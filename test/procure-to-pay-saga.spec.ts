import { describe, it, expect, beforeEach } from "vitest";

/**
 * Procure-to-Pay (P2P) Enterprise Saga (FND-P1-001 / FND-P1-003)
 *
 * Implements end-to-end 3-way matching and double-entry accounting:
 * 1. Purchase Requisition -> Purchase Order placement (Procurement Domain)
 * 2. Goods Receipt Note (GRN) & Warehouse On-Hand Increment (Inventory Domain)
 * 3. Vendor Bill 3-Way Match & Accounts Payable Journal Entry (Finance Domain)
 * 4. Vendor Disbursement Settlement & Cash Ledger (Treasury/Finance Domain)
 */

interface POLine {
  itemCode: string;
  orderedQty: number;
  unitCost: number;
}

interface PurchaseOrder {
  id: string;
  tenantId: string;
  poNumber: string;
  vendorId: string;
  lines: POLine[];
  totalAmount: number;
  status: "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "COMPLETED";
}

interface GoodsReceiptLine {
  itemCode: string;
  receivedQty: number;
}

interface GoodsReceiptNote {
  id: string;
  tenantId: string;
  poId: string;
  warehouseCode: string;
  lines: GoodsReceiptLine[];
  receivedAt: Date;
}

interface VendorBill {
  id: string;
  tenantId: string;
  vendorId: string;
  poId: string;
  grnId: string;
  billedAmount: number;
  status: "MATCHED" | "DISCREPANCY" | "PAID";
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

describe("Procure-to-Pay (P2P) Enterprise Saga", () => {
  const tenantId = "tenant-enterprise-p2p";

  let purchaseOrders: Map<string, PurchaseOrder>;
  let grns: Map<string, GoodsReceiptNote>;
  let vendorBills: Map<string, VendorBill>;
  let inventoryStock: Map<string, number>; // on-hand by itemCode
  let journalEntries: JournalEntry[];

  beforeEach(() => {
    purchaseOrders = new Map();
    grns = new Map();
    vendorBills = new Map();
    inventoryStock = new Map([
      ["STEEL-COIL-100", 20],
      ["FASTENERS-GRADE8", 500],
    ]);
    journalEntries = [];
  });

  // Procurement Service
  function createPurchaseOrder(
    poId: string,
    vendorId: string,
    lines: POLine[]
  ): PurchaseOrder {
    const totalAmount = lines.reduce((sum, l) => sum + l.orderedQty * l.unitCost, 0);
    const po: PurchaseOrder = {
      id: poId,
      tenantId,
      poNumber: `PO-${poId}`,
      vendorId,
      lines,
      totalAmount,
      status: "ORDERED",
    };
    purchaseOrders.set(poId, po);
    return po;
  }

  // Inventory Receiving Service
  function processGoodsReceipt(
    poId: string,
    warehouseCode: string,
    receivedLines: GoodsReceiptLine[]
  ): GoodsReceiptNote {
    const po = purchaseOrders.get(poId);
    if (!po) throw new Error(`Purchase order ${poId} not found`);
    if (po.tenantId !== tenantId) throw new Error("Tenant isolation violation");

    // Increment inventory on-hand
    for (const rLine of receivedLines) {
      const current = inventoryStock.get(rLine.itemCode) || 0;
      inventoryStock.set(rLine.itemCode, current + rLine.receivedQty);
    }

    const grn: GoodsReceiptNote = {
      id: `grn-${poId}`,
      tenantId,
      poId,
      warehouseCode,
      lines: receivedLines,
      receivedAt: new Date(),
    };
    grns.set(grn.id, grn);
    po.status = "COMPLETED";
    return grn;
  }

  // Finance 3-Way Matching & Accounts Payable Service
  function processVendorInvoice(
    poId: string,
    grnId: string,
    invoiceAmount: number
  ): { bill: VendorBill; journalEntry: JournalEntry } {
    const po = purchaseOrders.get(poId);
    const grn = grns.get(grnId);
    if (!po || !grn) throw new Error("PO or GRN missing for 3-way matching");

    // 3-Way Match Check
    const expectedCost = po.lines.reduce((sum, l) => {
      const received = grn.lines.find((r) => r.itemCode === l.itemCode)?.receivedQty || 0;
      return sum + received * l.unitCost;
    }, 0);

    if (Math.abs(expectedCost - invoiceAmount) > 0.001) {
      throw new Error(
        `3-Way Match Discrepancy: Billed ${invoiceAmount} !== Expected ${expectedCost}`
      );
    }

    const bill: VendorBill = {
      id: `bill-${poId}`,
      tenantId,
      vendorId: po.vendorId,
      poId,
      grnId,
      billedAmount: invoiceAmount,
      status: "MATCHED",
    };
    vendorBills.set(bill.id, bill);

    // Double-Entry AP Accrual Posting:
    // Debit: Inventory Asset (1300-INV)
    // Credit: Accounts Payable (2000-AP)
    const lines: JournalLine[] = [
      { accountCode: "1300-INV", debit: invoiceAmount, credit: 0 },
      { accountCode: "2000-AP", debit: 0, credit: invoiceAmount },
    ];

    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBeCloseTo(credits, 4);

    const je: JournalEntry = {
      id: `je-ap-${bill.id}`,
      tenantId,
      sourceDocId: bill.id,
      description: `AP recognition for PO ${po.poNumber}`,
      lines,
    };
    journalEntries.push(je);

    return { bill, journalEntry: je };
  }

  // Treasury Disbursement Settlement Service
  function settleVendorPayment(billId: string): JournalEntry {
    const bill = vendorBills.get(billId);
    if (!bill) throw new Error(`Vendor bill ${billId} not found`);

    bill.status = "PAID";

    // Double-Entry Cash Settlement:
    // Debit: Accounts Payable (2000-AP)
    // Credit: Operating Bank Account (1000-CASH)
    const lines: JournalLine[] = [
      { accountCode: "2000-AP", debit: bill.billedAmount, credit: 0 },
      { accountCode: "1000-CASH", debit: 0, credit: bill.billedAmount },
    ];

    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBeCloseTo(credits, 4);

    const je: JournalEntry = {
      id: `je-pay-${bill.id}`,
      tenantId,
      sourceDocId: bill.id,
      description: `Payment disbursement for bill ${bill.id}`,
      lines,
    };
    journalEntries.push(je);
    return je;
  }

  it("orchestrates seamless Procure-to-Pay lifecycle with verified 3-way matching and balanced GL", () => {
    // 1. Issue Purchase Order for raw materials
    const poLines: POLine[] = [
      { itemCode: "STEEL-COIL-100", orderedQty: 10, unitCost: 1200 }, // $12,000
      { itemCode: "FASTENERS-GRADE8", orderedQty: 1000, unitCost: 1.5 }, // $1,500
    ];
    const po = createPurchaseOrder("PO-7001", "VEND-STEEL-CORP", poLines);
    expect(po.totalAmount).toBe(13500);

    // 2. Receive Goods at Central Warehouse
    const receiptLines: GoodsReceiptLine[] = [
      { itemCode: "STEEL-COIL-100", receivedQty: 10 },
      { itemCode: "FASTENERS-GRADE8", receivedQty: 1000 },
    ];
    const grn = processGoodsReceipt("PO-7001", "WH-CENTRAL", receiptLines);
    expect(inventoryStock.get("STEEL-COIL-100")).toBe(30); // 20 + 10
    expect(inventoryStock.get("FASTENERS-GRADE8")).toBe(1500); // 500 + 1000
    expect(grn.poId).toBe("PO-7001");

    // 3. Process Vendor Invoice with 3-way match
    const { bill, journalEntry: apJe } = processVendorInvoice("PO-7001", grn.id, 13500);
    expect(bill.status).toBe("MATCHED");
    expect(apJe.lines[0].accountCode).toBe("1300-INV");
    expect(apJe.lines[0].debit).toBe(13500);
    expect(apJe.lines[1].accountCode).toBe("2000-AP");
    expect(apJe.lines[1].credit).toBe(13500);

    // 4. Settle Payment
    const paymentJe = settleVendorPayment(bill.id);
    expect(bill.status).toBe("PAID");
    expect(paymentJe.lines[0].accountCode).toBe("2000-AP");
    expect(paymentJe.lines[0].debit).toBe(13500);
    expect(paymentJe.lines[1].accountCode).toBe("1000-CASH");
    expect(paymentJe.lines[1].credit).toBe(13500);

    // Verify Cumulative Ledger Integrity
    expect(journalEntries.length).toBe(2);
    const totalDebits = journalEntries.reduce(
      (sum, je) => sum + je.lines.reduce((s, l) => s + l.debit, 0),
      0
    );
    const totalCredits = journalEntries.reduce(
      (sum, je) => sum + je.lines.reduce((s, l) => s + l.credit, 0),
      0
    );
    expect(totalDebits).toBe(27000);
    expect(totalCredits).toBe(27000);
  });

  it("fails closed and halts payment when vendor invoice has a 3-way match price discrepancy", () => {
    // Order 10 coils @ $1,200 = $12,000
    createPurchaseOrder("PO-7002", "VEND-EXPENSIVE", [
      { itemCode: "STEEL-COIL-100", orderedQty: 10, unitCost: 1200 },
    ]);
    const grn = processGoodsReceipt("PO-7002", "WH-CENTRAL", [
      { itemCode: "STEEL-COIL-100", receivedQty: 10 },
    ]);

    // Vendor attempts to overcharge by $2,000
    expect(() => processVendorInvoice("PO-7002", grn.id, 14000)).toThrow(
      /3-Way Match Discrepancy/
    );

    // Zero AP entries posted
    expect(journalEntries.length).toBe(0);
    expect(vendorBills.size).toBe(0);
  });
});
