// Step material — what ONE unit of a Child Part / Machine order needs for one
// step, per BOM line, keyed and counted the way the order's own Material List
// keys and counts its rows (childPartReorderService.computeSubChildPartMaterialRows
// / machineReorderService.computeMachineMaterialRows):
//   - a plain raw / assembly / consumable line → its code, in its own unit
//   - a Sub Child Part / Child Part reference → its code, in pieces
//   - a sheet-metal line → `${code}#${variantId}#${cut signature}`, in sheets
//     (the cut's area ÷ one catalog sheet's area)
//   - a length line → `${code}#${variantId}#${first line's cut signature}`,
//     in BOM cut pieces (Store cuts them to size)
//
// Shared by the per-step material check (productionMfgController's
// resolveStepMaterialLines) and the outsource material plan
// (outsourceMaterialPlanService.js), so both read a step's material the same
// way (outsource-v2 slice 5, 2026-10-20). Before this, the step check looked
// fabrication lines up by their plain code — which never matched the list's
// composite key — and ignored a step's own quantity split (materialQuantities).
import { Item } from '../models/Inventory.js';
import { findSubChildPartMaterialLines } from './childPartReorderService.js';
import { findMachineMaterialLines } from './machineReorderService.js';
import { sheetAreaFromItem } from '../controllers/sheetMetalPlanController.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';

// The order's BOM lines ({ materials, materialLines, ... }), or null for a
// Sub Child Part order (its one source material isn't a BOM line) / no BOM.
export async function bomLinesForOrder(order, companyId) {
  if (order.orderKind === 'ChildPart') return findSubChildPartMaterialLines(order.subChildPartItem, companyId);
  if (order.orderKind === 'SubChildPart') return null;
  const mfgItem = await Item.findOne({ $or: [{ code: order.machineCode }, { name: order.machineName }], companyId }).lean();
  return mfgItem ? findMachineMaterialLines(mfgItem._id, companyId) : null;
}

const isLengthLine = (m) => {
  if (m.isSheetMetal || !m.fabricationCategory || !m.dimensionVariantId) return false;
  const category = getCategoryByKey(m.fabricationCategory);
  return !!category && category.calcType !== 'sheet';
};

// One step's material, per unit. `found` = bomLinesForOrder(...). Returns
// rows: { bomLineId, lineKind, kind, demandKey, code, name, unit, itemId,
//   variantId, perUnit (in the row's own measure), perUnitDu (in the
//   Material List's unit), pieceSize (mm² of one sheet, for 'sheetArea'),
//   demandUnit }.
// kind: 'parts' | 'plain' | 'sheetArea' | 'cutPieces'. A line that can't be
// resolved (a sheet whose size has no area, an Item that's gone) is skipped.
export async function stepMaterialPerUnit(proc, found, companyId) {
  const refs = (proc?.materialRefs || []).map(String);
  if (!refs.length || !found) return [];
  const split = new Map((proc.materialQuantities || []).map(q => [String(q.ref), Number(q.qty) || 0]));
  const itemCache = new Map();
  const itemByCode = async (code) => {
    if (!itemCache.has(code)) itemCache.set(code, await Item.findOne({ code, companyId }).lean());
    return itemCache.get(code);
  };

  const rows = [];
  for (const line of found.materials) {
    const id = String(line._id);
    if (!refs.includes(id)) continue;
    const qty = split.has(id) ? split.get(id) : (Number(line.quantity) || 0);
    if (!(qty > 0)) continue;

    if (line.lineKind === 'SubChildPart' || line.lineKind === 'ChildPart') {
      rows.push({
        bomLineId: id, lineKind: line.lineKind, kind: 'parts', demandKey: line.code, code: line.code,
        name: line.name || line.item, unit: 'Pieces', demandUnit: 'Pieces',
        itemId: line.subChildPart || line.childPart || null, variantId: null,
        perUnit: qty, perUnitDu: qty, pieceSize: null,
      });
      continue;
    }

    const item = await itemByCode(line.code);
    if (line.isSheetMetal && line.dimensionVariantId) {
      const areaPerPiece = Number(line.bomDimensions?.area) || 0;
      const sheet = item ? sheetAreaFromItem(item, line.dimensionVariantId) : null;
      if (!areaPerPiece || !sheet?.areaMm2) continue;
      const perUnit = areaPerPiece * qty;
      rows.push({
        bomLineId: id, lineKind: 'Material', kind: 'sheetArea',
        demandKey: `${line.code}#${line.dimensionVariantId}#${dimensionSignature(line.bomDimensions)}`,
        code: line.code, name: line.item, unit: 'mm²', demandUnit: 'sheet(s)',
        itemId: item?._id || null, variantId: String(line.dimensionVariantId),
        perUnit, perUnitDu: perUnit / sheet.areaMm2, pieceSize: sheet.areaMm2,
      });
      continue;
    }

    if (isLengthLine(line)) {
      // Keyed / counted by the group's first line, exactly as the Material
      // List builds its Length Fabrication row.
      const sample = found.materialLines.find(m => m.code === line.code && String(m.dimensionVariantId) === String(line.dimensionVariantId)) || line;
      const sampleLen = Number(sample.bomDimensions?.length) || 0;
      const lineLen = Number(line.bomDimensions?.length) || 0;
      if (!sampleLen || !lineLen) continue;
      const cuts = (lineLen * qty) / sampleLen;
      rows.push({
        bomLineId: id, lineKind: 'Material', kind: 'cutPieces',
        demandKey: `${line.code}#${line.dimensionVariantId}#${dimensionSignature(sample.bomDimensions)}`,
        code: line.code, name: line.item, unit: 'piece(s)', demandUnit: 'piece(s)',
        itemId: item?._id || null, variantId: String(line.dimensionVariantId),
        // pieceSize = one cut's length (mm) — Store's capacity check (slice 6).
        perUnit: cuts, perUnitDu: cuts, pieceSize: sampleLen,
      });
      continue;
    }

    rows.push({
      bomLineId: id, lineKind: 'Material', kind: 'plain', demandKey: line.code,
      code: line.code, name: line.item, unit: line.unit || 'Pieces', demandUnit: line.unit || 'Pieces',
      itemId: item?._id || null, variantId: null,
      perUnit: qty, perUnitDu: qty, pieceSize: null,
    });
  }
  return rows;
}

// What Production holds of one Material List line for its order, in the
// list's unit: received or on its way from Store (M4), less what's used and
// what's waiting to go back.
export function heldByProduction(demand) {
  if (!demand) return 0;
  return Math.max(0, (Number(demand.transferredQuantity) || 0) - (Number(demand.consumedQuantity) || 0) - (Number(demand.returnPendingQuantity) || 0));
}

// ── What's used, and what can go back (2026-11-03) ──
// docs/serial number work/material-list-used-and-return-logic-2026-11.md
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Where one step's material stands, or null when the step hasn't taken it yet.
function stepMaterialState(proc) {
  if (proc.type === 'Outsourcing') {
    if (proc.outsourceStatus === 'Received' || proc.status === 'Completed') return 'used';
    return proc.outsourceStatus === 'Sent' ? 'withVendor' : null;
  }
  if (proc.status === 'In Progress') return 'running';
  return proc.status === 'QC Pending' || proc.status === 'Completed' ? 'used' : null;
}

// Per Material List line (demandKey), across every unit, in the list's unit:
//   used — taken by a step that's running or finished
//   running — of that, on an in-house step still In Progress
//   withVendor — at a vendor on a step not back yet
// Empty for a Sub Child Part order (no BOM lines, no per-step usage).
export async function lineUsage(order, companyId) {
  const usage = new Map();
  const found = await bomLinesForOrder(order, companyId);
  if (!found) return usage;
  const units = [order.processes || [], ...(order.extraUnits || []).map(u => u.processes || [])];
  const linesByStep = new Map();
  for (const procs of units) {
    for (const proc of procs) {
      const state = stepMaterialState(proc);
      if (!state || !proc.materialRefs?.length) continue;
      const stepKey = JSON.stringify([proc.materialRefs, proc.materialQuantities || []]);
      if (!linesByStep.has(stepKey)) linesByStep.set(stepKey, await stepMaterialPerUnit(proc, found, companyId));
      for (const l of linesByStep.get(stepKey)) {
        const e = usage.get(l.demandKey) || { used: 0, running: 0, withVendor: 0 };
        if (state === 'withVendor') e.withVendor = r4(e.withVendor + l.perUnitDu);
        else e.used = r4(e.used + l.perUnitDu);
        if (state === 'running') e.running = r4(e.running + l.perUnitDu);
        usage.set(l.demandKey, e);
      }
    }
  }
  return usage;
}

// The most of one line that can go back to Store. Used material can't go back
// as Excess; it can as Defect only while its in-house step is running. A
// whole-piece fabrication line (cut on the floor) returns its measured offcut
// after use, so it isn't limited.
export function returnLimits(demand, running = 0) {
  const held = Math.max(0, (Number(demand?.issuedQuantity) || 0) - (Number(demand?.returnPendingQuantity) || 0));
  const isOffcutLine = !!demand?.fabricationCategory && (!demand.bomDimensions || !Object.keys(demand.bomDimensions).length);
  if (isOffcutLine) return { excess: r4(held), defect: r4(held) };
  const excess = Math.max(0, held - (Number(demand?.consumedQuantity) || 0));
  return { excess: r4(excess), defect: r4(Math.min(held, excess + (Number(running) || 0))) };
}

// Adds usage + returnable to each row of a built Material List. Called by the
// list's controller: the list services can't import this file (import cycle).
export async function addUsageToList(order, companyId, categories) {
  const usage = await lineUsage(order, companyId);
  const demandByKey = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
  for (const cat of categories) {
    for (const row of cat.materials) {
      const u = usage.get(row.demandKey) || { used: 0, running: 0, withVendor: 0 };
      row.usage = { used: u.used, withVendor: u.withVendor };
      row.returnable = returnLimits(demandByKey.get(row.demandKey), u.running);
    }
  }
  return categories;
}
