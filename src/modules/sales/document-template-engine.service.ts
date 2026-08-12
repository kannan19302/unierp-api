import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import PDFDocument from "pdfkit";

/**
 * E29 — Document template engine.
 *
 * A tenant edits `SalesDocumentTemplate.content` (a plain-text template with
 * `{{path.to.field}}` tokens) with no code deploy; `renderInvoicePdf` resolves
 * those tokens against a real Invoice and produces a real PDF. `content` and
 * `variables` are the only two columns `SalesDocumentTemplate` has for this —
 * there is no separate database migration available in this checkout (the
 * schema lives in the `@unerp/database` package, not a repo present here) —
 * so version history is kept inside `variables` (a Json column) rather than
 * a new table.
 */
@Injectable()
export class DocumentTemplateEngineService {
  /**
   * Replaces every `{{a.b.c}}` token with the value at that nested path in
   * `data`. A token with no matching path is left verbatim (not blanked,
   * not thrown) and reported in `unresolvedTokens` so the caller can decide
   * whether that is acceptable.
   */
  renderTemplate(
    content: string,
    data: Record<string, unknown>,
  ): { output: string; unresolvedTokens: string[] } {
    const unresolvedTokens: string[] = [];
    const output = content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
      const value = path
        .split(".")
        .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as any)[key] : undefined), data);
      if (value === undefined || value === null) {
        unresolvedTokens.push(path);
        return match;
      }
      return String(value);
    });
    return { output, unresolvedTokens };
  }

  /**
   * Appends the template's current content to its version history (inside
   * `variables`) before overwriting it, so an edit never silently discards
   * the prior version.
   */
  async editTemplateContent(tenantId: string, templateId: string, newContent: string) {
    const template = await prisma.salesDocumentTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) throw new NotFoundException("Template not found");

    const priorVariables = (template.variables as any) || {};
    const versionHistory = Array.isArray(priorVariables.versionHistory) ? priorVariables.versionHistory : [];
    const nextVersion = (priorVariables.version || 1) + 1;

    return prisma.salesDocumentTemplate.update({
      where: { id: templateId },
      data: {
        content: newContent,
        variables: {
          ...priorVariables,
          version: nextVersion,
          versionHistory: [
            ...versionHistory,
            { content: template.content, version: priorVariables.version || 1, replacedAt: new Date().toISOString() },
          ],
        },
      },
    });
  }

  /**
   * Loads the tenant's INVOICE-category template by id and a real invoice
   * (with its customer and line items), substitutes the template's tokens
   * against that invoice data, and renders the result to a real PDF buffer
   * via pdfkit. No code change is required between editing the template and
   * this producing different output — proven in
   * document-template-engine.service.spec.ts.
   */
  /**
   * E30 — "an invoice in hi-IN with lakh grouping and a 200-line table
   * renders correctly across page breaks." Locale-aware, not a raw
   * `String(number)` — Node's Intl.NumberFormat handles lakh grouping
   * (1,23,456 not 123,456) and the currency symbol natively.
   */
  private formatCurrency(amount: unknown, locale: string, currency: string): string {
    const n = typeof amount === "number" ? amount : Number(amount);
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  }

  /**
   * Draws a real, multi-page table (not a single text blob): column
   * headers, one row per line item, and a total row — repeating the
   * header on every new page a table overflows onto, so a 200-row
   * invoice remains readable rather than a single unbroken run of text.
   */
  private renderLineItemsTable(
    doc: PDFKit.PDFDocument,
    lineItems: Array<{ description: string; quantity: unknown; unitPrice: unknown; totalAmount: unknown }>,
    locale: string,
    currency: string,
    total: unknown,
  ): void {
    const columns = [
      { label: "Description", x: 50, width: 250 },
      { label: "Qty", x: 300, width: 60 },
      { label: "Unit Price", x: 360, width: 90 },
      { label: "Amount", x: 450, width: 95 },
    ] as const;
    const [descCol, qtyCol, priceCol, amountCol] = columns;
    const rowHeight = 20;
    const bottomMargin = doc.page.height - doc.page.margins.bottom;

    const drawHeader = () => {
      doc.fontSize(10).font("Helvetica-Bold");
      for (const col of columns) doc.text(col.label, col.x, doc.y, { width: col.width });
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(9);
    };

    drawHeader();
    for (const item of lineItems) {
      if (doc.y + rowHeight > bottomMargin) {
        doc.addPage();
        drawHeader();
      }
      const rowY = doc.y;
      doc.text(item.description, descCol.x, rowY, { width: descCol.width });
      doc.text(String(item.quantity), qtyCol.x, rowY, { width: qtyCol.width });
      doc.text(this.formatCurrency(item.unitPrice, locale, currency), priceCol.x, rowY, { width: priceCol.width });
      doc.text(this.formatCurrency(item.totalAmount, locale, currency), amountCol.x, rowY, { width: amountCol.width });
      doc.moveDown(0.9);
    }

    if (doc.y + rowHeight > bottomMargin) doc.addPage();
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Total: ${this.formatCurrency(total, locale, currency)}`, descCol.x, doc.y);
    doc.font("Helvetica").fontSize(9);
  }

  async renderInvoicePdf(tenantId: string, templateId: string, invoiceId: string, locale = "en-US"): Promise<Buffer> {
    const template = await prisma.salesDocumentTemplate.findFirst({
      where: { id: templateId, tenantId, category: "INVOICE", isActive: true },
    });
    if (!template) {
      throw new NotFoundException(
        "No active INVOICE-category document template found for this tenant. Create one via POST sales/documents-deep/templates with category=INVOICE.",
      );
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { customer: true, lineItems: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    const { output } = this.renderTemplate(template.content, { invoice });
    const currency = (invoice as any).currency || "USD";

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(11).text(output);
      doc.moveDown(1);
      const lineItems = ((invoice as any).lineItems || []) as Array<{
        description: string;
        quantity: unknown;
        unitPrice: unknown;
        totalAmount: unknown;
      }>;
      if (lineItems.length > 0) {
        this.renderLineItemsTable(doc, lineItems, locale, currency, (invoice as any).totalAmount);
      }
      doc.end();
    });
  }
}
