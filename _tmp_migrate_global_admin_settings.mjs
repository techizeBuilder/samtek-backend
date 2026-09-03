import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import AdminSettings from './models/AdminSettings.js';
import GlobalAdminSettings from './models/GlobalAdminSettings.js';

await mongoose.connect(process.env.MONGODB_URI);

const FIELDS = [
  'leadStages', 'leadSources', 'businessTypes', 'documentTypes',
  'leadRejectReasons', 'termsAndConditions', 'additionalCharges',
  'quotationNotes', 'quotationNumberSettings', 'dispatchChecklist',
  'hrmsDocumentTypes', 'roles',
];

const existing = await GlobalAdminSettings.findOne();
if (existing) {
  console.log('GlobalAdminSettings already exists, not touching it. _id:', existing._id.toString());
} else {
  // Same rule as the Sales Checklist migration: carry over whichever
  // company's per-company doc currently has the richest data for each field
  // (i.e. whatever Super Admin has actually been editing), so nothing
  // already configured gets lost in the switch to one shared list.
  const all = await AdminSettings.find({});
  const seed = {};
  for (const field of FIELDS) {
    let best = null;
    for (const s of all) {
      const len = (s[field] || []).length;
      if (!best || len > (best.doc[field] || []).length) best = { doc: s, len };
    }
    seed[field] = best && best.len > 0
      ? best.doc[field].map(item => item.toObject ? item.toObject() : item)
      : [];
    console.log(field, '<-', best?.doc?.companyId?.toString(), `(${seed[field].length} items)`);
  }

  const created = new GlobalAdminSettings(seed);
  await created.save();
  console.log('Created GlobalAdminSettings:', created._id.toString());
}

await mongoose.disconnect();
