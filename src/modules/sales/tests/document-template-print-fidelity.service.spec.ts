/**
 * E30 exit criterion: "An invoice in hi-IN with ₹ lakh grouping and a
 * 200-line table renders correctly across page breaks."
 *
 * No PDF-parsing dependency is available in this checkout, so this spec
 * observes the REAL pdfkit PDFDocument's own API calls (addPage/text) via
 * prototype spies, rather than decoding the produced PDF bytes. pdfkit
 * itself is real and unmocked — only the call sequence is captured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    salesDocumentTemplate: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@kannan19302/database";
import { DocumentTemplateEngineService } from "../document-template-engine.service";

function makeLineItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `li-${i}`,
    description: `Item ${i + 1}`,
    quantity: 1,
    unitPrice: 1000,
    totalAmount: 1000,
  }));
}

describe("E30 · invoice PDFs are locale/currency-correct and paginate a large table correctly", () => {
  let svc: DocumentTemplateEngineService;
  let textCalls: { page: number; text: string }[];
  let pageCount: number;
  let originalAddPage: any;
  let originalText: any;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new DocumentTemplateEngineService();
    (prisma.salesDocumentTemplate.findFirst as any).mockResolvedValue({
      id: "tmpl-1",
      tenantId: "t1",
      category: "INVOICE",
      content: "INVOICE #{{invoice.invoiceNumber}}",
      variables: null,
    });

    textCalls = [];
    pageCount = 1;
    originalAddPage = PDFDocument.prototype.addPage;
    originalText = PDFDocument.prototype.text;
    PDFDocument.prototype.addPage = function (...args: any[]) {
      pageCount++;
      return originalAddPage.apply(this, args);
    };
    PDFDocument.prototype.text = function (text: any, ...args: any[]) {
      textCalls.push({ page: pageCount, text: String(text) });
      return originalText.apply(this, [text, ...args]);
    };
  });

  afterEach(() => {
    PDFDocument.prototype.addPage = originalAddPage;
    PDFDocument.prototype.text = originalText;
  });

  it("formats a large total using hi-IN lakh grouping and the ₹ symbol, not a raw unformatted number", async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: "inv-1",
      tenantId: "t1",
      invoiceNumber: "INV-LAKH-1",
      totalAmount: 1234567.89,
      currency: "INR",
      customer: { name: "Acme India Pvt Ltd" },
      lineItems: makeLineItems(3),
    });

    await svc.renderInvoicePdf("t1", "tmpl-1", "inv-1", "hi-IN");
    const allText = textCalls.map((c) => c.text).join(" ");
    // hi-IN lakh grouping of 1234567.89 is "12,34,567.89" — plain
    // "1,234,567.89" (US grouping) would be the un-localized bug.
    expect(allText).toContain("₹12,34,567.89");
    expect(allText).not.toContain("1,234,567.89");
  });

  it("a 200-line-item invoice renders across MULTIPLE pages, not a single unreadable page", async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: "inv-2",
      tenantId: "t1",
      invoiceNumber: "INV-BIG-1",
      totalAmount: 200000,
      currency: "INR",
      customer: { name: "Big Order Ltd" },
      lineItems: makeLineItems(200),
    });

    await svc.renderInvoicePdf("t1", "tmpl-1", "inv-2", "hi-IN");
    expect(pageCount).toBeGreaterThan(1);
  });

  it("every page of a multi-page invoice repeats the table column headers — not just page 1", async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: "inv-3",
      tenantId: "t1",
      invoiceNumber: "INV-BIG-2",
      totalAmount: 200000,
      currency: "INR",
      customer: { name: "Big Order Ltd" },
      lineItems: makeLineItems(200),
    });

    await svc.renderInvoicePdf("t1", "tmpl-1", "inv-3", "hi-IN");
    const headerCallsPerPage = new Set(textCalls.filter((c) => c.text === "Description").map((c) => c.page));
    // Every page that carries table ROWS repeats the header — a trailing
    // page holding only the final total line legitimately has none, so
    // this allows headerCallsPerPage to be pageCount or pageCount-1, but
    // never just 1 (that would mean no repetition happened at all).
    expect(headerCallsPerPage.size).toBeGreaterThan(1);
    expect(headerCallsPerPage.size).toBeGreaterThanOrEqual(pageCount - 1);
  });

  it("the invoice total is printed once, correctly, at the end — not once per page or omitted", async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: "inv-4",
      tenantId: "t1",
      invoiceNumber: "INV-BIG-3",
      totalAmount: 50000,
      currency: "INR",
      customer: { name: "Total Check Ltd" },
      lineItems: makeLineItems(50),
    });

    await svc.renderInvoicePdf("t1", "tmpl-1", "inv-4", "hi-IN");
    const totalOccurrences = textCalls.filter((c) => c.text.includes("₹50,000.00")).length;
    expect(totalOccurrences).toBe(1);
  });
});
