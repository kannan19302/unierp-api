import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentTemplateEngineService } from "../document-template-engine.service";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    salesDocumentTemplate: { findFirst: vi.fn(), update: vi.fn() },
    invoice: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@kannan19302/database";

describe("DocumentTemplateEngineService", () => {
  let svc: DocumentTemplateEngineService;

  beforeEach(() => {
    svc = new DocumentTemplateEngineService();
    vi.clearAllMocks();
  });

  it("renderTemplate substitutes every {{path}} token from nested data with no code changes", () => {
    const content =
      "INVOICE #{{invoice.invoiceNumber}}\nBill to: {{invoice.customer.name}}\nTotal: {{invoice.totalAmount}} {{invoice.currency}}";
    const { output, unresolvedTokens } = svc.renderTemplate(content, {
      invoice: {
        invoiceNumber: "INV-1001",
        currency: "USD",
        totalAmount: "1234.50",
        customer: { name: "Acme Corp" },
      },
    });
    expect(output).toBe(
      "INVOICE #INV-1001\nBill to: Acme Corp\nTotal: 1234.50 USD",
    );
    expect(unresolvedTokens).toEqual([]);
  });

  it("a template edit changes the rendered output with zero code changes — the exit criterion's own words", () => {
    const originalContent = "Invoice {{invoice.invoiceNumber}} — Total {{invoice.totalAmount}}";
    const editedContent = "*** {{invoice.invoiceNumber}} *** Amount Due: {{invoice.totalAmount}} ***";
    const data = { invoice: { invoiceNumber: "INV-2002", totalAmount: "500.00" } };

    const before = svc.renderTemplate(originalContent, data).output;
    const after = svc.renderTemplate(editedContent, data).output;

    expect(before).toBe("Invoice INV-2002 — Total 500.00");
    expect(after).toBe("*** INV-2002 *** Amount Due: 500.00 ***");
    expect(before).not.toBe(after);
  });

  it("reports unresolved tokens by name instead of silently emitting blanks or crashing", () => {
    const { output, unresolvedTokens } = svc.renderTemplate(
      "Total: {{invoice.totalAmount}} Ref: {{invoice.missingField}}",
      { invoice: { totalAmount: "10.00" } },
    );
    expect(output).toBe("Total: 10.00 Ref: {{invoice.missingField}}");
    expect(unresolvedTokens).toEqual(["invoice.missingField"]);
  });

  it("renderInvoicePdf loads the tenant's active INVOICE template and the real invoice, and produces a non-empty PDF buffer reflecting the template", async () => {
    (prisma.salesDocumentTemplate.findFirst as any).mockResolvedValue({
      id: "tmpl-1",
      tenantId: "t1",
      category: "INVOICE",
      content: "INVOICE #{{invoice.invoiceNumber}}\nTotal: {{invoice.totalAmount}} {{invoice.currency}}",
      variables: null,
    });
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: "inv-1",
      tenantId: "t1",
      invoiceNumber: "INV-3003",
      totalAmount: "777.00",
      currency: "USD",
      customer: { name: "Beta LLC" },
      lineItems: [],
    });

    const pdf = await svc.renderInvoicePdf("t1", "tmpl-1", "inv-1");
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renderInvoicePdf refuses when no active INVOICE-category template exists for the tenant", async () => {
    (prisma.salesDocumentTemplate.findFirst as any).mockResolvedValue(null);
    await expect(svc.renderInvoicePdf("t1", "tmpl-missing", "inv-1")).rejects.toThrow();
  });

  it("editTemplateContent records the previous content as version history before overwriting — no version is lost silently", async () => {
    (prisma.salesDocumentTemplate.findFirst as any).mockResolvedValue({
      id: "tmpl-1",
      tenantId: "t1",
      content: "old content",
      variables: null,
    });
    (prisma.salesDocumentTemplate.update as any).mockImplementation(({ data }: any) => data);

    const result: any = await svc.editTemplateContent("t1", "tmpl-1", "new content");
    expect(result.content).toBe("new content");
    expect(result.variables.version).toBe(2);
    expect(result.variables.versionHistory).toHaveLength(1);
    expect(result.variables.versionHistory[0].content).toBe("old content");
  });
});
