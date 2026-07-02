import AdminSettings from '../models/AdminSettings.js';

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

// ─── Helper: get or create settings for a company ─────────────────────────────
async function getOrCreateSettings(companyId) {
  let settings = await AdminSettings.findOne({ companyId });
  if (!settings) {
    settings = new AdminSettings({
      companyId,
      smtp: [],
      leadStages: DEFAULT_LEAD_STAGES,
      leadSources: DEFAULT_LEAD_SOURCES,
      businessTypes: DEFAULT_BUSINESS_TYPES,
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      termsAndConditions: DEFAULT_TERMS,
      additionalCharges: DEFAULT_ADDITIONAL_CHARGES,
      quotationNotes: DEFAULT_NOTES,
    });
    await settings.save();
  }
  return settings;
}

// ─── GET all admin settings ────────────────────────────────────────────────────
export const getAdminSettings = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) return res.status(400).json({ success: false, message: 'Company not assigned' });
    const settings = await getOrCreateSettings(companyId);
    res.json({ success: true, settings });
  } catch (err) {
    console.error('getAdminSettings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SMTP ─────────────────────────────────────────────────────────────────────
export const addSmtp = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const settings = await getOrCreateSettings(companyId);
    settings.smtp.push(req.body);
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateSmtp = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const settings = await getOrCreateSettings(companyId);
    const item = settings.smtp.id(id);
    if (!item) return res.status(404).json({ success: false, message: 'SMTP config not found' });
    Object.assign(item, req.body);
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSmtp = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const settings = await getOrCreateSettings(companyId);
    settings.smtp.pull({ _id: id });
    await settings.save();
    res.json({ success: true, smtp: settings.smtp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Generic CRUD factory for array fields ────────────────────────────────────
function makeArrayCrud(field) {
  return {
    list: async (req, res) => {
      try {
        const companyId = req.user.companyId;
        const settings = await getOrCreateSettings(companyId);
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    add: async (req, res) => {
      try {
        const companyId = req.user.companyId;
        const settings = await getOrCreateSettings(companyId);
        settings[field].push(req.body);
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    update: async (req, res) => {
      try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const settings = await getOrCreateSettings(companyId);
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
        const companyId = req.user.companyId;
        const { id } = req.params;
        const settings = await getOrCreateSettings(companyId);
        settings[field].pull({ _id: id });
        await settings.save();
        res.json({ success: true, data: settings[field] });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
    reorder: async (req, res) => {
      try {
        const companyId = req.user.companyId;
        const { orderedIds } = req.body; // array of ids in new order
        const settings = await getOrCreateSettings(companyId);
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

export const leadStagesCrud   = makeArrayCrud('leadStages');
export const leadSourcesCrud  = makeArrayCrud('leadSources');
export const businessTypesCrud = makeArrayCrud('businessTypes');
export const documentTypesCrud = makeArrayCrud('documentTypes');
export const termsCrud        = makeArrayCrud('termsAndConditions');
export const chargesCrud      = makeArrayCrud('additionalCharges');
export const notesCrud        = makeArrayCrud('quotationNotes');
