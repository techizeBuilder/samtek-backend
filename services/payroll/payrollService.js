// Payroll from the database (2026-11-11): loads a company's month in a few queries,
// then pays each person with payrollCalc. The preview, Run Payroll, Recalculate
// and the payslip all come from here, so they can't disagree.
import User from '../../models/User.js';
import SalaryStructure from '../../models/SalaryStructure.js';
import Attendance from '../../models/Attendance.js';
import Leave from '../../models/Leave.js';
import LeaveType from '../../models/LeaveType.js';
import Holiday from '../../models/Holiday.js';
import Payroll from '../../models/Payroll.js';
import { AttendancePolicy } from '../../models/AttendancePolicy.js';
import { indiaDate } from '../deviceSync/deviceProcess.js';
import { dayKinds, computePay, monthDates, monthFinished } from './payrollCalc.js';
import { isPlatformAdmin, isInMyCompany } from '../../utils/companyScope.js';

export class PayrollError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const name = (u) => u.fullName || u.username || 'Unknown';

export function companyOf(reqUser, companyId) {
  const id = isPlatformAdmin(reqUser) ? companyId || reqUser?.companyId : reqUser?.companyId;
  if (!id) throw new PayrollError(400, 'Choose a company');
  return id;
}

export function checkMonth(month) {
  if (!MONTH_RE.test(String(month || ''))) throw new PayrollError(400, 'Month must look like 2026-11');
}

// The company's weekly off days: Sunday unless HR changed it.
export async function weeklyOffDaysFor(companyId) {
  const p = await AttendancePolicy.findOne({ companyId }).select('weeklyOffDays').lean();
  return Array.isArray(p?.weeklyOffDays) ? p.weeklyOffDays : [0];
}

/** Everything a month's pay needs, for a company or some of its people. */
export async function loadCompanyInputs(companyId, month, { userIds } = {}) {
  const dates = monthDates(month);
  const first = dates[0], last = dates.at(-1);
  const userQuery = { companyId, ...(userIds ? { _id: { $in: userIds } } : {}) };
  const users = await User.find(userQuery)
    .select('fullName username employeeId deviceCode joiningDate isActive canLogin role')
    .lean();
  const ids = users.map((u) => u._id);
  const startAt = new Date(`${first}T00:00:00+05:30`), endAt = new Date(`${last}T23:59:59.999+05:30`);

  const [salaries, attendance, leaves, types, holidays, weeklyOffDays] = await Promise.all([
    SalaryStructure.find({ employee: { $in: ids } }).lean(),
    Attendance.find({ user: { $in: ids }, date: { $gte: first, $lte: last } }).lean(),
    Leave.find({ employee: { $in: ids }, status: 'APPROVED', fromDate: { $lte: endAt }, toDate: { $gte: startAt } }).lean(),
    LeaveType.find({ $or: [{ companyId }, { companyId: { $exists: false } }, { companyId: null }] }).lean(),
    Holiday.find({ companyId, isActive: { $ne: false }, date: { $gte: new Date(startAt.getTime() - 86400000), $lte: new Date(endAt.getTime() + 86400000) } }).lean(),
    weeklyOffDaysFor(companyId),
  ]);

  // The company's own leave type wins over one with no company.
  const paidByName = new Map();
  for (const t of [...types].sort((a, b) => (a.companyId ? 1 : 0) - (b.companyId ? 1 : 0))) paidByName.set(t.name, !!t.paid);
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) { const k = String(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };
  return {
    month, users,
    salaryOf: new Map(salaries.map((s) => [String(s.employee), s])),
    attendanceOf: group(attendance, 'user'),
    leavesOf: group(leaves, 'employee'),
    leavePaid: (n) => paidByName.get(n) === true,
    holidays: holidays.map((h) => ({ date: indiaDate(h.date), paid: h.paid !== false })).filter((h) => h.date >= first && h.date <= last),
    weeklyOffDays,
  };
}

/** One person's month: their days and their pay. */
export function payFor(inputs, user, today = indiaDate()) {
  const id = String(user._id);
  const days = dayKinds({
    month: inputs.month, today,
    person: { joiningDate: user.joiningDate, deviceCode: user.deviceCode },
    attendance: inputs.attendanceOf.get(id) || [],
    leaves: inputs.leavesOf.get(id) || [],
    leavePaid: inputs.leavePaid,
    holidays: inputs.holidays,
    weeklyOffDays: inputs.weeklyOffDays,
  });
  return { days, pay: computePay(days, inputs.salaryOf.get(id)) };
}

// Paid this month: has a salary, joined by the month's end, and still here or paid something.
function splitPeople(inputs, today) {
  const last = monthDates(inputs.month).at(-1);
  const paid = [], noSalary = [];
  for (const u of inputs.users) {
    if (u.joiningDate && indiaDate(u.joiningDate) > last) continue;
    if (!inputs.salaryOf.has(String(u._id))) {
      if (u.isActive !== false) noSalary.push({ userId: u._id, name: name(u), employeeId: u.employeeId });
      continue;
    }
    const { days, pay } = payFor(inputs, u, today);
    if (u.isActive === false && pay.payDays === 0) continue;
    paid.push({ user: u, days, pay });
  }
  return { paid, noSalary };
}

const payrollFields = (pay) => ({
  gross: pay.gross, deduction: pay.deduction, net: pay.net,
  payDays: pay.payDays, lopDays: pay.lopDays,
  workingDays: pay.workingDays, earned: pay.earned, fixedDeduction: pay.fixedDeduction,
  lopAmount: pay.lopAmount, workedOnOff: pay.workedOnOff, days: pay.days,
});

/** The Payroll Run table: a saved row where there is one, otherwise the calculation. Paged here. */
export async function monthRows(reqUser, month, { page = 1, limit = 15, search = '', companyId } = {}) {
  checkMonth(month);
  const company = companyOf(reqUser, companyId);
  const today = indiaDate();
  const inputs = await loadCompanyInputs(company, month);
  const { paid, noSalary } = splitPeople(inputs, today);
  const saved = new Map((await Payroll.find({ month, employee: { $in: inputs.users.map((u) => u._id) } }).lean()).map((p) => [String(p.employee), p]));

  let rows = paid.map(({ user, pay }) => {
    const s = saved.get(String(user._id));
    const base = { userId: user._id, name: name(user), employeeId: user.employeeId, onDevice: !!user.deviceCode };
    // A saved row shows what was saved. Rows saved before 11 Nov 2026 have no day counts.
    if (s) return { ...base, payrollId: s._id, status: s.status, rejectReason: s.rejectReason, rejectedAt: s.rejectedAt, ...payrollFields(s) };
    return { ...base, status: 'Not run', ...payrollFields(pay) };
  });
  // Someone paid earlier who no longer qualifies still shows, from the saved row.
  for (const [id, s] of saved) {
    if (rows.some((r) => String(r.userId) === id)) continue;
    const u = inputs.users.find((x) => String(x._id) === id);
    rows.push({ userId: s.employee, name: u ? name(u) : 'Unknown', employeeId: u?.employeeId, payrollId: s._id, status: s.status, rejectReason: s.rejectReason, rejectedAt: s.rejectedAt, ...payrollFields(s) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce((t, r) => ({ gross: t.gross + (r.gross || 0), deduction: t.deduction + (r.deduction || 0), net: t.net + (r.net || 0) }), { gross: 0, deduction: 0, net: 0 });
  const notRun = rows.filter((r) => r.status === 'Not run').length;
  const people = rows.length;
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    rows = rows.filter((r) => re.test(r.name) || re.test(r.employeeId || ''));
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1), limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
  return {
    month, finished: monthFinished(month, today), weeklyOffDays: inputs.weeklyOffDays,
    rows: rows.slice((pageNum - 1) * limitNum, pageNum * limitNum),
    pagination: { page: pageNum, limit: limitNum, total: rows.length, pages: Math.ceil(rows.length / limitNum) || 1 },
    totals, notRun, people,
    noSalary: noSalary.slice(0, 100), noSalaryCount: noSalary.length,
  };
}

/** One person's days, for the row's detail. */
export async function personDays(reqUser, month, userId, { companyId } = {}) {
  checkMonth(month);
  const company = companyOf(reqUser, companyId);
  if (!userId || !(await isInMyCompany(reqUser, userId))) throw new PayrollError(404, 'Person not found');
  const inputs = await loadCompanyInputs(company, month, { userIds: [userId] });
  const u = inputs.users[0];
  if (!u) throw new PayrollError(404, 'Person not found');
  const { days, pay } = payFor(inputs, u);
  return { name: name(u), month, days, pay, hasSalary: inputs.salaryOf.has(String(u._id)) };
}

/** Run Payroll: a finished month only; adds rows for people without one, never changes a saved row. */
export async function runMonth(reqUser, month, { companyId } = {}) {
  checkMonth(month);
  if (!monthFinished(month)) throw new PayrollError(400, `Payroll for ${month} can be run after the month ends.`);
  const company = companyOf(reqUser, companyId);
  const inputs = await loadCompanyInputs(company, month);
  const { paid } = splitPeople(inputs, indiaDate());
  if (!paid.length) return { created: 0, kept: 0 };
  const res = await Payroll.bulkWrite(paid.map(({ user, pay }) => ({
    updateOne: {
      filter: { employee: user._id, month },
      update: { $setOnInsert: { employee: user._id, month, status: 'Paid', ...payrollFields(pay) } },
      upsert: true,
    },
  })), { ordered: false });
  return { created: res.upsertedCount, kept: paid.length - res.upsertedCount };
}

/** Recalculate a rejected row from today's attendance, leave and salary. */
export async function recalculateOne(reqUser, payrollId) {
  const p = payrollId && await Payroll.findById(payrollId).catch(() => null);
  if (!p || !(await isInMyCompany(reqUser, p.employee))) throw new PayrollError(404, 'Payroll not found');
  if (p.status === 'Paid') throw new PayrollError(400, 'Paid payroll cannot be recalculated');
  if (p.status !== 'Rejected') throw new PayrollError(400, 'Only rejected payroll can be recalculated');
  const owner = await User.findById(p.employee).select('companyId').lean();
  const inputs = await loadCompanyInputs(owner.companyId, p.month, { userIds: [p.employee] });
  const u = inputs.users[0];
  if (!inputs.salaryOf.has(String(u._id))) throw new PayrollError(400, 'This person has no salary structure');
  Object.assign(p, payrollFields(payFor(inputs, u).pay), { status: 'Paid', rejectReason: undefined, rejectedAt: undefined });
  await p.save();
  return p;
}
