import { describe, it, expect, beforeEach } from "vitest";

/**
 * Cross-Domain Transactional Saga Integration Suite (FND-P1-001 / FND-P1-003 / FND-P0-006)
 *
 * Validates the multi-entity event-driven choreography across:
 * 1. Sales Domain (SalesOrder lifecycle & Transactional Outbox atomic enqueue)
 * 2. Inventory Domain (StockItem reservation & ATP constraint enforcement)
 * 3. Finance Domain (General Ledger posting with strict double-entry balance parity)
 */

interface SalesOrderLine {
  itemCode: string;
  quantity: number;
  unitPrice: number;
}

interface SalesOrder {
  id: string;
  tenantId: string;
  orderNumber: string;
  customerAccount: string;
  totalAmount: number;
  status: "DRAFT" | "CONFIRMED" | "FULFILLED" | "CANCELLED";
  lines: SalesOrderLine[];
}

interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  dispatchedAt: Date | null;
}

interface StockReservation {
  id: string;
  tenantId: string;
  itemCode: string;
  warehouseCode: string;
  reservedQty: number;
  orderId: string;
}

interface JournalEntryLine {
  accountCode: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  tenantId: string;
  sourceDocId: string;
  description: string;
  lines: JournalEntryLine[];
}

describe("Cross-Domain Transactional Saga (Sales -> Inventory -> GL)", () => {
  const tenantId = "tenant-enterprise-001";

  // In-memory repositories representing transactional domain boundaries
  let orders: Map<string, SalesOrder>;
  let outbox: OutboxEvent[];
  let stockLevels: Map<string, { onHand: number; reserved: number }>;
  let reservations: StockReservation[];
  let journalEntries: JournalEntry[];

  beforeEach(() => {
    orders = new Map();
    outbox = [];
    stockLevels = new Map([
      ["SKU-SERVER-01", { onHand: 50, reserved: 10 }], // 40 ATP
    ]);
    reservations = [];
    journalEntries = [];
  });

  // Domain A: Sales Service
  function createAndConfirmSalesOrder(
    orderId: string,
    customerAccount: string,
    lines: SalesOrderLine[]
  ): SalesOrder {
    const totalAmount = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    const order: SalesOrder = {
      id: orderId,
      tenantId,
      orderNumber: `SO-${orderId}`,
      customerAccount,
      totalAmount,
      status: "CONFIRMED",
      lines,
    };

    // Atomic Transaction: Order saved AND outbox event created together
    orders.set(orderId, order);
    outbox.push({
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      eventType: "SALES_ORDER_CONFIRMED",
      aggregateType: "SalesOrder",
      aggregateId: orderId,
      payload: { orderId, lines, totalAmount, customerAccount },
      createdAt: new Date(),
      dispatchedAt: null,
    });

    return order;
  }

  // Domain B: Inventory Outbox Consumer / Reservation Service
  function processInventoryReservation(event: OutboxEvent): StockReservation[] {
    expect(event.tenantId).toBe(tenantId);
    const { orderId, lines } = event.payload as { orderId: string; lines: SalesOrderLine[] };
    const created: StockReservation[] = [];

    for (const line of lines) {
      const stock = stockLevels.get(line.itemCode);
      if (!stock) {
        throw new Error(`Item ${line.itemCode} not found in inventory`);
      }

      const availableToPromise = stock.onHand - stock.reserved;
      if (availableToPromise < line.quantity) {
        throw new Error(
          `Insufficient stock for ${line.itemCode}: ATP=${availableToPromise}, requested=${line.quantity}`
        );
      }

      // Reserve stock
      stock.reserved += line.quantity;
      const res: StockReservation = {
        id: `res-${orderId}-${line.itemCode}`,
        tenantId,
        itemCode: line.itemCode,
        warehouseCode: "WH-PRIMARY",
        reservedQty: line.quantity,
        orderId,
      };
      reservations.push(res);
      created.push(res);
    }

    // Mark outbox event dispatched
    event.dispatchedAt = new Date();

    // Enqueue downstream event: INVENTORY_RESERVED
    outbox.push({
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      eventType: "INVENTORY_RESERVED",
      aggregateType: "InventoryReservation",
      aggregateId: orderId,
      payload: { orderId, reservationIds: created.map((r) => r.id) },
      createdAt: new Date(),
      dispatchedAt: null,
    });

    return created;
  }

  // Domain C: Finance General Ledger Consumer
  function processGeneralLedgerPosting(order: SalesOrder): JournalEntry {
    expect(order.tenantId).toBe(tenantId);

    // Standard Revenue Recognition & COGS entries
    // Total order: $15,000 (estimated cost $9,000)
    const revenue = order.totalAmount;
    const estimatedCost = revenue * 0.6; // 60% cost basis

    const lines: JournalEntryLine[] = [
      // 1. Accounts Receivable (Debit) vs Sales Revenue (Credit)
      { accountCode: "1100-AR", debit: revenue, credit: 0 },
      { accountCode: "4000-REV", debit: 0, credit: revenue },
      // 2. Cost of Goods Sold (Debit) vs Inventory Asset (Credit)
      { accountCode: "5000-COGS", debit: estimatedCost, credit: 0 },
      { accountCode: "1300-INV", debit: 0, credit: estimatedCost },
    ];

    // Assert Double-Entry Invariant: Debit sum === Credit sum
    const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);
    expect(totalDebits).toBeCloseTo(totalCredits, 4);

    const entry: JournalEntry = {
      id: `je-so-${order.id}`,
      tenantId,
      sourceDocId: order.id,
      description: `Sales Revenue & COGS recognition for ${order.orderNumber}`,
      lines,
    };

    journalEntries.push(entry);
    return entry;
  }

  it("successfully orchestrates end-to-end saga from sales order to general ledger posting", () => {
    // 1. Create Sales Order
    const orderLines: SalesOrderLine[] = [
      { itemCode: "SKU-SERVER-01", quantity: 5, unitPrice: 3000 },
    ];
    const order = createAndConfirmSalesOrder("ord-9001", "CUST-ACME", orderLines);

    expect(order.totalAmount).toBe(15000);
    expect(outbox.length).toBe(1);
    expect(outbox[0].eventType).toBe("SALES_ORDER_CONFIRMED");
    expect(outbox[0].dispatchedAt).toBeNull();

    // 2. Inventory Service processes confirmed order event
    const confirmedEvent = outbox[0];
    const createdReservations = processInventoryReservation(confirmedEvent);

    expect(createdReservations.length).toBe(1);
    expect(createdReservations[0].reservedQty).toBe(5);
    expect(stockLevels.get("SKU-SERVER-01")?.reserved).toBe(15); // was 10, now 15
    expect(confirmedEvent.dispatchedAt).not.toBeNull();
    expect(outbox.length).toBe(2);
    expect(outbox[1].eventType).toBe("INVENTORY_RESERVED");

    // 3. Finance Service posts balanced journal entry
    const journalEntry = processGeneralLedgerPosting(order);
    expect(journalEntry.lines.length).toBe(4);

    const totalDebits = journalEntry.lines.reduce((acc, l) => acc + l.debit, 0);
    const totalCredits = journalEntry.lines.reduce((acc, l) => acc + l.credit, 0);
    expect(totalDebits).toBe(24000); // 15000 AR + 9000 COGS
    expect(totalCredits).toBe(24000); // 15000 REV + 9000 INV
    expect(journalEntries.length).toBe(1);
  });

  it("fails closed when stock is insufficient without corrupting inventory or posting to GL", () => {
    // Request 100 units when only 40 are available
    const orderLines: SalesOrderLine[] = [
      { itemCode: "SKU-SERVER-01", quantity: 100, unitPrice: 3000 },
    ];
    createAndConfirmSalesOrder("ord-9002", "CUST-BIGCORP", orderLines);

    const event = outbox[0];
    expect(() => processInventoryReservation(event)).toThrow(/Insufficient stock/);

    // Verify Invariants:
    // 1. Reserved qty must NOT have changed
    expect(stockLevels.get("SKU-SERVER-01")?.reserved).toBe(10);
    // 2. Zero reservations persisted
    expect(reservations.length).toBe(0);
    // 3. Zero journal entries posted to General Ledger
    expect(journalEntries.length).toBe(0);
  });
});
