// Fabrication Master → inventory item sync (2026-10-28 —
// docs/fabrication-size-sync-2026-10.md §3). Before this, a Fabrication
// Master save changed nothing on the item; R&D's "Change" button re-copied
// the catalog by matching numbers, so an edited size became a second size at
// stock 0 next to the old one.
//
// Sizes are matched by their numbers (dimensionSignature) — the same
// identity the purchase side uses. Only sizes R&D removed IN THIS SAVE (in the
// catalog before, not after) leave the item, and only when nothing uses them
// (fabricationSizeUsage). Item sizes already out of step with the catalog
// (from before the sync) and leftovers are left alone. The item's code never
// changes here — it's locked once an item exists.
import { Item } from '../models/Inventory.js';
import { dimensionSignature, formatDims } from './fabricationDemandService.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';
import { sizeUsage } from './fabricationSizeUsage.js';

const sigOf = (d) => dimensionSignature(d?.values);
const isCatalogSize = (v) => !v.isLeftover;

export const linkedItems = (fm, companyId) => Item.find({ companyId, fabricationRef: fm._id });

// Sizes in the catalog before the save and not after.
function removedSigs(oldDims, newDims) {
  const now = new Set((newDims || []).map(sigOf));
  return new Set((oldDims || []).map(sigOf).filter(s => !now.has(s)));
}

// Every removed size that's still in use, per linked item: [{ item, size, reasons }].
// Empty = the save may go ahead.
export async function blockedRemovals(fm, newDims, companyId) {
  const gone = removedSigs(fm.dimensions, newDims);
  if (!gone.size) return [];
  const blocked = [];
  for (const item of await linkedItems(fm, companyId).lean()) {
    for (const v of (item.dimensionVariants || []).filter(isCatalogSize)) {
      if (!gone.has(sigOf(v))) continue;
      const reasons = await sizeUsage(item, v);
      if (reasons.length) blocked.push({ item: item.code, size: v.designation || formatDims(v.values), reasons });
    }
  }
  return blocked;
}

// Applies the saved catalog entry to its inventory item(s). oldDims: the
// catalog's sizes before this save. Returns what changed; runs the price push
// when a weight changed.
export async function syncLinkedItems(fm, oldDims, companyId) {
  const gone = removedSigs(oldDims, fm.dimensions);
  const summary = [];
  for (const item of await linkedItems(fm, companyId)) {
    const s = { item: item.code, updated: 0, added: 0, removed: 0, weightChanged: false };
    const fresh = new Map((fm.dimensions || []).map(d => [sigOf(d), d]));
    const density = { value: fm.density?.value ?? null, unit: fm.density?.unit || 'kg/m3' };
    const flowFrom = item.dimensionVariants.find(isCatalogSize) || {};

    // Same numbers → refresh in place (same id, same stock).
    const onItem = new Set();
    for (const v of item.dimensionVariants) {
      if (!isCatalogSize(v)) continue;
      const sig = sigOf(v);
      const d = fresh.get(sig);
      if (!d) continue;
      onItem.add(sig);
      if (Math.abs((Number(v.weightPerPieceKg) || 0) - (Number(d.weightPerPieceKg) || 0)) > 1e-9) s.weightChanged = true;
      Object.assign(v, {
        category: fm.category, designation: d.designation || '',
        densityValue: density.value, densityUnit: density.unit,
        weightPerMeterKg: d.weightPerMeterKg ?? null, weightPerPieceKg: d.weightPerPieceKg ?? null,
        isDiscontinued: !!d.isDiscontinued,
      });
      s.updated++;
    }

    // Leftovers are the same material: a density change re-works their weight.
    for (const v of item.dimensionVariants) {
      if (isCatalogSize(v) || v.densityValue === density.value && v.densityUnit === density.unit) continue;
      let w = null;
      try { w = calculateFabricationWeight(v.category || fm.category, v.values || {}, density.value, density.unit, v.designation); } catch { /* odd cut shape — keep its weight */ }
      Object.assign(v, { densityValue: density.value, densityUnit: density.unit });
      if (w?.weightPerPieceKg > 0) Object.assign(v, { weightPerMeterKg: w.weightPerMeterKg ?? null, weightPerPieceKg: w.weightPerPieceKg });
      s.weightChanged = true;
    }

    // Removed in this save (already checked unused) → off the item.
    const keep = item.dimensionVariants.filter(v => !(isCatalogSize(v) && gone.has(sigOf(v)) && !fresh.has(sigOf(v))));
    s.removed = item.dimensionVariants.length - keep.length;
    if (s.removed) item.dimensionVariants = keep;

    // New sizes → added at stock 0; reorder settings as the item's others
    // (entered once for every size — SimpleInventoryForm's field 17).
    for (const [sig, d] of fresh) {
      if (onItem.has(sig)) continue;
      item.dimensionVariants.push({
        category: fm.category, values: d.values || {}, designation: d.designation || '',
        densityValue: density.value, densityUnit: density.unit,
        weightPerMeterKg: d.weightPerMeterKg ?? null, weightPerPieceKg: d.weightPerPieceKg ?? null,
        subStock: 0, isLeftover: false, isDiscontinued: !!d.isDiscontinued,
        materialFlow: flowFrom.materialFlow || '', minStock: Number(flowFrom.minStock) || 0, reorderQty: Number(flowFrom.reorderQty) || 0,
      });
      s.added++;
    }

    // Item-level fields that flow (never the code).
    item.name = fm.itemName || item.name;
    item.materialGrade = fm.material || item.materialGrade;
    item.isSheetMetal = !!fm.isSheetMetal;
    if (fm.purchaseUnitType) item.purchaseUnitType = fm.purchaseUnitType;
    if (fm.purchaseUnit) item.purchaseUnit = fm.purchaseUnit;
    if (fm.usedUnitType) item.unitType = fm.usedUnitType;
    if (fm.usedUnit) item.unit = fm.usedUnit;
    if (fm.receiveUnitType) item.receiveUnitType = fm.receiveUnitType;
    if (fm.receiveUnit) item.receiveUnit = fm.receiveUnit;

    item.markModified('dimensionVariants');
    await item.save();
    if (s.weightChanged) {
      const { onRawMaterialChanged } = await import('./priceCascadeService.js');
      await onRawMaterialChanged(item);
    }
    summary.push(s);
  }
  return summary;
}
