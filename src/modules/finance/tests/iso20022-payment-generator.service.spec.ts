import { describe, it, expect, vi, beforeEach } from "vitest";
import { Iso20022PaymentGeneratorService } from "../services/iso20022-payment-generator.service";
import { prisma } from "@kannan19302/database";
import { NotFoundException } from "@nestjs/common";
import * as crypto from "crypto";

vi.mock("@kannan19302/database", () => {
  return {
    prisma: {
      paymentBatch: {
        findFirst: vi.fn(),
      },
    },
  };
});

describe("Iso20022PaymentGeneratorService", () => {
  let service: Iso20022PaymentGeneratorService;
  const tenantId = "tenant-sepa-001";
  const batchId = "batch-101";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new Iso20022PaymentGeneratorService();
  });

  it("generates a valid ISO 20022 pain.001 XML payment batch with SHA-256 checksum", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      id: batchId,
      batchNumber: "PB-2026-001",
      currency: "EUR",
      totalAmount: 12500.5,
      tenantId,
      lines: [
        {
          id: "line-1",
          amount: 5000.25,
          vendorName: "Acme European Supplies & Logistics",
          recipientIban: "FR7630006000011234567890189",
          recipientBic: "BNPAFRPPXXX",
          notes: "Invoice #INV-2026-441 & Consulting",
        },
        {
          id: "line-2",
          amount: 7500.25,
          vendorName: "Nordic Tech Solutions <AB>",
          recipientIban: "DE89370400440532013000",
          recipientBic: "DBEUDEDDXXX",
          notes: "Software License Q3 > standard",
        },
      ],
    } as any);

    const result = await service.generatePain001Xml(tenantId, batchId, "UniERP Treasury Operations");

    expect(result.batchId).toBe(batchId);
    expect(result.currency).toBe("EUR");
    expect(result.transactionCount).toBe(2);
    expect(result.totalAmount).toBe(12500.5);

    // Verify XML tags
    expect(result.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result.xml).toContain('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
    expect(result.xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(result.xml).toContain("<CtrlSum>12500.50</CtrlSum>");
    expect(result.xml).toContain("<Nm>UniERP Treasury Operations</Nm>");
    expect(result.xml).toContain('<InstdAmt Ccy="EUR">5000.25</InstdAmt>');
    expect(result.xml).toContain('<InstdAmt Ccy="EUR">7500.25</InstdAmt>');
    expect(result.xml).toContain("<IBAN>FR7630006000011234567890189</IBAN>");
    expect(result.xml).toContain("<IBAN>DE89370400440532013000</IBAN>");

    // Verify XML escaping of special characters
    expect(result.xml).toContain("Acme European Supplies &amp; Logistics");
    expect(result.xml).toContain("Nordic Tech Solutions &lt;AB&gt;");

    // Verify SHA-256 Checksum
    const expectedChecksum = crypto.createHash("sha256").update(result.xml, "utf8").digest("hex");
    expect(result.sha256Checksum).toBe(expectedChecksum);
  });

  it("throws NotFoundException when batch is not found for tenant", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(null);

    await expect(service.generatePain001Xml(tenantId, "non-existent-batch")).rejects.toThrow(
      NotFoundException,
    );
  });
});
