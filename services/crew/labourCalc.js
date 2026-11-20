// Stage 6 (2026-11-12): labour cost from a person's hours and salary. Pure: no
// database, so the hand-worked totals in
// docs/client-features-2026-11/02f-labour-cost-logic.md test it directly.
//
//   per day   = monthly gross ÷ that month's working days   (payroll's rule, stage 3)
//   per hour  = per day ÷ that day's shift hours            (no shifts → 8)
//   labour    = Σ hours that day × per hour that day
import { monthDates, weekday } from '../payroll/payrollCalc.js';

const n = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

/** Days in the month that aren't a weekly off. Holidays count, as in payroll. */
export function workingDaysIn(month, weeklyOffDays = [0]) {
  const off = new Set((weeklyOffDays || []).map(Number));
  return monthDates(month).filter((d) => !off.has(weekday(d))).length;
}

/** Monthly gross, the same as payroll's computePay. */
export const grossOf = (salary) => (salary ? n(salary.basic) + n(salary.hra) + n(salary.otherAllowance) : 0);

/** ₹ an hour on a day of `month`, with that day's shift hours. */
export function hourlyRate(gross, month, weeklyOffDays = [0], shiftHours = 8) {
  const days = workingDaysIn(month, weeklyOffDays);
  const hours = shiftHours > 0 ? shiftHours : 8;
  if (!(gross > 0) || !days) return 0;
  return gross / days / hours;
}

/**
 * One person's labour on a run. days: [{ date: 'YYYY-MM-DD', hours, shiftHours }].
 * No salary (or a gross of 0) → ₹0 and missing, so the price can say so.
 */
export function personLabour(days = [], salary = null, weeklyOffDays = [0]) {
  const gross = grossOf(salary);
  if (!(gross > 0)) return { labour: 0, missing: (days || []).some((d) => d.hours > 0) };
  let total = 0;
  for (const d of days || []) total += n(d.hours) * hourlyRate(gross, String(d.date).slice(0, 7), weeklyOffDays, d.shiftHours);
  return { labour: round2(total), missing: false };
}
