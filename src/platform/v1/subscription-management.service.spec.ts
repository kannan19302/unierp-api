import { SubscriptionManagementService } from './subscription-management.service';

describe('SubscriptionManagementService Financial Arithmetic', () => {
  let service: SubscriptionManagementService;

  beforeEach(() => {
    service = new SubscriptionManagementService({ record: jest.fn() } as any);
  });

  describe('calculateProration', () => {
    it('should calculate exact 50% proration halfway through monthly period', () => {
      const periodStart = new Date('2026-08-01T00:00:00Z');
      const periodEnd = new Date('2026-08-31T00:00:00Z');
      const effectiveDate = new Date('2026-08-16T00:00:00Z');

      const oldPlanPrice = 100;
      const newPlanPrice = 200;

      const result = service.calculateProration(
        oldPlanPrice,
        newPlanPrice,
        periodStart,
        periodEnd,
        effectiveDate,
      );

      // Remaining fraction = 15 / 30 = 0.5
      // Credit = 100 * 0.5 = 50
      // Charge = 200 * 0.5 = 100
      // Net = 100 - 50 = 50
      expect(result.creditAmount).toBe(50);
      expect(result.chargeAmount).toBe(100);
      expect(result.netAmount).toBe(50);
    });

    it('should handle mid-cycle downgrade resulting in net credit or zero', () => {
      const periodStart = new Date('2026-08-01T00:00:00Z');
      const periodEnd = new Date('2026-08-31T00:00:00Z');
      const effectiveDate = new Date('2026-08-16T00:00:00Z');

      const oldPlanPrice = 200;
      const newPlanPrice = 50;

      const result = service.calculateProration(
        oldPlanPrice,
        newPlanPrice,
        periodStart,
        periodEnd,
        effectiveDate,
      );

      // Remaining fraction = 0.5
      // Credit = 200 * 0.5 = 100
      // Charge = 50 * 0.5 = 25
      // Net = 25 - 100 = -75
      expect(result.creditAmount).toBe(100);
      expect(result.chargeAmount).toBe(25);
      expect(result.netAmount).toBe(-75);
    });

    it('should handle zero remaining time at end of period', () => {
      const periodStart = new Date('2026-08-01T00:00:00Z');
      const periodEnd = new Date('2026-08-31T00:00:00Z');
      const effectiveDate = new Date('2026-08-31T00:00:00Z');

      const result = service.calculateProration(100, 200, periodStart, periodEnd, effectiveDate);

      expect(result.creditAmount).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.netAmount).toBe(0);
    });
  });
});
