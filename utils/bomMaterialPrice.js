// A Child Part / Machine BOM material or tool line's price, from its raw
// material's CURRENT price (outsource v2 slice 4, 2026-10-24). Same math the
// line add / edit endpoints use (childPartBOMController / machineBOMController):
// a fabrication line is its own weight per piece × the item's ₹/kg; anything
// else is the item's purchase cost. Before this, the completion refresh
// (recalculateChildPartCost) priced every line at purchaseCost — wrong for a
// fabrication line.
import { Item } from '../models/Inventory.js';
import { resolveFabricationWeight } from '../services/fabricationDemandService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function materialLineUnitPrice(line, rawItem) {
  if (!rawItem) return null;
  if (line.fabricationCategory && line.computedWeightPerPieceKg != null) {
    return round2(Number(line.computedWeightPerPieceKg) * (Number(rawItem.weightUnitPrice) || 0));
  }
  return Number(rawItem.purchaseCost) || 0;
}

// Re-prices every live material / tool line on a BOM document (mutates it).
// A raw material with no price yet (≤ 0) leaves the line as it was — never
// zeroed. Returns true when a line changed (the caller saves).
// A fabrication line's weight per piece is re-worked first, from its own cut
// size at the item's CURRENT density — a Fabrication Master density /
// material change moves weight and price together (2026-10-28,
// docs/fabrication-size-sync-2026-10.md §6).
export async function refreshBomMaterialLines(bom, companyId) {
  let changed = false;
  for (const m of bom.materials || []) {
    if (m.isDiscontinued || !m.code) continue;
    const raw = await Item.findOne({ companyId, productKind: null, code: m.code }).select('purchaseCost weightUnitPrice stdCost fabricationRef dimensionVariants').lean();
    if (raw?.fabricationRef && m.fabricationCategory && m.bomDimensions && Object.keys(m.bomDimensions).length) {
      const w = (await resolveFabricationWeight(raw, m.bomDimensions, m.bomDimensions.designation))?.weightPerPieceKg;
      if (w > 0 && Math.abs(w - (Number(m.computedWeightPerPieceKg) || 0)) > 1e-9) {
        m.computedWeightPerPieceKg = w;
        changed = true;
      }
    }
    const unitPrice = materialLineUnitPrice(m, raw);
    if (!(unitPrice > 0)) continue;
    const totalPrice = round2(unitPrice * (Number(m.quantity) || 0));
    if (m.unitPrice !== unitPrice || m.totalPrice !== totalPrice) {
      m.unitPrice = unitPrice;
      m.totalPrice = totalPrice;
      m.stdCost = raw.stdCost ?? null;
      changed = true;
    }
  }
  return changed;
}
