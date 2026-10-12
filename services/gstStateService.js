// CGST + SGST vs IGST (procurement-v2 point 15, 2026-10-10). The GST rate is
// the vendor's (quoted per item); WHICH GST it is follows the law, not a
// choice: a supplier in the same state as us charges CGST + SGST (half each),
// one in another state charges IGST — the amount is the same. Worked out from
// the first two digits of each GSTIN (the state code), falling back to the
// state name when a GSTIN is missing or malformed. Our side is the company's
// GSTIN: one registration per company (branches have no GSTIN of their own).
// The frontend keeps the same list in lib/gstStates.js.
export const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
  ['97', 'Other Territory'],
].map(([code, name]) => ({ code, name }));

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const byCode = new Map(GST_STATES.map(s => [s.code, s]));
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const byName = new Map(GST_STATES.map(s => [norm(s.name), s]));
// A few spellings people type.
for (const [alias, code] of [['orissa', '21'], ['pondicherry', '34'], ['jandk', '01'], ['up', '09'], ['mp', '23'], ['newdelhi', '07'], ['nctofdelhi', '07'], ['uttaranchal', '05'], ['andamannicobar', '35']]) byName.set(alias, byCode.get(code));

export const cleanGstin = (v) => String(v || '').trim().toUpperCase();
export const isValidGstin = (v) => GSTIN_PATTERN.test(cleanGstin(v)) && byCode.has(cleanGstin(v).slice(0, 2));

export function stateFromGstin(gstin) {
  return isValidGstin(gstin) ? byCode.get(cleanGstin(gstin).slice(0, 2)) : null;
}

// A state as typed: a name ("Uttar Pradesh"), or a 2-digit code ("09").
export function stateFromText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) return byCode.get(t.padStart(2, '0')) || null;
  return byName.get(norm(t)) || null;
}

// { type: 'CGST_SGST' | 'IGST' | null, ours, theirs, basis } — null type when
// a side can't be told (the PO then says so instead of guessing).
export function gstSplitFor({ ourGstin, ourState, theirGstin, theirState }) {
  const ours = stateFromGstin(ourGstin) || stateFromText(ourState);
  const theirs = stateFromGstin(theirGstin) || stateFromText(theirState);
  if (!ours || !theirs) {
    return { type: null, ours: ours || null, theirs: theirs || null, missing: !ours ? 'company' : 'vendor' };
  }
  return { type: ours.code === theirs.code ? 'CGST_SGST' : 'IGST', ours, theirs };
}

// For forms: a GSTIN must look right, and should match the state chosen.
// Returns { error } (refuse), { warning } (allow), or {}.
export function checkGstin(gstin, state) {
  const g = cleanGstin(gstin);
  if (!g) return {};
  if (!isValidGstin(g)) return { error: 'The GSTIN doesn\'t look right — it\'s 15 characters: 2-digit state code, PAN, then 3 more (e.g. 09ABCDE1234F1Z5).' };
  const fromGstin = stateFromGstin(g);
  const chosen = stateFromText(state);
  if (chosen && fromGstin && chosen.code !== fromGstin.code) {
    return { warning: `The GSTIN is registered in ${fromGstin.name} (code ${fromGstin.code}), but the state chosen is ${chosen.name}. GST is worked out from the GSTIN.` };
  }
  return {};
}
