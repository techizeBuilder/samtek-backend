import mongoose from 'mongoose';
import AdminSettings from '../models/AdminSettings.js';
import GlobalSmtpSettings from '../models/GlobalSmtpSettings.js';
import GlobalSalesChecklist from '../models/GlobalSalesChecklist.js';
import GlobalAdminSettings from '../models/GlobalAdminSettings.js';
import { USER_ROLES } from '../shared/schema.js';
import User from '../models/User.js';
import { validateAllowed, trimEveryoneOn, peopleOnCustomRoles } from '../services/access/customRoles.js';

// ─── Default data used when creating new settings ─────────────────────────────
const DEFAULT_LEAD_STAGES = [
  'Call Not Picked', 'Contacted', 'Product Qualified', 'Budget Qualified',
  'Bank Funding', 'Self Funding', 'Sent Marketing Data', 'Quatation Sent',
  'Visit Scheduled', 'Visited', 'Deal Closing', 'Deal Won'
].map((name, i) => ({ name, order: i }));

const DEFAULT_LEAD_SOURCES = [
  'Direct Visit', 'IndiaMART', 'TradeIndia', 'Website', 'LinkedIn',
  'Indiamart Direct Enquiries', 'Reference'
].map(name => ({ name }));

const DEFAULT_BUSINESS_TYPES = [
  'Distributor', 'Retailer', 'Wholesaler', 'End User'
].map(name => ({ name }));

const DEFAULT_DOCUMENT_TYPES = [
  'Aadhaar', 'Gst Registration Certificate', 'Indiamart Pns Calls',
  'PAN Card', 'Visiting Card'
].map(name => ({ name }));

const DEFAULT_LEAD_REJECT_REASONS = [
  "Payment Term Is Out Of Scope",
  "Freight Charged Are High",
  "Client Is Not Responding",
  "Client Dropped His Purchase Requirement",
  "Quoted Price Is High",
  "Purchased From Local Vendor",
  "Irrelevant Product Enquiry",
  "Low/ Retail Quantity",
  "Delivery Location Is Out Of Scope",
  "Legal Issue",
  "Junk Enquiry",
  "Payment Not Received",
  "Duplicate Leads",
  "Quoted But Delaying Decision",
  "Invalid Contact Number",
  "Not Potential",
].map((label, i) => ({ label, order: i }));

const DEFAULT_TERMS = [
  { heading: 'Jurisdiction', text: 'All disputes will be settled under Ghaziabad, Uttar Pradesh jurisdiction only.' },
  { heading: 'Prices & Packing', text: 'All prices are Ex-Works Ghaziabad, excluding packing, transport, insurance, and taxes (charged at actuals)' },
  { heading: 'Validity', text: 'Quotation valid for 30 days from the issue date. Prices may change thereafter.' },
  { heading: 'Payment Terms', text: '50% advance with order and balance before dispatch (or 100% advance under bank terms). Delayed payment attracts 30% yearly interest and voids warranty.' },
  { heading: 'Order Confirmation & Cancellation', text: 'Advance payment confirms acceptance of all terms. In case of cancellation, the advance is non-refundable.' },
  { heading: 'Delivery', text: 'Normal delivery time is 25–30 working days, depending on design and workload.' },
  { heading: 'Warranty', text: 'OEM warranty applies to bought-out parts (motors, sensors, drives, etc.). Wear-and-tear or mishandling is not covered.' },
  { heading: 'Product & Packaging', text: "Customer must share product and packing details. If delayed, SAMTEK may arrange the same at customer's cost." },
  { heading: 'Dispatch & Clearance', text: "Dispatch only after full payment. If goods aren't collected within 10 days, SAMTEK may return them at buyer's cost." },
  { heading: 'Inspection', text: "Inspection allowed at factory with 15 days' prior notice. Third-party inspection charges are borne by the customer." },
  { heading: 'Installation & Commissioning', text: "1. Engineer will be deputed after receiving written confirmation from the customer. 2. All travel, lodging, boarding, and local conveyance expenses shall be borne by the customer." },
  { heading: 'Transit & Short Shipment', text: 'Customer must insure goods before dispatch. SAMTEK is not liable for transit loss.' },
  { heading: 'Not In Our Scope Of Supply', text: 'Civil and foundation work required for machine installation is not included in our scope.' },
];

const DEFAULT_ADDITIONAL_CHARGES = [
  { name: 'Installation Charges', price: 10000, gst: 18 },
  { name: 'Freight Charges', price: 3000, gst: 18 },
  { name: 'AMC Charges', price: 5000, gst: 18 },
  { name: 'Training Charges', price: 2000, gst: 18 },
];

const DEFAULT_NOTES = [
  { text: 'The Semi-Skill and Unskilled Manpower, Along With Material Handling Equipment, Required For The Installation Of The Complete Plant.' },
  { text: 'The Civil & Foundation Work Required For Installation of The Machine.' },
  { text: 'Installation Charges Are Extra' },
  { text: 'Tools Will be Provided By The Customer.' },
  { text: 'Logging & Boarding Facilities Are To Be Provided By The Customer.' },
];

const DEFAULT_DISPATCH_CHECKLIST = [
  'All Parts Included', 'Accessories Included', 'Manual Included', 'Safety Packing Completed'
].map((label, i) => ({ label, order: i }));

// Keys match the fields already used on existing Orders' salesChecklist —
// changing labels/wording here later must never change these keys.
const DEFAULT_SALES_CHECKLIST = [
  { key: 'advancePayment', label: 'Advanced Payment Received/Discussed?', valueType: 'number', valueLabel: 'Advanced Amount (INR)', valuePlaceholder: 'Enter amount' },
  { key: 'installationCharge', label: 'Installation Charges Discussed?', valueType: 'text', valueLabel: 'How much installation charge is agreed?', valuePlaceholder: 'e.g. ₹15,000 / Extra at actual / Included in Deal' },
  { key: 'warranty', label: 'Warranty Committed?', valueType: 'text', valueLabel: 'Warranty duration & details', valuePlaceholder: 'e.g. 1 Year / 6 months / 2 Years on motor' },
  { key: 'boardingLodging', label: 'Installation Crew Stay/Food Arranged?', valueType: 'text', valueLabel: 'Boarding & Lodging arrangement details', valuePlaceholder: 'e.g. Under Customer Scope / Hotel by customer' },
  { key: 'backupGenerator', label: 'Backup Power Support / DG Discussed?', valueType: 'text', valueLabel: 'Generator / Power fluctuation arrangement details', valuePlaceholder: 'e.g. Customer will provide generator for backup' },
  { key: 'operatorErrorClause', label: 'Customer agreed that damage due to operator mistake is NOT our fault?', valueType: 'none', valueLabel: '', valuePlaceholder: '' },
].map((item, i) => ({ ...item, order: i }));

// Seeded so quotation numbering keeps working (as "SM-0022") for companies that
// never touch this new setting — matches the old hardcoded "SM-" prefix.
const DEFAULT_QUOTATION_NUMBER_SETTINGS = [
  { prefix: 'SM', suffix: '', bifurcateWith: '-', financialYearPosition: 'none' },
];

// Matches the document types that used to be hardcoded on the HRMS employee
// "Documents" tab — keys line up with existing UserDocument.type values so
// previously-uploaded documents keep matching correctly.
const DEFAULT_HRMS_DOCUMENT_TYPES = [
  { key: 'AADHAAR', label: 'Aadhaar Card', description: 'Front & back scan of Aadhaar card' },
  { key: 'PAN', label: 'PAN Card', description: 'Scanned copy of PAN card' },
  { key: 'MARKSHEET_12', label: '12th Marksheet', description: 'Class 12 / senior secondary marksheet' },
  { key: 'PASSBOOK', label: 'Bank Passbook', description: 'First page of bank passbook / cancelled cheque' },
].map((d, i) => ({ ...d, order: i }));

// Every role already built into the system (Sidebar/permissions/route-guards
// reference these exact names elsewhere) — seeded once as isBuiltIn so they
// show up in Role Setting from day one, protected from rename/delete.
const DEFAULT_ROLES = Object.values(USER_ROLES)
  .map((name, i) => ({ name, isBuiltIn: true, order: i }));

// ─── Helper: get or create settings for a company ─────────────────────────────
// Exported for leadSettingRequestController.js — Lead Settings (the 6 fields
// below) are now per-company live data, applied only on Company Admin approval
// of a Sales Head's request, rather than a direct Super Admin edit.
// ─── Feature 28 (24 Nov 2026): the packing checklist, HRMS document types and custom
// roles are per company (Company Admin), no longer one platform list. Each company starts
// from a copy of the platform lists, KEEPING their ids and keys, so packing answers saved
// against an item's id and documents saved against a type's key still match.
// docs/client-features-2026-11/28-settings-split-logic.md
const plainList = (arr) => (arr || []).map((x) => (x?.toObject ? x.toObject() : x));
function platformCopy(global) {
  return {
    dispatchChecklist: plainList(global.dispatchChecklist),
    hrmsDocumentTypes: plainList(global.hrmsDocumentTypes),
    roles: plainList(global.roles).filter((r) => !r.isBuiltIn), // built-ins stay platform-wide
  };
}
/** Once per company: its old lists are REPLACED by the platform's (same ids / keys). */
export async function copyPlatformListsOnce({ companyId = null } = {}) {
  const copy = platformCopy(await getOrCreateGlobalAdminSettings());
  const docs = await AdminSettings.find({ listsCopiedAt: null, ...(companyId ? { companyId } : {}) }).select('_id').lean();
  for (const d of docs) await AdminSettings.updateOne({ _id: d._id }, { $set: { ...copy, listsCopiedAt: new Date() } });
  if (docs.length && !companyId) console.log(`[AdminSettings] Copied the platform lists into ${docs.length} company record(s).`);
  return { copied: docs.length };
}

export async function getOrCreateSettings(companyId) {
  let settings = await AdminSettings.findOne({ companyId });
  if (!settings) {
    // Feature 28: a new company starts from the platform lists (not the old hardcoded defaults).
    const copy = platformCopy(await getOrCreateGlobalAdminSettings());
    settings = new AdminSettings({
      companyId,
      leadStages: DEFAULT_LEAD_STAGES,
      leadSources: DEFAULT_LEAD_SOURCES,
      businessTypes: DEFAULT_BUSINESS_TYPES,
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      termsAndConditions: DEFAULT_TERMS,
      additionalCharges: DEFAULT_ADDITIONAL_CHARGES,
      quotationNotes: DEFAULT_NOTES,
      dispatchChecklist: copy.dispatchChecklist,
      leadRejectReasons: DEFAULT_LEAD_REJECT_REASONS,
      salesChecklist: DEFAULT_SALES_CHECKLIST,
      quotationNumberSettings: DEFAULT_QUOTATION_NUMBER_SETTINGS,
      hrmsDocumentTypes: copy.hrmsDocumentTypes,
      roles: copy.roles,
      listsCopiedAt: new Date(),
    });
    await settings.save();
  } else {
    // Migrate existing companies (created before these fields existed) so
    // previously-hardcoded lists still show up once, editable from here on.
    let changed = false;
    // Feature 28: once a company has its own copy, an empty list is the Company Admin's choice
    // and is never refilled.
    if (!settings.listsCopiedAt && (!settings.dispatchChecklist || settings.dispatchChecklist.length === 0)) {
      settings.dispatchChecklist = DEFAULT_DISPATCH_CHECKLIST;
      changed = true;
    }
    if (!settings.leadRejectReasons || settings.leadRejectReasons.length === 0) {
      settings.leadRejectReasons = DEFAULT_LEAD_REJECT_REASONS;
      changed = true;
    }
    if (!settings.salesChecklist || settings.salesChecklist.length === 0) {
      settings.salesChecklist = DEFAULT_SALES_CHECKLIST;
      changed = true;
    }
    // Quotation Settings are per-company now (Sales Head request + Company
    // Admin approval, same as Lead Settings) — seed the old hardcoded lists
    // once for any company that never had them.
    if (!settings.termsAndConditions || settings.termsAndConditions.length === 0) {
      settings.termsAndConditions = DEFAULT_TERMS;
      changed = true;
    }
    if (!settings.additionalCharges || settings.additionalCharges.length === 0) {
      settings.additionalCharges = DEFAULT_ADDITIONAL_CHARGES;
      changed = true;
    }
    if (!settings.quotationNotes || settings.quotationNotes.length === 0) {
      settings.quotationNotes = DEFAULT_NOTES;
      changed = true;
    }
    if (!settings.quotationNumberSettings || settings.quotationNumberSettings.length === 0) {
      settings.quotationNumberSettings = DEFAULT_QUOTATION_NUMBER_SETTINGS;
      changed = true;
    }
    if (!settings.listsCopiedAt && (!settings.hrmsDocumentTypes || settings.hrmsDocumentTypes.length === 0)) {
      settings.hrmsDocumentTypes = DEFAULT_HRMS_DOCUMENT_TYPES;
      changed = true;
    }
    // (roles: per company they hold only the custom roles, which may be none — feature 28)
    if (changed) await settings.save();
    // Feature 28: a company not yet copied (created before the copy ran) gets it now.
    if (!settings.listsCopiedAt) {
      await copyPlatformListsOnce({ companyId: settings.companyId });
      settings = await AdminSettings.findById(settings._id);
    }
  }
  return settings;
}

const companyIdOf = (req) => req.user?.companyId?._id || req.user?.companyId || null;
class SettingsError extends Error { constructor(status, message) { super(message); this.status = status; } }
/** The caller's own company settings (copied from the platform if not yet). */
async function companySettingsOf(req) {
  const companyId = companyIdOf(req);
  if (!companyId) throw new SettingsError(400, 'These settings belong to a company.');
  return getOrCreateSettings(companyId);
}
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message });
/** The roles a company may pick from: the platform's built-in roles + its own custom roles. */
// Feature 32 (25 Nov 2026): the company's own custom role names (HR's bulk import offers them).
export async function companyCustomRoleNames(companyId) {
  const settings = await getOrCreateSettings(companyId);
  return plainList(settings.roles).filter((r) => !r.isBuiltIn).map((r) => r.name).filter(Boolean);
}

async function rolesFor(settings) {
  const global = await getOrCreateGlobalAdminSettings();
  // Feature 34: each custom role says how many people are on it (one grouped count).
  const custom = plainList(settings.roles).filter((r) => !r.isBuiltIn);
  const people = custom.length ? await peopleOnCustomRoles(settings.companyId) : {};
  return [...plainList(global.roles).filter((r) => r.isBuiltIn && r.name !== 'super_user'), // removed 26 Nov 2026
    ...custom.map((r) => ({ ...r, people: people[String(r._id)] || 0 }))];
}

// ─── GET all admin settings ────────────────────────────────────────────────────
export const getAdminSettings = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) return res.status(400).json({ success: false, message: 'Company not assigned' });
    const settings = await getOrCreateSettings(companyId);
    const roles = await rolesFor(settings);
    res.json({
      success: true,
      settings: {
        ...settings.toObject(),
        // Lead Settings (leadStages/leadSources/businessTypes/documentTypes/
        // leadRejectReasons/salesChecklist) AND Quotation Settings
        // (termsAndConditions/additionalCharges/quotationNotes/
        // quotationNumberSettings) are per-company live data now, editable only
        // via a Sales Head request + Company Admin approval
        // (leadSettingRequestController.js) — NOT overridden here.
        // Feature 28 (24 Nov 2026): the packing checklist, HRMS document types and custom roles
        // are this company's own (Company Admin). Roles = platform built-ins + the company's custom.
        dispatchChecklist: settings.dispatchChecklist,
        hrmsDocumentTypes: settings.hrmsDocumentTypes,
        roles,
      }
    });
  } catch (err) {
    console.error('getAdminSettings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Global Admin Settings — "General" section (Super Admin only — shared
// by every company: Lead Stages/Sources, Business/Document Types, Reject
// Reasons, Terms, Charges, Notes, Dispatch Checklist, Quotation Number
// Settings, HRMS Document Types, Roles) ─────────────────────────────────────
async function getOrCreateGlobalAdminSettings() {
  let settings = await GlobalAdminSettings.findOne();
  if (!settings) {
    settings = new GlobalAdminSettings({
      leadStages: DEFAULT_LEAD_STAGES,
      leadSources: DEFAULT_LEAD_SOURCES,
      businessTypes: DEFAULT_BUSINESS_TYPES,
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      leadRejectReasons: DEFAULT_LEAD_REJECT_REASONS,
      termsAndConditions: DEFAULT_TERMS,
      additionalCharges: DEFAULT_ADDITIONAL_CHARGES,
      quotationNotes: DEFAULT_NOTES,
      quotationNumberSettings: DEFAULT_QUOTATION_NUMBER_SETTINGS,
      dispatchChecklist: DEFAULT_DISPATCH_CHECKLIST,
      hrmsDocumentTypes: DEFAULT_HRMS_DOCUMENT_TYPES,
      roles: DEFAULT_ROLES,
    });
    await settings.save();
  }
  return settings;
}

// ─── Global Sales Checklist (Super Admin only — shared by every company) ──────
async function getOrCreateGlobalSalesChecklist() {
  let settings = await GlobalSalesChecklist.findOne();
  if (!settings) {
    settings = new GlobalSalesChecklist({ salesChecklist: DEFAULT_SALES_CHECKLIST });
    await settings.save();
  }
  return settings;
}

// ─── Global SMTP (Super Admin only — shared by every company) ─────────────────
async function getOrCreateGlobalSmtp() {
  let settings = await GlobalSmtpSettings.findOne();
  if (!settings) {
    settings = new GlobalSmtpSettings({ smtp: [] });
    await settings.save();
  }
  return settings;
}

export const getGlobalSmtp = async (req, res) => {
  try {
    const settings = await getOrCreateGlobalSmtp();
    // A blank entry (one was saved by an empty add before 26 Nov 2026) is never listed.
    res.json({ success: true, smtp: (settings.smtp || []).filter((s) => s && s.department) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addGlobalSmtp = async (req, res) => {
  try {
    // 26 Nov 2026: an add without a known department is refused. An empty request used to
    // save a blank entry and answer 200, and the blank entry crashed Settings → General.
    const DEPARTMENTS = GlobalSmtpSettings.schema.path('smtp').schema.path('department').enumValues;
    if (!req.body || typeof req.body !== 'object' || !DEPARTMENTS.includes(req.body.department)) {
      return res.status(400).json({ success: false, message: `Choose a department (${DEPARTMENTS.join(', ')}).` });
    }
    const settings = await getOrCreateGlobalSmtp();
    // One mailbox per department (2026-10-29) — a second one was never used
    // (the first active one always wins), e.g. accounts@ saved under Sales.
    if ((settings.smtp || []).some(s => s.department === req.body?.department)) {
      return res.status(409).json({ success: false, message: `${req.body.department} already has a mailbox — delete it first to replace it.` });
    }
    settings.smtp.push(req.body);
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateGlobalSmtp = async (req, res) => {
  try {
    const { id } = req.params;
    const settings = await getOrCreateGlobalSmtp();
    const item = settings.smtp.id(id);
    if (!item) return res.status(404).json({ success: false, message: 'SMTP config not found' });
    if (req.body?.department && req.body.department !== item.department
      && (settings.smtp || []).some(s => s.department === req.body.department && String(s._id) !== String(id))) {
      return res.status(409).json({ success: false, message: `${req.body.department} already has a mailbox — delete it first to replace it.` });
    }
    Object.assign(item, req.body);
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteGlobalSmtp = async (req, res) => {
  try {
    const { id } = req.params;
    const settings = await getOrCreateGlobalSmtp();
    settings.smtp.pull({ _id: id });
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Generic CRUD factory for array fields — platform-wide (Super Admin
// manages one shared list per field, see getOrCreateGlobalAdminSettings) ──────
function makeArrayCrud(field) {
  return {
    list: async (req, res) => {
      try {
        const settings = await getOrCreateGlobalAdminSettings();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    add: async (req, res) => {
      try {
        // Security check 25 Nov 2026: an empty request pushed a null entry (the schema's "required"
        // doesn't see a null array element). Every one of these lists needs a name or a label.
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        if (!String(b.name ?? b.label ?? '').trim()) {
          return res.status(400).json({ success: false, message: 'A name is required.' });
        }
        const settings = await getOrCreateGlobalAdminSettings();
        settings[field].push(b);
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    update: async (req, res) => {
      try {
        const { id } = req.params;
        const settings = await getOrCreateGlobalAdminSettings();
        const item = settings[field].id(id);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
        Object.assign(item, req.body);
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    remove: async (req, res) => {
      try {
        const { id } = req.params;
        const settings = await getOrCreateGlobalAdminSettings();
        settings[field].pull({ _id: id });
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    reorder: async (req, res) => {
      try {
        const { orderedIds } = req.body; // array of ids in new order
        const settings = await getOrCreateGlobalAdminSettings();
        if (orderedIds && Array.isArray(orderedIds)) {
          settings[field].sort((a, b) => orderedIds.indexOf(a._id.toString()) - orderedIds.indexOf(b._id.toString()));
        }
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    }
  };
}

// ─── Sales Checklist — platform-wide (Super Admin manages one shared list;
// bespoke, not the generic per-company factory, because `key` must be
// server-generated once at creation and is never editable afterwards, so a
// later label rename can't ever disturb already-saved Orders' data).
export const salesChecklistCrud = {
  list: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalSalesChecklist();
      res.json({ success: true, data: settings.salesChecklist });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  add: async (req, res) => {
    try {
      const { label, valueType, valueLabel, valuePlaceholder } = req.body;
      if (!label || !label.trim()) {
        return res.status(400).json({ success: false, message: 'Label is required' });
      }
      const settings = await getOrCreateGlobalSalesChecklist();
      settings.salesChecklist.push({
        key: new mongoose.Types.ObjectId().toString(),
        label: label.trim(),
        valueType: ['none', 'text', 'number'].includes(valueType) ? valueType : 'text',
        valueLabel: valueLabel || '',
        valuePlaceholder: valuePlaceholder || '',
        order: settings.salesChecklist.length
      });
      await settings.save();
      res.json({ success: true, data: settings.salesChecklist });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  update: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalSalesChecklist();
      const item = settings.salesChecklist.id(req.params.id);
      if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
      const { label, valueType, valueLabel, valuePlaceholder } = req.body; // key intentionally excluded — immutable
      if (label !== undefined) item.label = label;
      if (valueType !== undefined && ['none', 'text', 'number'].includes(valueType)) item.valueType = valueType;
      if (valueLabel !== undefined) item.valueLabel = valueLabel;
      if (valuePlaceholder !== undefined) item.valuePlaceholder = valuePlaceholder;
      await settings.save();
      res.json({ success: true, data: settings.salesChecklist });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  remove: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalSalesChecklist();
      settings.salesChecklist.pull({ _id: req.params.id });
      await settings.save();
      res.json({ success: true, data: settings.salesChecklist });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

export const leadStagesCrud   = makeArrayCrud('leadStages');
export const leadSourcesCrud  = makeArrayCrud('leadSources');
export const businessTypesCrud = makeArrayCrud('businessTypes');
export const documentTypesCrud = makeArrayCrud('documentTypes');
export const leadRejectReasonsCrud = makeArrayCrud('leadRejectReasons');

// Feature 28 (24 Nov 2026): the same list editing as makeArrayCrud (same requests and replies),
// on the caller's OWN company's list.
function companyListCrud(field) {
  const run = (fn) => async (req, res) => {
    try {
      const settings = await companySettingsOf(req);
      const out = await fn(settings, req, res);
      if (out === false) return;
      res.json({ success: true, data: settings[field] });
    } catch (err) { fail(res, err); }
  };
  return {
    list: run(() => true),
    add: run(async (settings, req) => { const { _id, ...body } = req.body || {}; settings[field].push(body); await settings.save(); }),
    update: run(async (settings, req, res) => {
      const item = settings[field].id(req.params.id);
      if (!item) { res.status(404).json({ success: false, message: 'Item not found' }); return false; }
      const { _id, key, ...body } = req.body || {}; // a document type's key never changes (uploads are saved by it)
      Object.assign(item, body);
      await settings.save();
    }),
    remove: run(async (settings, req) => { settings[field].pull({ _id: req.params.id }); await settings.save(); }),
  };
}
export const dispatchChecklistCrud = companyListCrud('dispatchChecklist');
export const hrmsDocumentTypesCrud = companyListCrud('hrmsDocumentTypes');
// termsAndConditions / additionalCharges / quotationNotes /
// quotationNumberSettings are per-company now (Sales Head request + Company
// Admin approval — see leadSettingRequestController.js), no longer a global
// Super-Admin-managed list.

// ─── HRMS: Role Setting (built-in roles are protected from rename/delete) ─────
// Feature 28 (24 Nov 2026): custom roles are per company. The list a company picks from is the
// platform's built-in roles (fixed) + its own custom roles, so one company can no longer rename
// or delete another company's roles.
const builtInMessage = (verb) => `Built-in roles cannot be ${verb}`;
async function findCompanyRole(settings, id, res, verb) {
  const role = settings.roles.id(id);
  if (role) return role;
  const builtIn = (await rolesFor(settings)).find((r) => String(r._id) === String(id) && r.isBuiltIn);
  res.status(builtIn ? 403 : 404).json({ success: false, message: builtIn ? builtInMessage(verb) : 'Role not found' });
  return null;
}
// Feature 34 (26 Nov 2026): a custom role is a cut-down version of one built-in role: its base role,
// the pages / actions it allows, and whether HR's assignment waits for the Company Admin.
// docs/client-features-2026-11/34-custom-roles-logic.md, services/access/customRoles.js
const peopleText = (n) => `${n} ${n === 1 ? 'person has' : 'people have'} this role`;
export const rolesCrud = {
  list: async (req, res) => {
    try { res.json({ success: true, data: await rolesFor(await companySettingsOf(req)) }); } catch (err) { fail(res, err); }
  },
  add: async (req, res) => {
    try {
      const settings = await companySettingsOf(req);
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Role name is required' });
      if ((await rolesFor(settings)).some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'A role with this name already exists' });
      }
      const baseRole = String(req.body.baseRole || '').trim();
      const v = validateAllowed(baseRole, req.body.allowed || []);
      if (v.error) return res.status(400).json({ success: false, message: v.error });
      settings.roles.push({
        name, isBuiltIn: false, order: settings.roles.length,
        baseRole, allowed: v.allowed, needsApproval: req.body.needsApproval === true,
      });
      await settings.save();
      res.json({ success: true, data: await rolesFor(settings) });
    } catch (err) { fail(res, err); }
  },
  update: async (req, res) => {
    try {
      const settings = await companySettingsOf(req);
      const role = await findCompanyRole(settings, req.params.id, res, 'changed');
      if (!role) return;
      const b = req.body || {};
      const people = (await peopleOnCustomRoles(settings.companyId))[String(role._id)] || 0;
      const renamed = b.name !== undefined && String(b.name).trim() !== role.name;
      if (b.name !== undefined) {
        const name = String(b.name || '').trim();
        if (!name) return res.status(400).json({ success: false, message: 'Role name is required' });
        if ((await rolesFor(settings)).some((r) => String(r._id) !== String(role._id) && r.name.toLowerCase() === name.toLowerCase())) {
          return res.status(400).json({ success: false, message: 'A role with this name already exists' });
        }
        role.name = name;
      }
      // Decision J: the base role is fixed once anyone is on the role.
      const baseRole = b.baseRole !== undefined ? String(b.baseRole || '').trim() : role.baseRole;
      if (baseRole !== (role.baseRole || '') && people > 0) {
        return res.status(409).json({ success: false, message: `${peopleText(people)}: the role it's based on can't change. Move them first.` });
      }
      const listChanges = b.allowed !== undefined || baseRole !== (role.baseRole || '');
      if (listChanges) {
        const v = validateAllowed(baseRole, b.allowed !== undefined ? b.allowed : role.allowed);
        if (v.error) return res.status(400).json({ success: false, message: v.error });
        role.baseRole = baseRole;
        role.allowed = v.allowed;
      }
      if (b.needsApproval !== undefined) role.needsApproval = b.needsApproval === true;
      await settings.save();
      // Decision G: a rename shows everywhere; decision F: what's taken away goes from everyone on it.
      if (renamed) {
        await User.updateMany({ companyId: settings.companyId, customRoleId: role._id }, { $set: { customRoleName: role.name } });
        await User.updateMany({ companyId: settings.companyId, 'headApproval.customRoleId': role._id }, { $set: { 'headApproval.customRoleName': role.name } });
      }
      if (listChanges && role.baseRole) await trimEveryoneOn(settings.companyId, role.toObject ? role.toObject() : role);
      res.json({ success: true, data: await rolesFor(settings) });
    } catch (err) { fail(res, err); }
  },
  remove: async (req, res) => {
    try {
      const settings = await companySettingsOf(req);
      const role = await findCompanyRole(settings, req.params.id, res, 'deleted');
      if (!role) return;
      // Decision G: never while anyone is on it, or waiting for it.
      const people = (await peopleOnCustomRoles(settings.companyId))[String(role._id)] || 0;
      const waiting = await User.countDocuments({ companyId: settings.companyId, 'headApproval.status': 'pending', 'headApproval.customRoleId': role._id });
      if (people || waiting) {
        return res.status(409).json({ success: false, message: `${peopleText(people + waiting)}${waiting ? ' (or are waiting for it)' : ''}: move them to another role first.` });
      }
      settings.roles.pull({ _id: req.params.id });
      await settings.save();
      res.json({ success: true, data: await rolesFor(settings) });
    } catch (err) { fail(res, err); }
  },
};
