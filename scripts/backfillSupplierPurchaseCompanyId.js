/**
 * One-time migration script
 *
 * Backfills the new `companyId` field on `Supplier` and `Purchase` (PO)
 * documents created before that field existed. Both models previously had
 * NO company-level scoping at all — only a `unit` branch-name string — and
 * a real cross-tenant collision was confirmed live (two different companies
 * both using the branch name "Test Unit"), meaning any query scoped only by
 * `unit` could return one company's vendors/POs to another company's users.
 * See server/docs/procurement-purchase-restructure-changes-2026-10.md for
 * the full writeup of how this was found and fixed.
 *
 * Backfill strategy (never guesses — leaves `companyId` unset and reports
 * it rather than assigning a wrong company):
 *   - Purchase: `createdBy` -> User.companyId (primary signal, reliable —
 *     createdBy is a required field). Falls back to the linked
 *     `purchaseRequests[]` -> PurchaseRequest.companyId when the creating
 *     user has no companyId of their own.
 *   - Supplier: collects every distinct companyId referenced by this
 *     vendor's own transactional history (VendorBid/PurchaseInvoice/
 *     PurchaseReturn/PurchaseExchange/VendorPayment/RFQ — all of which
 *     already carry companyId). Exactly one distinct value -> backfilled
 *     with confidence. Zero (no transactional history at all) -> falls
 *     back to matching the Supplier's own `unit` value against which
 *     company's real Users use that exact unit, only when that match is
 *     itself unambiguous (exactly one company). Two or more distinct
 *     values, or an ambiguous unit match, is left unset and reported.
 *
 * Safe to run multiple times — only ever touches documents still missing
 * `companyId`.
 *
 * Run: node --experimental-vm-modules scripts/backfillSupplierPurchaseCompanyId.js
 */

import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import User from '../models/User.js';
import VendorBid from '../models/VendorBid.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import PurchaseExchange from '../models/PurchaseExchange.js';
import VendorPayment from '../models/VendorPayment.js';
import RFQ from '../models/RFQ.js';

export const backfillSupplierPurchaseCompanyId = async () => {
  const results = {
    purchase: { total: 0, updated: 0, alreadySet: 0, unresolved: [] },
    supplier: { total: 0, updated: 0, alreadySet: 0, ambiguous: [], unresolved: [] },
    errors: [],
  };

  // ── Purchase ──────────────────────────────────────────────────────────
  const purchases = await Purchase.find({}).select('_id createdBy purchaseRequests companyId').lean();
  results.purchase.total = purchases.length;
  const userCache = new Map();

  for (const po of purchases) {
    if (po.companyId) { results.purchase.alreadySet++; continue; }
    try {
      let companyId = null;

      const uid = String(po.createdBy);
      if (!userCache.has(uid)) {
        userCache.set(uid, await User.findById(po.createdBy).select('companyId').lean());
      }
      const creator = userCache.get(uid);
      if (creator?.companyId) companyId = creator.companyId;

      if (!companyId && po.purchaseRequests?.length) {
        const pr = await PurchaseRequest.findOne({ _id: { $in: po.purchaseRequests }, companyId: { $ne: null } }).select('companyId').lean();
        if (pr?.companyId) companyId = pr.companyId;
      }

      if (companyId) {
        await Purchase.updateOne({ _id: po._id }, { $set: { companyId } });
        results.purchase.updated++;
      } else {
        results.purchase.unresolved.push({ _id: po._id, reason: 'No companyId found via createdBy or purchaseRequests' });
      }
    } catch (err) {
      results.errors.push({ model: 'Purchase', _id: po._id, error: err.message });
    }
  }

  // ── Supplier ──────────────────────────────────────────────────────────
  const suppliers = await Supplier.find({}).select('_id unit companyId').lean();
  results.supplier.total = suppliers.length;

  const vendorRefCollections = [
    { model: VendorBid, field: 'vendor' },
    { model: PurchaseInvoice, field: 'vendor' },
    { model: PurchaseReturn, field: 'vendor' },
    { model: PurchaseExchange, field: 'vendor' },
    { model: VendorPayment, field: 'vendor' },
    { model: RFQ, field: 'vendors' }, // array field
  ];

  for (const supplier of suppliers) {
    if (supplier.companyId) { results.supplier.alreadySet++; continue; }
    try {
      const companySet = new Set();
      for (const { model, field } of vendorRefCollections) {
        const docs = await model.find({ [field]: supplier._id }).select('companyId').lean();
        for (const d of docs) if (d.companyId) companySet.add(String(d.companyId));
      }

      let companyId = null;
      if (companySet.size === 1) {
        companyId = [...companySet][0];
      } else if (companySet.size === 0 && supplier.unit) {
        // No transactional history — fall back to an unambiguous unit match.
        const usersOnUnit = await User.find({ unit: supplier.unit, companyId: { $ne: null } }).select('companyId').lean();
        const companiesOnUnit = new Set(usersOnUnit.map(u => String(u.companyId)));
        if (companiesOnUnit.size === 1) companyId = [...companiesOnUnit][0];
        else if (companiesOnUnit.size > 1) {
          results.supplier.ambiguous.push({ _id: supplier._id, unit: supplier.unit, companies: [...companiesOnUnit] });
          continue;
        }
      } else if (companySet.size > 1) {
        results.supplier.ambiguous.push({ _id: supplier._id, companies: [...companySet] });
        continue;
      }

      if (companyId) {
        await Supplier.updateOne({ _id: supplier._id }, { $set: { companyId } });
        results.supplier.updated++;
      } else {
        results.supplier.unresolved.push({ _id: supplier._id, unit: supplier.unit, reason: 'No transactional history and no unambiguous unit match' });
      }
    } catch (err) {
      results.errors.push({ model: 'Supplier', _id: supplier._id, error: err.message });
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('backfillSupplierPurchaseCompanyId')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting Supplier/Purchase companyId backfill...');
      const results = await backfillSupplierPurchaseCompanyId();
      console.log('✅ Backfill complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Backfill failed:', err);
      process.exit(1);
    }
  })();
}
