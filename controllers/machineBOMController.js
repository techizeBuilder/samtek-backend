// Machine BOM — the final node of the corrected BOM hierarchy (see
// server/docs/bom-hierarchy-redesign-2026-09.md §5, §9). A Machine's new-flow
// BOM references Child Parts (by ObjectId + qty) instead of a flat tagged
// material list, plus its own extra Materials/Tools — mirroring, one level
// up, the exact pattern already built for ChildPartBOM referencing Sub Child
// Parts (childPartBOMController.js).
//
// Deliberately parallel to, not a replacement for, the OLD per-machine
// RDBOM flow (rdController.js) — every manufacturing Machine/Motor Item is
// still just one Item either way (unlike Child Part, there's no old/new
// catalog split to isolate here: a Machine BOM's own "does this exist yet"
// gate is simply "no MachineBOM document yet for this Item", same as the
// OLD RDBOM's own createBOM/getBOMForMachine gate).
//
// Unlike ChildPartBOM (display-only Total Cost, no Item write-back), this
// DOES push its rolled-up cost onto Item.stdCost/mrp/salePrice (reusing
// applyPricingToItem) — confirmed with the user, since Item.stdCost is a
// real, live gate on Sales Order submission (orderFormController.js's
// minimum-billing-amount check via getMachineBillingBOMCost) and feeds
// Sales Invoice/Returns/Damages pricing fallbacks. If a machine has both an
// old RDBOM and a new MachineBOM, whichever was saved/viewed most recently
// wins — accepted as a transitional state during migration, not solved here.
//
// Production/Store/QC/Delivery-Estimate integration, automatic Purchase/
// Production-triggered recalculation, and cost cascading to consumers are
// all explicitly deferred — see the plan's "Explicitly out of scope" section.
import { Item } from '../models/Inventory.js';
import MachineBOM from '../models/MachineBOM.js';
import { refreshAndComputeChildPart } from './childPartBOMController.js';
import { buildFabricationBomDimensions, resolveFabricationWeight } from '../services/fabricationDemandService.js';
import { resolveLineWeightKg } from '../utils/bomWeightCalc.js';
import { applyPricingToItem } from '../services/itemPricingService.js';
import { cleanProcessDefinition, validateProcessDefinition } from '../utils/processDefinitionValidation.js';
import RDDocument from '../models/RDDocument.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const itemNeedsAmount = (sourceItem) => !sourceItem.fabricationRef && AMOUNT_UNIT_TYPES.includes(sourceItem.unitType);
const today = () => new Date().toISOString().split('T')[0];

// Machine unit cost = Σ(Child Part unit cost × qty) + Σ(other material cost
// × qty) + Production Cost/Expense — per design doc §6, one level up from
// computeChildPartCost. materialsCost folds Raw + Tool lines together, same
// as every other BOM level (no distinct Tool cost model anywhere).
function computeMachineBOMCost(bom) {
  const childPartsCost = (bom.childParts || []).filter(l => !l.isDiscontinued).reduce((s, l) => s + (l.totalPrice || 0), 0);
  const rawCost = (bom.materials || []).filter(m => !m.isDiscontinued && m.materialKind !== 'tool').reduce((s, m) => s + (m.totalPrice || 0), 0);
  const toolsCost = (bom.materials || []).filter(m => !m.isDiscontinued && m.materialKind === 'tool').reduce((s, m) => s + (m.totalPrice || 0), 0);
  const materialsCost = rawCost + toolsCost;
  const totalCost = childPartsCost + materialsCost + (bom.productionCost || 0) + (bom.productionExpense || 0);
  return { childPartsCost, rawCost, toolsCost, materialsCost, totalCost };
}

// One material/tool line's own weight — never stored (same "computed live,
// never persisted per-line" convention every BOM level uses). Shared by
// computeMachineBOMWeight's own sum below AND getMachineBOM's per-line
// response decoration, so the two can never drift apart.
function materialLineWeightKg(m) {
  return resolveLineWeightKg({
    fabricationWeightPerPieceKg: m.fabricationCategory ? m.computedWeightPerPieceKg : null,
    quantity: m.quantity, unitWeightValue: m.unitWeightValue, unitWeightUnit: m.unitWeightUnit,
    amountValue: m.amountValue, amountUnit: m.amountUnit,
  });
}

// Sibling to computeMachineBOMCost — same rollup shape for weight.
function computeMachineBOMWeight(bom) {
  const childPartsWeightKg = (bom.childParts || []).filter(l => !l.isDiscontinued).reduce((s, l) => s + (l.totalWeightKg || 0), 0);
  const materialsWeightKg = (bom.materials || []).filter(m => !m.isDiscontinued).reduce((s, m) => s + (materialLineWeightKg(m) || 0), 0);
  return { childPartsWeightKg, materialsWeightKg, totalWeightKg: childPartsWeightKg + materialsWeightKg };
}

// Pushes the Machine's live-computed Total Cost onto Item.stdCost/mrp/
// salePrice (see itemPricingService.js's applyPricingToItem) — same gate
// (item.internalManufacturing) every OLD-flow call site already uses, so a
// purchased/non-manufactured machine's price is never touched by this.
export async function syncMachineBOMPricing(item, bom) {
  const cost = computeMachineBOMCost(bom);
  if (item.internalManufacturing) {
    await applyPricingToItem(item, cost.totalCost, 'BOM');
  }
  return cost;
}

// Resolves the Machine/Motor Item alone — used by getMachineBOM (which
// tolerates "no BOM yet") and createMachineBOM.
async function resolveMachineItem(machineId, companyId) {
  const item = await Item.findOne({ _id: machineId, companyId, productKind: { $in: ['Machine', 'Motor'] } });
  if (!item) return { error: { code: 404, message: 'Machine not found.' } };
  return { item };
}

// Resolves {item, bom}, 404ing "no BOM yet" — used by every line-CRUD/
// production-cost/lock/download endpoint, which all require a BOM to
// already exist (mirrors the OLD RDBOM's own createBOM-gated pattern).
async function resolveMachineBOMDoc(machineId, companyId) {
  const resolved = await resolveMachineItem(machineId, companyId);
  if (resolved.error) return resolved;
  const bom = await MachineBOM.findOne({ machine: resolved.item._id, company: companyId });
  if (!bom) return { error: { code: 404, message: 'No Machine BOM yet — create one first.' } };
  return { item: resolved.item, bom };
}

// Live-refreshes every non-discontinued childParts[] line from its own
// Child Part's current cost/weight (via childPartBOMController.js's
// refreshAndComputeChildPart — same helper that tab's own GET uses),
// saving only if something actually changed. A referenced Child Part that
// no longer resolves (deleted, or somehow lost its ChildPartBOM) is simply
// skipped, not an error — its last-known snapshot stays until fixed.
async function refreshMachineBOMChildParts(bom, companyId) {
  let changed = false;
  for (const line of bom.childParts) {
    if (line.isDiscontinued) continue;
    const cpResult = await refreshAndComputeChildPart(line.childPart, companyId);
    if (!cpResult) continue;
    const totalPrice = Math.round(cpResult.cost.totalCost * line.quantity * 100) / 100;
    const totalWeightKg = Math.round(cpResult.weight.totalWeightKg * line.quantity * 1000) / 1000;
    if (line.unitCost !== cpResult.cost.totalCost || line.totalPrice !== totalPrice
      || line.unitWeightKg !== cpResult.weight.totalWeightKg || line.totalWeightKg !== totalWeightKg) {
      line.unitCost = cpResult.cost.totalCost;
      line.totalPrice = totalPrice;
      line.unitWeightKg = cpResult.weight.totalWeightKg;
      line.totalWeightKg = totalWeightKg;
      changed = true;
    }
  }
  if (changed) await bom.save();
}

// GET /api/rd/machine-bom/:machineId — tolerates "no BOM yet" (bom: null),
// same as the OLD RDBOM's own getBOMForMachine, so the frontend's
// "Create BOM" gate can key off !data.bom exactly like BOMCreationTab.jsx.
export const getMachineBOM = async (req, res) => {
  try {
    const resolved = await resolveMachineItem(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item } = resolved;

    const bom = await MachineBOM.findOne({ machine: item._id, company: req.user.companyId });
    if (!bom) return res.json({ success: true, data: { item, bom: null, cost: null, weight: null } });

    await refreshMachineBOMChildParts(bom, req.user.companyId);
    const cost = await syncMachineBOMPricing(item, bom);
    const weight = computeMachineBOMWeight(bom);
    // Decorate each material/tool line's own weight onto the response —
    // never persisted (see materialLineWeightKg's own comment), purely for
    // the Materials/Tools tables' own Weight column to read directly.
    const plainBom = bom.toObject();
    plainBom.materials = (plainBom.materials || []).map(m => ({ ...m, weightKg: materialLineWeightKg(m) }));
    res.json({ success: true, data: { item, bom: plainBom, cost, weight } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/machine-bom — mirrors the OLD createBOM's exact validation
// (Machine must have a valid P-Source Type, or a Motor must be
// internalManufacturing) and the same "one BOM per machine" uniqueness.
export const createMachineBOM = async (req, res) => {
  try {
    const { machineId, variant } = req.body;
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });

    const item = await Item.findOne({ _id: machineId, companyId: req.user.companyId, productKind: { $in: ['Machine', 'Motor'] } });
    if (!item) return res.status(404).json({ success: false, message: 'Machine not found' });

    if (item.productKind === 'Machine') {
      const validSources = ['In House Manufacturing', 'Out Source Manufactured'];
      if (!validSources.includes(item.productSourceType)) {
        return res.status(400).json({
          success: false,
          message: `BOM creation blocked. P-Source Type must be In House or Out Source. Current: ${item.productSourceType}`,
        });
      }
    } else if (!item.internalManufacturing) {
      return res.status(400).json({ success: false, message: 'BOM creation blocked. This motor is marked Purchasable, not In House manufactured.' });
    }

    const existing = await MachineBOM.findOne({ machine: machineId, company: req.user.companyId });
    if (existing) return res.status(400).json({ success: false, message: 'A Machine BOM already exists for this machine.' });

    const bom = await MachineBOM.create({
      machine: machineId, variant: variant || 'Standard',
      company: req.user.companyId, createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Child Part line CRUD ────────────────────────────────────────────────

// POST /api/rd/machine-bom/:machineId/child-parts
export const addMachineBOMChildPart = async (req, res) => {
  try {
    const { childPartId, quantity } = req.body;
    if (!childPartId) return res.status(400).json({ success: false, message: 'childPartId is required.' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'quantity must be a positive number.' });

    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;

    const cpResult = await refreshAndComputeChildPart(childPartId, req.user.companyId);
    if (!cpResult) return res.status(404).json({ success: false, message: 'Child Part not found, or not a Child Part Master record (it may be from the old per-machine flow).' });

    const already = bom.childParts.find(l => String(l.childPart) === String(childPartId) && !l.isDiscontinued);
    if (already) return res.status(400).json({ success: false, message: `"${cpResult.item.name}" is already on this Machine — edit its quantity instead.` });

    const qty = Number(quantity);
    bom.childParts.push({
      childPart: cpResult.item._id, code: cpResult.item.code, name: cpResult.item.name,
      quantity: qty,
      unitCost: cpResult.cost.totalCost, totalPrice: Math.round(cpResult.cost.totalCost * qty * 100) / 100,
      unitWeightKg: cpResult.weight.totalWeightKg, totalWeightKg: Math.round(cpResult.weight.totalWeightKg * qty * 1000) / 1000,
    });
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.status(201).json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/child-parts/:lineId
export const updateMachineBOMChildPart = async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'quantity must be a positive number.' });

    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const line = bom.childParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Child Part line not found.' });

    const cpResult = await refreshAndComputeChildPart(line.childPart, req.user.companyId);
    const unitCost = cpResult ? cpResult.cost.totalCost : line.unitCost;
    const unitWeightKg = cpResult ? cpResult.weight.totalWeightKg : line.unitWeightKg;
    line.quantity = Number(quantity);
    line.unitCost = unitCost;
    line.totalPrice = Math.round(unitCost * line.quantity * 100) / 100;
    line.unitWeightKg = unitWeightKg;
    line.totalWeightKg = Math.round(unitWeightKg * line.quantity * 1000) / 1000;
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/machine-bom/:machineId/child-parts/:lineId
export const deleteMachineBOMChildPart = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const line = bom.childParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Child Part line not found.' });
    line.deleteOne();
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/child-parts/:lineId/discontinue
export const discontinueMachineBOMChildPart = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const line = bom.childParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Child Part line not found.' });
    line.isDiscontinued = true;
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/child-parts/:lineId/reactivate
export const reactivateMachineBOMChildPart = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const line = bom.childParts.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Child Part line not found.' });
    line.isDiscontinued = false;
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Material / Tool line CRUD ───────────────────────────────────────────
// Mirrors childPartBOMController.js's addChildPartMasterMaterial/
// updateChildPartMasterMaterial exactly (which itself mirrors
// rdController.js's addMaterial/updateMaterial) — same fabrication-weight
// branch, same materialKind derivation, same full Inventory snapshot — plus
// a cost-write-back sync after every change.

// POST /api/rd/machine-bom/:machineId/materials
export const addMachineBOMMaterial = async (req, res) => {
  try {
    const { code, item: itemName, itemType, quantity, unit, dimensionVariantId, amountValue, amountUnit } = req.body;
    if (!code || !itemName || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'code, item, quantity, and unit are required' });
    }

    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;

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
      code, item: itemName, itemType: itemType || '',
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
    const cost = await syncMachineBOMPricing(item, bom);
    res.status(201).json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/materials/:lineId
export const updateMachineBOMMaterial = async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
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
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/machine-bom/:machineId/materials/:lineId
export const deleteMachineBOMMaterial = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.deleteOne();
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/materials/:lineId/discontinue
export const discontinueMachineBOMMaterial = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = true;
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/materials/:lineId/reactivate
export const reactivateMachineBOMMaterial = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    const mat = bom.materials.id(req.params.lineId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = false;
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/production-cost
export const updateMachineBOMProductionCost = async (req, res) => {
  try {
    const { productionCost, productionExpense } = req.body;
    if (!(Number(productionCost) >= 0) || !(Number(productionExpense) >= 0)) {
      return res.status(400).json({ success: false, message: 'productionCost and productionExpense must be non-negative numbers.' });
    }
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    bom.productionCost = Number(productionCost);
    bom.productionExpense = Number(productionExpense);
    bom.productionCostSource = 'Manual';
    bom.productionCostUpdatedAt = new Date();
    await bom.save();
    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/process-definition — Category ->
// Internal Process pipeline for this Machine (see
// ProcessDefinitionSchema.js). materialRefs on an OutSource internal
// process must point at this same BOM's own materials[] line ids. No
// server-side isLocked check — matches every sibling edit endpoint on this
// controller (production-cost, materials, child-parts), which enforce the
// lock entirely client-side (MachineBOMTab.jsx's own isLocked gating).
export const updateMachineBOMProcessDefinition = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { bom } = resolved;

    const cleaned = cleanProcessDefinition(req.body.processDefinition);
    // Raw Materials/Tools and the Child Part reference lines are BOTH things
    // a step (In-House or Out Source, generalized 2026-09-23 — see
    // ProcessDefinitionSchema.js's own comment) can reference — passed
    // separately, not pre-unioned, since assemblyLineIds also drives the
    // one-consumption-per-sub-assembly pool check (validateProcessDefinition's
    // own comment). materialLineQuantities backs the material/tool
    // quantity-split cap (only checked for a line referenced by more than
    // one step).
    const materialLineIds = bom.materials.map(m => m._id);
    const assemblyLineIds = bom.childParts.map(l => l._id);
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

// ── PDF — Child Parts / Materials / Tools, one table each. The OLD
// writeBOMPdf's columns (childPart/subChildPart string tags per flat
// material row) don't apply to a reference-based BOM, so this is a fresh,
// simpler layout mirroring the 3-table UI directly, reusing the same
// PDFDocument/branding conventions.
function writeMachineBOMPdf(doc, bom, machine) {
  doc.fillColor('#1e293b').fontSize(22).font('Helvetica-Bold').text('SAMTEK MACHINERY', 50, 50);
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Master Bill of Materials', 50, 75);
  doc.moveTo(50, 92).lineTo(562, 92).strokeColor('#e2e8f0').lineWidth(1).stroke();

  doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(`Machine: ${machine.code || ''} — ${machine.name || ''}`, 50, 115);
  doc.fillColor('#334155').fontSize(9).font('Helvetica');
  doc.text(`Variant: ${bom.variant || 'Standard'}`, 50, 135);
  doc.text(`Version: ${bom.version || 'v1.0'}`, 50, 150);
  doc.text(`Status: ${bom.isLocked ? `Locked on ${bom.lockedAt || today()}` : 'Draft (not yet locked)'}`, 50, 165);
  doc.text(`Generated Date: ${new Date().toLocaleDateString()}`, 50, 180);

  let y = 215;
  const drawTable = (title, rows, columns) => {
    doc.fillColor('#1e3a8a').fontSize(11).font('Helvetica-Bold').text(title, 50, y);
    y += 20;
    const tableTop = y;
    const headerH = 22;
    doc.rect(50, tableTop, 512, headerH).fill('#f8fafc');
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
    columns.forEach(c => doc.text(c.label, c.x, tableTop + 7, { width: c.w, align: c.align || 'left' }));
    y = tableTop + headerH;
    if (rows.length === 0) {
      doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text('None added.', 60, y + 6);
      y += 24;
      return;
    }
    rows.forEach((row) => {
      if (y + 20 > 730) { doc.addPage(); y = 50; }
      doc.moveTo(50, y + 20).lineTo(562, y + 20).strokeColor('#f1f5f9').lineWidth(1).stroke();
      doc.fillColor(row.isDiscontinued ? '#dc2626' : '#334155').fontSize(8).font('Helvetica');
      columns.forEach(c => doc.text(String(c.value(row) ?? ''), c.x, y + 6, { width: c.w, align: c.align || 'left', ellipsis: true }));
      y += 20;
    });
    y += 15;
  };

  drawTable('Child Parts', (bom.childParts || []), [
    { label: 'Code', x: 58, w: 70, value: r => r.code },
    { label: 'Name', x: 130, w: 160, value: r => r.name },
    { label: 'Qty', x: 292, w: 40, align: 'center', value: r => r.quantity },
    { label: 'Unit Cost', x: 334, w: 80, align: 'right', value: r => `Rs. ${(r.unitCost || 0).toLocaleString()}` },
    { label: 'Total Cost', x: 416, w: 80, align: 'right', value: r => `Rs. ${(r.totalPrice || 0).toLocaleString()}` },
    { label: 'Status', x: 498, w: 60, align: 'right', value: r => r.isDiscontinued ? 'Discontinued' : 'Active' },
  ]);

  const rawMaterials = (bom.materials || []).filter(m => m.materialKind !== 'tool');
  const tools = (bom.materials || []).filter(m => m.materialKind === 'tool');
  const materialColumns = [
    { label: 'Code', x: 58, w: 70, value: r => r.code },
    { label: 'Name', x: 130, w: 160, value: r => r.item },
    { label: 'Qty', x: 292, w: 40, align: 'center', value: r => r.quantity },
    { label: 'Unit', x: 334, w: 50, value: r => r.unit },
    { label: 'Price', x: 386, w: 110, align: 'right', value: r => `Rs. ${(r.totalPrice || 0).toLocaleString()}` },
    { label: 'Status', x: 498, w: 60, align: 'right', value: r => r.isDiscontinued ? 'Discontinued' : 'Active' },
  ];
  drawTable('Materials', rawMaterials, materialColumns);
  drawTable('Tools', tools, materialColumns);
}

// GET /api/rd/machine-bom/:machineId/download — on-demand PDF, no disk save.
export const downloadMachineBOMPdf = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=MachineBOM_${item.code || 'machine'}_${bom.version || 'v1.0'}.pdf`);
    doc.pipe(res);
    writeMachineBOMPdf(doc, bom, item);
    doc.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/machine-bom/:machineId/lock — same disk-write + auto-RDDocument
// + isLocked/lockedAt mechanics as the OLD lockBOM, no Sheet-Metal-plan-
// required gate (confirmed no Sheet Metal concept remains at Machine level
// once Child Parts are referenced — sheet metal is a Sub Child Part concern
// end-to-end now).
export const lockMachineBOM = async (req, res) => {
  try {
    const resolved = await resolveMachineBOMDoc(req.params.machineId, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, bom } = resolved;
    if (bom.isLocked) return res.status(400).json({ success: false, message: 'Machine BOM is already locked' });

    const filename = `MachineBOM_${item.code}_${Date.now()}.pdf`;
    const filepath = path.join(process.cwd(), 'uploads', 'rd-docs', filename);

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    writeMachineBOMPdf(doc, bom, item);
    doc.end();

    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    await RDDocument.create({
      machine: item._id, machineCode: item.code, machineName: item.name,
      name: `Auto-Generated BOM (${bom.version})`, type: 'BOM', version: bom.version,
      size: '0.1 MB', fileUrl: `/uploads/rd-docs/${filename}`, originalName: filename,
      notes: 'Automatically generated and uploaded by system upon Machine BOM Lock.',
      uploadedBy: 'System Automation', uploadedAt: today(),
      company: req.user.companyId, createdBy: req.user._id,
    });

    bom.isLocked = true;
    bom.lockedAt = today();
    await bom.save();

    const cost = await syncMachineBOMPricing(item, bom);
    res.json({ success: true, data: { bom, cost }, message: 'Machine BOM locked and PDF generated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
