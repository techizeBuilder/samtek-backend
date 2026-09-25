import { Item } from '../models/Inventory.js';
import RDPrototype from '../models/RDPrototype.js';
import RDChangeRequest from '../models/RDChangeRequest.js';
import RDToolProcess from '../models/RDToolProcess.js';
import RDQualityParam from '../models/RDQualityParam.js';
import RDDocument from '../models/RDDocument.js';
import RDRequest from '../models/RDRequest.js';
import ProductionOrder from '../models/ProductionOrder.js';
import RDMasterOption from '../models/RDMasterOption.js';
import RDCustomFieldTemplate from '../models/RDCustomFieldTemplate.js';
import RDPlant from '../models/RDPlant.js';
import { getMachineBillingBOMCost } from '../services/itemPricingService.js';
import MachineBOM from '../models/MachineBOM.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import { findMachineMaterialLines } from '../services/machineReorderService.js';
import fs from 'fs';




const today = () => new Date().toISOString().split('T')[0];

// A non-fabrication material whose Used Unit is Length/Area/Volume needs an
// amountValue too (see addMaterial/updateMaterial) — purchaseCost is ₹ per
// Used Unit, and a flat quantity alone can't say "2 pieces of 1m length
// each" the way it can say "5 kg" or "3 pieces" for Mass/Count materials.
async function generateChangeId(companyId) {
  const year = new Date().getFullYear();

  const count = await RDChangeRequest.countDocuments({
    company: companyId
  });

  const companyCode = companyId.toString().slice(-4);

  return `CR-${companyCode}-${year}-${String(count + 1).padStart(3, '0')}`;
}

// ─── MACHINES ─────────────────────────────────────────────────────────────────
// Product Master machines now live in the Item collection (type:'Product',
// productKind:'Machine') instead of the old, separate RDMachine collection —
// this is what actually eliminates the double-record problem (a Product
// Master entry AND its own independently-created Inventory Item for the same
// machine). Every existing consumer of this API (ProductMaster.jsx, BOM
// Management's MaterialCodePicker/autofill, Prototype, Design Approval,
// Change Management, Tool & Process, Quality Parameters) still sends/expects
// the OLD flat field names (pType, category, pSourceType, designStatus,
// releaseStatus, forwardToNextPhase, machineType, isDiscontinued,
// rejectionNote, firstBuiltAt) — toMachineInput/toMachineResponse translate
// between that flat shape and Item's real schema, so none of that code had
// to change.
//
// Mapping: pType -> Item.category, category -> Item.subCategory,
// pSourceType -> Item.productSourceType (Item's category/subCategory are only
// 2 levels; Product Master needs 3, hence the extra productSourceType field).
// inputUnit(Type) -> Item.purchaseUnit(Type), outputUnit(Type) -> Item.unit(Type)
// (Product Master's Input/Output Unit were modeled to mirror these exactly).
// designStatus/releaseStatus/forwardToNextPhase/machineType/rejectionNote/
// firstBuiltAt live under Item.machineDetails. isDiscontinued is a common Item field.
const toMachineResponse = (item) => ({
  _id: item._id,
  code: item.code,
  name: item.name,
  description: item.description || '',
  pType: item.category || '',
  category: item.subCategory || '',
  pSourceType: item.productSourceType || '',
  brand: item.brand || '',
  metrology: item.metrology || '',
  size: item.size || '',
  unitWeightValue: item.unitWeightValue ?? null,
  unitWeightUnitType: item.unitWeightUnitType || '',
  unitWeightUnit: item.unitWeightUnit || '',
  inputUnitType: item.purchaseUnitType || '',
  inputUnit: item.purchaseUnit || '',
  outputUnitType: item.unitType || '',
  outputUnit: item.unit || '',
  specifications: item.specifications || [],
  customFields: item.customFields || [],
  forwardToNextPhase: !!item.machineDetails?.forwardToNextPhase,
  designStatus: item.machineDetails?.designStatus || 'Draft',
  releaseStatus: item.machineDetails?.releaseStatus || 'Not Released',
  machineType: item.machineDetails?.machineType || 'Standard',
  isDiscontinued: !!item.isDiscontinued,
  rejectionNote: item.machineDetails?.rejectionNote || '',
  // Motor Master motors reuse this same response shape (getBOMByMachineCode
  // is cross-department, keyed by Item code regardless of productKind) —
  // firstBuiltAt lives in motorDetails for those instead of machineDetails.
  firstBuiltAt: item.machineDetails?.firstBuiltAt || item.motorDetails?.firstBuiltAt || null,
  variant: item.machineDetails?.variant || '',
  productionRate: item.machineDetails?.productionRate || '',
  materialGrade: item.materialGrade || '',
  // A machine can run on several motors (e.g. one 5 HP + one 10 HP) — see
  // powerRequirements[] on machineDetails. The 4 legacy scalar fields below
  // are kept alongside it purely so a machine saved before this existed
  // still has something to show (PlantMaster.jsx's powerLine() falls back to
  // them when powerRequirements is empty); no longer written by new saves.
  powerRequirements: item.machineDetails?.powerRequirements || [],
  powerSource: item.machineDetails?.powerSource || '',
  powerRequiredHP: item.machineDetails?.powerRequiredHP ?? null,
  powerRequiredKWH: item.machineDetails?.powerRequiredKWH ?? null,
  powerRequiredRPM: item.machineDetails?.powerRequiredRPM ?? null,
  accessories: item.machineDetails?.accessories || [],
  modelNumber: item.machineDetails?.modelNumber || '',
  // Applications uses Item's own shared `applications` array (same field/UI
  // pattern as Inventory's DynamicListField) — not a machineDetails field,
  // since this is one of the "common" fields shared across every item kind.
  applications: item.applications || [],
  // Pricing & Stock + purchase/internalManufacturing are Item's shared common
  // fields (same as Inventory/Motor Master) — a Product Master machine IS the
  // sellable/purchasable Item now, so this is the only place to set them.
  purchase: item.purchase !== false,
  internalManufacturing: !!item.internalManufacturing,
  stdCost: item.stdCost ?? 0,
  purchaseCost: item.purchaseCost ?? 0,
  salePrice: item.salePrice ?? 0,
  mrp: item.mrp ?? 0,
  gst: item.gst ?? 0,
  hsn: item.hsn || '',
  qty: item.qty ?? 0,
  minStock: item.minStock ?? 0,
  costSource: item.costSource || 'Manual',
  costResolvedAt: item.costResolvedAt || null,
  costResolutionIssue: item.costResolutionIssue || null,
  company: item.companyId,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  designFiles: item.designFiles || [],
});

// Translates the flat request body (from ProductMaster.jsx's Add/Edit form,
// unchanged) into a partial Item update object using the mapping above.
// Only fields actually present in the body get translated, so this is safe
// to use for both create (full payload) and update (partial payload).
const toMachineItemFields = (body) => {
  const out = {};
  if (body.code !== undefined) out.code = body.code;
  if (body.name !== undefined) out.name = body.name;
  if (body.description !== undefined) out.description = body.description || '';
  if (body.pType !== undefined) out.category = body.pType;
  if (body.category !== undefined) out.subCategory = body.category;
  if (body.pSourceType !== undefined) out.productSourceType = body.pSourceType;
  if (body.brand !== undefined) out.brand = body.brand || '';
  if (body.metrology !== undefined) out.metrology = body.metrology || '';
  if (body.materialGrade !== undefined) out.materialGrade = body.materialGrade || '';
  if (body.size !== undefined) out.size = body.size || '';
  if (body.unitWeightValue !== undefined) out.unitWeightValue = body.unitWeightValue !== '' ? Number(body.unitWeightValue) : null;
  if (body.unitWeightUnitType !== undefined) out.unitWeightUnitType = body.unitWeightUnitType || '';
  if (body.unitWeightUnit !== undefined) out.unitWeightUnit = body.unitWeightUnit || '';
  if (body.inputUnitType !== undefined) out.purchaseUnitType = body.inputUnitType || '';
  if (body.inputUnit !== undefined) out.purchaseUnit = body.inputUnit || '';
  if (body.outputUnitType !== undefined) out.unitType = body.outputUnitType || '';
  if (body.outputUnit !== undefined) out.unit = body.outputUnit || '';
  // Receive Unit mirrors Used Unit for Product Master items too (see
  // createMachine and inventoryController.js's sanitizeItemData, which this
  // path bypasses) — no conversion exists between arbitrary unit types.
  if (body.outputUnitType !== undefined) out.receiveUnitType = body.outputUnitType || 'Count Unit';
  if (body.outputUnit !== undefined) out.receiveUnit = body.outputUnit || 'Pieces';
  if (body.specifications !== undefined) out.specifications = body.specifications || [];
  if (body.customFields !== undefined) out.customFields = body.customFields || [];
  if (body.isDiscontinued !== undefined) out.isDiscontinued = !!body.isDiscontinued;
  if (body.applications !== undefined) out.applications = body.applications || [];
  if (body.purchase !== undefined) out.purchase = !!body.purchase;
  if (body.internalManufacturing !== undefined) out.internalManufacturing = !!body.internalManufacturing;
  if (body.stdCost !== undefined) out.stdCost = Number(body.stdCost) || 0;
  if (body.purchaseCost !== undefined) out.purchaseCost = Number(body.purchaseCost) || 0;
  if (body.salePrice !== undefined) out.salePrice = Number(body.salePrice) || 0;
  if (body.mrp !== undefined) out.mrp = Number(body.mrp) || 0;
  if (body.gst !== undefined) out.gst = Number(body.gst) || 0;
  if (body.hsn !== undefined) out.hsn = body.hsn || '';
  if (body.qty !== undefined) out.qty = Number(body.qty) || 0;
  if (body.minStock !== undefined) out.minStock = Number(body.minStock) || 0;

  const md = {};
  if (body.forwardToNextPhase !== undefined) md.forwardToNextPhase = !!body.forwardToNextPhase;
  if (body.designStatus !== undefined) md.designStatus = body.designStatus;
  if (body.releaseStatus !== undefined) md.releaseStatus = body.releaseStatus;
  if (body.machineType !== undefined) md.machineType = body.machineType;
  if (body.rejectionNote !== undefined) md.rejectionNote = body.rejectionNote || '';
  if (body.firstBuiltAt !== undefined) md.firstBuiltAt = body.firstBuiltAt;
  if (body.variant !== undefined) md.variant = body.variant || '';
  if (body.productionRate !== undefined) md.productionRate = body.productionRate || '';
  if (body.powerRequirements !== undefined) {
    md.powerRequirements = Array.isArray(body.powerRequirements)
      ? body.powerRequirements.map(pr => ({
          powerSource: pr.powerSource || '',
          hp: pr.hp !== undefined && pr.hp !== '' ? Number(pr.hp) : null,
          kwh: pr.kwh !== undefined && pr.kwh !== '' ? Number(pr.kwh) : null,
          rpm: pr.rpm !== undefined && pr.rpm !== '' ? Number(pr.rpm) : null,
        }))
      : [];
    // Once a machine is edited through the new multi-power form, clear the
    // old single-power fields so there's only one source of truth for it
    // going forward (PlantMaster.jsx's fallback only kicks in when
    // powerRequirements is empty, so stale scalars here would otherwise just
    // sit unused, but clearing avoids confusion for anyone reading the DB directly).
    md.powerSource = '';
    md.powerRequiredHP = null;
    md.powerRequiredKWH = null;
    md.powerRequiredRPM = null;
  }
  if (body.accessories !== undefined) md.accessories = body.accessories || [];
  if (body.modelNumber !== undefined) md.modelNumber = body.modelNumber || '';
  Object.keys(md).forEach(k => { out[`machineDetails.${k}`] = md[k]; });

  return out;
};

// Single-machine version of getMachines' own design-file merge below (General
// RDDocument uploads + BOM Part Child/Sub Child Part images) — exported so
// other departments needing "the same categorized list Design Approval
// shows" for ONE machine don't re-derive a slightly different subset of it.
// See productionMfgController.js's getBomDesignStatus (Production's new
// BOM/Design check) for the first other caller.
// Full cutover (2026-09-14, confirmed with the user — no additive merge):
// Child Part/Sub Child Part design files are now resolved by walking the
// NEW Machine BOM -> Child Part -> Sub Child Part reference chain
// (MachineBOM.childParts[] -> ChildPartBOM.subChildParts[]), not the OLD
// RDChildPart structure. A machine with no MachineBOM yet (still on the
// legacy per-machine flow) simply shows no Child Part/Sub Child Part
// images here anymore — only its real uploaded ("General") RDDocument rows.
export async function buildMachineDesignFiles(machineId, companyId) {
  const files = [];
  const designDocuments = await RDDocument.find({
    company: companyId, machine: machineId, type: 'Design Files'
  }).lean();
  designDocuments.forEach(doc => files.push({ ...doc, source: 'General' }));

  const machineBom = await MachineBOM.findOne({ company: companyId, machine: machineId }).lean();
  const childPartIds = (machineBom?.childParts || []).filter(l => !l.isDiscontinued).map(l => l.childPart);
  if (childPartIds.length === 0) return files;

  const childPartItems = await Item.find({ _id: { $in: childPartIds }, companyId }).select('name code image').lean();
  const childPartItemById = new Map(childPartItems.map(i => [i._id.toString(), i]));
  childPartItems.forEach(cp => {
    if (cp.image) files.push({ _id: `child-part-${cp._id}`, name: `${cp.name} (${cp.code})`, version: '', fileUrl: cp.image, source: 'BOM Part' });
  });

  const childPartBoms = await ChildPartBOM.find({ company: companyId, childPart: { $in: childPartIds } }).lean();
  const subChildPartIds = [];
  childPartBoms.forEach(cpb => (cpb.subChildParts || []).filter(l => !l.isDiscontinued).forEach(l => subChildPartIds.push(l.subChildPart)));
  if (subChildPartIds.length === 0) return files;

  const subChildPartItems = await Item.find({ _id: { $in: subChildPartIds }, companyId }).select('name code image').lean();
  const subChildPartItemById = new Map(subChildPartItems.map(i => [i._id.toString(), i]));
  childPartBoms.forEach(cpb => {
    const cpItem = childPartItemById.get(cpb.childPart.toString());
    if (!cpItem) return;
    (cpb.subChildParts || []).filter(l => !l.isDiscontinued).forEach(l => {
      const scpItem = subChildPartItemById.get(String(l.subChildPart));
      if (!scpItem?.image) return;
      files.push({ _id: `sub-child-part-${scpItem._id}`, name: `${cpItem.name} (${cpItem.code}) > ${scpItem.name} (${scpItem.code})`, version: '', fileUrl: scpItem.image, source: 'BOM Part' });
    });
  });
  return files;
}

export const getMachines = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    // Opt-in pagination: several consumers (BOM/Tool-Process/Quality-Param
    // dropdowns, Prototype/Change Management machine pickers, dashboard stats)
    // rely on this endpoint returning the FULL unfiltered array with no
    // params — only paginate/filter when page/limit is explicitly sent
    // (Product Master's list view, Design Approval's queue).
    const { page, limit, search, designStatus, releaseStatus, discontinued, forwardToNextPhase, withStatusCounts, pType, category, pSourceType } = req.query;
    const isPaginated = !!(page || limit);

    // Base filter excludes designStatus so status-count aggregates below can
    // report totals per status regardless of which status tab is selected.
    const baseQuery = { companyId, type: 'Product', productKind: 'Machine' };
    if (discontinued === 'true') baseQuery.isDiscontinued = true;
    else if (discontinued === 'false') baseQuery.isDiscontinued = false;
    if (forwardToNextPhase === 'true') baseQuery['machineDetails.forwardToNextPhase'] = true;
    else if (forwardToNextPhase === 'false') baseQuery['machineDetails.forwardToNextPhase'] = false;
    if (releaseStatus && releaseStatus !== 'All') baseQuery['machineDetails.releaseStatus'] = releaseStatus;
    // Classification filters — lets R&D find every product under a P-Type/Category/P-Source Type
    // before renaming or deleting that option, so they can reassign items instead of hunting for them.
    if (pType) baseQuery.category = pType;
    if (category) baseQuery.subCategory = category;
    if (pSourceType) baseQuery.productSourceType = pSourceType;
    if (search) {
      baseQuery.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const query = { ...baseQuery };
    if (designStatus && designStatus !== 'All') query['machineDetails.designStatus'] = designStatus;

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await Item.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$machineDetails.designStatus', count: { $sum: 1 } } },
      ]);
      statusCounts = countsAgg.reduce((acc, c) => { acc[c._id] = c.count; return acc; }, {});
      statusCounts.All = countsAgg.reduce((sum, c) => sum + c.count, 0);
    }

    let machines, pagination;
    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;
      const [rows, total] = await Promise.all([
        Item.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
        Item.countDocuments(query),
      ]);
      machines = rows;
      pagination = { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) };
    } else {
      // 1. Fetch all machines for the company (.lean() makes it plain JSON so we can add properties)
      machines = await Item.find(query).sort({ createdAt: -1 }).lean();
    }

    if (machines.length === 0) {
      return res.json({ success: true, data: [], ...(pagination ? { pagination } : {}), ...(statusCounts ? { statusCounts } : {}) });
    }

    // 2. Fetch all Design Files for these machines
    const machineIds = machines.map(m => m._id);
    const designDocuments = await RDDocument.find({
      company: companyId,
      machine: { $in: machineIds },
      type: 'Design Files' // Only pulling design files for the approval workflow
    }).lean();

    // 3. Group the design files by machine ID — tagged 'General' so the
    // frontend can tell a manually-uploaded design doc apart from a BOM
    // part's own design file below (confirmed 2026-09-02: Design Approval
    // never showed Child Part/Sub Child Part design files at all before
    // this, even though Documentation already surfaces them live).
    const docsByMachine = {};
    designDocuments.forEach(doc => {
      const mId = doc.machine.toString();
      if (!docsByMachine[mId]) docsByMachine[mId] = [];
      docsByMachine[mId].push({ ...doc, source: 'General' });
    });

    // 2b. Child Part / Sub Child Part design files — full cutover (2026-09-14,
    // confirmed with the user): resolved through the NEW Machine BOM ->
    // Child Part -> Sub Child Part reference chain (mirrors
    // buildMachineDesignFiles's own single-machine version), not the OLD
    // RDChildPart structure. Batched ($in) the same way the "General"
    // RDDocument fetch above already is, not a per-machine loop, to avoid
    // regressing this into an N+1 query across a potentially large machine
    // list. A machine with no MachineBOM yet (still on the legacy flow)
    // simply contributes no 'BOM Part' rows here anymore.
    const machineBoms = await MachineBOM.find({ company: companyId, machine: { $in: machineIds } }).lean();
    const childPartIdsAll = [];
    machineBoms.forEach(mb => (mb.childParts || []).filter(l => !l.isDiscontinued).forEach(l => childPartIdsAll.push(l.childPart)));
    if (childPartIdsAll.length > 0) {
      const childPartItems = await Item.find({ _id: { $in: childPartIdsAll }, companyId }).select('name code image').lean();
      const childPartItemById = new Map(childPartItems.map(i => [i._id.toString(), i]));

      const childPartBoms = await ChildPartBOM.find({ company: companyId, childPart: { $in: childPartIdsAll } }).lean();
      const childPartBomByChildPartId = new Map(childPartBoms.map(cpb => [cpb.childPart.toString(), cpb]));
      const subChildPartIdsAll = [];
      childPartBoms.forEach(cpb => (cpb.subChildParts || []).filter(l => !l.isDiscontinued).forEach(l => subChildPartIdsAll.push(l.subChildPart)));
      const subChildPartItems = subChildPartIdsAll.length
        ? await Item.find({ _id: { $in: subChildPartIdsAll }, companyId }).select('name code image').lean()
        : [];
      const subChildPartItemById = new Map(subChildPartItems.map(i => [i._id.toString(), i]));

      machineBoms.forEach(mb => {
        const mId = mb.machine.toString();
        if (!docsByMachine[mId]) docsByMachine[mId] = [];
        (mb.childParts || []).filter(l => !l.isDiscontinued).forEach(l => {
          const cpItem = childPartItemById.get(String(l.childPart));
          if (!cpItem) return;
          if (cpItem.image) {
            docsByMachine[mId].push({ _id: `child-part-${cpItem._id}`, name: `${cpItem.name} (${cpItem.code})`, version: '', fileUrl: cpItem.image, source: 'BOM Part' });
          }
          const cpb = childPartBomByChildPartId.get(String(l.childPart));
          (cpb?.subChildParts || []).filter(sl => !sl.isDiscontinued).forEach(sl => {
            const scpItem = subChildPartItemById.get(String(sl.subChildPart));
            if (!scpItem?.image) return;
            docsByMachine[mId].push({ _id: `sub-child-part-${scpItem._id}`, name: `${cpItem.name} (${cpItem.code}) > ${scpItem.name} (${scpItem.code})`, version: '', fileUrl: scpItem.image, source: 'BOM Part' });
          });
        });
      });
    }

    // 4. Attach the grouped documents to their respective machines, then translate to the response shape
    const enrichedMachines = machines.map(machine => toMachineResponse({
      ...machine,
      designFiles: docsByMachine[machine._id.toString()] || []
    }));

    res.json({
      success: true,
      data: enrichedMachines,
      ...(pagination ? { pagination } : {}),
      ...(statusCounts ? { statusCounts } : {}),
    });
  } catch (err) {
    console.error('Error fetching machines with design files:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─── 1. CREATE MACHINE ─────────────────────────────────────────────────────────
export const createMachine = async (req, res) => {
  try {
    const {
      code, name, description,
      category, pType, pSourceType,
      brand, machineType, metrology, size,
      unitWeightValue, unitWeightUnitType, unitWeightUnit,
      inputUnitType, inputUnit, outputUnitType, outputUnit,
      specifications, customFields, forwardToNextPhase,
      variant, productionRate, materialGrade,
      powerRequirements,
      accessories, modelNumber, applications,
      purchase, internalManufacturing, isDiscontinued,
      stdCost, purchaseCost, salePrice, mrp, gst, hsn, qty, minStock,
    } = req.body;

    // Strict validation for required fields
    if (!code || !name || !category || !pType || !pSourceType) {
      return res.status(400).json({
        success: false,
        message: 'Product Code, Name, Category, P-Type, and P-Source Type are required.'
      });
    }
    // Exactly one of Purchasable (Vendor) / Internal Manufacturing — an
    // explicit user choice, never a default (2026-09-24, found live: the form
    // used to pre-select Purchasable, so IP612 was created "In House
    // Manufacturing" by Source Type but purchase:true by this flag — its BOM
    // cost never reached its price, and a Sale line for it would have routed
    // to Purchase instead of Production, since both read this flag).
    if (!!purchase === !!internalManufacturing) {
      return res.status(400).json({ success: false, message: 'Choose either Purchasable (Vendor) or Internal Manufacturing.' });
    }

    // No DB-level unique index on code (some pre-existing data already violates
    // one), so guard against duplicates here instead — a second active machine
    // sharing a code silently shadows the first one everywhere it's looked up
    // by code (BOM/R&D approval, autofill, etc.). Also covers Motor/Inventory
    // codes now, since it's all one Item collection.
    const existing = await Item.findOne({ code: code.trim(), companyId: req.user.companyId, isDiscontinued: false });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Product Code "${code}" is already used by "${existing.name}". Codes must be unique.`
      });
    }

    const machine = await Item.create({
      code,
      name,
      description: description || '',
      type: 'Product',
      productKind: 'Machine',
      category: pType,
      subCategory: category,
      productSourceType: pSourceType,
      brand: brand || '',
      metrology: metrology || '',
      size: size || '',
      unitWeightValue: unitWeightValue !== undefined && unitWeightValue !== '' ? Number(unitWeightValue) : null,
      unitWeightUnitType: unitWeightUnitType || '',
      unitWeightUnit: unitWeightUnit || '',
      purchaseUnitType: inputUnitType || '',
      purchaseUnit: inputUnit || '',
      // Item.unit is required — Product Master's Output Unit is optional on
      // the form, so fall back to a sensible default (matches existing data:
      // machines without an explicit output unit are conventionally counted
      // in Pieces) rather than blocking machine creation on it.
      unitType: outputUnitType || 'Count Unit',
      unit: outputUnit || 'Pieces',
      // Receive Unit mirrors Used Unit — this path bypasses
      // inventoryController.js's sanitizeItemData (which enforces the same
      // mirror for plain Inventory/Motor Master items), so it's done here
      // explicitly. No conversion exists between arbitrary unit types.
      receiveUnitType: outputUnitType || 'Count Unit',
      receiveUnit: outputUnit || 'Pieces',
      specifications: specifications || [],
      customFields: customFields || [],
      applications: applications || [],
      purchase: !!purchase,
      internalManufacturing: !!internalManufacturing,
      isDiscontinued: !!isDiscontinued,
      stdCost: Number(stdCost) || 0,
      purchaseCost: Number(purchaseCost) || 0,
      salePrice: Number(salePrice) || 0,
      mrp: Number(mrp) || 0,
      gst: Number(gst) || 0,
      hsn: hsn || '',
      qty: Number(qty) || 0,
      minStock: Number(minStock) || 0,
      materialGrade: materialGrade || '',
      machineDetails: {
        forwardToNextPhase: !!forwardToNextPhase,
        variant: variant || '',
        productionRate: productionRate || '',
        powerRequirements: Array.isArray(powerRequirements)
          ? powerRequirements.map(pr => ({
              powerSource: pr.powerSource || '',
              hp: pr.hp !== undefined && pr.hp !== '' ? Number(pr.hp) : null,
              kwh: pr.kwh !== undefined && pr.kwh !== '' ? Number(pr.kwh) : null,
              rpm: pr.rpm !== undefined && pr.rpm !== '' ? Number(pr.rpm) : null,
            }))
          : [],
        accessories: accessories || [],
        modelNumber: modelNumber || '',
      },
      companyId: req.user.companyId,
      // `store` is a separate, older company-scoping field several other
      // modules key off directly instead of `companyId` (Sales' own item
      // picker, Pricing Value — see their own comments) — inventoryController.js's
      // createItem always syncs it too; this had been missing here, silently
      // making every Product Master machine invisible to those modules.
      store: req.user.companyId.toString(),
    });

    res.status(201).json({ success: true, data: toMachineResponse(machine.toObject()) });
  } catch (err) {
    // Handle potential duplicate code errors gracefully
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Product Code already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateMachine = async (req, res) => {
  try {
    // Same exactly-one rule as createMachine — only checked when the edit
    // actually carries the sourcing choice (other partial updates don't).
    const { purchase, internalManufacturing } = req.body;
    if (purchase !== undefined && internalManufacturing !== undefined && !!purchase === !!internalManufacturing) {
      return res.status(400).json({ success: false, message: 'Choose either Purchasable (Vendor) or Internal Manufacturing.' });
    }
    // Backfills `store` on save if it was missing (see createMachine) — lets
    // editing an older machine self-heal without needing a separate migration.
    const machine = await Item.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId, productKind: 'Machine' },
      { $set: { ...toMachineItemFields(req.body), store: req.user.companyId.toString() } },
      { new: true }
    ).lean();
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: toMachineResponse(machine) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── 2. GET DYNAMIC DROPDOWN OPTIONS (Call this when page loads) ───────────────
export const getDropdownOptions = async (req, res) => {
  try {
    const options = await RDMasterOption.find({ company: req.user.companyId }).lean();

    // Group them for the frontend, keeping parentValue so cascading selects can filter.
    // Category depends on P-Type; P-SourceType depends on Category. Metrology and MaterialType
    // (used by BOM Management) are standalone, unrelated to the Product Master cascade.
    const toOption = (o) => ({ _id: o._id, value: o.value, parentValue: o.parentValue || null });
    const groupedOptions = {
      PType: options.filter(o => o.field === 'P-Type').map(toOption),
      Category: options.filter(o => o.field === 'Category').map(toOption),
      PSourceType: options.filter(o => o.field === 'P-SourceType').map(toOption),
      Metrology: options.filter(o => o.field === 'Metrology').map(toOption),
      MaterialType: options.filter(o => o.field === 'MaterialType').map(toOption),
      MotorCategory: options.filter(o => o.field === 'MotorCategory').map(toOption),
      MotorSubCategory: options.filter(o => o.field === 'MotorSubCategory').map(toOption),
      MotorType: options.filter(o => o.field === 'MotorType').map(toOption),
      MaterialGrade: options.filter(o => o.field === 'MaterialGrade').map(toOption),
      PowerSource: options.filter(o => o.field === 'PowerSource').map(toOption),
      PlantCategory: options.filter(o => o.field === 'PlantCategory').map(toOption),
      PlantSubCategory: options.filter(o => o.field === 'PlantSubCategory').map(toOption),
      ProductName: options.filter(o => o.field === 'ProductName').map(toOption),
      ProductVariant: options.filter(o => o.field === 'ProductVariant').map(toOption),
      PlantName: options.filter(o => o.field === 'PlantName').map(toOption),
      PlantProduction: options.filter(o => o.field === 'PlantProduction').map(toOption),
    };

    res.json({ success: true, data: groupedOptions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ─── 3. ADD NEW DROPDOWN OPTION (Call this when user clicks the "+" icon) ──────
export const addDropdownOption = async (req, res) => {
  try {
    const { field, value, parentValue } = req.body;

    if (!['Category', 'P-Type', 'P-SourceType', 'Metrology', 'MaterialType', 'MotorCategory', 'MotorSubCategory', 'MotorType', 'MaterialGrade', 'PowerSource', 'PlantCategory', 'PlantSubCategory', 'ProductName', 'ProductVariant', 'PlantName', 'PlantProduction'].includes(field)) {
      return res.status(400).json({ success: false, message: 'Invalid field type.' });
    }
    if (!value || value.trim() === '') {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }
    if (['Category', 'P-SourceType'].includes(field) && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: `Select the parent ${field === 'Category' ? 'P-Type' : 'Category'} before adding this option.` });
    }
    if (field === 'MotorSubCategory' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Motor Category before adding this option.' });
    }
    if (field === 'PlantSubCategory' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Plant Category before adding this option.' });
    }
    // Full linear chain: Category -> Sub Category -> Product Name -> Variant
    // -> Product Source Type. Product Name is scoped to a Sub Category (which
    // is itself already scoped to a Category, so Name is transitively linked
    // to both); Variant is scoped to a Product Name; Product Source Type
    // keeps its existing Sub Category scope unchanged — only its position in
    // the sequence moved (confirmed 2026-09-02).
    if (field === 'ProductName' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Sub Category before adding this Product Name.' });
    }
    if (field === 'ProductVariant' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Product Name before adding this Variant.' });
    }
    // Plant's own chain: PlantCategory -> PlantSubCategory -> PlantName ->
    // PlantProduction (confirmed 2026-09-02).
    if (field === 'PlantName' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Sub Category before adding this Plant Name.' });
    }
    if (field === 'PlantProduction' && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: 'Select the parent Plant Name before adding this Production value.' });
    }

    const newOption = await RDMasterOption.create({
      field,
      value: value.trim(),
      parentValue: parentValue ? parentValue.trim() : null,
      company: req.user.companyId
    });

    res.status(201).json({ success: true, data: newOption });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'This option already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// Field -> the Item column (+ optional productKind scope) it's the live source
// of truth for. P-Type/Category/P-SourceType are Product Master's own cascade
// (now living on Item as category/subCategory/productSourceType, scoped to
// productKind:'Machine'); Metrology is unscoped/shared. Item's category/
// subCategory are shared column *names* across Inventory/Motor/Product Master,
// so the productKind scope is required — without it a rename could bleed into
// an unrelated kind's classification that happens to share the same text.
const ITEM_FIELD_MAP = {
  'P-Type': { field: 'category', productKind: 'Machine' },
  'Category': { field: 'subCategory', productKind: 'Machine' },
  'P-SourceType': { field: 'productSourceType', productKind: 'Machine' },
  'Metrology': { field: 'metrology', productKind: null },
  MotorCategory: { field: 'category', productKind: 'Motor' },
  MotorSubCategory: { field: 'subCategory', productKind: 'Motor' },
  MotorType: { field: 'motorDetails.motorType', productKind: 'Motor' },
  // Unscoped like Metrology — Material Grade (e.g. SS304) is a universal spec
  // shared with Inventory's own Material Grade dropdown, not Machine-specific.
  MaterialGrade: { field: 'materialGrade', productKind: null },
  // Lives inside the powerRequirements[] array now (a machine can have
  // several) — this path still works unchanged for the *count/match* queries
  // below (Mongo matches an array-of-subdocuments dot-path natively), but the
  // rename handler's $set needs arrayFilters instead of a plain $set — see
  // its `itemMap.field === 'machineDetails.powerRequirements.powerSource'` branch.
  PowerSource: { field: 'machineDetails.powerRequirements.powerSource', productKind: 'Machine' },
  ProductName: { field: 'name', productKind: 'Machine' },
  ProductVariant: { field: 'variant', productKind: 'Machine' },
};
// Field -> the child dropdown field(s) whose parentValue chains off it. Values
// are arrays since Category (Sub Category) now has two independent children —
// P-SourceType (unchanged) and ProductName — making the full chain P-Type ->
// Category -> ProductName -> ProductVariant, with P-SourceType a second child
// of Category alongside ProductName (confirmed 2026-09-02: Source Type keeps
// its existing Sub Category scope, only its position in the UI moved).
const CHILD_FIELD_MAP = {
  'P-Type': ['Category'],
  'Category': ['P-SourceType', 'ProductName'],
  MotorCategory: ['MotorSubCategory'],
  // Plant's own chain: PlantCategory -> PlantSubCategory -> PlantName ->
  // PlantProduction (confirmed 2026-09-02 — same pre-enter-ahead-of-time
  // pattern as Product Master's Name/Variant, no custom-fields feature).
  PlantCategory: ['PlantSubCategory'],
  PlantSubCategory: ['PlantName'],
  PlantName: ['PlantProduction'],
  ProductName: ['ProductVariant'],
};
// Field -> the RDPlant column it's the live source of truth for (Plant Master
// is its own collection, not an Item, so it needs its own rename/delete target).
const PLANT_FIELD_MAP = {
  PlantCategory: 'category', PlantSubCategory: 'subCategory',
  PlantName: 'name', PlantProduction: 'productionRate',
};

// ─── 3b. UPDATE DROPDOWN OPTION (rename a value, cascading everywhere it's used) ─
export const updateDropdownOption = async (req, res) => {
  try {
    const { value } = req.body;
    if (!value || !value.trim()) {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }
    const newValue = value.trim();

    const option = await RDMasterOption.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Option not found' });

    const oldValue = option.value;
    if (oldValue === newValue) {
      return res.json({ success: true, data: option });
    }

    const duplicate = await RDMasterOption.findOne({
      _id: { $ne: option._id }, company: req.user.companyId,
      field: option.field, parentValue: option.parentValue, value: newValue
    });
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'This option already exists.' });
    }

    option.value = newValue;
    await option.save();

    const itemMap = ITEM_FIELD_MAP[option.field];
    if (itemMap) {
      const itemQuery = { companyId: req.user.companyId, [itemMap.field]: oldValue };
      if (itemMap.productKind) itemQuery.productKind = itemMap.productKind; // unscoped (e.g. Metrology) applies to any kind
      if (itemMap.field === 'machineDetails.powerRequirements.powerSource') {
        // Array of subdocuments — a plain $set on the dot-path would overwrite
        // the whole array with a string; needs arrayFilters to rename just the
        // matching element(s).
        await Item.updateMany(
          itemQuery,
          { $set: { 'machineDetails.powerRequirements.$[elem].powerSource': newValue } },
          { arrayFilters: [{ 'elem.powerSource': oldValue }] }
        );
      } else {
        await Item.updateMany(itemQuery, { $set: { [itemMap.field]: newValue } });
      }
    }

    const plantField = PLANT_FIELD_MAP[option.field];
    if (plantField) {
      await RDPlant.updateMany(
        { company: req.user.companyId, [plantField]: oldValue },
        { $set: { [plantField]: newValue } }
      );
    }

    const childFields = CHILD_FIELD_MAP[option.field] || [];
    for (const childField of childFields) {
      await RDMasterOption.updateMany(
        { company: req.user.companyId, field: childField, parentValue: oldValue },
        { $set: { parentValue: newValue } }
      );
    }

    if (option.field === 'P-Type') {
      await RDCustomFieldTemplate.updateMany({ company: req.user.companyId, pType: oldValue }, { $set: { pType: newValue } });
    } else if (option.field === 'Category') {
      await RDCustomFieldTemplate.updateMany({ company: req.user.companyId, category: oldValue }, { $set: { category: newValue } });
    } else if (option.field === 'P-SourceType') {
      await RDCustomFieldTemplate.updateMany({ company: req.user.companyId, pSourceType: oldValue }, { $set: { pSourceType: newValue } });
    }

    res.json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── 3c. DELETE DROPDOWN OPTION (blocked if still referenced by products/children) ─
export const deleteDropdownOption = async (req, res) => {
  try {
    const option = await RDMasterOption.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Option not found' });

    const itemMap = ITEM_FIELD_MAP[option.field];
    let productCount = 0;
    if (itemMap) {
      const itemQuery = { companyId: req.user.companyId, [itemMap.field]: option.value };
      if (itemMap.productKind) itemQuery.productKind = itemMap.productKind;
      productCount = await Item.countDocuments(itemQuery);
    }

    const plantField = PLANT_FIELD_MAP[option.field];
    const plantCount = plantField
      ? await RDPlant.countDocuments({ company: req.user.companyId, [plantField]: option.value })
      : 0;

    const childFields = CHILD_FIELD_MAP[option.field] || [];
    const childCounts = await Promise.all(
      childFields.map(cf => RDMasterOption.countDocuments({ company: req.user.companyId, field: cf, parentValue: option.value }))
    );
    const childCount = childCounts.reduce((a, b) => a + b, 0);

    if (productCount > 0 || plantCount > 0 || childCount > 0) {
      const parts = [];
      if (productCount > 0) parts.push(`${productCount} product${productCount > 1 ? 's' : ''}`);
      if (plantCount > 0) parts.push(`${plantCount} plant${plantCount > 1 ? 's' : ''}`);
      childFields.forEach((cf, i) => {
        if (childCounts[i] > 0) parts.push(`${childCounts[i]} linked ${cf} value${childCounts[i] > 1 ? 's' : ''}`);
      });
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${option.value}" — still used by ${parts.join(' and ')}. Reassign or remove those first.`,
        productCount, plantCount, childCount
      });
    }

    await option.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CUSTOM FIELD TEMPLATES (per P-Type + Category + P-SourceType combo) ───────

export const getCustomFieldTemplates = async (req, res) => {
  try {
    const templates = await RDCustomFieldTemplate.find({ company: req.user.companyId }).lean();
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const saveCustomFieldTemplate = async (req, res) => {
  try {
    const { pType, category, pSourceType, groups } = req.body;
    if (!pType || !category || !pSourceType) {
      return res.status(400).json({ success: false, message: 'pType, category and pSourceType are required.' });
    }

    const cleanGroups = (groups || [])
      .map(g => ({
        label: (g.label || '').trim(),
        fields: (g.fields || []).map(f => ({ name: (f.name || '').trim() })).filter(f => f.name)
      }))
      .filter(g => g.label && g.fields.length > 0);

    const template = await RDCustomFieldTemplate.findOneAndUpdate(
      { company: req.user.companyId, pType, category, pSourceType },
      { groups: cleanGroups, createdBy: req.user._id },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCustomFieldTemplate = async (req, res) => {
  try {
    const template = await RDCustomFieldTemplate.findOneAndDelete({ _id: req.params.id, company: req.user.companyId });
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PLANT MASTER ────────────────────────────────────────────────────────────
// Plant Master is its own lightweight collection (RDPlant), not an Item — a
// plant just groups existing Product Master machines / Motor Master motors by
// id + quantity. Used later to build sales quotations off a plant's list.
const PLANT_POPULATE = [
  { path: 'machines.item', select: 'code name category subCategory isDiscontinued mrp' },
  { path: 'motors.item', select: 'code name category subCategory isDiscontinued mrp' },
];

const cleanPlantRefList = (list) =>
  (Array.isArray(list) ? list : [])
    .filter(entry => entry && entry.item)
    .map(entry => ({ item: entry.item, quantity: Math.max(1, Number(entry.quantity) || 1) }));

export const getPlants = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    // Opt-in pagination, same convention as getMachines — several consumers
    // (Quotation's Plant filter, Leads' plant picker, Plant Master's own
    // machine/motor selectors) rely on this endpoint returning the FULL
    // unfiltered array with no params; only paginate when page/limit is
    // explicitly sent (Plant Master's own list view).
    const { search, discontinued, category, subCategory, page, limit } = req.query;
    const isPaginated = !!(page || limit);
    const query = { company: companyId };
    if (discontinued === 'true') query.isDiscontinued = true;
    else if (discontinued === 'false') query.isDiscontinued = false;
    if (category) query.category = category;
    if (subCategory) query.subCategory = subCategory;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { subCategory: { $regex: search, $options: 'i' } },
      ];
    }

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;
      const [plants, total] = await Promise.all([
        RDPlant.find(query).populate(PLANT_POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
        RDPlant.countDocuments(query),
      ]);
      return res.json({
        success: true,
        data: plants,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const plants = await RDPlant.find(query).populate(PLANT_POPULATE).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: plants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPlant = async (req, res) => {
  try {
    const { category, subCategory, name, productionRate, machines, motors, isDiscontinued } = req.body;
    if (!category || !subCategory || !name) {
      return res.status(400).json({ success: false, message: 'Category, Sub Category and Plant Name are required.' });
    }
    const plant = await RDPlant.create({
      category, subCategory, name,
      productionRate: productionRate || '',
      machines: cleanPlantRefList(machines),
      motors: cleanPlantRefList(motors),
      isDiscontinued: !!isDiscontinued,
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    const populated = await RDPlant.findById(plant._id).populate(PLANT_POPULATE).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePlant = async (req, res) => {
  try {
    const { category, subCategory, name, productionRate, machines, motors, isDiscontinued } = req.body;
    if ((category !== undefined && !category) || (subCategory !== undefined && !subCategory) || (name !== undefined && !name)) {
      return res.status(400).json({ success: false, message: 'Category, Sub Category and Plant Name cannot be empty.' });
    }
    const update = {};
    if (category !== undefined) update.category = category;
    if (subCategory !== undefined) update.subCategory = subCategory;
    if (name !== undefined) update.name = name;
    if (productionRate !== undefined) update.productionRate = productionRate;
    if (machines !== undefined) update.machines = cleanPlantRefList(machines);
    if (motors !== undefined) update.motors = cleanPlantRefList(motors);
    if (isDiscontinued !== undefined) update.isDiscontinued = !!isDiscontinued;

    const plant = await RDPlant.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { $set: update },
      { new: true }
    ).populate(PLANT_POPULATE).lean();
    if (!plant) return res.status(404).json({ success: false, message: 'Plant not found' });
    res.json({ success: true, data: plant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const setPlantStatus = async (req, res) => {
  try {
    const plant = await RDPlant.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { $set: { isDiscontinued: !!req.body.isDiscontinued } },
      { new: true }
    ).populate(PLANT_POPULATE).lean();
    if (!plant) return res.status(404).json({ success: false, message: 'Plant not found' });
    res.json({ success: true, data: plant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



export const updateDesignStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const update = { 'machineDetails.designStatus': status };
    if (status === 'Rejected') update['machineDetails.rejectionNote'] = note || '';
    const machine = await Item.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId, productKind: 'Machine' },
      { $set: update },
      { new: true }
    ).lean();
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: toMachineResponse(machine) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateReleaseStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const machine = await Item.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId, productKind: 'Machine' },
      { $set: { 'machineDetails.releaseStatus': status } },
      { new: true }
    ).lean();
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: toMachineResponse(machine) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueMachine = async (req, res) => {
  try {
    const machine = await Item.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId, productKind: 'Machine' },
      { $set: { isDiscontinued: true } },
      { new: true }
    ).lean();
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: toMachineResponse(machine) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateMachine = async (req, res) => {
  try {
    const machine = await Item.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId, productKind: 'Machine' },
      { $set: { isDiscontinued: false } },
      { new: true }
    ).lean();
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: toMachineResponse(machine) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── BOMs ─────────────────────────────────────────────────────────────────────

// ─── Cross-department lookup: a machine's real BOM cost, for billing ──────────
// Used by the Sales Order Form to show/enforce a minimum Billing Amount per
// item — the item's own Item.stdCost (same figure BOM Management's card
// shows), not a separately recalculated one (see getMachineBillingBOMCost).
// `data: null` means this code has no BOM-derived cost yet — callers should
// skip validation entirely.
export const getBOMCostByMachineCode = async (req, res) => {
  try {
    const { code } = req.params;
    const companyId = req.user.companyId;

    const result = await getMachineBillingBOMCost(code, companyId);
    res.json({ success: true, data: result.found ? result : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ─── PROTOTYPES ───────────────────────────────────────────────────────────────

function deriveStatus(perf, output, dur) {
  if (perf === 'Fail' || output === 'Fail' || dur === 'Fail') return 'Failed';
  if (perf === 'Pass' && output === 'Pass' && dur === 'Pass') return 'Passed';
  return 'In Progress';
}

export const getPrototypes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    // Opt-in pagination: the "New Prototype" modal's machine picker and other
    // consumers expect the full unfiltered array — only paginate/filter when
    // page/limit is explicitly sent by the Prototype Management list view.
    const { page, limit, status, withStatusCounts } = req.query;
    const isPaginated = !!(page || limit);

    const query = { company: companyId };
    if (status && status !== 'All') query.status = status;

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await RDPrototype.aggregate([
        { $match: { company: companyId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      // Start every known status at 0 — the aggregate only emits a group for
      // statuses that actually have >=1 document, so a status with zero
      // prototypes would otherwise be missing from the object entirely.
      statusCounts = { Passed: 0, Failed: 0, 'In Progress': 0 };
      countsAgg.forEach(c => { statusCounts[c._id] = c.count; });
      statusCounts.All = countsAgg.reduce((sum, c) => sum + c.count, 0);
    }

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;
      const [prototypes, total] = await Promise.all([
        RDPrototype.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
        RDPrototype.countDocuments(query),
      ]);
      return res.json({
        success: true,
        data: prototypes,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
        ...(statusCounts ? { statusCounts } : {}),
      });
    }

    const prototypes = await RDPrototype.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: prototypes, ...(statusCounts ? { statusCounts } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPrototype = async (req, res) => {
  try {
    const { machineId, machineName, machineCode, prototypeName, performanceTest, outputTest, durabilityTest, testNotes, testedBy } = req.body;
    if (!machineId || !prototypeName) {
      return res.status(400).json({ success: false, message: 'machineId and prototypeName are required' });
    }
    const perf = performanceTest || 'Pending';
    const out = outputTest || 'Pending';
    const dur = durabilityTest || 'Pending';
    const prototype = await RDPrototype.create({
      machine: machineId, machineName, machineCode, prototypeName,
      performanceTest: perf, outputTest: out, durabilityTest: dur,
      status: deriveStatus(perf, out, dur),
      testNotes: testNotes || '',
      testedBy: testedBy || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: prototype });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePrototype = async (req, res) => {
  try {
    const proto = await RDPrototype.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!proto) return res.status(404).json({ success: false, message: 'Prototype not found' });
    const updates = req.body;
    Object.assign(proto, updates);
    const perf = proto.performanceTest;
    const out = proto.outputTest;
    const dur = proto.durabilityTest;
    proto.status = deriveStatus(perf, out, dur);
    if (proto.status === 'Passed' && !proto.passedDate) proto.passedDate = today();
    await proto.save();
    res.json({ success: true, data: proto });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CHANGE REQUESTS ──────────────────────────────────────────────────────────

export const getChangeRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    // Opt-in pagination: the "Raise Change Request" modal's machine picker
    // (via getMachines) is unaffected; only paginate/filter when page/limit
    // is explicitly sent by the Change Management list view.
    const { page, limit, search, status, withStatusCounts } = req.query;
    const isPaginated = !!(page || limit);

    const query = { company: companyId };
    if (status && status !== 'All') query.status = status;
    if (search) {
      query.$or = [
        { machineName: { $regex: search, $options: 'i' } },
        { machineCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await RDChangeRequest.aggregate([
        { $match: { company: companyId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      statusCounts = countsAgg.reduce((acc, c) => { acc[c._id] = c.count; return acc; }, {});
      statusCounts.All = countsAgg.reduce((sum, c) => sum + c.count, 0);
    }

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;
      const [requests, total] = await Promise.all([
        RDChangeRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
        RDChangeRequest.countDocuments(query),
      ]);
      return res.json({
        success: true,
        data: requests,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
        ...(statusCounts ? { statusCounts } : {}),
      });
    }

    const requests = await RDChangeRequest.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: requests, ...(statusCounts ? { statusCounts } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createChangeRequest = async (req, res) => {
  try {
    const { machineId, machineName, machineCode, raisedBy, department, changeType, description } = req.body;
    if (!machineId || !raisedBy || !department || !changeType || !description) {
      return res.status(400).json({ success: false, message: 'machineId, raisedBy, department, changeType, description are required' });
    }
    const changeId = await generateChangeId(req.user.companyId);
    const cr = await RDChangeRequest.create({
      changeId, machine: machineId, machineName, machineCode,
      raisedBy, department, changeType, description,
      raisedAt: today(),
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: cr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resolveChangeRequest = async (req, res) => {
  try {
    const { approved, notes } = req.body;
    const cr = await RDChangeRequest.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { status: approved ? 'Approved' : 'Rejected', rdNotes: notes || '', resolvedAt: today() },
      { new: true }
    );
    if (!cr) return res.status(404).json({ success: false, message: 'Change request not found' });

    // Approving a change request used to also unlock the old RDBOM (the
    // ONLY way to edit a locked one) — that model is gone along with the
    // Legacy BOM Management tab, so there's nothing left to unlock here.
    // MachineBOM has its own `isLocked`/`lockMachineBOM`, with no
    // unlock-via-Change-Request path of its own yet (pre-existing gap,
    // not introduced by this removal).

    res.json({ success: true, data: cr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TOOL PROCESSES ───────────────────────────────────────────────────────────

export const getToolProcesses = async (req, res) => {
  try {
    const items = await RDToolProcess.find({ company: req.user.companyId });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

async function ensureToolProcess(machineId, companyId, userId) {
  let tp = await RDToolProcess.findOne({ machine: machineId, company: companyId });
  if (!tp) {
    tp = await RDToolProcess.create({ machine: machineId, company: companyId, createdBy: userId });
  }
  return tp;
}

export const addTool = async (req, res) => {
  try {
    const { code, name, specification, quantity, unit } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code and name are required' });
    const tp = await ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
    tp.tools.push({ code, name, specification: specification || '', quantity: Number(quantity) || 1, unit: unit || 'pcs' });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    tp.tools.pull({ _id: req.params.toolId });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    const tool = tp.tools.id(req.params.toolId);
    if (!tool) return res.status(404).json({ success: false, message: 'Tool not found' });
    tool.isDiscontinued = true;
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    const tool = tp.tools.id(req.params.toolId);
    if (!tool) return res.status(404).json({ success: false, message: 'Tool not found' });
    tool.isDiscontinued = false;
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addProcess = async (req, res) => {
  try {
    const { step, type, description, duration, tool } = req.body;
    if (!step || !type) return res.status(400).json({ success: false, message: 'step and type are required' });
    const tp = await ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
    tp.processes.push({ step: Number(step), type, description: description || '', duration: duration || '', tool: tool || '' });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeProcess = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    tp.processes.pull({ _id: req.params.processId });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── QUALITY PARAMS ───────────────────────────────────────────────────────────

export const getQualityParams = async (req, res) => {
  try {
    const items = await RDQualityParam.find({ company: req.user.companyId });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

async function ensureQualityParam(machineId, machineName, companyId, userId) {
  let qp = await RDQualityParam.findOne({ machine: machineId, company: companyId });
  if (!qp) {
    qp = await RDQualityParam.create({ machine: machineId, machineName, company: companyId, createdBy: userId });
  }
  return qp;
}

export const addQualityParam = async (req, res) => {
  try {
    const { machineId, machineName, parameter, tolerance, performanceStandard } = req.body;
    if (!machineId || !parameter) return res.status(400).json({ success: false, message: 'machineId and parameter are required' });
    const qp = await ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
    qp.parameters.push({ parameter, tolerance: tolerance || '', performanceStandard: performanceStandard || '' });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQualityParam = async (req, res) => {
  try {
    const qp = await RDQualityParam.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!qp) return res.status(404).json({ success: false, message: 'Not found' });
    qp.parameters.pull({ _id: req.params.paramId });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addQCItem = async (req, res) => {
  try {
    const { machineId, machineName, item } = req.body;
    if (!machineId || !item) return res.status(400).json({ success: false, message: 'machineId and item are required' });
    const qp = await ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
    qp.qcChecklist.push({ item });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQCItem = async (req, res) => {
  try {
    const qp = await RDQualityParam.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!qp) return res.status(404).json({ success: false, message: 'Not found' });
    qp.qcChecklist.pull({ _id: req.params.itemId });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

export const getDocuments = async (req, res) => {
  try {
    const docs = await RDDocument.find({ company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDocument = async (req, res) => {
  try {
    const { machineId, machineCode, machineName, name, type, version, notes, uploadedBy } = req.body;
    if (!machineId || !type) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'machineId and type are required' });
    }
    let mCode = machineCode, mName = machineName;
    if (!mCode || !mName) {
      const machine = await Item.findById(machineId).select('code name');
      mCode = machine?.code || '';
      mName = machine?.name || '';
    }
    const originalName = req.file ? req.file.originalname : (name || '');
    const docName = name || originalName;
    const fileUrl = req.file ? `/uploads/rd-docs/${req.file.filename}` : '';
    const fileSize = req.file
      ? (req.file.size / (1024 * 1024)).toFixed(1) + ' MB'
      : '';
    const doc = await RDDocument.create({
      machine: machineId, machineCode: mCode, machineName: mName,
      name: docName, type,
      version: version || 'v1.0',
      size: fileSize,
      fileUrl,
      originalName,
      notes: notes || '',
      uploadedBy: uploadedBy || 'R&D Team', uploadedAt: today(),
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const doc = await RDDocument.findOneAndDelete({ _id: req.params.id, company: req.user.companyId });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.fileUrl) {
      const filePath = doc.fileUrl.replace(/^\//, '');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─── 1. GET LIST VIEW (WITH TABS, SEARCH, FILTER & PAGINATION) ─────────────
// ─── 1. GET LIST VIEW (WITH TABS, SEARCH, FILTER & PAGINATION) ─────────────
export const getRDRequests = async (req, res) => {
  try {
    // 1. Added `requestType` to the extracted query variables
    const { tab, search, status, requestType, page = 1 } = req.query;
    const companyId = req.user.companyId;

    const query = { company: companyId };

    // Tab Logic
    if (tab === 'history') {
      query.status = { $in: ['Approved', 'Rejected'] };
    } else {
      query.status = 'Pending'; // Fresh requests waiting for R&D action
    }

    // Explicit Status Filter
    if (status && status !== 'All') {
      query.status = status;
    }

    // ── NEW: Explicit Type Filter ──
    // Allows the frontend to filter by "Initial BOM" vs "Material Change"
    if (requestType && requestType !== 'All') {
      query.requestType = requestType;
    }

    // ── IMPROVED: Smart Search ──
    if (search) {
      const orConditions = [
        { machineCode: { $regex: search, $options: 'i' } },
        { machineName: { $regex: search, $options: 'i' } },
        // Now R&D can search by the specific material code/name requested!
        { "materialChangeDetails.materialCode": { $regex: search, $options: 'i' } },
        { "materialChangeDetails.materialName": { $regex: search, $options: 'i' } }
      ];

      // Also match by either of Production's two order IDs — its own internal
      // orderId (e.g. "PROD-2026-682637") or the real sales order code (e.g. "ORD-0094").
      const matchingOrders = await ProductionOrder.find({
        company: companyId,
        $or: [
          { orderId: { $regex: search, $options: 'i' } },
          { orderCode: { $regex: search, $options: 'i' } }
        ]
      }).select('_id').lean();
      if (matchingOrders.length > 0) {
        orConditions.push({ productionOrderId: { $in: matchingOrders.map(o => o._id) } });
      }

      query.$or = orConditions;
    }

    // Pagination Logic
    const limit = 20;
    const currentPage = Math.max(1, parseInt(page, 10)); // Ensure page is at least 1
    const skip = (currentPage - 1) * limit;

    // Get total count of documents matching the query (for frontend pagination UI)
    const total = await RDRequest.countDocuments(query);

    // Fetch the actual paginated data
    const requests = await RDRequest.find(query)
      .populate('productionOrderId', 'orderId orderCode priority receivedDate deliveryDate status source machineCode rejectionDetails')
      .populate('processedBy', 'username fullName')
      .sort({ createdAt: -1 })
      .skip(skip)   // Skip previous pages
      .limit(limit) // Limit to 20 items
      .lean();

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / limit),
        limit
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};




// ─────────────────────────────────────────────────────────────
// API 2: PROCESS R&D REQUEST (Approval / Rejection)
// ─────────────────────────────────────────────────────────────
export const processRDRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejectReason } = req.body;
    const companyId = req.user.companyId;

    const rdRequest = await RDRequest.findOne({ _id: id, company: companyId });
    if (!rdRequest) return res.status(404).json({ success: false, message: 'R&D Request not found.' });
    if (rdRequest.status !== 'Pending') return res.status(400).json({ success: false, message: `Already ${rdRequest.status}.` });

    // ─────────────────────────────────────────────────────────────
    // SCENARIO A: HANDLING REJECTIONS
    // ─────────────────────────────────────────────────────────────
    if (action === 'Reject') {
      rdRequest.status = 'Rejected';
      rdRequest.processedBy = req.user._id;
      rdRequest.processedAt = new Date();
      rdRequest.rejectReason = rejectReason || null;
      await rdRequest.save();

      if (rdRequest.requestType === 'Material Change') {
        const order = await ProductionOrder.findById(rdRequest.productionOrderId);
        const demand = order.materialDemands.find(m => m.materialCode === rdRequest.materialChangeDetails.materialCode);

        const prevQty = rdRequest.materialChangeDetails.previousQuantity;

        let revertedStatus = 'R&D Rejected';
        let revertedQty = demand.quantity;

        // If it was an existing material, we roll back the quantity and fix the status
        if (prevQty !== null && prevQty !== undefined) {
          revertedQty = prevQty;
          const held = Math.max(demand.transferredQuantity || 0, demand.issuedQuantity || 0);

          if (held >= revertedQty) revertedStatus = 'Issued';
          else if ((demand.transferredQuantity || 0) > (demand.issuedQuantity || 0)) revertedStatus = 'In Transit';
          else revertedStatus = 'Requested';
        }

        await ProductionOrder.findOneAndUpdate(
          { _id: rdRequest.productionOrderId, "materialDemands.materialCode": rdRequest.materialChangeDetails.materialCode },
          {
            $set: {
              "materialDemands.$.status": revertedStatus,
              "materialDemands.$.quantity": revertedQty
            }
          }
        );
        return res.json({ success: true, message: 'Material change rejected. Original quantities restored.' });
      } else {
        await ProductionOrder.findByIdAndUpdate(rdRequest.productionOrderId, {
          rdRequestRaised: false, status: 'On Hold',
          notes: `R&D Rejected: ${rejectReason || 'No reason provided.'}`
        });
        return res.json({ success: true, message: 'Initial BOM rejected. Order on hold.' });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // SCENARIO B: HANDLING APPROVALS
    // ─────────────────────────────────────────────────────────────
    if (action === 'Approve') {

      // ── WORKFLOW 1: MATERIAL CHANGE APPROVAL ──
      if (rdRequest.requestType === 'Material Change') {
        const order = await ProductionOrder.findById(rdRequest.productionOrderId);
        const demandIndex = order.materialDemands.findIndex(m => m.materialCode === rdRequest.materialChangeDetails.materialCode);
        const demand = order.materialDemands[demandIndex];

        // 🚨 SMART STATUS ROUTING
        // Calculate what production actually holds or is about to receive
        const totalHeld = Math.max(demand.transferredQuantity || 0, demand.issuedQuantity || 0);

        let newStatus = 'Requested';

        if (totalHeld >= demand.quantity) {
          // They already have equal to or more than the new approved quantity.
          // Do not trigger the store. They will return excess later.
          newStatus = 'Issued';
        } else if ((demand.transferredQuantity || 0) > (demand.issuedQuantity || 0)) {
          // The store already dispatched a cart, it's currently on the floor moving
          newStatus = 'In Transit';
        }

        order.materialDemands[demandIndex].status = newStatus;

        // Auto-Complete check just in case this approval was the final missing piece
        const allIssued = order.materialDemands.every(m => m.status === 'Issued');
        if (allIssued) {
          order.materialIssued = true;
        }

        await order.save();

        rdRequest.status = 'Approved';
        rdRequest.processedBy = req.user._id;
        rdRequest.processedAt = new Date();
        await rdRequest.save();
        return res.json({ success: true, message: 'Material change approved and order updated.' });
      }

      // ── WORKFLOW 2: INITIAL BOM APPROVAL ──
      // isDiscontinued: false — code isn't guaranteed unique (see createMachine's
      // duplicate-code guard), so an old discontinued duplicate must never shadow
      // the live machine this BOM/prototype actually belongs to.
      const machineProfile = await Item.findOne({ code: rdRequest.machineCode, companyId, productKind: 'Machine', isDiscontinued: false });
      if (!machineProfile || machineProfile.machineDetails?.releaseStatus !== 'Released') {
        return res.status(400).json({ success: false, message: 'Machine profile missing or not released.' });
      }

      // MachineBOM only — no RDBOM fallback (full cutover, 2026-09-17;
      // RDBOM itself stays exactly where it already is, BOM Management's
      // own "Legacy" tab, untouched). Existence only, NOT `isLocked`
      // (corrected 2026-09-19 — the earlier version of this check mirrored
      // getBomDesignStatus's own auto-verify gate, but that's the wrong
      // model for what this action actually is). Auto-verify
      // (`applyAutoVerify`, productionMfgController.js) is the NORMAL path —
      // it fires on its own, with no R&D click needed, the moment a locked
      // BOM + approved design both exist. THIS manual queue only exists for
      // when that hasn't happened yet: Production raises a request asking
      // permission to proceed anyway, and R&D can grant it as a judgment
      // call — deliberately NOT gated on the BOM being finished/locked,
      // since requiring that would make this action redundant with
      // auto-verify instead of being its actual fallback. Still requires a
      // real MachineBOM document to exist (so there's something concrete to
      // reference/review — getRDRequestReviewData already pulls its
      // materials from this same BOM), just not a LOCKED one.
      const machineBom = await MachineBOM.findOne({ machine: machineProfile._id, company: companyId });
      if (!machineBom) {
        return res.status(400).json({ success: false, message: 'No Master BOM found for this machine yet — create one in BOM Management before this request can be approved.' });
      }

      const designDocs = await RDDocument.find({ machine: machineProfile._id, company: companyId, type: 'Design Files' });

      // Material demands are no longer pushed here — that's the "material
      // transfer request to Store" the client asked to stop (this approval
      // used to seed order.materialDemands with every BOM line, which fed
      // Store's own separate pending-requests queue). Materials are already
      // read live, direct from the locked BOM, wherever Production actually
      // needs them (see "MATERIAL LIST — direct-from-BOM" in
      // productionMfgController.js) — this push was a second, now-redundant
      // path to the same data. Design docs still snapshot onto the order as
      // before; only the material push is gone.
      const docsToPush = designDocs.map(doc => ({ name: doc.name, fileUrl: doc.fileUrl, version: doc.version }));

      await ProductionOrder.findByIdAndUpdate(rdRequest.productionOrderId, {
        $push: { designDocuments: { $each: docsToPush } },
        bomVerified: true, designVerified: true, rdRequestRaised: false, status: 'Pending',
        notes: `BOM & Design approved by R&D on ${new Date().toLocaleDateString()}`
      });

      rdRequest.status = 'Approved';
      rdRequest.processedBy = req.user._id;
      rdRequest.processedAt = new Date();
      await rdRequest.save();

      return res.json({ success: true, message: 'Initial BOM injected into Production Order.' });
    }

    return res.status(400).json({ success: false, message: 'Invalid action.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── 2. NEW API: VIEW BOM AND DESIGN FILES FOR A REQUEST ───────────────────
// GET /api/rd-requests/:id/review
export const getRDRequestReviewData = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // 1. Find the request to get the target machineCode
    const rdRequest = await RDRequest.findOne({ _id: id, company: companyId });
    if (!rdRequest) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // 2. Fetch the corresponding R&D Machine Profile
    // isDiscontinued: false — see the same guard in processRDRequest's Initial BOM workflow.
    const machineProfile = await Item.findOne({ code: rdRequest.machineCode, companyId, productKind: 'Machine', isDiscontinued: false }).lean();

    // If R&D hasn't created the machine yet, return empty arrays so the frontend doesn't crash
    if (!machineProfile) {
      return res.json({
        success: true,
        data: { machine: null, materials: [], documents: [] }
      });
    }

    // 3. Fetch Master BOM — MachineBOM only, no RDBOM fallback (full
    // cutover, 2026-09-17, same reasoning as processRDRequest's own Initial
    // BOM workflow above). `materials` is the same lineKind-tagged shape
    // getBomDesignStatus/the Machine Material List already use.
    const found = await findMachineMaterialLines(machineProfile._id, companyId);

    // 4. Fetch ONLY Design Documents
    const designDocs = await RDDocument.find({
      machine: machineProfile._id,
      company: companyId,
      type: 'Design Files'
    }).lean();

    res.json({
      success: true,
      data: {
        machine: toMachineResponse(machineProfile),
        materials: found?.materials || [],
        documents: designDocs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};