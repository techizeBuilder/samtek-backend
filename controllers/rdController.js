import { Item } from '../models/Inventory.js';
import RDBOM from '../models/RDBOM.js';
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
import { computeBOMMaterialsMrpCost } from '../services/itemPricingService.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';




const today = () => new Date().toISOString().split('T')[0];

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
  firstBuiltAt: item.machineDetails?.firstBuiltAt || null,
  variant: item.machineDetails?.variant || '',
  productionRate: item.machineDetails?.productionRate || '',
  materialGrade: item.materialGrade || '',
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
  if (body.powerSource !== undefined) md.powerSource = body.powerSource || '';
  if (body.powerRequiredHP !== undefined) md.powerRequiredHP = body.powerRequiredHP !== '' ? Number(body.powerRequiredHP) : null;
  if (body.powerRequiredKWH !== undefined) md.powerRequiredKWH = body.powerRequiredKWH !== '' ? Number(body.powerRequiredKWH) : null;
  if (body.powerRequiredRPM !== undefined) md.powerRequiredRPM = body.powerRequiredRPM !== '' ? Number(body.powerRequiredRPM) : null;
  if (body.accessories !== undefined) md.accessories = body.accessories || [];
  if (body.modelNumber !== undefined) md.modelNumber = body.modelNumber || '';
  Object.keys(md).forEach(k => { out[`machineDetails.${k}`] = md[k]; });

  return out;
};

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

    // 3. Group the design files by machine ID
    const docsByMachine = {};
    designDocuments.forEach(doc => {
      const mId = doc.machine.toString();
      if (!docsByMachine[mId]) {
        docsByMachine[mId] = [];
      }
      docsByMachine[mId].push(doc);
    });

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
      variant, productionRate, materialGrade, powerSource,
      powerRequiredHP, powerRequiredKWH, powerRequiredRPM,
      accessories, modelNumber, applications,
      purchase, internalManufacturing,
      stdCost, purchaseCost, salePrice, mrp, gst, qty, minStock,
    } = req.body;

    // Strict validation for required fields
    if (!code || !name || !category || !pType || !pSourceType) {
      return res.status(400).json({
        success: false,
        message: 'Product Code, Name, Category, P-Type, and P-Source Type are required.'
      });
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
      specifications: specifications || [],
      customFields: customFields || [],
      applications: applications || [],
      purchase: !!purchase,
      internalManufacturing: !!internalManufacturing,
      stdCost: Number(stdCost) || 0,
      purchaseCost: Number(purchaseCost) || 0,
      salePrice: Number(salePrice) || 0,
      mrp: Number(mrp) || 0,
      gst: Number(gst) || 0,
      qty: Number(qty) || 0,
      minStock: Number(minStock) || 0,
      materialGrade: materialGrade || '',
      machineDetails: {
        forwardToNextPhase: !!forwardToNextPhase,
        variant: variant || '',
        productionRate: productionRate || '',
        powerSource: powerSource || '',
        powerRequiredHP: powerRequiredHP !== undefined && powerRequiredHP !== '' ? Number(powerRequiredHP) : null,
        powerRequiredKWH: powerRequiredKWH !== undefined && powerRequiredKWH !== '' ? Number(powerRequiredKWH) : null,
        powerRequiredRPM: powerRequiredRPM !== undefined && powerRequiredRPM !== '' ? Number(powerRequiredRPM) : null,
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

    if (!['Category', 'P-Type', 'P-SourceType', 'Metrology', 'MaterialType', 'MotorCategory', 'MotorSubCategory', 'MotorType', 'MaterialGrade', 'PowerSource', 'PlantCategory', 'PlantSubCategory'].includes(field)) {
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

// Field -> the RDBOM material snapshot column it renders into. These snapshot
// field names are independent legacy names (a point-in-time copy captured when
// a BOM material's code matched a Product Master item) — they don't need to
// match Item's own field names below.
const BOM_SNAPSHOT_FIELD_MAP = { 'P-Type': 'pType', 'Category': 'category', 'P-SourceType': 'pSourceType', 'Metrology': 'metrology' };
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
  PowerSource: { field: 'machineDetails.powerSource', productKind: 'Machine' },
};
// Field -> the child dropdown field whose parentValue chains off it
const CHILD_FIELD_MAP = { 'P-Type': 'Category', 'Category': 'P-SourceType', MotorCategory: 'MotorSubCategory', PlantCategory: 'PlantSubCategory' };
// Field -> the RDPlant column it's the live source of truth for (Plant Master
// is its own collection, not an Item, so it needs its own rename/delete target).
const PLANT_FIELD_MAP = { PlantCategory: 'category', PlantSubCategory: 'subCategory' };

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

    const bomField = BOM_SNAPSHOT_FIELD_MAP[option.field];
    if (bomField) {
      await RDBOM.updateMany(
        { company: req.user.companyId, [`materials.${bomField}`]: oldValue },
        { $set: { [`materials.$[elem].${bomField}`]: newValue } },
        { arrayFilters: [{ [`elem.${bomField}`]: oldValue }] }
      );
    }

    const itemMap = ITEM_FIELD_MAP[option.field];
    if (itemMap) {
      const itemQuery = { companyId: req.user.companyId, [itemMap.field]: oldValue };
      if (itemMap.productKind) itemQuery.productKind = itemMap.productKind; // unscoped (e.g. Metrology) applies to any kind
      await Item.updateMany(itemQuery, { $set: { [itemMap.field]: newValue } });
    }

    const plantField = PLANT_FIELD_MAP[option.field];
    if (plantField) {
      await RDPlant.updateMany(
        { company: req.user.companyId, [plantField]: oldValue },
        { $set: { [plantField]: newValue } }
      );
    }

    const childField = CHILD_FIELD_MAP[option.field];
    if (childField) {
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

    const childField = CHILD_FIELD_MAP[option.field];
    const childCount = childField
      ? await RDMasterOption.countDocuments({ company: req.user.companyId, field: childField, parentValue: option.value })
      : 0;

    if (productCount > 0 || plantCount > 0 || childCount > 0) {
      const parts = [];
      if (productCount > 0) parts.push(`${productCount} product${productCount > 1 ? 's' : ''}`);
      if (plantCount > 0) parts.push(`${plantCount} plant${plantCount > 1 ? 's' : ''}`);
      if (childCount > 0) parts.push(`${childCount} linked ${childField.replace('P-', 'P-')} value${childCount > 1 ? 's' : ''}`);
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
  { path: 'machines.item', select: 'code name category subCategory isDiscontinued' },
  { path: 'motors.item', select: 'code name category subCategory isDiscontinued' },
];

const cleanPlantRefList = (list) =>
  (Array.isArray(list) ? list : [])
    .filter(entry => entry && entry.item)
    .map(entry => ({ item: entry.item, quantity: Math.max(1, Number(entry.quantity) || 1) }));

export const getPlants = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, discontinued, category, subCategory } = req.query;
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
    const plants = await RDPlant.find(query).populate(PLANT_POPULATE).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: plants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPlant = async (req, res) => {
  try {
    const { category, subCategory, name, productionRate, machines, motors } = req.body;
    if (!category || !subCategory || !name) {
      return res.status(400).json({ success: false, message: 'Category, Sub Category and Plant Name are required.' });
    }
    const plant = await RDPlant.create({
      category, subCategory, name,
      productionRate: productionRate || '',
      machines: cleanPlantRefList(machines),
      motors: cleanPlantRefList(motors),
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
    const { category, subCategory, name, productionRate, machines, motors } = req.body;
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

export const getBOMs = async (req, res) => {
  try {
    const boms = await RDBOM.find({ company: req.user.companyId }).populate('machine', 'code name');
    res.json({ success: true, data: boms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBOMForMachine = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ machine: req.params.machineId, company: req.user.companyId });
    res.json({ success: true, data: bom || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Cross-department lookup: get a machine's BOM by its Product Code ─────────
// Used by Production (Order Management) to show the full R&D BOM entry — including
// hierarchy, material type, and the Product Master snapshot — for a material demand,
// without needing the internal RDMachine ObjectId.
export const getBOMByMachineCode = async (req, res) => {
  try {
    const { code } = req.params;
    const companyId = req.user.companyId;

    const machine = await Item.findOne({ code, companyId, productKind: 'Machine' }).lean();
    if (!machine) {
      return res.json({ success: true, data: { machine: null, bom: null } });
    }

    const bom = await RDBOM.findOne({ machine: machine._id, company: companyId }).lean();
    res.json({ success: true, data: { machine: toMachineResponse(machine), bom: bom || null } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Cross-department lookup: a machine's BOM material cost by MRP ────────────
// Used by the Sales Order Form to show/enforce a minimum Billing Amount per
// item (material MRP × qty, summed across the BOM). `data: null` means no
// RDMachine/BOM exists for this code — callers should skip validation entirely.
export const getBOMCostByMachineCode = async (req, res) => {
  try {
    const { code } = req.params;
    const companyId = req.user.companyId;

    const result = await computeBOMMaterialsMrpCost(code, companyId);
    res.json({ success: true, data: result.found ? result : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ─── CREATE BOM (WITH SOURCE TYPE VALIDATION) ─────────────────────────────────
export const createBOM = async (req, res) => {
  try {
    const { machineId, variant } = req.body;
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });

    // 1. Fetch Machine and Validate P-Source Type
    const machine = await Item.findOne({ _id: machineId, companyId: req.user.companyId, productKind: 'Machine' });
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });

    const validSources = ['In House Manufacturing', 'Out Source Manufactured'];
    if (!validSources.includes(machine.productSourceType)) {
      return res.status(400).json({
        success: false,
        message: `BOM creation blocked. P-Source Type must be In House or Out Source. Current: ${machine.productSourceType}`
      });
    }

    const existing = await RDBOM.findOne({ machine: machineId, company: req.user.companyId });
    if (existing) return res.status(400).json({ success: false, message: 'BOM already exists for this machine' });

    const bom = await RDBOM.create({
      machine: machineId,
      variant: variant || 'Standard',
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addMaterial = async (req, res) => {
  try {
    // 1. Extract 'code' alongside the new fields
    const {
      code, childPart, subChildPart, childPartCode, subChildPartCode, item, itemType, quantity, unit,
      pType, pSourceType, customFields,
      inputUnitType, inputUnit, outputUnitType, outputUnit
    } = req.body;

    // 2. Validate that 'code' is present
    if (!code || !item || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: 'code, item, quantity, and unit are required'
      });
    }

    // BOM materials must reference an existing Inventory item (raw material) —
    // no free-typed codes, even via direct API calls that bypass the frontend's
    // MaterialCodePicker. Product Master now holds finished-goods machines
    // only, not raw materials, so materials come from plain Inventory
    // (productKind: null) instead.
    const sourceItem = await Item.findOne({ companyId: req.user.companyId, productKind: null, code: code.trim() });
    if (!sourceItem) {
      return res.status(400).json({
        success: false,
        message: `"${code}" does not match any Inventory item. BOM materials must be selected from Inventory.`
      });
    }

    // Price and every other BOM_FIELD_CATALOG field are pulled straight from
    // the validated Inventory item server-side, never trusted from the
    // client — "Price fetch by Purchase item wise and auto calculate", and
    // whatever fields BOM Format & Modification later enables as columns
    // always have real, authoritative data behind them.
    const unitPrice = sourceItem.purchaseCost || 0;
    const totalPrice = Math.round(unitPrice * Number(quantity) * 100) / 100;

    // 3. Push all fields to the materials array
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      {
        $push: {
          materials: {
            code, // Injecting explicit material code
            childPart,
            subChildPart,
            childPartCode: childPartCode || '',
            subChildPartCode: subChildPartCode || '',
            item,
            itemType: itemType || '',
            quantity: Number(quantity),
            unit,
            unitPrice,
            totalPrice,
            // Inventory snapshot — authoritative, from sourceItem (see above),
            // field-for-field with BOM_FIELD_CATALOG / SimpleInventoryForm.jsx.
            category: sourceItem.category || '',
            subCategory: sourceItem.subCategory || '',
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
            // Legacy Product-Master-only fields — kept for older BOMs that
            // still reference them; never populated from Inventory items.
            pType: pType || '',
            pSourceType: pSourceType || '',
            inputUnitType: inputUnitType || '',
            inputUnit: inputUnit || '',
            outputUnitType: outputUnitType || '',
            outputUnit: outputUnit || '',
            customFields: customFields || [],
          }
        }
      },
      { new: true }
    );

    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found or is locked' });

    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });

    const newCode = req.body.code ? req.body.code.trim() : mat.code;
    const sourceItem = await Item.findOne({ companyId: req.user.companyId, productKind: null, code: newCode });
    if (!sourceItem) {
      return res.status(400).json({
        success: false,
        message: `"${req.body.code || newCode}" does not match any Inventory item. BOM materials must be selected from Inventory.`
      });
    }

    Object.assign(mat, req.body);

    // Price and every other BOM_FIELD_CATALOG field are re-pulled from the
    // validated Inventory item server-side, never trusted from the client —
    // same as addMaterial, so editing a material always reflects Inventory's
    // current data rather than whatever the client happened to send.
    mat.unitPrice = sourceItem.purchaseCost || 0;
    mat.totalPrice = Math.round(mat.unitPrice * (mat.quantity || 0) * 100) / 100;
    mat.category = sourceItem.category || '';
    mat.subCategory = sourceItem.subCategory || '';
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

export const deleteMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      { $pull: { materials: { _id: req.params.materialId } } },
      { new: true }
    );
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found or is locked' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


export const lockBOM = async (req, res) => {
  try {
    // 1. Fetch BOM with Machine Details
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId }).populate('machine');
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.isLocked) return res.status(400).json({ success: false, message: 'BOM is already locked' });

    // 2. Setup PDF Generation
    const filename = `BOM_${bom.machine.code}_${Date.now()}.pdf`;
    const filepath = path.join(process.cwd(), 'uploads', 'rd-docs', filename);

    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // 3. Write PDF Header
    doc.fontSize(20).text(`Master Bill of Materials`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Machine Code: ${bom.machine.code}`);
    doc.text(`Machine Name: ${bom.machine.name}`);
    doc.text(`Variant: ${bom.variant}`);
    doc.text(`Version: ${bom.version}`);
    doc.text(`Date Locked: ${today()}`);
    doc.moveDown();

    // 4. Write PDF Rows
    doc.fontSize(14).text('Items:', { underline: true });
    doc.fontSize(10);
    bom.materials.forEach((mat, idx) => {
      // Formats nicely: 1. Body > Door | Sheet Metal | Laser Cutting | 2 pcs
      const hierarchy = [mat.childPart, mat.subChildPart].filter(Boolean).join(' > ');
      const prefix = hierarchy ? `${hierarchy} | ` : '';
      doc.text(`${idx + 1}. ${prefix}${mat.item} (${mat.itemType}) - ${mat.quantity} ${mat.unit}`);
    });

    doc.end();

    // 5. Wait for PDF to finish writing to disk
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    // 6. Create the Document Record Automatically
    await RDDocument.create({
      machine: bom.machine._id,
      machineCode: bom.machine.code,
      machineName: bom.machine.name,
      name: `Auto-Generated BOM (${bom.version})`,
      type: 'BOM',
      version: bom.version,
      size: '0.1 MB', // Standard placeholder size for basic text PDFs
      fileUrl: `/uploads/rd-docs/${filename}`,
      originalName: filename,
      notes: 'Automatically generated and uploaded by system upon BOM Lock.',
      uploadedBy: 'System Automation',
      uploadedAt: today(),
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    // 7. Lock the BOM
    bom.isLocked = true;
    bom.lockedAt = today();
    await bom.save();

    res.json({ success: true, data: bom, message: 'BOM locked and PDF generated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = true;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = false;
    await bom.save();
    res.json({ success: true, data: bom });
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

    // Approving a change request is the ONLY way to edit a locked BOM — so
    // approval must unlock the machine's BOM here. Nothing else in the
    // codebase ever flips isLocked back to false (lockBOM only ever sets it
    // true), so without this the BOM stayed locked forever after approval.
    // The CR only references `machine`, not a specific BOM id, but
    // RDBOM enforces a unique {company, machine} pair, so this lookup is
    // unambiguous.
    if (approved) {
      await RDBOM.findOneAndUpdate(
        { machine: cr.machine, company: req.user.companyId },
        { isLocked: false, lockedAt: null }
      );
    }

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
      // (Your original logic remains untouched here)
      // isDiscontinued: false — code isn't guaranteed unique (see createMachine's
      // duplicate-code guard), so an old discontinued duplicate must never shadow
      // the live machine this BOM/prototype actually belongs to.
      const machineProfile = await Item.findOne({ code: rdRequest.machineCode, companyId, productKind: 'Machine', isDiscontinued: false });
      if (!machineProfile || machineProfile.machineDetails?.releaseStatus !== 'Released') {
        return res.status(400).json({ success: false, message: 'Machine profile missing or not released.' });
      }

      const masterBOM = await RDBOM.findOne({ machine: machineProfile._id, company: companyId });
      if (!masterBOM || masterBOM.materials.length === 0) {
        return res.status(400).json({ success: false, message: 'No materials found in Master BOM.' });
      }

      const designDocs = await RDDocument.find({ machine: machineProfile._id, company: companyId, type: 'Design Files' });

      // Multi-item/qty: the Master BOM is per-unit; a Production Order that
      // builds N units (orderQuantity) demands N × the BOM quantity of every
      // material. bomQuantity stays per-unit for reference.
      const prodOrderForQty = await ProductionOrder.findById(rdRequest.productionOrderId)
        .select('orderQuantity').lean();
      const buildQty = Math.max(1, Number(prodOrderForQty?.orderQuantity) || 1);

      const demandsToPush = masterBOM.materials.map(mat => ({
        materialCode: mat.code,
        materialName: mat.item,
        bomQuantity: mat.quantity,
        quantity: mat.quantity * buildQty,
        unit: mat.unit,
        status: 'Requested'
      }));

      const docsToPush = designDocs.map(doc => ({ name: doc.name, fileUrl: doc.fileUrl, version: doc.version }));

      await ProductionOrder.findByIdAndUpdate(rdRequest.productionOrderId, {
        $push: { materialDemands: { $each: demandsToPush }, designDocuments: { $each: docsToPush } },
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
        data: { machine: null, bom: null, documents: [] }
      });
    }

    // 3. Fetch Master BOM
    const masterBOM = await RDBOM.findOne({ machine: machineProfile._id, company: companyId }).lean();

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
        bom: masterBOM,
        documents: designDocs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};