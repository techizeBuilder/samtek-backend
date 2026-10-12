// The purchase side of the ledger (procurement-v2, 2026-10-12).
//
// Before this, a PO's invoice tried to post to accounts named "Purchase
// Account" / "Input GST" that existed in no unit, so it never posted, while
// vendor payments did post (Dr Accounts Payable) — Payable went negative.
// Now the software keeps its own purchase accounts per company + unit,
// created on first use, and posts every money event of a PO itself:
//
//   advance paid            Dr Advance to Vendors        / Cr Bank
//   material QC-passed      Dr Purchase + Input GST      / Cr Accounts Payable
//   PO fully accepted       Dr Purchase + Input GST (charges) / Cr Accounts Payable
//                           Dr Accounts Payable          / Cr Advance to Vendors (set-off)
//   payment for material    Dr Accounts Payable          / Cr Bank
//
// See docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md §4.
// Balances move with the same sign rule as accountsController.createTransaction
// and the ledger page: Asset / Expense + debit − credit, others + credit − debit.
import { Account, Transaction } from '../models/Account.js';

export const SYSTEM_ACCOUNTS = {
  purchase: { name: 'Purchase', type: 'Expense', description: 'Material bought — posted when it passes QC' },
  input_cgst: { name: 'Input CGST', type: 'Asset', description: 'CGST paid on purchases (same-state vendors)' },
  input_sgst: { name: 'Input SGST', type: 'Asset', description: 'SGST paid on purchases (same-state vendors)' },
  input_igst: { name: 'Input IGST', type: 'Asset', description: 'IGST paid on purchases (other-state vendors)' },
  accounts_payable: { name: 'Accounts Payable', type: 'Liability', description: 'What we owe vendors for accepted material' },
  advance_to_vendors: { name: 'Advance to Vendors', type: 'Asset', description: 'Money paid to vendors before the material was accepted (advances, vendor credit)' },
  vendor_refund_due: { name: 'Vendor Refund Due', type: 'Asset', description: 'Refunds vendors have agreed to pay back' },
  purchase_loss: { name: 'Purchase Loss', type: 'Expense', description: 'Money paid for rejected material the vendor would not replace or refund' },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const slug = (s) => String(s || 'unit').trim().replace(/[^A-Za-z0-9]+/g, '-').toUpperCase();

// The company + unit's own account for `key`, made the first time it's needed.
export async function getSystemAccount(key, { companyId, unit }) {
  const def = SYSTEM_ACCOUNTS[key];
  if (!def) throw new Error(`Unknown system account "${key}"`);
  if (!companyId || !unit) throw new Error('A company and unit are needed to post to the ledger.');
  const found = await Account.findOne({ systemKey: key, companyId, unit });
  if (found) return found;
  try {
    return await Account.create({
      accountNumber: `SYS-${key.toUpperCase()}-${String(companyId).slice(-6)}-${slug(unit)}`,
      accountName: def.name,
      accountType: def.type,
      balance: 0,
      unit,
      companyId,
      systemKey: key,
      description: def.description,
    });
  } catch (err) {
    // Two posts racing to create the same account: the unique accountNumber
    // stops the second — use the one that won.
    if (err?.code === 11000) {
      const again = await Account.findOne({ systemKey: key, companyId, unit });
      if (again) return again;
    }
    throw err;
  }
}

// The Input GST account(s) for a PO's GST type: same state → CGST + SGST
// (split half and half), other state → IGST. An unknown type (a side's
// GSTIN / state missing) is booked as CGST + SGST, the common case.
export function gstLines(gstAmount, gstType) {
  const gst = round2(gstAmount);
  if (!(gst > 0)) return [];
  if (gstType === 'IGST') return [{ key: 'input_igst', debit: gst }];
  const half = round2(gst / 2);
  return [{ key: 'input_cgst', debit: half }, { key: 'input_sgst', debit: round2(gst - half) }];
}

// Balanced? Returns the cleaned lines (2 decimals, zero lines dropped) or throws.
export function checkBalanced(lines) {
  const clean = lines
    .map(l => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
    .filter(l => l.debit > 0 || l.credit > 0);
  const dr = round2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (!clean.length) return { lines: [], total: 0 };
  if (Math.abs(dr - cr) > 0.01) throw new Error(`Ledger entry doesn't balance (Dr ₹${dr} / Cr ₹${cr}).`);
  return { lines: clean, total: dr };
}

const balanceChange = (type, debit, credit) => (['Asset', 'Expense'].includes(type) ? debit - credit : credit - debit);

// Posts one balanced entry. Each line names a system account by `key`, or a
// real account document / id by `account` (the bank). Returns the
// Transaction, or null when every line is zero.
export async function postEntry({ companyId, unit, lines, description, reference = '', relatedDocument, relatedDocumentId = null, mode = 'Other', date = new Date(), user, prefix = 'PUR' }) {
  const { lines: clean, total } = checkBalanced(lines);
  if (!clean.length) return null;
  const resolved = [];
  for (const l of clean) {
    let acc = l.account;
    if (l.key) acc = await getSystemAccount(l.key, { companyId, unit });
    else if (acc && !acc.accountType) acc = await Account.findById(acc);
    if (!acc) throw new Error('Ledger account not found.');
    resolved.push({ acc, debit: l.debit, credit: l.credit });
  }
  const txn = await Transaction.create({
    transactionNumber: `TXN-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11).toUpperCase()}`,
    date,
    description,
    reference,
    entries: resolved.map(r => ({ account: r.acc._id, debit: r.debit, credit: r.credit })),
    totalAmount: total,
    unit,
    relatedDocument,
    relatedDocumentId,
    mode,
    createdBy: user?._id || user,
  });
  for (const r of resolved) {
    const change = round2(balanceChange(r.acc.accountType, r.debit, r.credit));
    if (change) await Account.updateOne({ _id: r.acc._id }, { $inc: { balance: change } });
  }
  return txn;
}

export const _test = { round2, balanceChange, slug };
