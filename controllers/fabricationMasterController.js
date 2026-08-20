import FabricationMaster from '../models/FabricationMaster.js';
import FabricationMaterial from '../models/FabricationMaterial.js';
import { Item } from '../models/Inventory.js';
import {
  FABRICATION_CATEGORIES, FABRICATION_CATEGORY_GROUPS, MATERIAL_DENSITY_TABLE,
  getCategoryByKey, DEFAULT_DENSITY_KG_M3,
} from '../utils/fabricationCategories.js';
import { getSectionTable } from '../utils/steelSectionTables.js';
import { calculateFabricationWeight, densityToKgM3 } from '../utils/fabricationWeightCalc.js';

export const getCategories = async (req, res) => {
  res.json({
    success: true,
    data: FABRICATION_CATEGORIES,
    groups: FABRICATION_CATEGORY_GROUPS,
    defaultDensityKgM3: DEFAULT_DENSITY_KG_M3,
  });
};

// Material dropdown for the Dimension Calculator: the 5 built-in materials
// plus whatever this company has added via the "+" (see createMaterial).
export const getMaterials = async (req, res) => {
  try {
    const custom = await FabricationMaterial.find({ company: req.user.companyId }).sort({ name: 1 }).lean();
    const data = [
      ...MATERIAL_DENSITY_TABLE.map((m) => ({ key: m.key, label: m.label, densityKgM3: m.densityKgM3, custom: false })),
      ...custom.map((m) => ({ key: String(m._id), label: m.name, densityKgM3: m.densityKgM3, custom: true })),
    ];
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createMaterial = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const densityKgM3 = Number(req.body.densityKgM3);
    if (!name) return res.status(400).json({ success: false, message: 'Material name is required.' });
    if (!densityKgM3 || densityKgM3 <= 0) return res.status(400).json({ success: false, message: 'A valid density is required.' });

    const clashesBuiltIn = MATERIAL_DENSITY_TABLE.some(
      (m) => m.label.toLowerCase() === name.toLowerCase() || m.key.toLowerCase() === name.toLowerCase()
    );
    if (clashesBuiltIn) {
      return res.status(400).json({ success: false, message: `"${name}" already exists as a built-in material.` });
    }
    const existing = await FabricationMaterial.findOne({
      company: req.user.companyId,
      name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: `"${name}" has already been added.` });
    }

    const created = await FabricationMaterial.create({
      name, densityKgM3, company: req.user.companyId, createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: { key: String(created._id), label: created.name, densityKgM3: created.densityKgM3, custom: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSectionTableForFamily = async (req, res) => {
  const { family } = req.params;
  res.json({ success: true, data: getSectionTable(family) });
};

export const calculateWeight = async (req, res) => {
  try {
    const { category, values, densityValue, densityUnit, designation } = req.body;
    if (!category || !getCategoryByKey(category)) {
      return res.status(400).json({ success: false, message: 'Unknown or missing category' });
    }
    const result = calculateFabricationWeight(category, values, densityValue, densityUnit, designation);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Derives a code prefix from the item name — e.g. "Angle" -> "ANG", "Pipe"
// -> "PIP" (confirmed convention). Non-letter characters (spaces, digits)
// are dropped before taking the first 3 letters.
const derivePrefix = (name) => {
  const letters = String(name || '').replace(/[^a-zA-Z]/g, '');
  return (letters.slice(0, 3).toUpperCase()) || 'ITM';
};

// itemCode is globally unique (see FabricationMaster.js's index comment) and
// becomes an Item.code verbatim the moment it's picked in Inventory — which
// itself has a global unique constraint covering every item, fabrication-
// derived or not. So the "next" number has to skip anything already taken
// in EITHER collection, across every company — not just this one — or the
// suggested code can still collide the moment it's turned into an Item.
const getNextCodeForPrefix = async (prefix) => {
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  const [fabDocs, itemDocs] = await Promise.all([
    FabricationMaster.find({ itemCode: { $regex: `^${prefix}-\\d+$` } }).select('itemCode').lean(),
    Item.find({ code: { $regex: `^${prefix}-\\d+$` } }).select('code').lean(),
  ]);
  let max = 0;
  for (const d of fabDocs) {
    const m = d.itemCode.match(regex);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  for (const d of itemDocs) {
    const m = d.code.match(regex);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

export const suggestNextCode = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'name is required' });
    const prefix = derivePrefix(name);
    const code = await getNextCodeForPrefix(prefix);
    res.json({ success: true, data: { code } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFabricationItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, discontinued, category, page, limit } = req.query;
    const isPaginated = !!(page || limit);
    const query = { company: companyId };
    if (discontinued === 'true') query.isDiscontinued = true;
    else if (discontinued === 'false') query.isDiscontinued = false;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } },
      ];
    }

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const [items, total] = await Promise.all([
        FabricationMaster.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
        FabricationMaster.countDocuments(query),
      ]);
      return res.json({ success: true, data: items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
    }

    const items = await FabricationMaster.find(query).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Recomputes every dimension row's weight server-side from its category
// formula/lookup + density — the client's own live-preview numbers are never
// trusted directly into the saved document.
const buildDimensionsForSave = (category, density, rawDimensions) => {
  if (!Array.isArray(rawDimensions) || rawDimensions.length === 0) {
    throw new Error('At least one dimension is required.');
  }
  return rawDimensions.map((dim) => {
    const values = dim.values && typeof dim.values === 'object' ? dim.values : {};
    const { weightPerMeterKg, weightPerPieceKg } = calculateFabricationWeight(
      category, values, density.value, density.unit, dim.designation
    );
    return {
      values,
      designation: dim.designation ? String(dim.designation).trim() : '',
      weightPerMeterKg,
      weightPerPieceKg,
      pieces: dim.pieces !== undefined && dim.pieces !== null && dim.pieces !== '' ? Number(dim.pieces) || 1 : 1,
      pricePerKg: dim.pricePerKg !== undefined && dim.pricePerKg !== null && dim.pricePerKg !== '' ? Number(dim.pricePerKg) : null,
    };
  });
};

// Trims each of the 6 Purchase/Used/Receive Unit strings, defaulting missing ones to ''.
const sanitizeUnitFields = (body) => ({
  purchaseUnitType: body.purchaseUnitType ? String(body.purchaseUnitType).trim() : '',
  purchaseUnit: body.purchaseUnit ? String(body.purchaseUnit).trim() : '',
  usedUnitType: body.usedUnitType ? String(body.usedUnitType).trim() : '',
  usedUnit: body.usedUnit ? String(body.usedUnit).trim() : '',
  receiveUnitType: body.receiveUnitType ? String(body.receiveUnitType).trim() : '',
  receiveUnit: body.receiveUnit ? String(body.receiveUnit).trim() : '',
});

export const createFabricationItem = async (req, res) => {
  try {
    const { itemName, itemCode, category, density, dimensions } = req.body;
    if (!itemName || !itemName.trim()) {
      return res.status(400).json({ success: false, message: 'Item Name is required.' });
    }
    if (!category || !getCategoryByKey(category)) {
      return res.status(400).json({ success: false, message: 'A valid Category is required.' });
    }
    const densityIn = {
      value: Number(density?.value) || DEFAULT_DENSITY_KG_M3,
      unit: density?.unit === 'g/cm3' ? 'g/cm3' : 'kg/m3',
    };

    let finalDimensions;
    try {
      finalDimensions = buildDimensionsForSave(category, densityIn, dimensions);
    } catch (calcErr) {
      return res.status(400).json({ success: false, message: calcErr.message });
    }

    let code = itemCode && itemCode.trim();
    if (!code) {
      code = await getNextCodeForPrefix(derivePrefix(itemName));
    }

    // Global checks, not company-scoped — itemCode has to be unique across
    // every company (see FabricationMaster.js's index comment), and also
    // can't already be taken as a plain Inventory Item.code (e.g. a manually
    // created item, or another company's item that isn't Fabrication-linked
    // at all) — either would otherwise only surface as a confusing
    // duplicate-key error later, downstream in Inventory's Add Item form.
    const [existing, existingItem] = await Promise.all([
      FabricationMaster.findOne({ itemCode: code }),
      Item.findOne({ code }).select('name company').lean(),
    ]);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Coding Conflict: The Item Code "${code}" is already assigned to "${existing.itemName}".`,
      });
    }
    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: `Coding Conflict: The Item Code "${code}" is already used by an Inventory item ("${existingItem.name}").`,
      });
    }

    const created = await FabricationMaster.create({
      itemName: itemName.trim(),
      itemCode: code,
      category,
      density: densityIn,
      dimensions: finalDimensions,
      ...sanitizeUnitFields(req.body),
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateFabricationItem = async (req, res) => {
  try {
    const { itemName, itemCode, category, density, dimensions } = req.body;
    const existing = await FabricationMaster.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!existing) return res.status(404).json({ success: false, message: 'Fabrication item not found' });

    const update = {};
    if (itemName !== undefined) {
      if (!itemName.trim()) return res.status(400).json({ success: false, message: 'Item Name cannot be empty.' });
      update.itemName = itemName.trim();
    }
    if (category !== undefined) {
      if (!getCategoryByKey(category)) return res.status(400).json({ success: false, message: 'A valid Category is required.' });
      update.category = category;
    }
    if (density !== undefined) {
      update.density = {
        value: Number(density?.value) || DEFAULT_DENSITY_KG_M3,
        unit: density?.unit === 'g/cm3' ? 'g/cm3' : 'kg/m3',
      };
    }
    if (itemCode !== undefined && itemCode.trim() && itemCode.trim() !== existing.itemCode) {
      const newCode = itemCode.trim();
      // Global checks — see createFabricationItem's matching comment.
      const [conflict, conflictItem] = await Promise.all([
        FabricationMaster.findOne({ itemCode: newCode, _id: { $ne: existing._id } }),
        Item.findOne({ code: newCode }).select('name').lean(),
      ]);
      if (conflict) {
        return res.status(400).json({ success: false, message: `Coding Conflict: The Item Code "${newCode}" is already assigned to "${conflict.itemName}".` });
      }
      if (conflictItem) {
        return res.status(400).json({ success: false, message: `Coding Conflict: The Item Code "${newCode}" is already used by an Inventory item ("${conflictItem.name}").` });
      }
      update.itemCode = newCode;
    }
    if (dimensions !== undefined) {
      const categoryForCalc = update.category || existing.category;
      const densityForCalc = update.density || existing.density;
      try {
        update.dimensions = buildDimensionsForSave(categoryForCalc, densityForCalc, dimensions);
      } catch (calcErr) {
        return res.status(400).json({ success: false, message: calcErr.message });
      }
    }
    Object.assign(update, sanitizeUnitFields(req.body));

    const updated = await FabricationMaster.findByIdAndUpdate(existing._id, { $set: update }, { new: true });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const setFabricationItemStatus = async (req, res) => {
  try {
    const updated = await FabricationMaster.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { $set: { isDiscontinued: !!req.body.isDiscontinued } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Fabrication item not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
