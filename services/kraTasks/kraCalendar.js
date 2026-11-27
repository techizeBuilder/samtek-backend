// Feature 25, slice 3 (23 Nov 2026): working days for KRA tasks, the same way payroll counts
// them: the company's weekly off (AttendancePolicy, via weeklyOffDaysFor) and its active
// holidays; a person's approved leave covering the day.
import mongoose from 'mongoose';
import Holiday from '../../models/Holiday.js';
import Leave from '../../models/Leave.js';
import { weeklyOffDaysFor } from '../payroll/payrollService.js';
import { indiaDate } from '../deviceSync/deviceProcess.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const todayIndia = () => indiaDate(new Date());
/** 'YYYY-MM-DD' ± n days. */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const dayStart = (day) => new Date(`${day}T00:00:00+05:30`);
export const dayEnd = (day) => new Date(`${day}T23:59:59.999+05:30`);
/** A day's time ('HH:mm', India) as a Date. */
export const atTime = (day, hhmm) => new Date(`${day}T${/^\d{2}:\d{2}$/.test(hhmm || '') ? hhmm : '18:00'}:00+05:30`);

/**
 * The company's calendar around a day: { weeklyOff: Set(0..6), holidays: Set('YYYY-MM-DD'), isWorking(day) }.
 * Loads holidays from `back` days before to the day itself (one query).
 */
export async function calendarFor(companyId, day, back = 35) {
  const from = addDays(day, -back);
  const companyIds = [oid(companyId), String(companyId)];
  const [weeklyOff, hols] = await Promise.all([
    weeklyOffDaysFor(oid(companyId)),
    Holiday.find({ companyId: { $in: companyIds }, isActive: { $ne: false }, date: { $gte: new Date(dayStart(from).getTime() - 86400000), $lte: dayEnd(day) } }).select('date').lean(),
  ]);
  const off = new Set((weeklyOff || [0]).map(Number));
  const holidays = new Set(hols.map((h) => indiaDate(h.date)));
  const isWorking = (d) => !off.has(weekdayOf(d)) && !holidays.has(d);
  return { weeklyOff: off, holidays, isWorking };
}

/** The working day before `day` (looks back at most 31 days); null when none is found. */
export function previousWorkingDay(cal, day) {
  for (let i = 1; i <= 31; i++) { const d = addDays(day, -i); if (cal.isWorking(d)) return d; }
  return null;
}

/** Of these people, those on approved leave covering the day: Set(personId string). One query. */
export async function onLeave(personIds, day) {
  if (!personIds.length) return new Set();
  const rows = await Leave.find({ employee: { $in: personIds.map(oid) }, status: 'APPROVED', fromDate: { $lte: dayEnd(day) }, toDate: { $gte: dayStart(day) } }).select('employee').lean();
  return new Set(rows.map((r) => String(r.employee)));
}
