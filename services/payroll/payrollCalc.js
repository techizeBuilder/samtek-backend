// Pay for a month, day by day (2026-11-11). Pure: no database, so the hand-worked
// totals in docs/client-features-2026-11/02c-payroll-logic.md test it directly.
//
// Salary is for working days. A weekly off isn't a working day: not paid, not
// absence, not counted. Each other day gets one kind, the first rule that matches.
import { indiaDate } from '../deviceSync/deviceProcess.js';

export const KINDS = ['weeklyOff', 'notJoined', 'notYet', 'paidHoliday', 'unpaidHoliday', 'present', 'halfDay', 'paidLeave', 'unpaidLeave', 'absent'];

export const monthDates = (month) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// Finished = today (India) is after the month's last day.
export const monthFinished = (month, today = indiaDate()) => today > monthDates(month).at(-1);

const worked = (a) => !!a && (a.status === 'PRESENT' || a.status === 'HALF_DAY' || !!a.punchIn || !!a.punchOut || (a.totalWorkSeconds || 0) > 0);

const nextDate = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

// Leave dates are India dates, whether saved as UTC or India midnight.
const dayRange = (from, to) => {
  const out = [];
  for (let d = indiaDate(from), end = indiaDate(to); d <= end && out.length < 400; d = nextDate(d)) out.push(d);
  return out;
};

/**
 * One entry per date: { date, kind, pay, lop, worked }.
 * person: { joiningDate, deviceCode }; attendance: rows with date 'YYYY-MM-DD';
 * leaves: approved, { fromDate, toDate, leaveType }; leavePaid(name) → boolean;
 * holidays: [{ date (any Date or 'YYYY-MM-DD'), paid }]; weeklyOffDays: [0..6].
 */
export function dayKinds({ month, today = indiaDate(), person = {}, attendance = [], leaves = [], leavePaid = () => false, holidays = [], weeklyOffDays = [0] }) {
  const att = new Map(attendance.map((a) => [a.date, a]));
  const hol = new Map();
  for (const h of holidays) hol.set(typeof h.date === 'string' && h.date.length === 10 ? h.date : indiaDate(h.date), h.paid !== false);
  const leaveOn = new Map();
  for (const l of leaves) for (const d of dayRange(l.fromDate, l.toDate)) if (!leaveOn.has(d)) leaveOn.set(d, !!leavePaid(l.leaveType));
  const joined = person.joiningDate ? indiaDate(person.joiningDate) : null;
  const onDevice = !!person.deviceCode;

  return monthDates(month).map((date) => {
    const a = att.get(date);
    const w = worked(a);
    const offDay = weeklyOffDays.includes(weekday(date));
    const isOff = onDevice ? a?.status === 'WEEKLY_OFF' || (!a && offDay) : offDay;
    const day = (kind, pay = 0, lop = 0) => ({ date, kind, pay, lop, worked: w });

    if (isOff) return day('weeklyOff');
    if (joined && date < joined) return day('notJoined');
    if (date > today) return day('notYet');
    // Today, with nothing recorded yet, isn't absence: the day isn't over.
    if (date === today && !a && !hol.has(date) && !leaveOn.has(date)) return day('notYet');
    if (hol.has(date)) return hol.get(date) ? day('paidHoliday', 1) : day('unpaidHoliday');
    if (a?.status === 'HALF_DAY') return leaveOn.get(date) ? day('halfDay', 1) : day('halfDay', 0.5, 0.5);
    // The device's own Absent wins over a stray punch; anyone else counts as present once they worked.
    if (w && !(a.status === 'ABSENT' && a.source === 'Device')) return day('present', 1);
    if (leaveOn.has(date)) return leaveOn.get(date) ? day('paidLeave', 1) : day('unpaidLeave', 0, 1);
    return day('absent', 0, 1);
  });
}

const n = (v) => Number(v) || 0;

/** The month's money from its days. Payroll keeps its old meaning: gross − deduction = net. */
export function computePay(days, salary = {}) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let payDays = 0, lopDays = 0, workedOnOff = 0;
  for (const d of days) {
    counts[d.kind]++;
    payDays += d.pay;
    lopDays += d.lop;
    if (d.worked && (d.kind === 'weeklyOff' || d.kind === 'paidHoliday' || d.kind === 'unpaidHoliday')) workedOnOff++;
  }
  const workingDays = days.length - counts.weeklyOff;
  const gross = n(salary.basic) + n(salary.hra) + n(salary.otherAllowance);
  const fixedDeduction = n(salary.pf) + n(salary.professionalTax) + n(salary.tds) + n(salary.advance) + n(salary.others);
  const earned = workingDays ? Math.round((gross * payDays) / workingDays) : 0;
  const lopAmount = workingDays ? Math.round((gross * lopDays) / workingDays) : 0;
  return {
    workingDays, payDays, lopDays, workedOnOff, days: counts,
    gross, earned, lopAmount, fixedDeduction,
    deduction: fixedDeduction + (gross - earned),
    net: Math.max(0, earned - fixedDeduction),
  };
}
