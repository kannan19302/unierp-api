import { describe, it, expect } from 'vitest';
import { InvoicingService } from './invoicing.service';

describe('InvoicingService - Financial Arithmetic', () => {
  const service = new InvoicingService({ record: async () => {} } as any);

  it('calculates invoice totals without tax or discount correctly', () => {
    const res = service.calculateInvoiceTotals(100);
    expect(res.subtotal).toBe(100);
    expect(res.discountAmount).toBe(0);
    expect(res.taxAmount).toBe(0);
    expect(res.totalAmount).toBe(100);
  });

  it('calculates invoice totals with percentage tax and flat discount', () => {
    const res = service.calculateInvoiceTotals(200, 10, 20); // subtotal 200 - 20 discount = 180 * 10% tax = 18. total = 198
    expect(res.subtotal).toBe(200);
    expect(res.discountAmount).toBe(20);
    expect(res.taxAmount).toBe(18);
    expect(res.totalAmount).toBe(198);
  });

  it('handles discount larger than subtotal by capping at zero', () => {
    const res = service.calculateInvoiceTotals(50, 15, 100);
    expect(res.discountAmount).toBe(100);
    expect(res.taxAmount).toBe(0);
    expect(res.totalAmount).toBe(0);
  });
});
