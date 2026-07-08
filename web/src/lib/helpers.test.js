import { describe, it, expect, beforeAll } from 'vitest';
import {
  computePay, weekStartISO, weekEndISO, addWeeks, weekLabel, fmtClock, fmtHM, syncAppSettings,
} from './helpers.js';

// pin timezone + week start so date math is deterministic
beforeAll(() => { syncAppSettings({ timeZone: 'UTC', weekStartDay: 6, currency: '$' }); });

describe('computePay', () => {
  it('pays straight time with no OT or limit', () => {
    const r = computePay(10, { hourlyRate: 10 });
    expect(r.pay).toBe(100);
    expect(r.reg).toBe(10);
    expect(r.ot).toBe(0);
  });

  it('applies the overtime rate above the threshold', () => {
    const r = computePay(50, { hourlyRate: 10, overtimeRate: 15, overtimeThreshold: 40 });
    expect(r.reg).toBe(40);
    expect(r.ot).toBe(10);
    expect(r.pay).toBe(40 * 10 + 10 * 15); // 550
  });

  it('does not pay above the weekly limit', () => {
    const r = computePay(50, { hourlyRate: 10, weeklyLimit: 44 });
    expect(r.billable).toBe(44);
    expect(r.overLimit).toBe(6);
    expect(r.pay).toBe(440);
  });

  it('combines OT and weekly limit', () => {
    const r = computePay(55, { hourlyRate: 10, overtimeRate: 15, overtimeThreshold: 40, weeklyLimit: 50 });
    expect(r.billable).toBe(50);
    expect(r.overLimit).toBe(5);
    expect(r.reg).toBe(40);
    expect(r.ot).toBe(10);
    expect(r.pay).toBe(40 * 10 + 10 * 15); // 550
  });

  it("falls back to the base rate when no OT rate is set", () => {
    const r = computePay(50, { hourlyRate: 10, overtimeThreshold: 40 });
    expect(r.pay).toBe(500); // all hours at 10
  });

  it('treats empty-string limits as no limit', () => {
    const r = computePay(100, { hourlyRate: 5, overtimeThreshold: '', weeklyLimit: '' });
    expect(r.pay).toBe(500);
    expect(r.overLimit).toBe(0);
  });
});

describe('week math (Saturday start, UTC)', () => {
  it('finds the Saturday that starts the week', () => {
    // 2026-07-07 is a Tuesday; the prior Saturday is 2026-07-04
    expect(weekStartISO('2026-07-07')).toBe('2026-07-04');
  });
  it('a Saturday is its own week start', () => {
    expect(weekStartISO('2026-07-04')).toBe('2026-07-04');
  });
  it('week end is 6 days after start', () => {
    expect(weekEndISO('2026-07-04')).toBe('2026-07-10');
  });
  it('addWeeks shifts by 7-day multiples', () => {
    expect(addWeeks('2026-07-04', -1)).toBe('2026-06-27');
    expect(addWeeks('2026-07-04', 2)).toBe('2026-07-18');
  });
  it('labels the week range', () => {
    expect(weekLabel('2026-07-04')).toBe('Jul 04 – Jul 10, 2026');
  });
});

describe('time formatting', () => {
  it('formats H:MM:SS', () => {
    expect(fmtClock(3661)).toBe('1:01:01');
    expect(fmtClock(0)).toBe('0:00:00');
    expect(fmtClock(-5)).toBe('0:00:00');
  });
  it('formats compact H/M', () => {
    expect(fmtHM(3600)).toBe('1h 0m');
    expect(fmtHM(1500)).toBe('25m');
  });
});
