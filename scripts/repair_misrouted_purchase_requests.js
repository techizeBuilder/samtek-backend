/**
 * One-time repair: Purchase Requests that were mis-routed by the early
 * multi-item build, which treated 'Manufacturing Machine' items as purchased.
 * Correct rule: only 'Purchase Machine' category is purchased; everything
 * else is produced in-house.
 *
 * For every PENDING PR whose linked sale item's inventory category is NOT
 * 'Purchase Machine':
 *   - delete the wrong PR
 *   - reset that sale item's Store flow state (so Store can re-run Check,
 *     which now routes it to Production correctly)
 *
 * Safe to run multiple times. Only touches Pending PRs with a saleItemId.
 *
 * Run: node scripts/repair_misrouted_purchase_requests.js
 */

import connectDB from '../config/database.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Sale from '../models/Sale.js';
import { resolveInventoryItem } from '../services/storeFlowService.js';

export const repairMisroutedPRs = async () => {
  const results = { scanned: 0, repaired: 0, keptCorrect: 0, skippedNoItem: 0, errors: [] };

  const prs = await PurchaseRequest.find({ status: 'Pending', saleItemId: { $ne: null } });
  results.scanned = prs.length;

  for (const pr of prs) {
    try {
      const sale = await Sale.findOne({ 'items._id': pr.saleItemId });
      if (!sale) { results.skippedNoItem++; continue; }
      const saleItem = sale.items.id(pr.saleItemId);
      if (!saleItem) { results.skippedNoItem++; continue; }

      const invItem = await resolveInventoryItem(sale.companyId, {
        itemRef: saleItem.itemRef,
        name: saleItem.productName
      });
      const category = (invItem?.category || '').toLowerCase().trim();

      if (category === 'purchase machine') {
        results.keptCorrect++;
        continue; // correctly routed — leave it
      }

      // Mis-routed: remove the PR and reset the item so Store can re-check
      await PurchaseRequest.deleteOne({ _id: pr._id });
      saleItem.productType = null;
      saleItem.isAvailableInInventory = null;
      saleItem.storeQCStatus = null;
      sale.recomputeAggregateStoreStatus();
      await sale.save({ validateBeforeSave: false });

      results.repaired++;
      console.log(`🔧 Removed mis-routed PR ${pr.requestId} ("${pr.productName}", category: ${invItem?.category || 'unknown'}) — sale item reset for re-check`);
    } catch (err) {
      results.errors.push(`${pr.requestId}: ${err.message}`);
      console.error(`❌ Error repairing PR ${pr.requestId}:`, err.message);
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('repair_misrouted_purchase_requests')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Repairing mis-routed Purchase Requests...');
      const results = await repairMisroutedPRs();
      console.log('✅ Repair complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Repair failed:', err);
      process.exit(1);
    }
  })();
}
