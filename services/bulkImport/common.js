// Feature 20 (client, 21 Nov 2026): bulk import for R&D — shared helpers.
// docs/client-features-2026-11/20-bulk-import-logic.md
//
// A template is an .xlsx with one data sheet (header row + one row per record),
// a "How to fill" sheet and reference sheets. Reading is by header title, ignoring
// case, spaces and punctuation ("Item Code *" = "item code"), so a moved column or a
// column R&D deleted (an optional one) still reads.
import * as XLSX from 'xlsx';

export const MAX_ROWS = 1000;

export class ImportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const text = (v) => (v == null ? '' : String(v).trim());
/** Header / list matching key: lower case, letters and digits only. */
export const keyOf = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * A list value matched ignoring case and surrounding spaces → the list's own spelling, or null.
 * The exact spelling wins when the list holds the same value in two letter cases (23 Nov:
 * "Assembly Item" typed, the list has "Assembly Item" and "assembly item").
 */
export const matchIn = (value, list = []) => {
  const t = text(value);
  const k = t.toLowerCase();
  return list.find((x) => String(x).trim() === t) ?? list.find((x) => String(x).trim().toLowerCase() === k) ?? null;
};
/** '' → null; a number (or numeric text) → number; anything else → NaN. */
export const num = (v) => {
  if (v == null || text(v) === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '').trim() : v);
  return Number.isFinite(n) ? n : NaN;
};

/** An opened workbook, or null when the file isn't a readable Excel file. */
export function openWorkbook(buffer) {
  try { return XLSX.read(buffer, { type: 'buffer' }); } catch { return null; }
}

/**
 * Reads one sheet into rows keyed by column key.
 * source: the file's buffer, or a workbook from openWorkbook (several sheets, one parse).
 * columns: [{ key, title, required?, aliases? }] — `required` columns must exist in the header;
 * `aliases` are older titles still read (a file made from an older template).
 * options: optional — a sheet that may be missing or empty (no problem, and never the
 * first sheet in its place); maxRows — the row limit (default MAX_ROWS).
 * Returns { rows: [{ row, values: { key: raw } }], fileProblems: [string] }.
 */
export function readSheet(source, sheetName, columns, { optional = false, maxRows = MAX_ROWS } = {}) {
  const wb = Buffer.isBuffer(source) ? openWorkbook(source) : source;
  if (!wb) return { rows: [], fileProblems: ['This file could not be read as an Excel file (.xlsx).'] };
  const named = wb.SheetNames.find((n) => keyOf(n) === keyOf(sheetName));
  if (!named && optional) return { rows: [], fileProblems: [] };
  const name = named || wb.SheetNames[0];
  const sheet = name ? wb.Sheets[name] : null;
  if (!sheet) return { rows: [], fileProblems: ['The file has no sheets.'] };
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
  const header = (aoa[0] || []).map(keyOf);
  const at = new Map();
  for (const c of columns) {
    const i = [c.title, ...(c.aliases || [])].map((t) => header.indexOf(keyOf(t))).find((x) => x >= 0);
    if (i !== undefined) at.set(c.key, i);
  }
  const fileProblems = columns.filter((c) => c.required && !at.has(c.key))
    .map((c) => `This isn't the template: there's no "${(c.label || c.title).replace(/\s*\*$/, '')}" column in the "${sheetName}" sheet. Download the template again.`);
  const rows = [];
  for (let r = 1; r < aoa.length; r++) {
    const line = aoa[r] || [];
    if (!line.some((v) => text(v) !== '')) continue; // a blank row
    const values = {};
    for (const c of columns) values[c.key] = at.has(c.key) ? line[at.get(c.key)] : '';
    rows.push({ row: r + 1, values }); // Excel's row number
  }
  if (optional && !rows.length) return { rows, fileProblems: [] }; // an empty optional sheet (its header may even be missing)
  if (!fileProblems.length && !rows.length) fileProblems.push(`The "${sheetName}" sheet has no rows to import.`);
  if (rows.length > maxRows) fileProblems.push(`The "${sheetName}" sheet has ${rows.length} rows: up to ${maxRows} at a time. Split it into smaller files.`);
  return { rows, fileProblems };
}

/** An .xlsx buffer from [{ name, rows: [[...]], widths?: [n] }]. */
export function workbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.widths) ws['!cols'] = s.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Lists laid out side by side, one column per list: { 'Item Type': [...], … } → rows. */
export function listColumns(lists) {
  const names = Object.keys(lists);
  const height = Math.max(0, ...names.map((n) => lists[n].length));
  const rows = [names];
  for (let i = 0; i < height; i++) rows.push(names.map((n) => lists[n][i] ?? ''));
  return rows;
}

/** A problem list sorted by row, then column. */
export const sortProblems = (problems) => problems.sort((a, b) => (a.row || 0) - (b.row || 0) || String(a.column).localeCompare(String(b.column)));
