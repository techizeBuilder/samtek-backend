// Feature 32 (25 Nov 2026): HR's bulk import of people, with a login and without.
// docs/client-features-2026-11/32-employee-bulk-import-logic.md
//
// One sheet, one row per person, "Gets a login" Yes / No. Built the way the single forms build
// a person (userController createUser / createManpower). Check first; then everyone at once,
// all or nothing. The starting password (one for every login row) and each role's default
// permissions come from the import window, not the file. Department Heads wait for the
// Company Admin (feature 31). No-login people come in without their Aadhaar (listed after).
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../../models/User.js';
import Department from '../../models/Department.js';
import Designation from '../../models/Designation.js';
import { Company } from '../../models/Company.js';
import { getCompanyAbbr } from '../../utils/employeeUtils.js';
import { applyCodeQuietly } from '../deviceSync/deviceProcess.js';
import { needsHeadApproval, pendingRequest, notifyCompanyAdmin } from '../access/headApproval.js';
// Feature 34 (26 Nov 2026): custom roles are resolved to their base role, with their own list.
import { customRolesOf, defaultsFor, needsCustomApproval, customRoleFields } from '../access/customRoles.js';
import { applyRoleLimits } from '../access/roleLimits.js';
import { MAX_ROWS, ImportError, text, matchIn, readSheet, workbook, listColumns, sortProblems } from './common.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const lower = (v) => text(v).toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The roles HR gives with a login: the same list as the client's pages/hrms/loginRoles.ts
// (HRMS_ROLES + DEPARTMENT_HEAD_ROLES, by value). The suite peopleimport checks they match.
export const LOGIN_ROLES = [
  'Manager', 'Employee', 'Sales Employee', 'Production Employee', 'Dispatch Employee', 'Account Employee',
  'Research Development Employee', 'Complaint Management Employee', 'Store Employee', 'QC Employee', 'MIS Admin',
  'Marketing Employee',
  'Sales Head', 'Production Head', 'Dispatch Head', 'Accounts Head', 'Research & Development Head',
  'Complaint Management Head', 'Store Head', 'QC Head', 'Marketing Head',
];
const GENDERS = ['Male', 'Female'];
const EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Intern', 'Contract'];

export const COLUMNS = [
  { key: 'login', title: 'Gets a login *', required: true, help: 'Yes or No. No = labour / staff who only do the work (role Manpower, no sign-in).' },
  { key: 'name', title: 'Full Name *', required: true, help: 'Required.' },
  { key: 'mobile', title: 'Mobile *', required: true, help: 'Exactly 10 digits.' },
  { key: 'gender', title: 'Gender *', required: true, help: 'Male or Female.' },
  { key: 'dob', title: 'Date of Birth *', required: true, help: 'A date, e.g. 1995-04-21 or 21-04-1995.' },
  { key: 'joiningDate', title: 'Joining Date *', required: true, help: 'A date, e.g. 2026-11-01 or 01-11-2026.' },
  { key: 'department', title: 'Department *', required: true, help: 'From the "Lists" sheet.' },
  { key: 'designation', title: 'Designation *', required: true, help: 'From the "Lists" sheet (the name, or as listed with its department). It must belong to the row\'s department.' },
  { key: 'manager', title: 'Reporting Manager', help: 'A Manager from the "Lists" sheet: their email or employee ID. Required, except for someone whose role is Manager.' },
  { key: 'email', title: 'Email', help: 'With a login: required. Without: optional. A valid address that nobody has, not repeated in the file.' },
  { key: 'role', title: 'Role', help: 'With a login: required, from "Login roles" on the "Lists" sheet. A Department Head waits for the Company Admin\'s approval. Without a login: leave blank (Manpower).' },
  { key: 'ivr', title: 'IVR Extension', help: 'With a login. Digits only. Required for a Sales Employee.' },
  // 25 Nov (browser test): the form's "Is Trainee" tick, for someone with a login.
  { key: 'trainee', title: 'Is Trainee', help: 'With a login: Yes or No (blank = No). A trainee also gets the Trainee dashboard (LMS), as on the form.' },
  { key: 'deviceCode', title: 'Device Code', help: 'The attendance device code. Without a login: required. Type it as text (start with \') so 0005 stays 0005. Nobody in the company may have it, and it can\'t repeat in the file.' },
  { key: 'employmentType', title: 'Employment Type', help: 'Optional: Full-Time, Part-Time, Intern or Contract.' },
  { key: 'address', title: 'Address', help: 'Optional.' },
];
const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title.replace(/\s*\*$/, '')]));

/** An Excel date (serial number) or text as YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY → a UTC midnight Date, or null. */
export function parseDay(v) {
  if (v == null || text(v) === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  const t = text(v);
  let y, m, d;
  let x = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (x) [, y, m, d] = x;
  else if ((x = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = x;
  else return null;
  const out = new Date(Date.UTC(+y, +m - 1, +d));
  return out.getUTCFullYear() === +y && out.getUTCMonth() === +m - 1 && out.getUTCDate() === +d ? out : null;
}
const yes = (v) => ['yes', 'y', 'true', '1'].includes(lower(v));
const no = (v) => ['no', 'n', 'false', '0'].includes(lower(v));
const cleanCode = (v) => text(v); // as the form's cleanDeviceCode
const digits = (v) => text(v).replace(/\.0$/, ''); // 9876543210 read back as a number

async function companyLists(companyId) {
  const cid = oid(companyId);
  const [departments, designations, managers, custom] = await Promise.all([
    Department.find({ companyId: cid }).select('name').lean(),
    Designation.find({ companyId: cid }).select('name departmentId').lean(),
    User.find({ companyId: cid, role: 'Manager', isActive: { $ne: false } }).select('fullName email employeeId').lean(),
    customRolesOf(companyId), // feature 34: each custom role with its base role and list
  ]);
  const customRoles = custom.map((r) => r.name).filter(Boolean);
  return { departments, designations, managers, custom, roles: [...LOGIN_ROLES, ...customRoles.filter((r) => !LOGIN_ROLES.includes(r))] };
}

/** The template: People, How to fill, Lists. */
export async function buildTemplate(companyId) {
  const L = await companyLists(companyId);
  const deptName = new Map(L.departments.map((d) => [String(d._id), d.name]));
  const lists = {
    'Login roles': L.roles,
    Departments: L.departments.map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    Designations: L.designations.map((g) => (g.departmentId && deptName.get(String(g.departmentId)) ? `${g.name} (${deptName.get(String(g.departmentId))})` : g.name)).sort((a, b) => a.localeCompare(b)),
    Managers: L.managers.map((m) => [m.email, m.employeeId, m.fullName].filter(Boolean).join(' · ')),
    Gender: GENDERS,
    'Employment Type': EMPLOYMENT_TYPES,
  };
  const how = [
    ['How to fill the people import'],
    ['One row per person on the "People" sheet. Keep the header row. People with a login and without go in the same file.'],
    ['Upload: every row is checked first. If any row has a problem, nothing is imported and every problem is listed by row and column. New people only.'],
    ['Not in the file: the company and unit (yours), the employee ID (made automatically), the password (one starting password typed in the import window for every login row), the permissions (each role\'s usual ticks; change them per person afterwards).'],
    ['A Department Head waits for the Company Admin\'s approval before they can sign in.'],
    ['People without a login come in without their Aadhaar: upload it afterwards on Document Verification (the import lists who still needs it).'],
    [`Up to ${MAX_ROWS} rows per file.`],
    [],
    ['Column', 'Rule'],
    ...COLUMNS.map((c) => [c.title, c.help]),
  ];
  return workbook([
    { name: 'People', rows: [COLUMNS.map((c) => c.title)], widths: COLUMNS.map((c) => Math.max(14, c.title.length + 2)) },
    { name: 'How to fill', rows: how, widths: [22, 110] },
    { name: 'Lists', rows: listColumns(lists), widths: [30, 24, 36, 44, 10, 16] },
  ]);
}

/**
 * Checks every row; saves nothing.
 * opts: { password, defaults: { role: modules[] }, actor }.
 * Returns { problems, docs, preview, counts, total }.
 */
export async function check(companyId, buffer, opts = {}) {
  const { rows, fileProblems } = readSheet(buffer, 'People', COLUMNS);
  const empty = { login: 0, noLogin: 0, waiting: 0, aadhaarMissing: 0, people: 0 };
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ row: null, column: '', message: m })), docs: [], preview: [], counts: empty, total: rows.length };
  const cid = oid(companyId);
  const problems = [];
  const bad = (row, key, message) => problems.push({ row, column: TITLE[key] || key, message });
  const L = await companyLists(companyId);
  const deptName = new Map(L.departments.map((d) => [String(d._id), d.name]));

  // The file's emails and device codes already held (two bounded reads).
  const fileEmails = [...new Set(rows.map((r) => lower(r.values.email)).filter(Boolean))];
  const fileCodes = [...new Set(rows.map((r) => cleanCode(r.values.deviceCode)).filter(Boolean))];
  const [takenEmails, takenCodes] = await Promise.all([
    fileEmails.length ? User.distinct('email', { email: { $in: fileEmails } }) : [],
    fileCodes.length ? User.distinct('deviceCode', { companyId: cid, deviceCode: { $in: fileCodes } }) : [],
  ]);
  const emailTaken = new Set(takenEmails.map((e) => String(e).toLowerCase()));
  const codeTaken = new Set(takenCodes.map(String));

  const seenEmail = new Map(), seenCode = new Map();
  const docs = [], preview = [];
  let anyLogin = false;
  const defaults = opts.defaults && typeof opts.defaults === 'object' ? opts.defaults : {};
  for (const r of rows) {
    const v = r.values, row = r.row;
    const before = problems.length;
    const login = yes(v.login);
    if (!login && !no(v.login)) bad(row, 'login', text(v.login) ? `"${text(v.login)}": write Yes or No.` : 'Required: Yes or No.');
    if (login) anyLogin = true;

    const name = text(v.name);
    if (!name) bad(row, 'name', 'Required.');
    const mobile = digits(v.mobile);
    if (!mobile) bad(row, 'mobile', 'Required.');
    else if (!/^\d{10}$/.test(mobile)) bad(row, 'mobile', `"${text(v.mobile)}": exactly 10 digits.`);
    const gender = matchIn(v.gender, GENDERS);
    if (!text(v.gender)) bad(row, 'gender', 'Required.');
    else if (!gender) bad(row, 'gender', `"${text(v.gender)}": Male or Female.`);
    const dob = parseDay(v.dob), joiningDate = parseDay(v.joiningDate);
    if (!text(v.dob)) bad(row, 'dob', 'Required.'); else if (!dob) bad(row, 'dob', `"${text(v.dob)}" isn't a date: write it as 1995-04-21 or 21-04-1995.`);
    if (!text(v.joiningDate)) bad(row, 'joiningDate', 'Required.'); else if (!joiningDate) bad(row, 'joiningDate', `"${text(v.joiningDate)}" isn't a date: write it as 2026-11-01 or 01-11-2026.`);

    // Department, then a designation of it (by name, or "name (department)" as the list shows it).
    let department = null;
    if (!text(v.department)) bad(row, 'department', 'Required.');
    else {
      const n = matchIn(v.department, L.departments.map((d) => d.name));
      department = n ? L.departments.find((d) => d.name === n) : null;
      if (!department) bad(row, 'department', `"${text(v.department)}" isn't one of your departments (see "Lists").`);
    }
    let designation = null;
    if (!text(v.designation)) bad(row, 'designation', 'Required.');
    else {
      const typed = text(v.designation).replace(/\s*\(([^)]*)\)\s*$/, '');
      const same = L.designations.filter((g) => lower(g.name) === lower(typed));
      if (!same.length) bad(row, 'designation', `"${text(v.designation)}" isn't one of your designations (see "Lists").`);
      else if (department) {
        designation = same.find((g) => String(g.departmentId || '') === String(department._id)) || same.find((g) => !g.departmentId) || null;
        if (!designation) {
          const its = same.map((g) => deptName.get(String(g.departmentId)) || '—').join(', ');
          bad(row, 'designation', `"${typed}" belongs to ${its}, not ${department.name}.`);
        }
      }
    }

    // Login part: role, email, IVR.
    let role = 'Manpower';
    let custom = null; // feature 34: a custom role, saved as its base role
    const email = lower(v.email);
    if (login) {
      if (!text(v.role)) bad(row, 'role', 'Required for someone with a login.');
      else {
        role = matchIn(v.role, L.roles);
        if (!role) bad(row, 'role', `"${text(v.role)}" isn't a role HR gives (see "Login roles" on the "Lists" sheet).`);
        custom = role ? (L.custom.find((c) => c.name === role) || null) : null;
        if (custom && !custom.baseRole) bad(row, 'role', `"${custom.name}" has no role it's based on yet: the Company Admin sets it on Company Settings → Custom roles.`);
        else if (custom) role = custom.baseRole;
      }
      if (!email) bad(row, 'email', 'Required for someone with a login.');
    } else if (text(v.role) && lower(v.role) !== 'manpower') {
      bad(row, 'role', `Leave blank for someone without a login (their role is Manpower), or set "Gets a login" to Yes.`);
    }
    if (email) {
      if (!EMAIL_RE.test(email)) bad(row, 'email', `"${text(v.email)}" isn't a valid email address.`);
      else if (emailTaken.has(email)) bad(row, 'email', `${email} is already used by someone.`);
      else if (seenEmail.has(email)) bad(row, 'email', `${email} is also on row ${seenEmail.get(email)}.`);
      else seenEmail.set(email, row);
    }
    const ivr = digits(v.ivr);
    if (ivr && !/^\d+$/.test(ivr)) bad(row, 'ivr', 'Digits only.');
    if (login && role === 'Sales Employee' && !ivr) bad(row, 'ivr', 'Required for a Sales Employee.');
    let trainee = false;
    if (text(v.trainee)) {
      if (yes(v.trainee)) trainee = true;
      else if (!no(v.trainee)) bad(row, 'trainee', `"${text(v.trainee)}": write Yes or No (or leave blank).`);
      if (trainee && !login) bad(row, 'trainee', 'Only for someone with a login.');
    }

    // Device code: required without a login; unused and unique either way.
    const deviceCode = cleanCode(v.deviceCode);
    if (!login && !deviceCode) bad(row, 'deviceCode', 'Required for someone without a login.');
    if (deviceCode) {
      if (codeTaken.has(deviceCode)) bad(row, 'deviceCode', `Device code ${deviceCode} is already given to someone in this company.`);
      else if (seenCode.has(deviceCode)) bad(row, 'deviceCode', `Device code ${deviceCode} is also on row ${seenCode.get(deviceCode)}.`);
      else seenCode.set(deviceCode, row);
    }

    // Reporting manager: a Manager of the company, by email or employee ID (or the list's "email · id · name").
    let manager = null;
    const mTyped = text(v.manager).split(' · ')[0].trim();
    if (mTyped) {
      manager = L.managers.find((m) => lower(m.email) === lower(mTyped) || lower(m.employeeId) === lower(mTyped));
      if (!manager) bad(row, 'manager', `"${text(v.manager)}" isn't one of your Managers (see "Lists"): use their email or employee ID.`);
    } else if (!(login && role === 'Manager')) bad(row, 'manager', 'Required (only someone whose role is Manager may have none).');

    let employmentType = '';
    if (text(v.employmentType)) {
      employmentType = matchIn(v.employmentType, EMPLOYMENT_TYPES);
      if (!employmentType) bad(row, 'employmentType', `"${text(v.employmentType)}": Full-Time, Part-Time, Intern or Contract.`);
    }
    if (problems.length > before) continue;

    const common = {
      fullName: name, mobile, gender, dob, joiningDate, companyId: cid, branchId: cid, unit: opts.actor?.unit || '',
      departmentId: department._id, designationId: designation._id, reportingManager: manager?._id || null,
      employeeType: employmentType || '', address: text(v.address), ...(deviceCode ? { deviceCode } : {}),
    };
    let doc, waits = false;
    if (login) {
      // Feature 34: a custom role starts with everything it allows (not the window's defaults for its base role).
      const modules = custom ? defaultsFor(custom).modules
        : (Array.isArray(defaults[role]) ? defaults[role] : []).map((m) => ({ ...m, features: [...(m.features || [])] }));
      // A trainee gets the Trainee dashboard in the first module, as createUser does for the form.
      if (trainee && modules[0] && !modules[0].features.some((f) => f.key === 'traineeDashboard')) {
        modules[0].features.push({ key: 'traineeDashboard', view: true, add: false, edit: false, delete: false, alter: false });
      }
      const permissions = applyRoleLimits(role, { role, canAccessAllUnits: false, modules }); // 26 Nov: Store's R&D views only
      waits = needsHeadApproval(opts.actor, role) || needsCustomApproval(opts.actor, custom);
      doc = {
        ...common, canLogin: true, username: email, email, role, permissions, isActive: !waits, isTrainee: trainee, ivrNumber: ivr,
        technicianSkills: [], serviceZone: role === 'Complaint Management Employee' ? (opts.actor?.unit || '') : '',
        ...customRoleFields(custom).set,
        ...(waits ? { headApproval: pendingRequest('new', role, permissions, opts.actor, undefined, custom) } : {}),
      };
    } else {
      doc = { ...common, canLogin: false, role: 'Manpower', permissions: { role: 'Manpower', canAccessAllUnits: false, modules: [] }, isActive: true, ...(email ? { email } : {}) };
    }
    docs.push({ row, doc, waits });
    if (preview.length < 50) {
      preview.push({ row, name, login, role: custom ? custom.name : role, trainee, department: department.name, designation: designation.name, manager: manager?.fullName || manager?.email || '', deviceCode, waits });
    }
  }
  if (anyLogin && String(opts.password || '').length < 6) {
    problems.push({ row: null, column: 'Starting password', message: 'The file has people with a login: type a starting password (at least 6 characters) in the import window.' });
  }
  const counts = {
    people: docs.length,
    login: docs.filter((d) => d.doc.canLogin).length,
    noLogin: docs.filter((d) => !d.doc.canLogin).length,
    waiting: docs.filter((d) => d.waits).length,
    aadhaarMissing: docs.filter((d) => !d.doc.canLogin).length,
  };
  return { problems: sortProblems(problems), docs, preview, counts, total: rows.length };
}

/** The next employee IDs for the company: EMP-ABC-0042 onwards, from the highest number in use. */
async function nextEmployeeIds(companyId, n) {
  const company = await Company.findById(companyId).select('name').lean();
  const prefix = `EMP-${getCompanyAbbr(company?.name)}-`;
  const used = await User.distinct('employeeId', { employeeId: { $regex: `^${prefix}` } });
  const high = Math.max(0, ...used.map((id) => parseInt(String(id).split('-').pop(), 10)).filter((x) => !Number.isNaN(x)));
  return Array.from({ length: n }, (_, i) => `${prefix}${String(high + 1 + i).padStart(4, '0')}`);
}

/** Checks again; then everyone at once — all or nothing. */
export async function importFile(companyId, user, buffer, opts = {}) {
  const o = { ...opts, actor: opts.actor || user };
  const c = await check(companyId, buffer, o);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const ids = await nextEmployeeIds(companyId, c.docs.length);
  const hash = c.counts.login ? await bcrypt.hash(String(o.password), 12) : null; // one hash for every login row
  const docs = c.docs.map(({ doc }, i) => {
    const d = { ...doc, _id: new mongoose.Types.ObjectId(), employeeId: ids[i] };
    if (d.canLogin) d.password = hash;
    else d.username = ids[i];
    return d;
  });
  try {
    // insertMany doesn't run the save hook, so the hash above is stored as it is (hashed once).
    await User.insertMany(docs, { ordered: true });
  } catch (err) {
    await User.deleteMany({ _id: { $in: docs.map((d) => d._id) } }).catch(() => {});
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'An email or device code in the file was taken by someone else while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  for (const d of docs) if (d.deviceCode) await applyCodeQuietly(companyId, d.deviceCode);
  for (const d of docs) if (d.headApproval) await notifyCompanyAdmin(d, o.actor);
  return {
    imported: docs.length, login: c.counts.login, noLogin: c.counts.noLogin, waiting: c.counts.waiting,
    aadhaarMissing: docs.filter((d) => !d.canLogin).map((d) => ({ name: d.fullName, employeeId: d.employeeId })),
    by: user?._id || null,
  };
}
