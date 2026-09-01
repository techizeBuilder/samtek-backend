import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';
import RDChildPart from '../models/RDChildPart.js';
import RDBOM from '../models/RDBOM.js';
import { resolveSelectedChecklist } from '../controllers/qcChecklistController.js';

// Product Master's own BOM-eligibility gate (same list used everywhere else
// this session — rdController.js's createBOM, rdChildPartController.js's
// MANUFACTURING_SOURCE_TYPES) — deliberately NOT the separate purchase/
// internalManufacturing radio, which isn't kept in sync with this.
const MANUFACTURING_SOURCE_TYPES = ['In House Manufacturing', 'Out Source Manufactured'];

// A QCJob's itemCode is set inconsistently by its 4 creation sites — a real
// Item.code for Purchase/Production/Stock jobs, but the Item's own ObjectId
// string for Store-sourced ones (see storeFlowService.js's own comment on
// why). Try both so this resolver works regardless of which source created
// the job, rather than requiring every future creation site to remember a
// convention this file doesn't otherwise enforce.
async function resolveItemForJob(job, companyId) {
  if (!job.itemCode) return null;
  if (mongoose.Types.ObjectId.isValid(job.itemCode)) {
    const byId = await Item.findOne({ _id: job.itemCode, companyId }).lean();
    if (byId) return byId;
  }
  return Item.findOne({ code: job.itemCode, companyId }).lean();
}

// Which {module, stage} a QCJob's own flat `checklist[]` (the whole-job
// decision — Inventory/Motor QC's only checklist, and a Product Master
// item's Final check regardless of purchase vs manufactured, see
// QCJob.js's own comment) should pull from.
function flatModuleStageForItem(item) {
  if (item.productKind === 'Motor') return { module: 'motorMaster', stage: 'default' };
  if (item.productKind === 'Machine') return { module: 'productMaster', stage: 'final' };
  return { module: 'inventory', stage: 'default' };
}

// Same shape the old RDQualityParam-based sync produced (parameter/
// standardValue/actualValue/status/remarks), plus `type` carried through
// from the master row so the fill-in UI knows whether this row needs a real
// value or is just a Pass/Fail checkbox (added 2026-09-02 — previously
// discarded here, forcing every row through a value box regardless of type).
// checkbox rows carry no numeric standard, so standardValue falls back to
// the row's own reference note (or a plain label) instead of a blank cell.
function toChecklistItems(selected) {
  return selected.map(row => ({
    parameter: row.label,
    standardValue: row.type === 'value' ? (row.expectedValue || '') : (row.reference || 'Checkbox'),
    type: row.type === 'value' ? 'value' : 'checkbox',
    actualValue: '',
    status: 'Pending',
    remarks: '',
  }));
}

// Lazy pull for a job's flat `checklist[]` — called from getQCJob the
// moment someone actually opens a job, never for the list view (confirmed
// 2026-09-01: computing this for all ~145 jobs on every list load would be
// wasted work almost nobody asked for). Only resolves+persists once; a job
// that already has checklist rows is left untouched here — re-syncing after
// R&D changes something is what the "Pull R&D Data" button (still wired to
// this exact function) is for.
export async function ensureFlatChecklist(job, companyId, { force = false } = {}) {
  if (job.checklist?.length > 0 && !force) return false;
  const item = await resolveItemForJob(job, companyId);
  if (!item) return false;
  const { module, stage } = flatModuleStageForItem(item);
  const { selected } = await resolveSelectedChecklist({
    module, stage, item: item._id, childPartId: null, subChildPartId: null, company: companyId,
  });
  if (!selected.length) return false;
  job.checklist = toChecklistItems(selected);
  return true;
}

// Structural seed only (no checklist rows yet) for an in-house/outsource-
// manufactured product's partChecks[] — one entry per Sub Child Part, read
// live off the real BOM (RDChildPart), same as the Product Master QC page
// itself. Row-level Initial/Process definitions are resolved separately,
// lazily, the first time Production actually opens ONE part (see
// productionMfgController.js's getPartChecklistRows) — no reason to resolve
// every part's rows just because the job or the parts list was opened once.
export async function ensurePartChecksStructure(job, companyId) {
  if (job.partChecks?.length > 0) return false;
  const item = await resolveItemForJob(job, companyId);
  if (!item || item.productKind !== 'Machine') return false;
  if (!MANUFACTURING_SOURCE_TYPES.includes(item.productSourceType)) return false;

  const childParts = await RDChildPart.find({ product: item._id, company: companyId }).lean();
  const entries = [];
  for (const cp of childParts) {
    if (cp.isDiscontinued) continue;
    for (const scp of cp.subChildParts || []) {
      if (scp.isDiscontinued) continue;
      entries.push({
        childPartId: cp._id, subChildPartId: scp._id,
        childPartName: cp.name, subChildPartName: scp.name,
        initial: [], process: [], status: 'Awaiting Production',
      });
    }
  }
  if (!entries.length) return false;
  job.partChecks = entries;
  return true;
}

// Row definitions (not yet Production's actual results) for one part's
// Initial or Process checklist — read-only, resolved fresh every time
// (cheap: one part, one stage) rather than cached, so a master-checklist
// edit R&D makes mid-build is reflected immediately.
export async function resolvePartChecklistRows(productId, childPartId, subChildPartId, stage, companyId) {
  const { selected } = await resolveSelectedChecklist({
    module: 'productMaster', stage, item: productId, childPartId, subChildPartId, company: companyId,
  });
  return toChecklistItems(selected);
}

// Read-only reference data (design file + real BOM material lines) for each
// Sub Child Part on a manufactured product's partChecks — resolved fresh
// against BOM Management's live data every call, never stored on the QCJob
// itself (same "always fresh" reasoning as resolvePartChecklistRows above),
// so whoever's checking "Design"/"Material"/"Size (Amount)/Qty" always sees
// the current spec. Added 2026-09-02: Production/QC were being asked to
// verify those checklist items against data they were never actually shown.
export async function attachPartReference(partChecks, productId, companyId) {
  if (!partChecks?.length) return [];
  const [childPartDocs, bom] = await Promise.all([
    RDChildPart.find({ product: productId, company: companyId }).lean(),
    RDBOM.findOne({ machine: productId, company: companyId }).select('materials').lean(),
  ]);
  const materials = bom?.materials || [];
  return partChecks.map(p => {
    const cp = childPartDocs.find(c => String(c._id) === String(p.childPartId));
    const scp = cp?.subChildParts?.find(s => String(s._id) === String(p.subChildPartId));
    const partMaterials = scp
      ? materials.filter(m => m.subChildPartCode === scp.code).map(m => ({
          item: m.item, quantity: m.quantity, unit: m.unit, size: m.size,
          materialGrade: m.materialGrade, brand: m.brand,
        }))
      : [];
    const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
    return { ...obj, designFile: scp?.image || '', materials: partMaterials };
  });
}

export { MANUFACTURING_SOURCE_TYPES, resolveItemForJob };
