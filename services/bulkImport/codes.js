// Feature 35 (27 Nov 2026): codes made on import when the cell is blank.
// docs/client-features-2026-11/35-import-auto-codes-logic.md
//
// Everything works in memory on one set of taken codes (the checks already read every Item code
// through the code index), so a big file makes no query per row. The rules are the ones the
// pages and the other code makers already use:
//   nextNumbered: PREFIX-NNN, one more than the highest under that prefix (itemCodeService.js
//                 nextSequentialCode; the Fabrication import's nextCode)
//   freeFrom:     base, then base-2, base-3 … (itemCodeService.js freeCode; rdController.js
//                 getFreeProductCode, the Product Master Generate button)
//   productCodeBase: the Generate button's rule (client pages/ResearchDevelopment/ProductMaster.jsx
//                 suggestProductCode)

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A set of taken codes (any letter case). add() marks one taken; has() asks. */
export function codeKeeper(codes = []) {
  const taken = new Set();
  const keeper = {
    add(c) { const v = String(c || '').trim().toLowerCase(); if (v) taken.add(v); return keeper; },
    has(c) { return taken.has(String(c || '').trim().toLowerCase()); },
    all() { return taken; },
  };
  for (const c of codes) keeper.add(c);
  return keeper;
}

/** The Fabrication rule's prefix: the name's first 3 letters, upper case (ITM when it has none). */
export const derivePrefix = (name) => (String(name || '').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()) || 'ITM';

/** PREFIX-NNN: one more than the highest number under that prefix; the code is marked taken. */
export function nextNumbered(keeper, prefix, pad = 3) {
  const re = new RegExp(`^${esc(prefix.toLowerCase())}-(\\d+)$`);
  let max = 0;
  for (const c of keeper.all()) { const m = c.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  let n = max + 1;
  let code = `${prefix}-${String(n).padStart(pad, '0')}`;
  while (keeper.has(code)) { n += 1; code = `${prefix}-${String(n).padStart(pad, '0')}`; }
  keeper.add(code);
  return code;
}

/** base, else base-2, base-3 …; the code is marked taken. */
export function freeFrom(keeper, base) {
  const b = String(base || '').trim().toUpperCase();
  if (!b) return '';
  let code = b;
  for (let n = 2; keeper.has(code); n += 1) code = `${b}-${n}`;
  keeper.add(code);
  return code;
}

/**
 * The Product Master Generate button's base: the initials of the Name's words (a word with a digit
 * in it, a size like "6x12", kept whole), the Metrology, and the Variant's digits unless the Name
 * already carries them. "Impact Pulverizer" + MS + 6x12 → IPMS612; "Aata machine 6x12" → AM6X12.
 */
export function productCodeBase({ name = '', metrology = '', variant = '' } = {}) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const initials = words.map((w) => (/\d/.test(w) ? w.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : w[0].toUpperCase())).join('');
  const nameDigits = words.filter((w) => /\d/.test(w)).join('').replace(/\D/g, '');
  const variantDigits = String(variant || '').replace(/[^0-9]/g, '');
  const digits = variantDigits && nameDigits.includes(variantDigits) ? '' : variantDigits;
  return `${initials}${String(metrology || '').toUpperCase()}${digits}`;
}
