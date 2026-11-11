// Which documents a vendor must have, and which the Company Admin must verify
// (2026-10-28, docs/procurement-v2/vendor-documents-design-2026-10.md).
//
// The nine original types are built in: always present, can't be renamed or
// deleted, only their choice can change. The Company Admin adds their own on
// top. Choice per type: 'none' (optional) · 'required' (the vendor can't be
// submitted without it) · 'verified' (required, and the admin ticks it at
// approval). Saved in PurchaseSettings.vendorDocumentTypes; a company that
// never touched it gets today's rules.
import PurchaseSettings from '../models/PurchaseSettings.js';

export const DOC_RULES = ['none', 'required', 'verified'];

// Order = the order shown. onlyWithGstin: the document only applies to a
// vendor that has a GSTIN (a vendor with no GSTIN has no certificate).
// uploadOnly: 'Other' — any extra document with no title of its own. It's
// always offered when uploading (last), but it's outside the Company Admin's
// required / verified setting: never required, never ticked (2026-10-29).
export const BUILT_IN_DOC_TYPES = [
  { name: 'GST Certificate', defaultRule: 'verified', onlyWithGstin: true },
  { name: 'PAN Card', defaultRule: 'verified' },
  { name: 'MSME/Udyam Certificate', defaultRule: 'none' },
  { name: 'Company Registration', defaultRule: 'none' },
  { name: 'ISO/Quality Certificate', defaultRule: 'none' },
  { name: 'Authorization/Dealership Certificate', defaultRule: 'none' },
  { name: 'Product Certificate', defaultRule: 'none' },
  { name: 'Cancelled Cheque/Bank Proof', defaultRule: 'verified' },
  { name: 'Other', defaultRule: 'none', uploadOnly: true },
];

// What each approval tick says. The three that used to be fixed keep their
// wording; any other type reads the same way.
const TICK_LABELS = {
  'GST Certificate': 'GSTIN checked against the GST certificate',
  'PAN Card': 'PAN checked against the PAN card',
  'Cancelled Cheque/Bank Proof': 'Bank details checked against the cancelled cheque / bank proof',
};
export const tickLabelFor = (name) => TICK_LABELS[name] || `${name} — genuine and in date`;

const norm = (v) => String(v ?? '').trim();
const hasGstin = (vendor) => !!norm(vendor?.gstNumber);

// settings: a PurchaseSettings document / lean object, or null (defaults).
// → [{ _id?, name, builtIn, rule, onlyWithGstin, uploadOnly }] — the built-in
// types, then the Company Admin's own, then 'Other' last.
export function effectiveDocumentTypes(settings) {
  const saved = settings?.vendorDocumentTypes || [];
  const savedRule = (name) => saved.find(t => t.builtIn && t.name === name)?.rule;
  const builtIn = (b) => ({
    name: b.name, builtIn: true, onlyWithGstin: !!b.onlyWithGstin, uploadOnly: !!b.uploadOnly,
    rule: b.uploadOnly ? 'none' : (DOC_RULES.includes(savedRule(b.name)) ? savedRule(b.name) : b.defaultRule),
  });
  const out = BUILT_IN_DOC_TYPES.filter(b => !b.uploadOnly).map(builtIn);
  for (const t of saved) {
    if (t.builtIn || !norm(t.name)) continue;
    out.push({ _id: t._id, name: t.name, builtIn: false, onlyWithGstin: false, uploadOnly: false, rule: DOC_RULES.includes(t.rule) ? t.rule : 'none' });
  }
  out.push(...BUILT_IN_DOC_TYPES.filter(b => b.uploadOnly).map(builtIn));
  return out;
}

export async function documentTypesFor(companyId) {
  const settings = await PurchaseSettings.findOne({ companyId }).select('vendorDocumentTypes').lean();
  return effectiveDocumentTypes(settings);
}

const applies = (type, vendor) => !type.onlyWithGstin || hasGstin(vendor);
export const hasDocument = (vendor, name) => (vendor?.documents || []).some(d => d.docType === name);

// Types the vendor can't be submitted (or approved) without.
export const requiredTypesFor = (vendor, types) =>
  types.filter(t => (t.rule === 'required' || t.rule === 'verified') && applies(t, vendor));

// Types the vendor lacks.
export const missingTypesFor = (vendor, types) =>
  requiredTypesFor(vendor, types).filter(t => !hasDocument(vendor, t.name));

// Types the admin ticks at approval: verified ones the vendor has uploaded.
export const verifyTypesFor = (vendor, types) =>
  types.filter(t => t.rule === 'verified' && applies(t, vendor) && hasDocument(vendor, t.name));

// What the approval page shows for a vendor under review.
export const docChecksFor = (vendor, types) => ({
  verify: verifyTypesFor(vendor, types).map(t => ({ name: t.name, label: tickLabelFor(t.name) })),
  missing: missingTypesFor(vendor, types).map(t => t.name),
});
