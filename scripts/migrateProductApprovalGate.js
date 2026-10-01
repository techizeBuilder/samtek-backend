import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// One-time migration for the Product Approval Gate
// (docs/product-approval-gate-redesign-discussion-2026-09.md).
//
// Existing items predate the new approval fields, so without this every
// Machine would drop out of Sales' pickers (releaseStatus now gates ALL
// Machines) and every Child Part / Sub Child Part would stop its reorder
// cron / cascade orders. Per the "dev data, legacy doesn't matter" decision,
// everything already in the system is grandfathered in as fully approved and
// Released. Also cleans up the removed R&D-request flow:
//  - orders parked in 'BOM Pending' go back to 'Pending'
//  - material demands stuck at 'Pending R&D' become 'Requested' (no reviewer
//    exists any more)
//  - the orphaned rdrequests collection is dropped
//
// Usage: node scripts/migrateProductApprovalGate.js [--dry-run]
// Needs MONGODB_URI in server/.env (or the environment). Idempotent.
const DRY = process.argv.includes('--dry-run');

const approved = (block) => ({
  [`${block}.designStatus`]: 'Approved',
  [`${block}.bomApproved`]: true,
  [`${block}.qcListApproved`]: true,
  [`${block}.releaseStatus`]: 'Released',
});

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected${DRY ? ' (DRY RUN — nothing is written)' : ''}`);

  const plans = [
    ['Machine', 'machineDetails'],
    ['ChildPart', 'childPartDetails'],
    ['SubChildPart', 'subChildPartDetails'],
  ];
  for (const [kind, block] of plans) {
    const filter = { productKind: kind, [`${block}.releaseStatus`]: { $ne: 'Released' } };
    const count = await Item.countDocuments(filter);
    console.log(`${kind}: ${count} item(s) to grandfather in as approved + Released`);
    if (!DRY && count) await Item.updateMany(filter, { $set: approved(block) });
  }

  const bomPending = await ProductionOrder.countDocuments({ status: 'BOM Pending' });
  console.log(`Orders in 'BOM Pending': ${bomPending} -> 'Pending'`);
  if (!DRY && bomPending) await ProductionOrder.updateMany({ status: 'BOM Pending' }, { $set: { status: 'Pending', rdRequestRaised: false } });

  const stuck = await ProductionOrder.countDocuments({ 'materialDemands.status': 'Pending R&D' });
  console.log(`Orders with 'Pending R&D' material demands: ${stuck} -> 'Requested'`);
  if (!DRY && stuck) {
    await ProductionOrder.updateMany(
      { 'materialDemands.status': 'Pending R&D' },
      { $set: { 'materialDemands.$[d].status': 'Requested' } },
      { arrayFilters: [{ 'd.status': 'Pending R&D' }] }
    );
  }

  const collections = await mongoose.connection.db.listCollections({ name: 'rdrequests' }).toArray();
  console.log(`rdrequests collection: ${collections.length ? 'present -> drop' : 'not present'}`);
  if (!DRY && collections.length) await mongoose.connection.db.dropCollection('rdrequests');

  await mongoose.disconnect();
  console.log('Done');
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
