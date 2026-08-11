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
  async renderInvoicePdf(tenantId: string, templateId: string, invoiceId: string): Promise<Buffer> {
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

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(11).text(output);
      doc.end();
    });
  }
}
