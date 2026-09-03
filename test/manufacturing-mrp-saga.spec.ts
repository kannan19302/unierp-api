import { describe, it, expect, beforeEach } from "vitest";

/**
 * Manufacturing Material Requirements Planning (MRP) Saga (FND-P1-001 / FND-P1-003)
 *
 * Validates discrete manufacturing production order execution:
 * 1. Production Order creation & BOM Component Explosion
 * 2. Raw Material Reservation & Inventory Consumption -> WIP Journal Entry
 * 3. Work Center Labor & Machine Overhead Allocation -> WIP Journal Entry
 * 4. Production Order Completion -> Finished Goods Receipt & WIP Relief
 */

interface BOMComponent {
  itemCode: string;
  qtyPerUnit: number;
  unitCost: number;
}

interface BillOfMaterials {
  bomCode: string;
  finishedItemCode: string;
  components: BOMComponent[];
}

interface ProductionOrder {
  id: string;
  tenantId: string;
  bomCode: string;
  quantityToProduce: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
}

interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  tenantId: string;
  sourceDocId: string;
  description: string;
  lines: JournalLine[];
}

describe("Manufacturing MRP & Production Order Saga", () => {
  const tenantId = "tenant-industrial-mfg";

  let boms: Map<string, BillOfMaterials>;
  let productionOrders: Map<string, ProductionOrder>;
  let rawStock: Map<string, number>;
  let finishedStock: Map<string, number>;
  let journalEntries: JournalEntry[];

  beforeEach(() => {
    boms = new Map();
    productionOrders = new Map();
    rawStock = new Map([
      ["SKU-MOTOR-01", 100], // 100 on hand @ $250
      ["SKU-BOARD-01", 30],  // 30 on hand @ $600
      ["SKU-ALUM-01", 500],  // 500kg on hand @ $50
    ]);
    finishedStock = new Map([
      ["SKU-ROBOT-FG", 0],
    ]);
    journalEntries = [];

    // Register Robot BOM
    boms.set("BOM-ROBOT-01", {
      bomCode: "BOM-ROBOT-01",
      finishedItemCode: "SKU-ROBOT-FG",
      components: [
        { itemCode: "SKU-MOTOR-01", qtyPerUnit: 4, unitCost: 250 },   // $1,000
        { itemCode: "SKU-BOARD-01", qtyPerUnit: 1, unitCost: 600 },   // $600
        { itemCode: "SKU-ALUM-01", qtyPerUnit: 10, unitCost: 50 },    // $500
      ], // Total Material Cost per unit: $2,100
    });
  });

  // Manufacturing Planning Service
  function createProductionOrder(
    orderId: string,
    bomCode: string,
    qty: number
  ): ProductionOrder {
    const bom = boms.get(bomCode);
    if (!bom) throw new Error(`BOM ${bomCode} not found`);

    const order: ProductionOrder = {
      id: orderId,
      tenantId,
      bomCode,
      quantityToProduce: qty,
      status: "PLANNED",
    };
    productionOrders.set(orderId, order);
    return order;
  }

  // Material Issue Service (Inventory -> WIP)
  function issueRawMaterialsToProduction(orderId: string): JournalEntry {
    const order = productionOrders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const bom = boms.get(order.bomCode)!;

    let totalMaterialCost = 0;

    // Check availability and decrement raw materials
    for (const comp of bom.components) {
      const requiredQty = comp.qtyPerUnit * order.quantityToProduce;
      const onHand = rawStock.get(comp.itemCode) || 0;

      if (onHand < requiredQty) {
        throw new Error(
          `Insufficient raw material for ${comp.itemCode}: required ${requiredQty}, onHand ${onHand}`
        );
      }

      rawStock.set(comp.itemCode, onHand - requiredQty);
      totalMaterialCost += requiredQty * comp.unitCost;
    }

    order.status = "IN_PROGRESS";

    // Finance Journal Entry: Transfer Raw Material to WIP
    // Debit: Work-In-Progress (1350-WIP)
    // Credit: Raw Material Inventory (1310-RAW-INV)
    const lines: JournalLine[] = [
      { accountCode: "1350-WIP", debit: totalMaterialCost, credit: 0 },
      { accountCode: "1310-RAW-INV", debit: 0, credit: totalMaterialCost },
    ];

    const je: JournalEntry = {
      id: `je-mat-${orderId}`,
      tenantId,
      sourceDocId: orderId,
      description: `Raw material issue for ${orderId}`,
      lines,
    };
    journalEntries.push(je);
    return je;
  }

  // Work Center Execution Service (Labor -> WIP)
  function recordDirectLabor(orderId: string, hours: number, hourlyRate: number): JournalEntry {
    const laborCost = hours * hourlyRate;

    // Debit: Work-In-Progress (1350-WIP)
    // Credit: Labor Accrued Clearing (2150-LABOR)
    const lines: JournalLine[] = [
      { accountCode: "1350-WIP", debit: laborCost, credit: 0 },
      { accountCode: "2150-LABOR", debit: 0, credit: laborCost },
    ];

    const je: JournalEntry = {
      id: `je-lab-${orderId}`,
      tenantId,
      sourceDocId: orderId,
      description: `Direct labor allocation for ${orderId}`,
      lines,
    };
    journalEntries.push(je);
    return je;
  }

  // Production Completion & Finished Goods Receipt Service
  function completeProductionOrder(orderId: string): { order: ProductionOrder; journalEntry: JournalEntry } {
    const order = productionOrders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const bom = boms.get(order.bomCode)!;

    // Calculate total accumulated WIP for this order
    const totalWIP = journalEntries
      .filter((je) => je.sourceDocId === orderId)
      .reduce((sum, je) => {
        const wipDebit = je.lines.find((l) => l.accountCode === "1350-WIP")?.debit || 0;
        return sum + wipDebit;
      }, 0);

    // Increment finished goods stock
    const currentFG = finishedStock.get(bom.finishedItemCode) || 0;
    finishedStock.set(bom.finishedItemCode, currentFG + order.quantityToProduce);
    order.status = "COMPLETED";

    // Finance Journal Entry: Relieve WIP to Finished Goods Inventory
    // Debit: Finished Goods Inventory (1320-FG-INV)
    // Credit: Work-In-Progress (1350-WIP)
    const lines: JournalLine[] = [
      { accountCode: "1320-FG-INV", debit: totalWIP, credit: 0 },
      { accountCode: "1350-WIP", debit: 0, credit: totalWIP },
    ];

    const je: JournalEntry = {
      id: `je-fg-${orderId}`,
      tenantId,
      sourceDocId: orderId,
      description: `Finished goods completion for ${orderId}`,
      lines,
    };
    journalEntries.push(je);

    return { order, journalEntry: je };
  }

  it("completes full manufacturing production order: BOM explosion, WIP accrual, and FG receipt", () => {
    // 1. Plan Production of 10 Robotic Arms
    const order = createProductionOrder("MO-8001", "BOM-ROBOT-01", 10);
    expect(order.status).toBe("PLANNED");

    // 2. Issue Raw Materials (40 motors, 10 boards, 100kg aluminum)
    const matJe = issueRawMaterialsToProduction("MO-8001");
    expect(rawStock.get("SKU-MOTOR-01")).toBe(60); // 100 - 40
    expect(rawStock.get("SKU-BOARD-01")).toBe(20);  // 30 - 10
    expect(rawStock.get("SKU-ALUM-01")).toBe(400);  // 500 - 100
    // Material cost: (40*250) + (10*600) + (100*50) = 10000 + 6000 + 5000 = $21,000
    expect(matJe.lines[0].debit).toBe(21000);

    // 3. Record Direct Labor (50 hours @ $80/hr = $4,000)
    const labJe = recordDirectLabor("MO-8001", 50, 80);
    expect(labJe.lines[0].debit).toBe(4000);

    // 4. Complete Production Order
    const { order: completedOrder, journalEntry: fgJe } = completeProductionOrder("MO-8001");
    expect(completedOrder.status).toBe("COMPLETED");
    expect(finishedStock.get("SKU-ROBOT-FG")).toBe(10); // 10 finished robots received

    // Total FG Value = $21,000 materials + $4,000 labor = $25,000 ($2,500/unit)
    expect(fgJe.lines[0].accountCode).toBe("1320-FG-INV");
    expect(fgJe.lines[0].debit).toBe(25000);
    expect(fgJe.lines[1].accountCode).toBe("1350-WIP");
    expect(fgJe.lines[1].credit).toBe(25000);

    // Invariant: Net WIP balance for this order must be zero
    const totalWipDebits = journalEntries.reduce(
      (sum, je) => sum + (je.lines.find((l) => l.accountCode === "1350-WIP")?.debit || 0),
      0
    );
    const totalWipCredits = journalEntries.reduce(
      (sum, je) => sum + (je.lines.find((l) => l.accountCode === "1350-WIP")?.credit || 0),
      0
    );
    expect(totalWipDebits).toBe(totalWipCredits); // $25,000 === $25,000
  });

  it("fails closed when raw material inventory is inadequate for BOM requirements", () => {
    // Attempt to produce 100 robots (requires 400 motors, but only 100 in stock)
    createProductionOrder("MO-8002", "BOM-ROBOT-01", 100);

    expect(() => issueRawMaterialsToProduction("MO-8002")).toThrow(
      /Insufficient raw material for SKU-MOTOR-01/
    );

    // Verify Invariants:
    // 1. Stock remains unchanged
    expect(rawStock.get("SKU-MOTOR-01")).toBe(100);
    // 2. Zero finished goods created
    expect(finishedStock.get("SKU-ROBOT-FG")).toBe(0);
    // 3. Zero WIP entries posted
    expect(journalEntries.length).toBe(0);
  });
});
