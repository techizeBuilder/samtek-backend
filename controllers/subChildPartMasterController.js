// Sub Child Part Master — the new, genuinely standalone leaf of the
// corrected BOM hierarchy (see server/docs/bom-hierarchy-redesign-2026-09.md).
// A Sub Child Part is exactly ONE source raw material sent through Job Work
// (confirmed with the client 2026-09-11/12 — never a multi-material BOM), so
// unlike Child Part it needs no separate BOM document of its own — its whole
// definition lives directly on the Item (productKind: 'SubChildPart',
// subChildPartDetails). Not machine-scoped, not Child-Part-scoped — created
// once, referenced by code wherever a Child Part uses it (that reference
// wiring is the next build pass, not this one).
import { Item } from '../models/Inventory.js';
import { buildFabricationBomDimensions, resolveFabricationWeight } from '../services/fabricationDemandService.js';
import { resolveLineWeightKg } from '../utils/bomWeightCalc.js';
import { cleanProcessDefinition, validateProcessDefinition } from '../utils/processDefinitionValidation.js';

const pad3 = (n) => String(n).padStart(3, '0');

// Same "does this need an Amount field instead of a bare Quantity" rule the
// BOM material picker uses (rdController.js's own itemNeedsAmount) — a
// Sub Child Part's sourceQty/sourceUnit are always the source item's own
// locked Used Unit, so this decides which weight branch applies (see
// computeSourceMetrics below).
const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const itemNeedsAmount = (sourceItem) => !sourceItem.fabricationRef && AMOUNT_UNIT_TYPES.includes(sourceItem.unitType);

// Same math a BOM material line's own price/weight uses (rdController.js /
// server/utils/bomWeightCalc.js) — reused here, not reinvented, so a Sub
// Child Part's Materials Cost and Unit Weight can never drift from how the
// rest of the app prices/weighs the identical source material. Returns both
// together (not two separate calls) since the fabrication branch's own
// weight resolution already gives both for free.
export async function computeSourceMetrics(sourceItem, sourceQty, sourceUnit, sourceDimensionVariantId) {
  if (sourceItem.fabricationRef) {
    const bomDimensions = buildFabricationBomDimensions(sourceItem, sourceDimensionVariantId, sourceQty, sourceUnit);
    if (!bomDimensions) return { materialsCost: 0, unitWeightKg: 0 };
    const resolved = await resolveFabricationWeight(sourceItem, bomDimensions);
    const weightPerPieceKg = resolved?.weightPerPieceKg ?? null;
    return {
      materialsCost: weightPerPieceKg != null ? weightPerPieceKg * (sourceItem.weightUnitPrice || 0) : 0,
      unitWeightKg: weightPerPieceKg || 0,
    };
  }
  const materialsCost = (sourceItem.purchaseCost || 0) * (Number(sourceQty) || 0);
  const needsAmount = itemNeedsAmount(sourceItem);
  const weightKg = resolveLineWeightKg({
    quantity: Number(sourceQty) || 0,
    unitWeightValue: sourceItem.unitWeightValue,
    unitWeightUnit: sourceItem.unitWeightUnit,
    amountValue: needsAmount ? Number(sourceQty) || 0 : null,
    amountUnit: needsAmount ? sourceUnit : null,
  });
  return { materialsCost, unitWeightKg: weightKg || 0 };
}

// Shared by both places a Sub Child Part's build actually completes and a
// real cost becomes known — Purchase's job-work final receive
// (subChildPartJobWorkOrderController.js) and Production's in-house Submit
// to QC (subChildPartOrderMfgController.js). Whoever finishes the build
// enters ONE total for the whole order (matching what they'd actually have —
// a vendor invoice, or their own logged build cost); this divides it into
// the per-unit jobWorkCost the rest of the app already treats as a
// per-Sub-Child-Part-unit figure (childPartBOMController.js's
// subChildPartLineCostFrom), flips jobWorkCostSource to 'Actual', and — in
// the SAME step — refreshes materialsCost from the raw material's CURRENT
// price (not whatever it was when this Sub Child Part was last touched), so
// the BOM's Total Cost reflects reality regardless of which route completed
// it. No return value — mutates and saves `item` directly.
export async function captureSubChildPartActualCost(item, sourceItem, totalCost, orderQuantity) {
  const { sourceQty, sourceUnit, sourceDimensionVariantId } = item.subChildPartDetails;
  const { materialsCost } = await computeSourceMetrics(sourceItem, sourceQty, sourceUnit, sourceDimensionVariantId);
  item.subChildPartDetails.materialsCost = materialsCost;
  item.subChildPartDetails.jobWorkCost = totalCost / orderQuantity;
  item.subChildPartDetails.jobWorkCostSource = 'Actual';
  item.subChildPartDetails.jobWorkCostUpdatedAt = new Date();
  await item.save();
}

// GET /api/rd/sub-child-parts/generate-code
export const generateSubChildPartMasterCode = async (req, res) => {
  try {
    const count = await Item.countDocuments({ companyId: req.user.companyId, productKind: 'SubChildPart' });
    res.json({ success: true, code: `SCP-${pad3(count + 1)}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/sub-child-parts — list, with the source material's name/code
// resolved for display (never duplicated onto the Sub Child Part itself).
// Pagination is opt-in (only kicks in when page/limit are actually sent) —
// mirrors qcController.js's getQCJobs exactly — so
// SubChildPartMasterInventoryTab.jsx (Store/R&D Inventory tabs, which never
// sends page/limit) keeps getting today's flat, unpaginated response
// unchanged; only BOM Management's own paginated list opts in.
export const getSubChildParts = async (req, res) => {
  try {
    const { search, includeDiscontinued, page, limit } = req.query;
    const query = { companyId: req.user.companyId, productKind: 'SubChildPart' };
    if (includeDiscontinued !== 'true') query.isDiscontinued = { $ne: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }
    // unitType/fabricationRef/dimensionVariants/weightUnitPrice/purchaseCost
    // are what the create/edit form needs to rebuild its unit-aware /
    // fabrication-aware fields (see SubChildPartMasterTab.jsx's openEdit) —
    // not just for display. Every BOM_FIELD_CATALOG key too (itemType/
    // modelNumber/brand/itemCategories/sourceType/itemSourceType/metrology/
    // materialGrade/description) — the "Additional Details" panels (create/
    // edit form + each row's own expanded view) need these for ANY row.
    const populateSelect = 'name code unit unitType purchaseCost fabricationRef dimensionVariants weightUnitPrice itemType modelNumber brand itemCategories sourceType itemSourceType metrology materialGrade description';

    const isPaginated = !!(page || limit);
    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const [items, total] = await Promise.all([
        Item.find(query)
          .select('name code image specification qty unit materialFlow minStock reorderQty isDiscontinued subChildPartDetails createdAt')
          .populate('subChildPartDetails.sourceItem', populateSelect)
          .sort({ name: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
        Item.countDocuments(query),
      ]);
      return res.json({
        success: true, data: items,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const items = await Item.find(query)
      .select('name code image specification qty unit materialFlow minStock reorderQty isDiscontinued subChildPartDetails createdAt')
      .populate('subChildPartDetails.sourceItem', populateSelect)
      .sort({ name: 1 }).limit(500).lean();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/sub-child-parts/:id
export const getSubChildPart = async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.id, companyId: req.user.companyId, productKind: 'SubChildPart' })
      // Every BOM_FIELD_CATALOG key too (itemType/modelNumber/brand/
      // itemCategories/sourceType/itemSourceType/metrology/materialGrade/
      // description) — the View modal's "Additional Details" panel needs
      // these for ANY row, not just whichever one the create/edit form
      // happens to have open (which separately has the full raw-items list).
      .populate('subChildPartDetails.sourceItem', 'name code unit unitType purchaseCost fabricationRef dimensionVariants weightUnitPrice itemType modelNumber brand itemCategories sourceType itemSourceType metrology materialGrade description')
      .lean();
    if (!item) return res.status(404).json({ success: false, message: 'Sub Child Part not found.' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

function validateBody(body, { requireImage }) {
  const { name, code, image, sourceItemId, sourceQty, processDefinition } = body;
  if (!name?.trim() || !code?.trim()) return 'name and code are required';
  if (requireImage && !image) return 'A Design File (image or PDF) is required.';
  if (!sourceItemId) return 'A source raw material is required — a Sub Child Part is always exactly one material.';
  if (!(Number(sourceQty) > 0)) return 'sourceQty must be a positive number — how much of the source material one Sub Child Part unit consumes.';
  return validateProcessDefinition(cleanProcessDefinition(processDefinition), { requireAtLeastOne: true });
}

// Fabrication Master source material with more than one catalog dimension
// size needs a real pick — mirrors the BOM material picker's own
// FabricationVariantAmountFields, which auto-selects the sole variant when
// there's only one, but requires a choice otherwise.
function validateDimensionVariant(sourceItem, sourceDimensionVariantId) {
  if (!sourceItem.fabricationRef) return null;
  const variants = (sourceItem.dimensionVariants || []).filter(v => !v.isLeftover);
  if (variants.length > 1 && !sourceDimensionVariantId) {
    return 'This material has more than one catalog dimension size — pick which one this Sub Child Part is cut from.';
  }
  if (sourceDimensionVariantId && !variants.some(v => String(v._id) === String(sourceDimensionVariantId))) {
    return 'That dimension size is not on the source material\'s own catalog.';
  }
  return null;
}

// POST /api/rd/sub-child-parts
export const createSubChildPart = async (req, res) => {
  try {
    const { name, code, image, specification, sourceItemId, sourceQty, sourceUnit, sourceDimensionVariantId, processDefinition } = req.body;
    const err = validateBody(req.body, { requireImage: true });
    if (err) return res.status(400).json({ success: false, message: err });

    const codeTrim = code.trim();
    const existing = await Item.findOne({ companyId: req.user.companyId, code: codeTrim }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: existing.productKind === 'SubChildPart'
          ? `"${codeTrim}" is already a Sub Child Part.`
          : `Item code "${codeTrim}" is already in use.`,
      });
    }

    const sourceItem = await Item.findOne({ _id: sourceItemId, companyId: req.user.companyId }).lean();
    if (!sourceItem) return res.status(404).json({ success: false, message: 'Source raw material not found.' });
    const dimErr = validateDimensionVariant(sourceItem, sourceDimensionVariantId);
    if (dimErr) return res.status(400).json({ success: false, message: dimErr });
    const { materialsCost, unitWeightKg } = await computeSourceMetrics(sourceItem, sourceQty, sourceUnit?.trim() || sourceItem.unit || '', sourceDimensionVariantId);

    const newItem = await Item.create({
      name: name.trim(), code: codeTrim, image: image || '',
      specification: specification?.trim() || '',
      productKind: 'SubChildPart', type: 'Assemblies',
      unitType: 'Count Unit', unit: 'Pieces', qty: 0,
      // Reorder is driven by this record's own jobWork flag, not the generic
      // vendor-purchase sweep — see subChildPartDetails below and
      // bom-hierarchy-redesign-2026-09.md §3. Left at the schema default
      // (false) here deliberately; the reorder routing itself is the next
      // build pass, not this one.
      purchase: false,
      subChildPartDetails: {
        sourceItem: sourceItem._id,
        sourceQty: Number(sourceQty),
        sourceUnit: sourceUnit?.trim() || sourceItem.unit || '',
        materialsCost,
        unitWeightKg,
        sourceDimensionVariantId: sourceDimensionVariantId || null,
        processDefinition: cleanProcessDefinition(processDefinition),
      },
      companyId: req.user.companyId, createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/sub-child-parts/:id — definition fields only (name/spec/source
// material/job work). Stock-management fields (materialFlow/minStock/
// reorderQty/isDiscontinued) go through the generic PUT /api/items/:id, same
// as Child Part's own Flow Management modal already does — no need for a
// second path to the same fields.
export const updateSubChildPart = async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.id, companyId: req.user.companyId, productKind: 'SubChildPart' });
    if (!item) return res.status(404).json({ success: false, message: 'Sub Child Part not found.' });

    const { name, image, specification, sourceItemId, sourceQty, sourceUnit, sourceDimensionVariantId, processDefinition } = req.body;
    if (name !== undefined) item.name = name.trim();
    if (image !== undefined) {
      if (!image) return res.status(400).json({ success: false, message: 'A Design File (image or PDF) is required.' });
      item.image = image;
    }
    if (specification !== undefined) item.specification = specification.trim();

    let sourceItem = null;
    if (sourceItemId !== undefined) {
      sourceItem = await Item.findOne({ _id: sourceItemId, companyId: req.user.companyId }).lean();
      if (!sourceItem) return res.status(404).json({ success: false, message: 'Source raw material not found.' });
      item.subChildPartDetails.sourceItem = sourceItem._id;
      if (sourceUnit === undefined) item.subChildPartDetails.sourceUnit = sourceItem.unit || '';
    }
    if (sourceDimensionVariantId !== undefined) {
      // Re-validate against whichever source item is now in effect — the one
      // just picked above, or the one already saved.
      const checkAgainst = sourceItem || await Item.findOne({ _id: item.subChildPartDetails.sourceItem }).lean();
      if (checkAgainst) {
        const dimErr = validateDimensionVariant(checkAgainst, sourceDimensionVariantId);
        if (dimErr) return res.status(400).json({ success: false, message: dimErr });
      }
      item.subChildPartDetails.sourceDimensionVariantId = sourceDimensionVariantId || null;
    }
    if (sourceQty !== undefined) {
      if (!(Number(sourceQty) > 0)) return res.status(400).json({ success: false, message: 'sourceQty must be a positive number.' });
      item.subChildPartDetails.sourceQty = Number(sourceQty);
    }
    if (sourceUnit !== undefined) item.subChildPartDetails.sourceUnit = sourceUnit.trim();
    if (processDefinition !== undefined) {
      const cleaned = cleanProcessDefinition(processDefinition);
      const err = validateProcessDefinition(cleaned, { requireAtLeastOne: true });
      if (err) return res.status(400).json({ success: false, message: err });
      item.subChildPartDetails.processDefinition = cleaned;
    }

    // Recomputed on every save regardless of which fields actually changed —
    // cheap (one extra lookup at most, only when sourceItemId itself wasn't
    // already fetched above) and always correct, rather than tracking every
    // combination of touched fields that could affect it.
    const effectiveSourceItem = sourceItem || await Item.findOne({ _id: item.subChildPartDetails.sourceItem }).lean();
    if (effectiveSourceItem) {
      const { materialsCost, unitWeightKg } = await computeSourceMetrics(
        effectiveSourceItem,
        item.subChildPartDetails.sourceQty,
        item.subChildPartDetails.sourceUnit,
        item.subChildPartDetails.sourceDimensionVariantId
      );
      item.subChildPartDetails.materialsCost = materialsCost;
      item.subChildPartDetails.unitWeightKg = unitWeightKg;
    }

    await item.save();
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
