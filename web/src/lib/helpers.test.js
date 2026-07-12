import { describe, it, expect, beforeAll } from 'vitest';
import {
  computePay, weekStartISO, weekEndISO, addWeeks, weekLabel, fmtClock, fmtHM, syncAppSettings,
  periodStartISO, periodEndISO, addPeriod, periodLabel,
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

  it('pays nothing for zero hours', () => {
    const r = computePay(0, { hourlyRate: 20, overtimeRate: 30, overtimeThreshold: 40, weeklyLimit: 44 });
    expect(r).toMatchObject({ pay: 0, reg: 0, ot: 0, billable: 0, overLimit: 0 });
  });

  it('pays nothing when no rate is set', () => {
    const r = computePay(10, {});
    expect(r.pay).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('handles fractional hours to the cent', () => {
    const r = computePay(8.5, { hourlyRate: 12.5 });
    expect(r.pay).toBe(106.25);
  });

  it('a weekly limit below the OT threshold prevents any overtime', () => {
    // 50 worked, OT would start at 40, but the 35 h limit caps billable first
    const r = computePay(50, { hourlyRate: 10, overtimeRate: 15, overtimeThreshold: 40, weeklyLimit: 35 });
    expect(r.billable).toBe(35);
    expect(r.overLimit).toBe(15);
    expect(r.reg).toBe(35);
    expect(r.ot).toBe(0);
    expect(r.pay).toBe(350);
  });

  it('an OT threshold of 0 makes every hour overtime', () => {
    const r = computePay(10, { hourlyRate: 10, overtimeRate: 15, overtimeThreshold: 0 });
    expect(r.reg).toBe(0);
    expect(r.ot).toBe(10);
    expect(r.pay).toBe(150);
  });

  it('applies an OT rate even when it is lower than the base rate', () => {
    const r = computePay(50, { hourlyRate: 10, overtimeRate: 5, overtimeThreshold: 40 });
    expect(r.pay).toBe(40 * 10 + 10 * 5); // 450 — no implicit max()
  });

  it('hours exactly at the weekly limit are fully billable', () => {
    const r = computePay(44, { hourlyRate: 10, weeklyLimit: 44 });
    expect(r.billable).toBe(44);
    expect(r.overLimit).toBe(0);
    expect(r.pay).toBe(440);
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
  it('crosses a month boundary correctly', () => {
    // 2026-08-01 is a Saturday → its own week start; 2026-08-03 (Mon) maps back to it
    expect(weekStartISO('2026-08-03')).toBe('2026-08-01');
    // a week that starts in July and ends in August
    expect(weekEndISO('2026-07-25')).toBe('2026-07-31');
  });
  it('crosses a year boundary correctly', () => {
    // 2027-01-01 is a Friday; the prior Saturday is 2026-12-26
    expect(weekStartISO('2027-01-01')).toBe('2026-12-26');
    expect(weekEndISO('2026-12-26')).toBe('2027-01-01');
  });
});

describe('pay periods', () => {
  it('weekly period equals the week', () => {
    expect(periodStartISO('2026-07-07', 'weekly')).toBe('2026-07-04');
    expect(periodEndISO('2026-07-04', 'weekly')).toBe('2026-07-10');
  });
  it('monthly spans the calendar month', () => {
    expect(periodStartISO('2026-07-07', 'monthly')).toBe('2026-07-01');
    expect(periodEndISO('2026-07-01', 'monthly')).toBe('2026-07-31');
    expect(periodStartISO('2026-02-15', 'monthly')).toBe('2026-02-01');
    expect(periodEndISO('2026-02-01', 'monthly')).toBe('2026-02-28');
    expect(periodLabel('2026-07-01', 'monthly')).toBe('July 2026');
  });
  it('biweekly block is 14 days (end = start + 13) and Saturday-aligned', () => {
    const p = periodStartISO('2026-07-07', 'biweekly');
    expect(weekStartISO(p)).toBe(p); // starts on a week boundary (Saturday)
    const [sy, sm, sd] = p.split('-').map(Number);
    const [ey, em, ed] = periodEndISO(p, 'biweekly').split('-').map(Number);
    const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    expect(days).toBe(13);
  });
  it('addPeriod moves by the right span', () => {
    expect(addPeriod('2026-07-04', 1, 'weekly')).toBe('2026-07-11');
    expect(addPeriod('2026-07-04', 1, 'biweekly')).toBe('2026-07-18');
    expect(addPeriod('2026-07-01', 1, 'monthly')).toBe('2026-08-01');
    expect(addPeriod('2026-01-01', -1, 'monthly')).toBe('2025-12-01');
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
