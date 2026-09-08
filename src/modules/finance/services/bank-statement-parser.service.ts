import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@kannan19302/database/prisma";
import * as crypto from "crypto";

export interface ParsedTransaction {
  date: Date;
  amount: number;
  currency: string;
  isDebit: boolean;
  description: string;
  reference?: string;
  bankReference?: string;
  transactionCode?: string;
  balanceAfter?: number;
  hash: string;
}

export interface ParsedBankStatement {
  statementId: string;
  accountNumber: string;
  currency: string;
  openingBalance: number;
  openingBalanceDate: Date;
  closingBalance: number;
  closingBalanceDate: Date;
  transactions: ParsedTransaction[];
  totalDebit: number;
  totalCredit: number;
  netMovement: number;
  format: "MT940" | "CAMT053";
}

export interface ImportStatementResult {
  statement: ParsedBankStatement;
  connectionId: string;
  importedCount: number;
  duplicateCount: number;
  importedTransactions: any[];
}

@Injectable()
export class BankStatementParserService {
  /**
   * Parse SWIFT MT940 formatted text content into a structured statement model.
   */
  parseMT940(rawContent: string): ParsedBankStatement {
    if (!rawContent || !rawContent.trim()) {
      throw new BadRequestException("MT940 content cannot be empty.");
    }

    const lines = rawContent.replace(/\r\n/g, "\n").split("\n");
    let statementId = `MT940-${Date.now()}`;
    let accountNumber = "UNKNOWN";
    let currency = "USD";
    let openingBalance = 0;
    let openingDate = new Date();
    let closingBalance = 0;
    let closingDate = new Date();

    const transactions: ParsedTransaction[] = [];
    let currentTx: Partial<ParsedTransaction> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || "";
      if (!line) continue;

      if (line.startsWith(":20:")) {
        statementId = line.substring(4).trim();
      } else if (line.startsWith(":25:")) {
        accountNumber = line.substring(4).trim();
      } else if (line.startsWith(":60F:") || line.startsWith(":60M:")) {
        // e.g. :60F:C240101EUR125000,50
        const content = line.substring(5).trim();
        const isCredit = content.charAt(0) === "C";
        const dateStr = content.substring(1, 7); // YYMMDD
        const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
        const month = parseInt(dateStr.substring(2, 4), 10) - 1;
        const day = parseInt(dateStr.substring(4, 6), 10);
        openingDate = new Date(Date.UTC(year, month, day));

        currency = content.substring(7, 10);
        const amountStr = content.substring(10).replace(",", ".");
        const val = parseFloat(amountStr) || 0;
        openingBalance = isCredit ? val : -val;
      } else if (line.startsWith(":61:")) {
        // If a transaction was pending, push it
        if (currentTx && currentTx.date && currentTx.amount !== undefined) {
          this.finalizeTransaction(currentTx, accountNumber, currency, transactions);
          currentTx = null;
        }

        // e.g. :61:2401050105CR4500,00NTRFNONREF//CUST1234
        // or :61:240105D120,50NTRFREF123
        const content = line.substring(4).trim();
        const dateStr = content.substring(0, 6);
        const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
        const month = parseInt(dateStr.substring(2, 4), 10) - 1;
        const day = parseInt(dateStr.substring(4, 6), 10);
        const txDate = new Date(Date.UTC(year, month, day));

        let offset = 6;
        // Check optional entry date (4 digits MMDD)
        if (/^\d{4}/.test(content.substring(offset))) {
          offset += 4;
        }

        // Debit or Credit indicator (C, D, RC, RD)
        let isDebit = false;
        if (content.substring(offset).startsWith("RC")) {
          isDebit = true; // Reversal of credit -> debit
          offset += 2;
        } else if (content.substring(offset).startsWith("RD")) {
          isDebit = false; // Reversal of debit -> credit
          offset += 2;
        } else if (content.charAt(offset) === "D") {
          isDebit = true;
          offset += 1;
        } else if (content.charAt(offset) === "C") {
          isDebit = false;
          offset += 1;
        }

        // Skip optional funds code (1 char non-digit)
        if (!/^\d/.test(content.charAt(offset))) {
          offset += 1;
        }

        // Parse amount up to next alphabetic character (transaction type code N...)
        const amountMatch = content.substring(offset).match(/^([0-9]+[,\.][0-9]{0,2}|[0-9]+)/);
        let amount = 0;
        if (amountMatch && amountMatch[1]) {
          amount = parseFloat(amountMatch[1].replace(",", "."));
          offset += amountMatch[1].length;
        }

        const remaining = content.substring(offset).trim();
        const txCode = remaining.substring(0, 4);
        const refPart = remaining.substring(4);
        const refParts = refPart.split("//");
        const reference = refParts[0]?.trim() || "";
        const bankReference = refParts[1]?.trim() || "";

        currentTx = {
          date: txDate,
          amount: isDebit ? -amount : amount,
          isDebit,
          currency,
          transactionCode: txCode,
          reference: reference === "NONREF" ? undefined : reference,
          bankReference,
          description: `MT940 ${txCode} ${reference || ""}`.trim(),
        };
      } else if (line.startsWith(":86:")) {
        // Narrative line for current transaction
        const narrative = line.substring(4).trim();
        if (currentTx) {
          currentTx.description = narrative || currentTx.description;
        }
      } else if (line.startsWith(":62F:") || line.startsWith(":62M:")) {
        // Closing balance
        if (currentTx && currentTx.date && currentTx.amount !== undefined) {
          this.finalizeTransaction(currentTx, accountNumber, currency, transactions);
          currentTx = null;
        }

        const content = line.substring(5).trim();
        const isCredit = content.charAt(0) === "C";
        const dateStr = content.substring(1, 7);
        const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
        const month = parseInt(dateStr.substring(2, 4), 10) - 1;
        const day = parseInt(dateStr.substring(4, 6), 10);
        closingDate = new Date(Date.UTC(year, month, day));

        const amountStr = content.substring(10).replace(",", ".");
        const val = parseFloat(amountStr) || 0;
        closingBalance = isCredit ? val : -val;
      } else if (currentTx && !line.startsWith(":")) {
        // Multi-line continuation of :86: narrative
        currentTx.description += ` ${line}`;
      }
    }

    if (currentTx && currentTx.date && currentTx.amount !== undefined) {
      this.finalizeTransaction(currentTx, accountNumber, currency, transactions);
    }

    const totalCredit = transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDebit = transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const netMovement = Math.round((totalCredit - totalDebit) * 100) / 100;

    return {
      statementId,
      accountNumber,
      currency,
      openingBalance,
      openingBalanceDate: openingDate,
      closingBalance,
      closingBalanceDate: closingDate,
      transactions,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      netMovement,
      format: "MT940",
    };
  }

  /**
   * Parse ISO 20022 CAMT.053 XML statement.
   */
  parseCAMT053(xmlContent: string): ParsedBankStatement {
    if (!xmlContent || !xmlContent.trim()) {
      throw new BadRequestException("CAMT.053 XML content cannot be empty.");
    }

    const statementIdMatch = xmlContent.match(/<Id>([^<]+)<\/Id>/);
    const statementId = statementIdMatch && statementIdMatch[1] ? statementIdMatch[1] : `CAMT053-${Date.now()}`;

    // Extract Account IBAN or ID
    const ibanMatch = xmlContent.match(/<IBAN>([^<]+)<\/IBAN>/);
    const othrIdMatch = xmlContent.match(/<Othr>\s*<Id>([^<]+)<\/Id>/);
    const accountNumber =
      ibanMatch && ibanMatch[1]
        ? ibanMatch[1]
        : othrIdMatch && othrIdMatch[1]
          ? othrIdMatch[1]
          : "UNKNOWN_ACCOUNT";

    // Extract Opening and Closing Balances
    let openingBalance = 0;
    let openingDate = new Date();
    let closingBalance = 0;
    let closingDate = new Date();
    let currency = "USD";

    // Match all <Bal>...</Bal> blocks
    const balRegex = /<Bal>([\s\S]*?)<\/Bal>/g;
    let balMatch: RegExpExecArray | null;

    while ((balMatch = balRegex.exec(xmlContent)) !== null) {
      const balBlock = balMatch[1] || "";
      const isOpbd = /<Cd>OPBD<\/Cd>|<Cd>PRCD<\/Cd>/.test(balBlock);
      const isClbd = /<Cd>CLBD<\/Cd>|<Cd>CLAV<\/Cd>/.test(balBlock);

      const amtMatch = balBlock.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
      const cdtDbtMatch = balBlock.match(/<CdtDbtInd>([^<]+)<\/CdtDbtInd>/);
      const dtMatch = balBlock.match(/<Dt>([^<]+)<\/Dt>/);

      if (amtMatch && amtMatch[1] && amtMatch[2]) {
        currency = amtMatch[1];
        const val = parseFloat(amtMatch[2]) || 0;
        const isCredit = cdtDbtMatch ? cdtDbtMatch[1] === "CRDT" : true;
        const balance = isCredit ? val : -val;
        const bDate = dtMatch && dtMatch[1] ? new Date(dtMatch[1]) : new Date();

        if (isOpbd) {
          openingBalance = balance;
          openingDate = bDate;
        } else if (isClbd) {
          closingBalance = balance;
          closingDate = bDate;
        }
      }
    }

    // Match all Entries (<Ntry>...</Ntry>)
    const transactions: ParsedTransaction[] = [];
    const ntryRegex = /<Ntry>([\s\S]*?)<\/Ntry>/g;
    let ntryMatch: RegExpExecArray | null;

    while ((ntryMatch = ntryRegex.exec(xmlContent)) !== null) {
      const ntryBlock = ntryMatch[1] || "";
      const amtMatch = ntryBlock.match(/<Amt(?:\s+Ccy="([^"]+)")?>([^<]+)<\/Amt>/);
      const cdtDbtMatch = ntryBlock.match(/<CdtDbtInd>([^<]+)<\/CdtDbtInd>/);
      const valDtMatch = ntryBlock.match(/<(?:ValDt|BookgDt)>\s*<Dt>([^<]+)<\/Dt>/);
      const ustrdMatch = ntryBlock.match(/<Ustrd>([^<]+)<\/Ustrd>/);
      const endToEndIdMatch = ntryBlock.match(/<EndToEndId>([^<]+)<\/EndToEndId>/);

      if (amtMatch && amtMatch[2]) {
        const entryCurrency = amtMatch[1] || currency;
        const rawAmount = parseFloat(amtMatch[2]) || 0;
        const isDebit = cdtDbtMatch ? cdtDbtMatch[1] === "DBIT" : false;
        const amount = isDebit ? -rawAmount : rawAmount;
        const txDate = valDtMatch && valDtMatch[1] ? new Date(valDtMatch[1]) : new Date();
        const description = ustrdMatch && ustrdMatch[1] ? ustrdMatch[1].trim() : `CAMT.053 Entry ${amount > 0 ? "Credit" : "Debit"}`;
        const reference = endToEndIdMatch && endToEndIdMatch[1] ? endToEndIdMatch[1].trim() : undefined;

        const hash = crypto
          .createHash("sha256")
          .update(`${accountNumber}:${txDate.toISOString().slice(0, 10)}:${amount}:${description}`)
          .digest("hex");

        transactions.push({
          date: txDate,
          amount,
          currency: entryCurrency,
          isDebit,
          description,
          reference,
          hash,
        });
      }
    }

    const totalCredit = transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDebit = transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const netMovement = Math.round((totalCredit - totalDebit) * 100) / 100;

    return {
      statementId,
      accountNumber,
      currency,
      openingBalance,
      openingBalanceDate: openingDate,
      closingBalance,
      closingBalanceDate: closingDate,
      transactions,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      netMovement,
      format: "CAMT053",
    };
  }

  /**
   * Import parsed statement transactions directly into the bank feeds ledger.
   */
  async importStatement(
    tenantId: string,
    connectionId: string,
    rawContent: string,
    preferredFormat?: "MT940" | "CAMT053",
  ): Promise<ImportStatementResult> {
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, tenantId },
      include: { bankAccount: true },
    });

    if (!connection) {
      throw new NotFoundException("Bank Connection not found");
    }

    // Auto-detect format if not explicitly provided
    let format: "MT940" | "CAMT053" = preferredFormat || "MT940";
    if (!preferredFormat) {
      format = rawContent.includes("<Document") || rawContent.includes("<BkToCstmrStmt")
        ? "CAMT053"
        : "MT940";
    }

    const statement = format === "CAMT053"
      ? this.parseCAMT053(rawContent)
      : this.parseMT940(rawContent);

    const importedTransactions: any[] = [];
    let duplicateCount = 0;

    for (const tx of statement.transactions) {
      // Check for duplicate transaction within ±24 hours with exact amount and matching description prefix
      const existing = await prisma.bankTransaction.findFirst({
        where: {
          connectionId,
          tenantId,
          amount: new Prisma.Decimal(tx.amount),
          date: {
            gte: new Date(tx.date.getTime() - 24 * 60 * 60 * 1000),
            lte: new Date(tx.date.getTime() + 24 * 60 * 60 * 1000),
          },
          description: {
            startsWith: tx.description.slice(0, 20),
          },
        },
      });

      if (existing) {
        duplicateCount++;
        continue;
      }

      const created = await prisma.bankTransaction.create({
        data: {
          tenantId,
          connectionId,
          date: tx.date,
          amount: new Prisma.Decimal(tx.amount),
          description: tx.description,
          status: "UNMATCHED",
        },
      });

      importedTransactions.push(created);
    }

    // Update connection last synced timestamp
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date() },
    });

    return {
      statement,
      connectionId,
      importedCount: importedTransactions.length,
      duplicateCount,
      importedTransactions,
    };
  }

  private finalizeTransaction(
    tx: Partial<ParsedTransaction>,
    accountNumber: string,
    currency: string,
    list: ParsedTransaction[],
  ) {
    if (!tx.date || tx.amount === undefined) return;
    const isDebit = tx.amount < 0;
    const desc = tx.description || `MT940 Transaction ${tx.transactionCode || ""}`;
    const hash = crypto
      .createHash("sha256")
      .update(`${accountNumber}:${tx.date.toISOString().slice(0, 10)}:${tx.amount}:${desc}`)
      .digest("hex");

    list.push({
      date: tx.date,
      amount: tx.amount,
      currency,
      isDebit,
      description: desc,
      reference: tx.reference,
      bankReference: tx.bankReference,
      transactionCode: tx.transactionCode,
      hash,
    });
  }
}
