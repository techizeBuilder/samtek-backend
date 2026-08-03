import RDMachine from '../models/RDMachine.js';
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
    const baseQuery = { company: companyId };
    if (discontinued === 'true') baseQuery.isDiscontinued = true;
    else if (discontinued === 'false') baseQuery.isDiscontinued = false;
    if (forwardToNextPhase === 'true') baseQuery.forwardToNextPhase = true;
    else if (forwardToNextPhase === 'false') baseQuery.forwardToNextPhase = false;
    if (releaseStatus && releaseStatus !== 'All') baseQuery.releaseStatus = releaseStatus;
    // Classification filters — lets R&D find every product under a P-Type/Category/P-Source Type
    // before renaming or deleting that option, so they can reassign items instead of hunting for them.
    if (pType) baseQuery.pType = pType;
    if (category) baseQuery.category = category;
    if (pSourceType) baseQuery.pSourceType = pSourceType;
    if (search) {
      baseQuery.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const query = { ...baseQuery };
    if (designStatus && designStatus !== 'All') query.designStatus = designStatus;

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await RDMachine.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$designStatus', count: { $sum: 1 } } },
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
        RDMachine.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
        RDMachine.countDocuments(query),
      ]);
      machines = rows;
      pagination = { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) };
    } else {
      // 1. Fetch all machines for the company (.lean() makes it plain JSON so we can add properties)
      machines = await RDMachine.find(query).sort({ createdAt: -1 }).lean();
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

    // 4. Attach the grouped documents to their respective machines
    const enrichedMachines = machines.map(machine => ({
      ...machine,
      // This feeds the files directly into the frontend response
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
      specifications, customFields, forwardToNextPhase
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
    // by code (BOM/R&D approval, autofill, etc.).
    const existing = await RDMachine.findOne({ code: code.trim(), company: req.user.companyId, isDiscontinued: false });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Product Code "${code}" is already used by "${existing.name}". Codes must be unique.`
      });
    }

    const machine = await RDMachine.create({
      code,
      name,
      description: description || '',
      category,
      pType,
      pSourceType,
      brand: brand || '',
      metrology: metrology || '',
      size: size || '',
      unitWeightValue: unitWeightValue !== undefined && unitWeightValue !== '' ? Number(unitWeightValue) : null,
      unitWeightUnitType: unitWeightUnitType || '',
      unitWeightUnit: unitWeightUnit || '',
      inputUnitType: inputUnitType || '',
      inputUnit: inputUnit || '',
      outputUnitType: outputUnitType || '',
      outputUnit: outputUnit || '',
      machineType: machineType || 'Standard',
      specifications: specifications || [],
      customFields: customFields || [],
      forwardToNextPhase: !!forwardToNextPhase,
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: machine });
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
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { ...req.body },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
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

    if (!['Category', 'P-Type', 'P-SourceType', 'Metrology', 'MaterialType'].includes(field)) {
      return res.status(400).json({ success: false, message: 'Invalid field type.' });
    }
    if (!value || value.trim() === '') {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }
    if (['Category', 'P-SourceType'].includes(field) && (!parentValue || !parentValue.trim())) {
      return res.status(400).json({ success: false, message: `Select the parent ${field === 'Category' ? 'P-Type' : 'Category'} before adding this option.` });
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

// Field -> the RDMachine column it snapshots into, for cascading edits/usage checks
const MACHINE_FIELD_MAP = { 'P-Type': 'pType', 'Category': 'category', 'P-SourceType': 'pSourceType', 'Metrology': 'metrology' };
// Field -> the child dropdown field whose parentValue chains off it
const CHILD_FIELD_MAP = { 'P-Type': 'Category', 'Category': 'P-SourceType' };

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

    const machineField = MACHINE_FIELD_MAP[option.field];
    if (machineField) {
      await RDMachine.updateMany(
        { company: req.user.companyId, [machineField]: oldValue },
        { $set: { [machineField]: newValue } }
      );
      await RDBOM.updateMany(
        { company: req.user.companyId, [`materials.${machineField}`]: oldValue },
        { $set: { [`materials.$[elem].${machineField}`]: newValue } },
        { arrayFilters: [{ [`elem.${machineField}`]: oldValue }] }
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

    const machineField = MACHINE_FIELD_MAP[option.field];
    const productCount = machineField
      ? await RDMachine.countDocuments({ company: req.user.companyId, [machineField]: option.value })
      : 0;

    const childField = CHILD_FIELD_MAP[option.field];
    const childCount = childField
      ? await RDMasterOption.countDocuments({ company: req.user.companyId, field: childField, parentValue: option.value })
      : 0;

    if (productCount > 0 || childCount > 0) {
      const parts = [];
      if (productCount > 0) parts.push(`${productCount} product${productCount > 1 ? 's' : ''}`);
      if (childCount > 0) parts.push(`${childCount} linked ${childField.replace('P-', 'P-')} value${childCount > 1 ? 's' : ''}`);
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${option.value}" — still used by ${parts.join(' and ')}. Reassign or remove those first.`,
        productCount, childCount
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



export const updateDesignStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const update = { designStatus: status };
    if (status === 'Rejected') update.rejectionNote = note || '';
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      update,
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateReleaseStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { releaseStatus: status },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueMachine = async (req, res) => {
  try {
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { isDiscontinued: true },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateMachine = async (req, res) => {
  try {
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { isDiscontinued: false },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
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

    const machine = await RDMachine.findOne({ code, company: companyId }).lean();
    if (!machine) {
      return res.json({ success: true, data: { machine: null, bom: null } });
    }

    const bom = await RDBOM.findOne({ machine: machine._id, company: companyId }).lean();
    res.json({ success: true, data: { machine, bom: bom || null } });
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
    const machine = await RDMachine.findOne({ _id: machineId, company: req.user.companyId });
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });

    const validSources = ['In House Manufacturing', 'Out Source Manufactured'];
    if (!validSources.includes(machine.pSourceType)) {
      return res.status(400).json({
        success: false,
        message: `BOM creation blocked. P-Source Type must be In House or Out Source. Current: ${machine.pSourceType}`
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
      code, childPart, subChildPart, item, itemType, quantity, unit,
      category, pType, pSourceType, brand, description, metrology, specifications, customFields,
      size, unitWeightValue, unitWeightUnitType, unitWeightUnit,
      inputUnitType, inputUnit, outputUnitType, outputUnit
    } = req.body;

    // 2. Validate that 'code' is present
    if (!code || !item || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: 'code, item, quantity, and unit are required'
      });
    }

    // BOM materials must reference an existing Product Master entry — no free-typed codes,
    // even via direct API calls that bypass the frontend's MaterialCodePicker.
    const sourceMachine = await RDMachine.findOne({ company: req.user.companyId, code: code.trim() });
    if (!sourceMachine) {
      return res.status(400).json({
        success: false,
        message: `"${code}" does not match any Product Master item. BOM materials must be selected from Product Master.`
      });
    }

    // 3. Push all fields to the materials array
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      {
        $push: {
          materials: {
            code, // Injecting explicit material code
            childPart,
            subChildPart,
            item,
            itemType: itemType || '',
            quantity: Number(quantity),
            unit,
            // Product Master snapshot, captured client-side when the code matched
            category: category || '',
            pType: pType || '',
            pSourceType: pSourceType || '',
            brand: brand || '',
            description: description || '',
            metrology: metrology || '',
            size: size || '',
            unitWeightValue: unitWeightValue !== undefined && unitWeightValue !== '' ? Number(unitWeightValue) : null,
            unitWeightUnitType: unitWeightUnitType || '',
            unitWeightUnit: unitWeightUnit || '',
            inputUnitType: inputUnitType || '',
            inputUnit: inputUnit || '',
            outputUnitType: outputUnitType || '',
            outputUnit: outputUnit || '',
            specifications: specifications || [],
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

    if (req.body.code && req.body.code.trim() !== mat.code) {
      const sourceMachine = await RDMachine.findOne({ company: req.user.companyId, code: req.body.code.trim() });
      if (!sourceMachine) {
        return res.status(400).json({
          success: false,
          message: `"${req.body.code}" does not match any Product Master item. BOM materials must be selected from Product Master.`
        });
      }
    }

    Object.assign(mat, req.body);
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
      const machine = await RDMachine.findById(machineId).select('code name');
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
      const machineProfile = await RDMachine.findOne({ code: rdRequest.machineCode, company: companyId, isDiscontinued: false });
      if (!machineProfile || machineProfile.releaseStatus !== 'Released') {
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
    const machineProfile = await RDMachine.findOne({ code: rdRequest.machineCode, company: companyId, isDiscontinued: false }).lean();

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
        machine: machineProfile,
        bom: masterBOM,
        documents: designDocs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};