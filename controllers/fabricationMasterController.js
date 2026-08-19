import FabricationMaster from '../models/FabricationMaster.js';
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
    materials: MATERIAL_DENSITY_TABLE,
    defaultDensityKgM3: DEFAULT_DENSITY_KG_M3,
  });
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

const getNextCodeForPrefix = async (companyId, prefix) => {
  const docs = await FabricationMaster.find({
    company: companyId,
    itemCode: { $regex: `^${prefix}-\\d+$` },
  }).select('itemCode').lean();
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const d of docs) {
    const m = d.itemCode.match(regex);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

export const suggestNextCode = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'name is required' });
    const prefix = derivePrefix(name);
    const code = await getNextCodeForPrefix(req.user.companyId, prefix);
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
      code = await getNextCodeForPrefix(req.user.companyId, derivePrefix(itemName));
    }

    const existing = await FabricationMaster.findOne({ company: req.user.companyId, itemCode: code });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Coding Conflict: The Item Code "${code}" is already assigned to "${existing.itemName}".`,
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
      const conflict = await FabricationMaster.findOne({ company: req.user.companyId, itemCode: itemCode.trim(), _id: { $ne: existing._id } });
      if (conflict) {
        return res.status(400).json({ success: false, message: `Coding Conflict: The Item Code "${itemCode.trim()}" is already assigned to "${conflict.itemName}".` });
      }
      update.itemCode = itemCode.trim();
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
