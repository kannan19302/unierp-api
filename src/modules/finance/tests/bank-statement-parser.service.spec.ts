import { describe, it, expect, vi, beforeEach } from "vitest";
import { BankStatementParserService } from "../services/bank-statement-parser.service";
import { prisma } from "@kannan19302/database";
import { BadRequestException, NotFoundException } from "@nestjs/common";

vi.mock("@kannan19302/database", () => {
  return {
    prisma: {
      bankConnection: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      bankTransaction: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

describe("BankStatementParserService", () => {
  let service: BankStatementParserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BankStatementParserService();
  });

  const sampleMT940 = `
:20:STMT-2026-001
:25:NL91ABNA0417164300
:28C:00012/001
:60F:C260101EUR50000,00
:61:2601030103CR1500,50NTRFNONREF//INV-9901
:86:Customer settlement for Invoice 9901
:61:2601040104D250,00NCHGREF-FEE//BANKFEE
:86:Monthly Account Maintenance Fee
:62F:C260105EUR51250,50
  `.trim();

  const sampleCAMT053 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>CAMT-STATEMENT-402</Id>
      <Acct>
        <Id>
          <IBAN>DE89370400440532013000</IBAN>
        </Id>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">75000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>2026-01-01</Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry>
        </Tp>
        <Amt Ccy="EUR">78200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>2026-01-10</Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">3500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-01-05</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-SALES-883</EndToEndId></Refs>
            <RmtInf><Ustrd>Software License Annual Payment</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">300.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-01-08</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-WIRE-011</EndToEndId></Refs>
            <RmtInf><Ustrd>International SWIFT Wire Surcharge</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`.trim();

  describe("parseMT940", () => {
    it("parses SWIFT MT940 statement tags, amounts, balances, and narratives accurately", () => {
      const result = service.parseMT940(sampleMT940);

      expect(result.statementId).toBe("STMT-2026-001");
      expect(result.accountNumber).toBe("NL91ABNA0417164300");
      expect(result.currency).toBe("EUR");
      expect(result.openingBalance).toBe(50000.0);
      expect(result.closingBalance).toBe(51250.5);
      expect(result.transactions).toHaveLength(2);

      // Inflow check
      const creditTx = result.transactions[0];
      expect(creditTx.amount).toBe(1500.5);
      expect(creditTx.isDebit).toBe(false);
      expect(creditTx.description).toBe("Customer settlement for Invoice 9901");
      expect(creditTx.bankReference).toBe("INV-9901");

      // Outflow check
      const debitTx = result.transactions[1];
      expect(debitTx.amount).toBe(-250.0);
      expect(debitTx.isDebit).toBe(true);
      expect(debitTx.description).toBe("Monthly Account Maintenance Fee");

      // Total summary
      expect(result.totalCredit).toBe(1500.5);
      expect(result.totalDebit).toBe(250.0);
      expect(result.netMovement).toBe(1250.5);
    });

    it("throws BadRequestException for empty or invalid MT940 content", () => {
      expect(() => service.parseMT940("")).toThrow(BadRequestException);
    });
  });

  describe("parseCAMT053", () => {
    it("parses ISO 20022 CAMT.053 XML opening/closing balances and transactions accurately", () => {
      const result = service.parseCAMT053(sampleCAMT053);

      expect(result.statementId).toBe("CAMT-STATEMENT-402");
      expect(result.accountNumber).toBe("DE89370400440532013000");
      expect(result.currency).toBe("EUR");
      expect(result.openingBalance).toBe(75000.0);
      expect(result.closingBalance).toBe(78200.0);
      expect(result.transactions).toHaveLength(2);

      const entry1 = result.transactions[0];
      expect(entry1.amount).toBe(3500.0);
      expect(entry1.isDebit).toBe(false);
      expect(entry1.description).toBe("Software License Annual Payment");
      expect(entry1.reference).toBe("E2E-SALES-883");

      const entry2 = result.transactions[1];
      expect(entry2.amount).toBe(-300.0);
      expect(entry2.isDebit).toBe(true);
      expect(entry2.description).toBe("International SWIFT Wire Surcharge");

      expect(result.totalCredit).toBe(3500.0);
      expect(result.totalDebit).toBe(300.0);
      expect(result.netMovement).toBe(3200.0);
    });

    it("throws BadRequestException for empty CAMT.053 XML content", () => {
      expect(() => service.parseCAMT053("   ")).toThrow(BadRequestException);
    });
  });

  describe("importStatement", () => {
    const tenantId = "tenant-bank-01";
    const connectionId = "conn-chase-01";

    it("throws NotFoundException if bank connection is missing", async () => {
      vi.mocked(prisma.bankConnection.findFirst).mockResolvedValue(null);

      await expect(
        service.importStatement(tenantId, connectionId, sampleMT940),
      ).rejects.toThrow(NotFoundException);
    });

    it("imports new transactions and skips duplicate transactions", async () => {
      vi.mocked(prisma.bankConnection.findFirst).mockResolvedValue({
        id: connectionId,
        tenantId,
        bankName: "ABN AMRO",
        accountNumber: "NL91ABNA0417164300",
      } as any);

      // Simulate first tx is new, second tx already exists (duplicate)
      vi.mocked(prisma.bankTransaction.findFirst)
        .mockResolvedValueOnce(null) // first tx is new
        .mockResolvedValueOnce({ id: "existing-tx-2" } as any); // second tx duplicate

      vi.mocked(prisma.bankTransaction.create).mockResolvedValue({
        id: "new-tx-1",
        tenantId,
        connectionId,
        amount: 1500.5,
        description: "Customer settlement for Invoice 9901",
        status: "UNMATCHED",
      } as any);

      const result = await service.importStatement(tenantId, connectionId, sampleMT940, "MT940");

      expect(result.importedCount).toBe(1);
      expect(result.duplicateCount).toBe(1);
      expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(1);
      expect(prisma.bankConnection.update).toHaveBeenCalledWith({
        where: { id: connectionId },
        data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      });
    });
  });
});
