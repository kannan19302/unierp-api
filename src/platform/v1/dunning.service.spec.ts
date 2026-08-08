import { describe, it, expect } from 'vitest';
import { DunningService } from './dunning.service';

describe('DunningService - Dunning Ladder Logic', () => {
  const service = new DunningService({ record: async () => {} } as any);

  it('determines REMINDER for past due under 7 days', () => {
    expect(service.getNextDunningStep(1)).toBe('REMINDER');
    expect(service.getNextDunningStep(6)).toBe('REMINDER');
  });

  it('determines WARNING for past due between 7 and 13 days', () => {
    expect(service.getNextDunningStep(7)).toBe('WARNING');
    expect(service.getNextDunningStep(13)).toBe('WARNING');
  });

  it('determines FINAL_NOTICE for past due between 14 and 20 days', () => {
    expect(service.getNextDunningStep(14)).toBe('FINAL_NOTICE');
    expect(service.getNextDunningStep(20)).toBe('FINAL_NOTICE');
  });

  it('determines SUSPEND for past due 21 days or more', () => {
    expect(service.getNextDunningStep(21)).toBe('SUSPEND');
    expect(service.getNextDunningStep(60)).toBe('SUSPEND');
  });
});
