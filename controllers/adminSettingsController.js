import mongoose from 'mongoose';
import AdminSettings from '../models/AdminSettings.js';
import GlobalSmtpSettings from '../models/GlobalSmtpSettings.js';
import GlobalSalesChecklist from '../models/GlobalSalesChecklist.js';
import GlobalAdminSettings from '../models/GlobalAdminSettings.js';
import { USER_ROLES } from '../shared/schema.js';

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
export async function getOrCreateSettings(companyId) {
  let settings = await AdminSettings.findOne({ companyId });
  if (!settings) {
    settings = new AdminSettings({
      companyId,
      leadStages: DEFAULT_LEAD_STAGES,
      leadSources: DEFAULT_LEAD_SOURCES,
      businessTypes: DEFAULT_BUSINESS_TYPES,
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      termsAndConditions: DEFAULT_TERMS,
      additionalCharges: DEFAULT_ADDITIONAL_CHARGES,
      quotationNotes: DEFAULT_NOTES,
      dispatchChecklist: DEFAULT_DISPATCH_CHECKLIST,
      leadRejectReasons: DEFAULT_LEAD_REJECT_REASONS,
      salesChecklist: DEFAULT_SALES_CHECKLIST,
      quotationNumberSettings: DEFAULT_QUOTATION_NUMBER_SETTINGS,
      hrmsDocumentTypes: DEFAULT_HRMS_DOCUMENT_TYPES,
      roles: DEFAULT_ROLES,
    });
    await settings.save();
  } else {
    // Migrate existing companies (created before these fields existed) so
    // previously-hardcoded lists still show up once, editable from here on.
    let changed = false;
    if (!settings.dispatchChecklist || settings.dispatchChecklist.length === 0) {
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
    if (!settings.quotationNumberSettings || settings.quotationNumberSettings.length === 0) {
      settings.quotationNumberSettings = DEFAULT_QUOTATION_NUMBER_SETTINGS;
      changed = true;
    }
    if (!settings.hrmsDocumentTypes || settings.hrmsDocumentTypes.length === 0) {
      settings.hrmsDocumentTypes = DEFAULT_HRMS_DOCUMENT_TYPES;
      changed = true;
    }
    if (!settings.roles || settings.roles.length === 0) {
      settings.roles = DEFAULT_ROLES;
      changed = true;
    }
    if (changed) await settings.save();
  }
  return settings;
}

// ─── GET all admin settings ────────────────────────────────────────────────────
export const getAdminSettings = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) return res.status(400).json({ success: false, message: 'Company not assigned' });
    const settings = await getOrCreateSettings(companyId);
    const globalSettings = await getOrCreateGlobalAdminSettings();
    res.json({
      success: true,
      settings: {
        ...settings.toObject(),
        // Lead Settings (leadStages/leadSources/businessTypes/documentTypes/
        // leadRejectReasons/salesChecklist) intentionally NOT overridden here
        // anymore — they're per-company live data now, editable only via a
        // Sales Head request + Company Admin approval (leadSettingRequestController.js).
        // Everything below this line stays platform-wide/Super-Admin-managed.
        termsAndConditions: globalSettings.termsAndConditions,
        additionalCharges: globalSettings.additionalCharges,
        quotationNotes: globalSettings.quotationNotes,
        quotationNumberSettings: globalSettings.quotationNumberSettings,
        dispatchChecklist: globalSettings.dispatchChecklist,
        hrmsDocumentTypes: globalSettings.hrmsDocumentTypes,
        roles: globalSettings.roles,
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
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addGlobalSmtp = async (req, res) => {
  try {
    const settings = await getOrCreateGlobalSmtp();
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
        const settings = await getOrCreateGlobalAdminSettings();
        settings[field].push(req.body);
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
export const termsCrud        = makeArrayCrud('termsAndConditions');
export const chargesCrud      = makeArrayCrud('additionalCharges');
export const notesCrud        = makeArrayCrud('quotationNotes');
export const dispatchChecklistCrud = makeArrayCrud('dispatchChecklist');
export const leadRejectReasonsCrud = makeArrayCrud('leadRejectReasons');
export const quotationNumberSettingsCrud = makeArrayCrud('quotationNumberSettings');
export const hrmsDocumentTypesCrud = makeArrayCrud('hrmsDocumentTypes');

// ─── HRMS: Role Setting (built-in roles are protected from rename/delete) ─────
export const rolesCrud = {
  list: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalAdminSettings();
      res.json({ success: true, data: settings.roles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  add: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalAdminSettings();
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Role name is required' });
      if (settings.roles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'A role with this name already exists' });
      }
      settings.roles.push({ name, isBuiltIn: false, order: settings.roles.length });
      await settings.save();
      res.json({ success: true, data: settings.roles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  update: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalAdminSettings();
      const role = settings.roles.id(req.params.id);
      if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
      if (role.isBuiltIn) {
        return res.status(403).json({ success: false, message: 'Built-in roles cannot be renamed' });
      }
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Role name is required' });
      role.name = name;
      await settings.save();
      res.json({ success: true, data: settings.roles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  remove: async (req, res) => {
    try {
      const settings = await getOrCreateGlobalAdminSettings();
      const role = settings.roles.id(req.params.id);
      if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
      if (role.isBuiltIn) {
        return res.status(403).json({ success: false, message: 'Built-in roles cannot be deleted' });
      }
      settings.roles.pull({ _id: req.params.id });
      await settings.save();
      res.json({ success: true, data: settings.roles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};
