import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import RDMasterOption from '../models/RDMasterOption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// One-time migration (2026-10-19, client bug): link every classification
// value to its parent OPTION (parentId) instead of only the parent's name.
//
// Before, a child knew its parent by text only, so two same-named parents —
// a Sub Category "Chakki" under two different Categories — shared one list
// of Product Names / Variants / Source Types. For each child not yet linked:
//   - one parent with that name   → linked to it;
//   - several (a shared name)     → linked to the first, and a COPY made for
//     each other parent, so every one keeps the list it shows today but is
//     independent from now on (their own children are handled the same way
//     in the next pass — e.g. Variants copied per Product Name copy);
//   - none                        → an orphan, reported, left unlinked.
// First the unique index is swapped (old: company+field+value+parentValue →
// new: + parentId), since the copies repeat the same name and parent text.
//
// Usage (from server/):
//   node scripts/linkClassificationParents.js                 dry run, every company
//   node scripts/linkClassificationParents.js --apply         write
//   --company=<id>  only that company · --uri=<mongodb uri>  instead of .env MONGODB_URI
// Safe to re-run: linked values are left alone, so a second run changes nothing.

// Parents first, so a copy made at one level is a parent at the next.
const ORDER = ['Category', 'P-SourceType', 'ProductName', 'ProductVariant', 'MotorSubCategory', 'PlantSubCategory', 'PlantName', 'PlantProduction'];
const PARENT = {
  Category: 'P-Type', 'P-SourceType': 'Category', ProductName: 'Category', ProductVariant: 'ProductName',
  MotorSubCategory: 'MotorCategory', PlantSubCategory: 'PlantCategory', PlantName: 'PlantSubCategory', PlantProduction: 'PlantName',
};

// Plan for one company, worked out in memory: [{ type: 'link', id, parentId } | { type: 'copy', doc }], plus a report.
export function planCompany(options) {
  const opts = options.map(o => ({ ...o }));
  const ops = [];
  const report = { linked: 0, copied: [], orphans: [] };
  const label = (o) => {
    const p = o.parentId ? opts.find(x => String(x._id) === String(o.parentId)) : null;
    return p ? `${p.value}${p.parentValue ? ` (under ${p.parentValue})` : ''}` : (o.parentValue || '—');
  };
  for (const field of ORDER) {
    const children = opts.filter(o => o.field === field && !o.parentId && o.parentValue);
    for (const c of children) {
      const parents = opts.filter(o => o.field === PARENT[field] && o.value === c.parentValue)
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id)));
      if (!parents.length) { report.orphans.push(`${field} "${c.value}" (parent "${c.parentValue}" not found)`); continue; }
      c.parentId = parents[0]._id;
      ops.push({ type: 'link', id: c._id, parentId: parents[0]._id });
      report.linked += 1;
      for (const p of parents.slice(1)) {
        const now = new Date();
        const doc = { _id: new mongoose.Types.ObjectId(), field: c.field, value: c.value, parentValue: p.value, parentId: p._id, company: c.company, createdAt: now, updatedAt: now };
        opts.push(doc);
        ops.push({ type: 'copy', doc });
        report.copied.push(`${field} "${c.value}" copied under ${PARENT[field]} ${label(doc)}`);
      }
    }
  }
  return { ops, report };
}

const run = async () => {
  const apply = process.argv.includes('--apply');
  const uri = (process.argv.find(a => a.startsWith('--uri=')) || '').slice(6) || process.env.MONGODB_URI;
  const onlyCompany = (process.argv.find(a => a.startsWith('--company=')) || '').slice(10);
  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}\n`);

  if (apply) {
    // The new index first (the copies repeat a name + parent text).
    const dropped = await RDMasterOption.syncIndexes();
    console.log(`Index swapped${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}.\n`);
  }

  const companies = onlyCompany ? [onlyCompany] : (await RDMasterOption.distinct('company')).map(String);
  let totalOps = 0;
  for (const co of companies) {
    const options = await RDMasterOption.find({ company: co }).lean();
    const { ops, report } = planCompany(options);
    totalOps += ops.length;
    console.log(`Company ${co}: ${options.length} values · ${report.linked} to link · ${report.copied.length} copies · ${report.orphans.length} orphans`);
    for (const line of report.copied) console.log(`   copy   ${line}`);
    for (const line of report.orphans) console.log(`   orphan ${line}`);
    if (!apply) continue;
    for (const op of ops) {
      if (op.type === 'link') await RDMasterOption.updateOne({ _id: op.id }, { $set: { parentId: op.parentId } });
      else await RDMasterOption.collection.insertOne(op.doc);
    }
    const unlinked = await RDMasterOption.countDocuments({ company: co, field: { $in: ORDER }, parentId: null, parentValue: { $ne: null } });
    console.log(`   applied · still unlinked: ${unlinked} (= orphans ${report.orphans.length})`);
  }

  console.log(apply ? `\nDone: ${totalOps} change(s).` : `\nDry run complete: ${totalOps} change(s) planned. Re-run with --apply to write.`);
  await mongoose.disconnect();
  process.exit(0);
};

// Run only when called directly (the planner is imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(err => { console.error(err); process.exit(1); });
}
