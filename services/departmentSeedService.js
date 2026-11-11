// Departments from roles (2026-11-06,
// docs/client-features-2026-11/03-departments-from-roles-changes.md). The roles
// already name a company's departments, so nobody should have to type them.
//
// A company with no departments gets the whole list once: when it's created, or
// at the next server start if it already existed. A company that already has
// departments is left alone, because "Quality Control" beside a typed "Quality"
// would be a duplicate; it picks what it wants from a checklist instead.
import { Company } from '../models/Company.js';
import Department from '../models/Department.js';

// Custom roles aren't here: they're only labels, so nothing says which
// department one belongs to. Nor are roles that aren't a department (Manager,
// Employee, Company Admin, Auditor, Finance Manager, Admin).
export const ROLE_DEPARTMENTS = [
  { name: 'Sales', roles: ['Sales Head', 'Sales Employee'] },
  { name: 'Marketing', roles: ['Marketing Head', 'Marketing Employee'] },
  { name: 'Accounts', roles: ['Accounts Head', 'Account Employee'] },
  { name: 'Production', roles: ['Production Head', 'Production Employee'] },
  { name: 'Research & Development', roles: ['Research & Development Head', 'Research Development Employee'] },
  { name: 'Store', roles: ['Store Head', 'Store Employee'] },
  { name: 'Quality Control', roles: ['QC Head', 'QC Employee'] },
  // The Add Employee form labels the Dispatch roles "Packing and Dispatch".
  { name: 'Packing and Dispatch', roles: ['Packing and Dispatch Head', 'Packing and Dispatch Employee'] },
  { name: 'Complaint Management', roles: ['Complaint Management Head', 'Complaint Management Employee'] },
  { name: 'MIS', roles: ['MIS Admin'] },
  { name: 'Human Resources', roles: ['HR-Admin'] },
];

const nameKey = (s) => String(s ?? '').trim().toLowerCase();

// Once per company: claimed first, atomically, so two servers on one database
// can't both seed it, and a department an admin deletes later stays deleted.
export async function seedCompanyDepartments(companyId) {
  const claim = await Company.updateOne(
    { _id: companyId, departmentsSeededAt: null },
    { $set: { departmentsSeededAt: new Date() } },
    { timestamps: false },
  );
  if (!claim.modifiedCount) return { claimed: false, added: 0 };
  if (await Department.exists({ companyId })) return { claimed: true, added: 0 };
  await Department.insertMany(ROLE_DEPARTMENTS.map(({ name }) => ({ companyId, name })));
  return { claimed: true, added: ROLE_DEPARTMENTS.length };
}

// Companies not yet claimed, at server start. One failing doesn't stop the rest.
export async function seedExistingCompanies() {
  const companies = await Company.find({ departmentsSeededAt: null }).select('_id').lean();
  let seeded = 0;
  for (const { _id } of companies) {
    try {
      const { added } = await seedCompanyDepartments(_id);
      if (added) seeded++;
    } catch (err) {
      console.error(`[DepartmentSeed] Company ${_id} failed:`, err.message);
    }
  }
  if (companies.length) console.log(`[DepartmentSeed] Checked ${companies.length} company(ies), seeded ${seeded}.`);
  return { checked: companies.length, seeded };
}

// The list, each marked as already there or not. A name matching ignoring
// capitals counts as there, whatever its status.
export async function departmentsFromRoles(companyId) {
  const existing = await Department.find({ companyId }).select('name').lean();
  const have = new Set(existing.map((d) => nameKey(d.name)));
  return ROLE_DEPARTMENTS.map((d) => ({ ...d, exists: have.has(nameKey(d.name)) }));
}

// Adds only names on the list that the company doesn't have yet.
export async function addDepartmentsFromRoles(companyId, names) {
  const picked = new Set((Array.isArray(names) ? names : []).map(nameKey));
  const list = await departmentsFromRoles(companyId);
  const toAdd = list.filter((d) => !d.exists && picked.has(nameKey(d.name))).map((d) => d.name);
  if (toAdd.length) await Department.insertMany(toAdd.map((name) => ({ companyId, name })));
  return toAdd;
}
