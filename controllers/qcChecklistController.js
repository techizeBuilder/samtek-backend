import mongoose from 'mongoose';
import QCMasterChecklist, { QC_MODULES, QC_MODULE_STAGES } from '../models/QCMasterChecklist.js';
import QCItemChecklist from '../models/QCItemChecklist.js';
import { Item } from '../models/Inventory.js';
import RDChildPart from '../models/RDChildPart.js';
import RDBOM from '../models/RDBOM.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';

// Shared by every route below — 'inventory'/'motorMaster' are flat (only
// stage 'default'); 'productMaster' is staged ('initial'/'process'/'final',
// see QC_MODULE_STAGES's own comment).
function isValidModuleStage(module, stage) {
  return QC_MODULE_STAGES[module]?.includes(stage) || false;
}
// Only Product Master QC's 'initial'/'process' stages target a specific Sub
// Child Part instead of the whole item — everything else (flat modules,
// and productMaster's own 'final' stage) is item-level, same mechanic
// Inventory QC/Motor Master QC already use.
function isPartScopedStage(module, stage) {
  return module === 'productMaster' && (stage === 'initial' || stage === 'process');
}

// ── Master Checklist (one per {company, module, stage}) ─────────────────────

// GET /api/rd/qc-checklist/:module/:stage/master
export const getMasterChecklist = async (req, res) => {
  try {
    const { module, stage } = req.params;
    if (!isValidModuleStage(module, stage)) return res.status(400).json({ success: false, message: 'Invalid QC module/stage' });

    const doc = await QCMasterChecklist.findOne({ module, stage, company: req.user.companyId }).lean();
    const items = doc?.items || [];

    const counts = await QCItemChecklist.aggregate([
      { $match: { module, stage, company: new mongoose.Types.ObjectId(req.user.companyId) } },
      { $unwind: '$selectedItems' },
      { $group: { _id: '$selectedItems.masterItemId', count: { $sum: 1 } } },
    ]);
    const countByRow = new Map(counts.map(c => [String(c._id), c.count]));

    res.json({
      success: true,
      data: items.map(it => ({ ...it, usageCount: countByRow.get(String(it._id)) || 0 })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/qc-checklist/:module/:stage/master
export const addMasterChecklistItem = async (req, res) => {
  try {
    const { module, stage } = req.params;
    if (!isValidModuleStage(module, stage)) return res.status(400).json({ success: false, message: 'Invalid QC module/stage' });
    const { label, type, reference } = req.body;
    if (!label || !String(label).trim()) return res.status(400).json({ success: false, message: 'Check item label is required' });
    if (!['checkbox', 'value'].includes(type)) return res.status(400).json({ success: false, message: 'Type must be "checkbox" or "value"' });

    const doc = await QCMasterChecklist.findOneAndUpdate(
      { module, stage, company: req.user.companyId },
      {
        $push: { items: { label: label.trim(), type, reference: (reference || '').trim() } },
        $setOnInsert: { module, stage, company: req.user.companyId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, data: doc.items[doc.items.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/qc-checklist/:module/:stage/master/:rowId
export const updateMasterChecklistItem = async (req, res) => {
  try {
    const { module, stage, rowId } = req.params;
    if (!isValidModuleStage(module, stage)) return res.status(400).json({ success: false, message: 'Invalid QC module/stage' });
    const { label, type, reference, isDiscontinued } = req.body;
    if (type !== undefined && !['checkbox', 'value'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be "checkbox" or "value"' });
    }

    const doc = await QCMasterChecklist.findOne({ module, stage, company: req.user.companyId });
    if (!doc) return res.status(404).json({ success: false, message: 'Master checklist not found' });
    const row = doc.items.id(rowId);
    if (!row) return res.status(404).json({ success: false, message: 'Check item not found' });

    if (label !== undefined) {
      if (!String(label).trim()) return res.status(400).json({ success: false, message: 'Check item label is required' });
      row.label = label.trim();
    }
    if (type !== undefined) row.type = type;
    if (reference !== undefined) row.reference = (reference || '').trim();
    if (isDiscontinued !== undefined) row.isDiscontinued = !!isDiscontinued;

    await doc.save();
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/qc-checklist/:module/:stage/master/:rowId — hard delete,
// only ever allowed while nothing has selected the row yet (Discontinue
// otherwise) — see QCMasterChecklist.js's own comment.
export const deleteMasterChecklistItem = async (req, res) => {
  try {
    const { module, stage, rowId } = req.params;
    if (!isValidModuleStage(module, stage)) return res.status(400).json({ success: false, message: 'Invalid QC module/stage' });

    const usageCount = await QCItemChecklist.countDocuments({
      module, stage, company: req.user.companyId, 'selectedItems.masterItemId': rowId,
    });
    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Can't delete — this check is used by ${usageCount} item${usageCount === 1 ? '' : 's'}. Discontinue it instead.`,
      });
    }

    const doc = await QCMasterChecklist.findOneAndUpdate(
      { module, stage, company: req.user.companyId },
      { $pull: { items: { _id: rowId } } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Master checklist not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/qc-checklist/:module/:stage/master/reorder
export const reorderMasterChecklist = async (req, res) => {
  try {
    const { module, stage } = req.params;
    if (!isValidModuleStage(module, stage)) return res.status(400).json({ success: false, message: 'Invalid QC module/stage' });
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds is required' });
    }

    const doc = await QCMasterChecklist.findOne({ module, stage, company: req.user.companyId });
    if (!doc) return res.status(404).json({ success: false, message: 'Master checklist not found' });

    const byId = new Map(doc.items.map(it => [String(it._id), it]));
    if (orderedIds.length !== doc.items.length || !orderedIds.every(id => byId.has(String(id)))) {
      return res.status(400).json({ success: false, message: 'orderedIds must include every existing row exactly once' });
    }

    doc.items = orderedIds.map(id => byId.get(String(id)));
    await doc.save();
    res.json({ success: true, data: doc.items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Item / Part Checklist (one per {company, module, stage, item[, part]}) ──

// Shared resolver for both the plain item route and the part-scoped route —
// builds the exact filter for this target, and (for part-scoped requests)
// validates the childPart/subChildPart actually exist on this product's own
// Child Parts before anything reads/writes against them.
async function resolveTarget(req, res) {
  const { module, stage, itemId, childPartId, subChildPartId } = req.params;
  const companyId = req.user.companyId;
  if (!isValidModuleStage(module, stage)) {
    res.status(400).json({ success: false, message: 'Invalid QC module/stage' });
    return null;
  }
  const partScoped = isPartScopedStage(module, stage);

  const item = await Item.findOne({ _id: itemId, companyId }).lean();
  if (!item) {
    res.status(404).json({ success: false, message: 'Item not found' });
    return null;
  }

  // ── Canonical Sub Child Part QC (2026-09-16) ───────────────────────────
  // A Sub Child Part's initial/process checklist is defined ONCE, keyed to
  // its own Inventory Item (productKind 'ChildPart'), part ids null —
  // exactly like the material-list guard makes a linked part's BOM one
  // shared thing. Two ways in:
  //  1. Directly, by the Sub Child Part Item itself — the Inventory QC page's
  //     new "Sub Child Part Inventory" tab, and Production's Sub Child Part
  //     order QC pull.
  //  2. Indirectly, from a machine's Product Master QC when the part on that
  //     machine is LINKED to an Inventory Item — the request comes in with
  //     machine + child/sub-child ids, but we redirect it to the canonical
  //     entry so every machine using that part shares one checklist.
  if (partScoped && item.productKind === 'ChildPart' && !childPartId && !subChildPartId) {
    return {
      module, stage, item,
      filter: { module, stage, item: itemId, childPartId: null, subChildPartId: null, company: companyId },
      subChildPartCanonical: true,
      sharedMachineCount: await RDChildPart.countDocuments({ company: companyId, 'subChildParts.inventoryItem': item._id }),
    };
  }

  if (partScoped && (!childPartId || !subChildPartId)) {
    res.status(400).json({ success: false, message: `${module}/${stage} checklists are configured per Sub Child Part — use the /part route` });
    return null;
  }
  if (!partScoped && (childPartId || subChildPartId)) {
    res.status(400).json({ success: false, message: `${module}/${stage} checklists apply to the whole item, not a part` });
    return null;
  }

  if (partScoped) {
    const childPart = await RDChildPart.findOne({ _id: childPartId, product: itemId, company: companyId }).lean();
    const subChildPart = childPart?.subChildParts?.find(s => String(s._id) === String(subChildPartId));
    if (!childPart || !subChildPart) {
      res.status(404).json({ success: false, message: 'Sub Child Part not found on this product' });
      return null;
    }
    // Linked → redirect to the one canonical entry keyed by the Inventory Item.
    if (subChildPart.inventoryItem) {
      return {
        module, stage, item,
        filter: { module, stage, item: String(subChildPart.inventoryItem), childPartId: null, subChildPartId: null, company: companyId },
        subChildPartCanonical: true,
        redirectedFromMachine: true,
        sharedMachineCount: await RDChildPart.countDocuments({ company: companyId, 'subChildParts.inventoryItem': subChildPart.inventoryItem }),
      };
    }
  }

  return {
    module, stage, item,
    filter: { module, stage, item: itemId, childPartId: partScoped ? childPartId : null, subChildPartId: partScoped ? subChildPartId : null, company: companyId },
  };
}

// GET /api/rd/qc-checklist/:module/:stage/item/:itemId
// GET /api/rd/qc-checklist/:module/:stage/item/:itemId/part/:childPartId/:subChildPartId
// Plain (no req/res) core of GET .../item — reused by the QC Jobs lazy-pull
// mechanism (qcChecklistPullService.js) so it resolves a part/item's
// configured checklist exactly the same way this endpoint shows it to R&D,
// with no separate copy of this logic to drift out of sync. `filter` is the
// same shape resolveTarget below builds: { module, stage, item, childPartId,
// subChildPartId, company }.
export async function resolveSelectedChecklist(filter) {
  const [masterDoc, targetDoc] = await Promise.all([
    QCMasterChecklist.findOne({ module: filter.module, stage: filter.stage, company: filter.company }).lean(),
    QCItemChecklist.findOne(filter).lean(),
  ]);
  const master = masterDoc?.items || [];
  const masterById = new Map(master.map(row => [String(row._id), row]));
  const selectedItems = targetDoc?.selectedItems || [];

  const selected = selectedItems
    .map(sel => {
      const row = masterById.get(String(sel.masterItemId));
      if (!row) return null; // master row was hard-deleted (shouldn't happen once selected — the delete guard blocks it)
      return {
        masterItemId: sel.masterItemId,
        label: row.label,
        type: row.type,
        reference: row.reference,
        isDiscontinued: row.isDiscontinued,
        expectedValue: sel.expectedValue || '',
      };
    })
    .filter(Boolean);

  return { master, selected };
}

export const getItemChecklist = async (req, res) => {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return; // resolveTarget already sent the error response
    const data = await resolveSelectedChecklist(target.filter);
    res.json({
      success: true,
      data: {
        ...data,
        // Present only when this checklist is the one canonical entry shared
        // by every machine that uses this Sub Child Part — the frontend uses
        // it to auto-fill from what's already defined and to warn before a
        // change that hits every machine (the BOM-guard idea).
        subChildPartCanonical: !!target.subChildPartCanonical,
        sharedMachineCount: target.sharedMachineCount ?? 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/qc-checklist/:module/:stage/item/:itemId
// POST /api/rd/qc-checklist/:module/:stage/item/:itemId/part/:childPartId/:subChildPartId
// Body: { selectedItems: [{ masterItemId, expectedValue }] } — full replace.
export const saveItemChecklist = async (req, res) => {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return;
    const { selectedItems } = req.body;
    if (!Array.isArray(selectedItems)) return res.status(400).json({ success: false, message: 'selectedItems must be an array' });

    const masterDoc = await QCMasterChecklist.findOne({ module: target.module, stage: target.stage, company: req.user.companyId }).lean();
    const masterById = new Map((masterDoc?.items || []).map(row => [String(row._id), row]));

    const resolved = [];
    for (const sel of selectedItems) {
      const row = masterById.get(String(sel.masterItemId));
      if (!row) return res.status(400).json({ success: false, message: 'One of the selected checks no longer exists on the master checklist' });
      if (row.type === 'value' && !String(sel.expectedValue || '').trim()) {
        return res.status(400).json({ success: false, message: `"${row.label}" needs an expected value/tolerance` });
      }
      resolved.push({
        masterItemId: row._id,
        expectedValue: row.type === 'value' ? String(sel.expectedValue).trim() : '',
      });
    }

    const doc = await QCItemChecklist.findOneAndUpdate(
      target.filter,
      { $set: { selectedItems: resolved, updatedBy: req.user._id }, $setOnInsert: target.filter },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Product Master QC only: read-only BOM tree for a product ────────────────

// GET /api/rd/qc-checklist/productMaster/parts/:productId — everything the
// Product Master QC page needs to decide/render its branch: the product's
// own productSourceType (Purchase/Job Work vs In House/Out Source — decides
// whether Initial/Process even apply, see the client-request doc's 2026-08-31
// follow-on), and its Child Part -> Sub Child Part tree with each Sub Child
// Part's own real BOM material lines (material/grade/brand/qty), read live
// off RDChildPart + the product's locked/current RDBOM — never stored by
// this QC feature itself, always a fresh read so it can't drift from BOM
// Management. matches material lines to a Sub Child Part via subChildPartCode
// (RDBOM.MaterialSchema's own stronger reference, see RDBOM.js) rather than
// the display-name snapshot, since codes don't get silently renamed the way
// a free-text name field could.
export const getProductQCParts = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Item.findOne({ _id: productId, companyId: req.user.companyId, productKind: 'Machine' }).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // A real MachineBOM means this machine is on the new hierarchy — its
    // Child Parts are reusable, independently-stocked units with their own
    // complete QC pipeline (Fabrication -> Assembly -> QC -> Painting),
    // already passed before any unit is ever issued to this machine's own
    // order. There's nothing left to configure in the old RDChildPart/RDBOM
    // tree below for these machines (confirmed with the user 2026-09-17) —
    // skip it entirely rather than show a misleading "No BOM created yet"
    // for a machine that clearly has one, just not this kind.
    const machineBOM = await MachineBOM.findOne({ machine: productId, company: req.user.companyId }).select('_id').lean();
    if (machineBOM) {
      return res.json({
        success: true,
        data: { productSourceType: product.productSourceType || '', hasBOM: true, hasMachineBOM: true, childParts: [] },
      });
    }

    const [childParts, bom] = await Promise.all([
      RDChildPart.find({ product: productId, company: req.user.companyId }).sort({ createdAt: 1 }).lean(),
      RDBOM.findOne({ machine: productId, company: req.user.companyId }).lean(),
    ]);

    const materialsBySubChildCode = new Map();
    for (const mat of bom?.materials || []) {
      if (mat.isDiscontinued || !mat.subChildPartCode) continue;
      const key = `${mat.childPartCode}::${mat.subChildPartCode}`;
      if (!materialsBySubChildCode.has(key)) materialsBySubChildCode.set(key, []);
      materialsBySubChildCode.get(key).push({
        code: mat.code, item: mat.item, materialGrade: mat.materialGrade, brand: mat.brand,
        quantity: mat.quantity, unit: mat.unit, materialKind: mat.materialKind,
      });
    }

    // Initial/Process selected-checklist counts for every part on this
    // product, in one query — avoids an N+1 round trip per Sub Child Part
    // just to show a "3 selected" badge. Only ever set for these two
    // part-scoped stages (see isPartScopedStage) — 'final' is product-level,
    // not part-level, so it's excluded by the childPartId:{$ne:null} filter.
    const partChecklists = await QCItemChecklist.find({
      module: 'productMaster', item: productId, company: req.user.companyId, childPartId: { $ne: null },
    }).lean();
    const countByPart = new Map(); // `${stage}:${childPartId}:${subChildPartId}` -> selected count
    for (const doc of partChecklists) {
      countByPart.set(`${doc.stage}:${doc.childPartId}:${doc.subChildPartId}`, doc.selectedItems.length);
    }

    const data = childParts.map(cp => ({
      _id: cp._id, code: cp.code, name: cp.name, image: cp.image, isDiscontinued: cp.isDiscontinued,
      subChildParts: (cp.subChildParts || []).map(scp => ({
        _id: scp._id, code: scp.code, name: scp.name, image: scp.image, isDiscontinued: scp.isDiscontinued,
        materials: materialsBySubChildCode.get(`${cp.code}::${scp.code}`) || [],
        initialCount: countByPart.get(`initial:${cp._id}:${scp._id}`) || 0,
        processCount: countByPart.get(`process:${cp._id}:${scp._id}`) || 0,
      })),
    }));

    res.json({
      success: true,
      data: { productSourceType: product.productSourceType || '', hasBOM: !!bom, childParts: data },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/qc-checklist/child-part-list — the Inventory QC page's "Child
// Part" tab: every Child Part Item with how many machines use it (still a
// live read off the legacy RDChildPart tree — purely informational, doesn't
// share checklist state with anything) and its own, genuinely independent
// module:'childPart' Initial/Process selected-check counts. Renamed
// 2026-09-14 from getSubChildPartQCList — it always queried
// productKind:'ChildPart' (correct), the only thing wrong was counting
// checklists under the shared 'productMaster' module instead of its own.
export const getChildPartQCList = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const items = await Item.find({ companyId, productKind: 'ChildPart' })
      .select('code name image isDiscontinued').sort({ name: 1 }).lean();
    if (!items.length) return res.json({ success: true, data: [] });

    const ids = items.map(i => i._id);
    const [checklists, childParts] = await Promise.all([
      QCItemChecklist.find({
        module: 'childPart', item: { $in: ids }, childPartId: null, subChildPartId: null, company: companyId,
      }).lean(),
      RDChildPart.find({ company: companyId, 'subChildParts.inventoryItem': { $in: ids } })
        .select('subChildParts.inventoryItem').lean(),
    ]);

    const countByItemStage = new Map();
    for (const doc of checklists) countByItemStage.set(`${doc.item}:${doc.stage}`, doc.selectedItems.length);
    const machineCount = new Map();
    for (const cp of childParts) {
      for (const scp of cp.subChildParts || []) {
        if (!scp.inventoryItem) continue;
        const k = String(scp.inventoryItem);
        machineCount.set(k, (machineCount.get(k) || 0) + 1);
      }
    }

    res.json({
      success: true,
      data: items.map(i => ({
        _id: i._id, code: i.code, name: i.name, image: i.image, isDiscontinued: i.isDiscontinued,
        machineCount: machineCount.get(String(i._id)) || 0,
        initialCount: countByItemStage.get(`${i._id}:initial`) || 0,
        processCount: countByItemStage.get(`${i._id}:process`) || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Read-only reference panels (2026-09-14) — Child Part QC / Sub Child Part
// QC's own "what is this part actually made of" quick-look, matching the
// compact format Product Master QC's old per-part panel used
// (`${item}${grade}${brand} · ${qty} ${unit}`), plus a design-file link.
// Deliberately gated by the SAME feature key as everything else on these two
// QC pages (qcChildPart/qcSubChildPart), NOT bomManagement — this IS the QC
// page reading BOM data for reference, not BOM Management itself (same
// reasoning getProductQCParts above already established). Live reads off the
// NEW hierarchy (ChildPartBOM / Item.subChildPartDetails) — never stored by
// this QC feature itself, so it can never drift from BOM Management.

// GET /api/rd/qc-checklist/child-part/:itemId/reference
export const getChildPartQCReference = async (req, res) => {
  try {
    const { itemId } = req.params;
    const companyId = req.user.companyId;
    const bom = await ChildPartBOM.findOne({ childPart: itemId, company: companyId })
      .populate('subChildParts.subChildPart', 'image')
      .lean();
    if (!bom) return res.json({ success: true, data: { subChildParts: [], materials: [] } });

    res.json({
      success: true,
      data: {
        subChildParts: (bom.subChildParts || []).filter(s => !s.isDiscontinued).map(s => ({
          code: s.code, name: s.name, quantity: s.quantity, unit: s.unit,
          image: s.subChildPart?.image || null,
        })),
        materials: (bom.materials || []).filter(m => !m.isDiscontinued).map(m => ({
          item: m.item, materialGrade: m.materialGrade, brand: m.brand,
          quantity: m.quantity, unit: m.unit, materialKind: m.materialKind,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/qc-checklist/sub-child-part/:itemId/reference
export const getSubChildPartQCReference = async (req, res) => {
  try {
    const { itemId } = req.params;
    const companyId = req.user.companyId;
    const item = await Item.findOne({ _id: itemId, companyId, productKind: 'SubChildPart' })
      .select('image subChildPartDetails')
      .populate('subChildPartDetails.sourceItem', 'name code materialGrade brand')
      .lean();
    if (!item) return res.status(404).json({ success: false, message: 'Sub Child Part not found' });

    const src = item.subChildPartDetails?.sourceItem;
    res.json({
      success: true,
      data: {
        image: item.image || null,
        material: src ? {
          name: src.name, code: src.code,
          materialGrade: src.materialGrade || '', brand: src.brand || '',
          quantity: item.subChildPartDetails.sourceQty, unit: item.subChildPartDetails.sourceUnit,
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
