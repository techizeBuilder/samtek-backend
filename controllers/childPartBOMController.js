// Child Part Master — the new, standalone leaf-plus-one node of the
// corrected BOM hierarchy (see server/docs/bom-hierarchy-redesign-2026-09.md
// §4, §9). A Child Part owns its own material list — Sub Child Parts it's
// assembled from, plus other materials (raw material/tool) it consumes
// directly — on its own ChildPartBOM document, distinct from the OLD
// per-machine RDChildPart/RDBOM flow (rdChildPartController.js/
// rdController.js), which stays completely untouched.
//
// Both the OLD per-machine flow and this NEW catalog write
// Item.productKind: 'ChildPart' (confirmed — rdChildPartController.js's
// addSubChildPart still creates plain productKind:'ChildPart' Items). A
// Child Part "belongs to this new catalog" purely by having a ChildPartBOM
// document — every query below is scoped through ChildPartBOM, never
// through a bare Item.find({productKind:'ChildPart'}), so an old-flow Item
// with no ChildPartBOM never surfaces here.
//
// Material/Tool line CRUD mirrors rdController.js's addMaterial/
// updateMaterial/deleteMaterial/discontinueMaterial/reactivateMaterial
// exactly (same fabrication-weight branch, same materialKind derivation)
// minus the shared-Sub-Child-Part guard — that machinery exists only because
// the OLD model embedded copies of a shared part across machines; a Child
// Part Master's subChildParts[] line is a reference to the single canonical
// Sub Child Part Master record, so there's nothing to keep in sync.
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import { buildFabricationBomDimensions, resolveFabricationWeight } from '../services/fabricationDemandService.js';
import { resolveLineWeightKg } from '../utils/bomWeightCalc.js';
import { cleanProcessDefinition, validateProcessDefinition } from '../utils/processDefinitionValidation.js';

const pad3 = (n) => String(n).padStart(3, '0');

const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const itemNeedsAmount = (sourceItem) => !sourceItem.fabricationRef && AMOUNT_UNIT_TYPES.includes(sourceItem.unitType);

// A Sub Child Part's own per-unit cost — materialsCost + jobWorkCost +
// scrapCost, the same three independently-maintained numbers
// subChildPartMasterController.js/subChildPartSheetPlanController.js write
// onto Item.subChildPartDetails. Never pre-summed there, so summed here.
// unitWeightKg is a fourth, similarly independently-maintained number (see
// subChildPartMasterController.js's computeSourceMetrics) — passed through
// unchanged, no summing needed for a single number.
function subChildPartLineCostFrom(sourceItem) {
  const d = sourceItem.subChildPartDetails || {};
  const materialsCost = d.materialsCost || 0;
  const jobWorkCost = d.jobWorkCost || 0;
  const scrapCost = d.scrapCost || 0;
  return { materialsCost, jobWorkCost, scrapCost, unitCost: materialsCost + jobWorkCost + scrapCost, unitWeightKg: d.unitWeightKg || 0 };
}

// Child Part unit cost = Σ(Sub Child Part unit cost × qty) + Σ(other
// material cost × qty) + Production Cost/Expense — per design doc §6.
// materialsCost below folds Raw + Tool lines together (both priced the same
// way, no distinct Tool cost model exists anywhere in this codebase).
function computeChildPartCost(bom) {
  const subChildPartsCost = (bom.subChildParts || []).filter(l => !l.isDiscontinued).reduce((s, l) => s + (l.totalPrice || 0), 0);
  const rawCost = (bom.materials || []).filter(m => !m.isDiscontinued && m.materialKind !== 'tool').reduce((s, m) => s + (m.totalPrice || 0), 0);
  const toolsCost = (bom.materials || []).filter(m => !m.isDiscontinued && m.materialKind === 'tool').reduce((s, m) => s + (m.totalPrice || 0), 0);
  const materialsCost = rawCost + toolsCost;
  const totalCost = subChildPartsCost + materialsCost + (bom.productionCost || 0) + (bom.productionExpense || 0);
  return { subChildPartsCost, rawCost, toolsCost, materialsCost, totalCost };
}

// Child Part total weight = Σ(Sub Child Part unit weight × qty) +
// Σ(material/tool line weight) — same rollup shape as computeChildPartCost,
// sibling function. A material/tool line's own weight is never stored (same
// "computed live, never persisted per-line" convention every BOM level
// already uses) — resolveLineWeightKg recomputes it from the line's own
// snapshot fields each time.
// One material/tool line's own weight — never stored (same "computed live,
// never persisted per-line" convention every BOM level already uses).
// Shared by computeChildPartWeight's own sum below AND
// refreshAndComputeChildPart's per-line response decoration, so the two
// can never drift apart.
function materialLineWeightKg(m) {
  return resolveLineWeightKg({
    fabricationWeightPerPieceKg: m.fabricationCategory ? m.computedWeightPerPieceKg : null,
    quantity: m.quantity, unitWeightValue: m.unitWeightValue, unitWeightUnit: m.unitWeightUnit,
    amountValue: m.amountValue, amountUnit: m.amountUnit,
  });
}

function computeChildPartWeight(bom) {
  const subChildPartsWeightKg = (bom.subChildParts || []).filter(l => !l.isDiscontinued).reduce((s, l) => s + (l.totalWeightKg || 0), 0);
  const materialsWeightKg = (bom.materials || []).filter(m => !m.isDiscontinued).reduce((s, m) => s + (materialLineWeightKg(m) || 0), 0);
  return { subChildPartsWeightKg, materialsWeightKg, totalWeightKg: subChildPartsWeightKg + materialsWeightKg };
}

// Resolves {item, bom} for every sub-resource endpoint below — 404s if
// either the Item isn't a Child Part, or (critically) if it has no
// ChildPartBOM, which is what keeps an old-flow Child Part's id from working
// against any of these new-flow routes.
async function resolveChildPartMasterBOM(id, companyId) {
  const item = await Item.findOne({ _id: id, companyId, productKind: 'ChildPart' });
  if (!item) return { error: { code: 404, message: 'Child Part not found.' } };
  const bom = await ChildPartBOM.findOne({ childPart: item._id, company: companyId });
  if (!bom) return { error: { code: 404, message: 'Not a Child Part Master record — this Child Part may be from the old per-machine flow.' } };
  return { item, bom };
}

function validateChildPartBody(body, { requireImage }) {
  const { name, code, image } = body;
  if (!name?.trim() || !code?.trim()) return 'name and code are required';
  if (requireImage && !image) return 'A Design File (image or PDF) is required.';
  return null;
}

// GET /api/rd/child-part-master/generate-code
export const generateChildPartMasterCode = async (req, res) => {
  try {
    const count = await ChildPartBOM.countDocuments({ company: req.user.companyId });
    res.json({ success: true, code: `CP-${pad3(count + 1)}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/child-part-master — feeds the "Select Child Part" dropdown.
// Sourced from ChildPartBOM, not Item, so an old-flow Child Part never
// appears here.
export const getChildPartMasters = async (req, res) => {
  try {
    const { includeDiscontinued } = req.query;
    const boms = await ChildPartBOM.find({ company: req.user.companyId })
      .populate('childPart', 'name code image isDiscontinued specification')
      .sort({ createdAt: -1 })
      .lean();
    const rows = boms
      .filter(b => b.childPart && (includeDiscontinued === 'true' || !b.childPart.isDiscontinued))
      .map(b => ({
        _id: b.childPart._id, name: b.childPart.name, code: b.childPart.code,
        image: b.childPart.image, specification: b.childPart.specification,
        isDiscontinued: b.childPart.isDiscontinued,
      }));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Live-refresh + cost/weight computation for one Child Part Master —
// factored out of getChildPartMaster so machineBOMController.js can call the
// exact same refresh logic when live-refreshing its own childParts[] lines,
// rather than duplicating this loop a third time. A Sub Child Part's own
// materialsCost/jobWorkCost/scrapCost/unitWeightKg keep changing on Sub
// Child Part Master after this line is added, so they're re-derived on
// every read (mirrors RDBOM's own refreshBOMMaterialPrices-on-every-read
// convention). Material/Tool lines stay pure point-in-time snapshots, same
// as the Machine BOM. Returns null if the Child Part doesn't exist / has no
// ChildPartBOM (belongs to the old per-machine flow).
export async function refreshAndComputeChildPart(childPartId, companyId) {
  const resolved = await resolveChildPartMasterBOM(childPartId, companyId);
  if (resolved.error) return null;
  const { item, bom } = resolved;

  let changed = false;
  for (const line of bom.subChildParts) {
    if (line.isDiscontinued) continue;
    const src = await Item.findOne({ _id: line.subChildPart, companyId }).select('subChildPartDetails').lean();
    if (!src) continue;
    const cost = subChildPartLineCostFrom(src);
    const totalPrice = Math.round(cost.unitCost * line.quantity * 100) / 100;
    const totalWeightKg = Math.round(cost.unitWeightKg * line.quantity * 1000) / 1000;
    if (line.materialsCost !== cost.materialsCost || line.jobWorkCost !== cost.jobWorkCost
      || line.scrapCost !== cost.scrapCost || line.unitCost !== cost.unitCost || line.totalPrice !== totalPrice
      || line.unitWeightKg !== cost.unitWeightKg || line.totalWeightKg !== totalWeightKg) {
      line.materialsCost = cost.materialsCost;
      line.jobWorkCost = cost.jobWorkCost;
      line.scrapCost = cost.scrapCost;
      line.unitCost = cost.unitCost;
      line.totalPrice = totalPrice;
      line.unitWeightKg = cost.unitWeightKg;
      line.totalWeightKg = totalWeightKg;
      changed = true;
    }
  }
  if (changed) await bom.save();

  const plainBom = bom.toObject();
  // Decorate each material/tool line's own weight onto the response — never
  // persisted (see materialLineWeightKg's own comment), purely for the
  // Materials/Tools tables' own Weight column to read directly.
  plainBom.materials = (plainBom.materials || []).map(m => ({ ...m, weightKg: materialLineWeightKg(m) }));
  return { item, bom: plainBom, cost: computeChildPartCost(plainBom), weight: computeChildPartWeight(plainBom) };
}

// Called once a Child Part's own build actually completes (one unit's
// Painting finishing, see productionMfgController.js's
// completeChildPartUnitPainting) — the Child-Part-level slice of the
// pricing-cascade design (server/docs/automated-pricing-cascade-design-
// 2026-09.md's proposed recalculateChildPartCost; the upward MachineBOM
// cascade half stays deferred until Machine's own order flow exists,
// confirmed with the user 2026-09-16). Two things refreshAndComputeChildPart
// above does NOT do: refresh materials[] lines' own price from their raw
// material's CURRENT cost (that function's own comment: "Material/Tool
// lines stay pure point-in-time snapshots"), and write the newly-captured
// productionCost/productionExpense. Composes as two sequential steps rather
// than one shared mutation, since refreshAndComputeChildPart does its own
// internal fetch+save+return-a-plain-object cycle.
export async function recalculateChildPartCost(childPartItemId, companyId, { productionCost, productionExpense } = {}) {
  await refreshAndComputeChildPart(childPartItemId, companyId); // refreshes + saves subChildParts[] lines

  const bom = await ChildPartBOM.findOne({ childPart: childPartItemId, company: companyId });
  if (!bom) return null;
  for (const m of bom.materials) {
    if (m.isDiscontinued) continue;
    const rawItem = await Item.findOne({ code: m.code, companyId });
    if (rawItem) {
      m.unitPrice = rawItem.purchaseCost || 0;
      m.totalPrice = m.unitPrice * m.quantity;
      m.stdCost = rawItem.stdCost ?? null;
    }
  }
  if (productionCost != null && productionExpense != null) {
    bom.productionCost = productionCost;
    bom.productionExpense = productionExpense;
    bom.productionCostSource = 'Actual';
    bom.productionCostUpdatedAt = new Date();
  }
  await bom.save();
  return computeChildPartCost(bom.toObject());
}

// GET /api/rd/child-part-master/:id
export const getChildPartMaster = async (req, res) => {
  try {
    const result = await refreshAndComputeChildPart(req.params.id, req.user.companyId);
    if (!result) return res.status(404).json({ success: false, message: 'Not a Child Part Master record — this Child Part may be from the old per-machine flow, or may not exist.' });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/child-part-master — creates the Item (same defaults Sub
// Child Part Master uses) plus its empty ChildPartBOM shell in one call.
// Sub Child Part / Material / Tool lines are added right after via the
// sub-resource endpoints below, called sequentially by the frontend.
export const createChildPartMaster = async (req, res) => {
  try {
    const { name, code, image, specification } = req.body;
    const err = validateChildPartBody(req.body, { requireImage: true });
    if (err) return res.status(400).json({ success: false, message: err });

    const codeTrim = code.trim();
    const existing = await Item.findOne({ companyId: req.user.companyId, code: codeTrim }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: existing.productKind === 'ChildPart'
          ? `"${codeTrim}" is already a Child Part.`
          : `Item code "${codeTrim}" is already in use.`,
      });
    }

    const newItem = await Item.create({
      name: name.trim(), code: codeTrim, image: image || '',
      specification: specification?.trim() || '',
      productKind: 'ChildPart', type: 'Assemblies',
      unitType: 'Count Unit', unit: 'Pieces', qty: 0,
      purchase: false,
      companyId: req.user.companyId, createdBy: req.user._id,
    });

    const bom = await ChildPartBOM.create({ childPart: newItem._id, company: req.user.companyId, createdBy: req.user._id });

    res.status(201).json({ success: true, data: { item: newItem, bom } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id — definition fields only (name/image/
// specification). BOM arrays go through their own sub-resource endpoints.
export const updateChildPartMaster = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item } = resolved;

    const { name, image, specification } = req.body;
    if (name !== undefined) item.name = name.trim();
    if (image !== undefined) {
      if (!image) return res.status(400).json({ success: false, message: 'A Design File (image or PDF) is required.' });
      item.image = image;
    }
    if (specification !== undefined) item.specification = specification.trim();
    await item.save();
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sub Child Part line CRUD ────────────────────────────────────────────

// POST /api/rd/child-part-master/:id/sub-child-parts
export const addChildPartMasterSubChildPart = async (req, res) => {
  try {
    const { subChildPartId, quantity } = req.body;
    if (!subChildPartId) return res.status(400).json({ success: false, message: 'subChildPartId is required.' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'quantity must be a positive number.' });

    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;

    const sourceItem = await Item.findOne({ _id: subChildPartId, companyId: req.user.companyId, productKind: 'SubChildPart' }).lean();
    if (!sourceItem) return res.status(404).json({ success: false, message: 'Sub Child Part not found.' });

    const already = bom.subChildParts.find(l => String(l.subChildPart) === String(subChildPartId) && !l.isDiscontinued);
    if (already) return res.status(400).json({ success: false, message: `"${sourceItem.name}" is already on this Child Part — edit its quantity instead.` });

    const cost = subChildPartLineCostFrom(sourceItem);
    const qty = Number(quantity);
    bom.subChildParts.push({
      subChildPart: sourceItem._id, code: sourceItem.code, name: sourceItem.name,
      quantity: qty, unit: sourceItem.unit || 'Pieces',
      materialsCost: cost.materialsCost, jobWorkCost: cost.jobWorkCost, scrapCost: cost.scrapCost,
      unitCost: cost.unitCost, totalPrice: Math.round(cost.unitCost * qty * 100) / 100,
      unitWeightKg: cost.unitWeightKg, totalWeightKg: Math.round(cost.unitWeightKg * qty * 1000) / 1000,
    });
    await bom.save();
    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/sub-child-parts/:lineId
export const updateChildPartMasterSubChildPart = async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'quantity must be a positive number.' });

    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const line = bom.subChildParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Sub Child Part line not found.' });

    const sourceItem = await Item.findOne({ _id: line.subChildPart, companyId: req.user.companyId }).lean();
    const cost = sourceItem
      ? subChildPartLineCostFrom(sourceItem)
      : { materialsCost: line.materialsCost, jobWorkCost: line.jobWorkCost, scrapCost: line.scrapCost, unitCost: line.unitCost, unitWeightKg: line.unitWeightKg };
    line.quantity = Number(quantity);
    line.materialsCost = cost.materialsCost;
    line.jobWorkCost = cost.jobWorkCost;
    line.scrapCost = cost.scrapCost;
    line.unitCost = cost.unitCost;
    line.totalPrice = Math.round(cost.unitCost * line.quantity * 100) / 100;
    line.unitWeightKg = cost.unitWeightKg;
    line.totalWeightKg = Math.round(cost.unitWeightKg * line.quantity * 1000) / 1000;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/child-part-master/:id/sub-child-parts/:lineId
export const deleteChildPartMasterSubChildPart = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const line = bom.subChildParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Sub Child Part line not found.' });
    line.deleteOne();
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/sub-child-parts/:lineId/discontinue
export const discontinueChildPartMasterSubChildPart = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const line = bom.subChildParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Sub Child Part line not found.' });
    line.isDiscontinued = true;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/sub-child-parts/:lineId/reactivate
export const reactivateChildPartMasterSubChildPart = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const line = bom.subChildParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Sub Child Part line not found.' });
    line.isDiscontinued = false;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Material / Tool line CRUD ───────────────────────────────────────────
// Mirrors rdController.js's addMaterial/updateMaterial exactly (see this
// file's top comment) minus the shared-Sub-Child-Part guard and minus the
// childPart/subChildPart tagging fields (this whole document is already
// scoped to one Child Part).

// POST /api/rd/child-part-master/:id/materials
export const addChildPartMasterMaterial = async (req, res) => {
  try {
    const { code, item, itemType, quantity, unit, dimensionVariantId, amountValue, amountUnit } = req.body;
    if (!code || !item || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'code, item, quantity, and unit are required' });
    }

    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;

    const sourceItem = await Item.findOne({ companyId: req.user.companyId, productKind: null, code: code.trim() });
    if (!sourceItem) {
      return res.status(400).json({ success: false, message: `"${code}" does not match any Inventory item. Materials must be selected from Inventory.` });
    }

    let bomDimensions = {};
    let fabWeight = null;
    if (sourceItem.fabricationRef) {
      if (!dimensionVariantId || !(Number(amountValue) > 0) || !amountUnit) {
        return res.status(400).json({ success: false, message: 'A dimension size, amount, and amount unit are required for a Fabrication Master material.' });
      }
      bomDimensions = buildFabricationBomDimensions(sourceItem, dimensionVariantId, amountValue, amountUnit);
      if (!bomDimensions) {
        return res.status(400).json({ success: false, message: 'Chosen dimension size not found on this item, or the amount unit is invalid for its shape.' });
      }
      fabWeight = await resolveFabricationWeight(sourceItem, bomDimensions, bomDimensions.designation);
    }
    const needsAmount = itemNeedsAmount(sourceItem);
    if (needsAmount && !(Number(amountValue) > 0)) {
      return res.status(400).json({ success: false, message: `An amount (in ${sourceItem.unit}) is required for this material.` });
    }
    const unitPrice = fabWeight
      ? Math.round(fabWeight.weightPerPieceKg * (sourceItem.weightUnitPrice || 0) * 100) / 100
      : (sourceItem.purchaseCost || 0);
    const totalPrice = Math.round(unitPrice * Number(quantity) * 100) / 100;

    bom.materials.push({
      code, item, itemType: itemType || '',
      materialKind: /tool/i.test(sourceItem.itemType || '') ? 'tool' : 'raw',
      isSheetMetal: !!sourceItem.isSheetMetal,
      quantity: Number(quantity), unit, unitPrice, totalPrice,
      fabricationCategory: fabWeight?.fabricationCategory || '',
      bomDimensions,
      computedWeightPerPieceKg: fabWeight?.weightPerPieceKg ?? null,
      dimensionVariantId: sourceItem.fabricationRef ? dimensionVariantId : null,
      amountValue: (sourceItem.fabricationRef || needsAmount) ? Number(amountValue) : null,
      amountUnit: (sourceItem.fabricationRef || needsAmount) ? (sourceItem.fabricationRef ? amountUnit : sourceItem.unit) : null,
      category: sourceItem.category || '',
      subCategory: sourceItem.subCategory || '',
      inventoryItemType: sourceItem.itemType || '',
      sourceType: sourceItem.sourceType || '',
      itemSourceType: sourceItem.itemSourceType || '',
      itemCategories: sourceItem.itemCategories || [],
      stdCost: sourceItem.stdCost ?? null,
      salePrice: sourceItem.salePrice ?? null,
      mrp: sourceItem.mrp ?? null,
      hsn: sourceItem.hsn || '',
      gst: sourceItem.gst ?? null,
      brand: sourceItem.brand || '',
      description: sourceItem.description || '',
      modelNumber: sourceItem.modelNumber || '',
      metrology: sourceItem.metrology || '',
      materialGrade: sourceItem.materialGrade || '',
      size: sourceItem.size || '',
      unitWeightValue: sourceItem.unitWeightValue ?? null,
      unitWeightUnitType: sourceItem.unitWeightUnitType || '',
      unitWeightUnit: sourceItem.unitWeightUnit || '',
      dimensions: sourceItem.dimensions || {},
      applications: sourceItem.applications || [],
      specifications: sourceItem.specifications || [],
    });
    await bom.save();
    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/materials/:lineId
export const updateChildPartMasterMaterial = async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });

    const newCode = body.code ? body.code.trim() : mat.code;
    const sourceItem = await Item.findOne({ companyId: req.user.companyId, productKind: null, code: newCode });
    if (!sourceItem) {
      return res.status(400).json({ success: false, message: `"${body.code || newCode}" does not match any Inventory item.` });
    }

    Object.assign(mat, body);

    let fabWeight = null;
    if (sourceItem.fabricationRef) {
      if (!mat.dimensionVariantId || !(Number(mat.amountValue) > 0) || !mat.amountUnit) {
        return res.status(400).json({ success: false, message: 'A dimension size, amount, and amount unit are required for a Fabrication Master material.' });
      }
      mat.bomDimensions = buildFabricationBomDimensions(sourceItem, mat.dimensionVariantId, mat.amountValue, mat.amountUnit);
      if (!mat.bomDimensions) {
        return res.status(400).json({ success: false, message: 'Chosen dimension size not found on this item, or the amount unit is invalid for its shape.' });
      }
      fabWeight = await resolveFabricationWeight(sourceItem, mat.bomDimensions, mat.bomDimensions.designation);
    } else {
      mat.bomDimensions = {};
      mat.dimensionVariantId = null;
      if (itemNeedsAmount(sourceItem)) {
        if (!(Number(mat.amountValue) > 0)) {
          return res.status(400).json({ success: false, message: `An amount (in ${sourceItem.unit}) is required for this material.` });
        }
        mat.amountValue = Number(mat.amountValue);
        mat.amountUnit = sourceItem.unit;
      } else {
        mat.amountValue = null;
        mat.amountUnit = null;
      }
    }
    mat.fabricationCategory = fabWeight?.fabricationCategory || '';
    mat.computedWeightPerPieceKg = fabWeight?.weightPerPieceKg ?? null;
    mat.unitPrice = fabWeight
      ? Math.round(fabWeight.weightPerPieceKg * (sourceItem.weightUnitPrice || 0) * 100) / 100
      : (sourceItem.purchaseCost || 0);
    mat.totalPrice = Math.round(mat.unitPrice * (mat.quantity || 0) * 100) / 100;
    mat.category = sourceItem.category || '';
    mat.subCategory = sourceItem.subCategory || '';
    mat.inventoryItemType = sourceItem.itemType || '';
    mat.materialKind = /tool/i.test(sourceItem.itemType || '') ? 'tool' : 'raw';
    mat.isSheetMetal = !!sourceItem.isSheetMetal;
    mat.sourceType = sourceItem.sourceType || '';
    mat.itemSourceType = sourceItem.itemSourceType || '';
    mat.itemCategories = sourceItem.itemCategories || [];
    mat.stdCost = sourceItem.stdCost ?? null;
    mat.salePrice = sourceItem.salePrice ?? null;
    mat.mrp = sourceItem.mrp ?? null;
    mat.hsn = sourceItem.hsn || '';
    mat.gst = sourceItem.gst ?? null;
    mat.brand = sourceItem.brand || '';
    mat.description = sourceItem.description || '';
    mat.modelNumber = sourceItem.modelNumber || '';
    mat.metrology = sourceItem.metrology || '';
    mat.materialGrade = sourceItem.materialGrade || '';
    mat.size = sourceItem.size || '';
    mat.unitWeightValue = sourceItem.unitWeightValue ?? null;
    mat.unitWeightUnitType = sourceItem.unitWeightUnitType || '';
    mat.unitWeightUnit = sourceItem.unitWeightUnit || '';
    mat.dimensions = sourceItem.dimensions || {};
    mat.applications = sourceItem.applications || [];
    mat.specifications = sourceItem.specifications || [];

    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/child-part-master/:id/materials/:lineId
export const deleteChildPartMasterMaterial = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.deleteOne();
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/materials/:lineId/discontinue
export const discontinueChildPartMasterMaterial = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = true;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/materials/:lineId/reactivate
export const reactivateChildPartMasterMaterial = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = false;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/production-cost — same manual-estimate
// shape as RDBOM's own updateBOMProductionCost. No recalculateItemPricing
// equivalent call — there is no Item-price-sync for Child Part yet
// (confirmed out of scope; a future Machine BOM referencing Child Parts
// will need to read ChildPartBOM directly).
export const updateChildPartMasterProductionCost = async (req, res) => {
  try {
    const { productionCost, productionExpense } = req.body;
    if (!(Number(productionCost) >= 0) || !(Number(productionExpense) >= 0)) {
      return res.status(400).json({ success: false, message: 'productionCost and productionExpense must be non-negative numbers.' });
    }
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;
    bom.productionCost = Number(productionCost);
    bom.productionExpense = Number(productionExpense);
    bom.productionCostSource = 'Manual';
    bom.productionCostUpdatedAt = new Date();
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/child-part-master/:id/process-definition — Category ->
// Internal Process pipeline for this Child Part (see
// ProcessDefinitionSchema.js). materialRefs on an OutSource internal
// process must point at this same BOM's own materials[] line ids — never a
// re-derivation of quantity, just a reference into what's already there.
export const updateChildPartMasterProcessDefinition = async (req, res) => {
  try {
    const resolved = await resolveChildPartMasterBOM(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;

    const cleaned = cleanProcessDefinition(req.body.processDefinition);
    // Raw Materials/Tools and the Sub Child Part reference lines are BOTH
    // things a step (In-House or Out Source, generalized 2026-09-23 — see
    // ProcessDefinitionSchema.js's own comment) can reference — passed
    // separately, not pre-unioned, since assemblyLineIds also drives the
    // one-consumption-per-sub-assembly pool check (validateProcessDefinition's
    // own comment). materialLineQuantities backs the material/tool
    // quantity-split cap (only checked for a line referenced by more than
    // one step).
    const materialLineIds = bom.materials.map(m => m._id);
    const assemblyLineIds = bom.subChildParts.map(l => l._id);
    const materialLineQuantities = Object.fromEntries(bom.materials.map(m => [String(m._id), Number(m.quantity) || 0]));
    const err = validateProcessDefinition(cleaned, {
      materialLineIds, assemblyLineIds, materialLineQuantities, requireExactlyOneQcStep: true,
    });
    if (err) return res.status(400).json({ success: false, message: err });

    bom.processDefinition = cleaned;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/child-parts/upload-file — relocated from the now-deleted
// rdChildPartController.js (the old per-machine Child Part flow). Generic
// design-file (image/PDF) upload via the shared rdDocumentUpload middleware,
// never actually tied to RDChildPart itself — still the live upload endpoint
// for Child Part Master (ChildPartMasterTab.jsx), Sub Child Part Master
// (SubChildPartMasterTab.jsx), and its Sheet Metal Plan's laser file
// (SubChildPartSheetPlanModal.jsx).
export const uploadChildPartFile = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
  res.json({
    success: true,
    url: `/uploads/rd-docs/${req.file.filename}`,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
  });
};

// GET /api/rd/sub-child-part-inventory?search=...&includeDiscontinued=true —
// relocated from the now-deleted rdChildPartController.js (the old per-machine
// Child Part flow) — this query itself was never tied to that flow's
// RDChildPart model, just a plain Item lookup, and it's the shared data
// source for ChildPartInventoryTab.jsx (R&D + Store Inventory).
export const searchSubChildPartInventory = async (req, res) => {
  try {
    const { search, includeDiscontinued } = req.query;
    const query = { companyId: req.user.companyId, productKind: 'ChildPart' };
    if (includeDiscontinued !== 'true') query.isDiscontinued = { $ne: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }
    const items = await Item.find(query)
      .select('name code image qty unit materialFlow minStock reorderQty isDiscontinued createdAt')
      .sort({ name: 1 }).limit(500).lean();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
