import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Item } from '../models/Inventory.js';
import ProcessCategoryOption from '../models/ProcessCategoryOption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// One-time migration (see server/docs/process-inhouse-outsource-redesign-
// discussion-2026-09.md "Phase 1 scope decisions"): Sub Child Part's old
// jobWork (Boolean) + jobWorkTypes ([String]) fields are being removed from
// the schema entirely, replaced by the new Category -> Internal Process
// processDefinition. This converts any existing data into that new shape
// BEFORE the old fields are deleted, so nothing is silently lost.
//
// Lossy but reasonable, by design: the old model had no per-jobWorkType
// in-house/outsource distinction, only one flag for the whole part — every
// jobWorkType becomes one internal process under a single auto-generated
// "Legacy Job Work" category, all typed the same way that part's old
// jobWork flag said (OutSource if true, InHouse if false). Also seeds a
// matching ProcessCategoryOption per company so the migrated data isn't
// orphaned relative to the new picker's own catalog.
//
// Idempotent — only touches Sub Child Parts that have old jobWorkTypes data
// AND no processDefinition yet, so re-running after --execute is a no-op.
const LEGACY_CATEGORY_LABEL = 'Legacy Job Work';

const run = async () => {
  const execute = process.argv.includes('--execute');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${execute ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}\n`);

  const items = await Item.find({
    productKind: 'SubChildPart',
    'subChildPartDetails.jobWorkTypes.0': { $exists: true },
    'subChildPartDetails.processDefinition.0': { $exists: false },
  });

  console.log(`Found ${items.length} Sub Child Part(s) to migrate.\n`);

  const seededCompanies = new Set();

  for (const item of items) {
    const d = item.subChildPartDetails;
    const type = d.jobWork ? 'OutSource' : 'InHouse';
    const names = [...new Set((d.jobWorkTypes || []).map(t => String(t).trim()).filter(Boolean))];
    console.log(`  - ${item.code} (${item.name}): jobWork=${d.jobWork} -> ${names.length} internal process(es) as ${type}`);

    if (execute) {
      item.subChildPartDetails.processDefinition = [{
        label: LEGACY_CATEGORY_LABEL,
        internalProcesses: names.map(name => ({ name, type, materialRefs: [] })),
      }];
      await item.save();

      const companyId = String(item.companyId);
      if (!seededCompanies.has(companyId)) {
        seededCompanies.add(companyId);
      }
      await ProcessCategoryOption.findOneAndUpdate(
        { companyId: item.companyId, bomLevel: 'SubChildPart', label: LEGACY_CATEGORY_LABEL },
        { $addToSet: { internalProcesses: { $each: names } } },
        { upsert: true }
      );
    }
  }

  console.log(execute
    ? `\nDone. Migrated ${items.length} Sub Child Part(s), seeded catalog for ${seededCompanies.size} compan${seededCompanies.size === 1 ? 'y' : 'ies'}.`
    : '\nDry run complete. Re-run with --execute to apply.');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
