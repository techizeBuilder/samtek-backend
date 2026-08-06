import { Item } from '../models/Inventory.js';
import RDBOM from '../models/RDBOM.js';
import ProductionOrder from '../models/ProductionOrder.js';
import ItemLeadTimeStats from '../models/ItemLeadTimeStats.js';

// Store's own triage (checking an order, deciding stock/purchase/production)
// is treated as a flat buffer, not its own tracked average — see the design
// discussion: it's a quick administrative step, not a real bottleneck, so a
// constant is one line instead of a whole second timing pipeline.
const STORE_BUFFER_DAYS = 1;

// Used only when an item has never completed a full Production/Purchase
// cycle yet, so there's no real average to lean on. Clearly flagged to the
// caller via `hasHistory: false` — the frontend must disclaim this as a
// rough default, not a measured number.
const DEFAULT_LEAD_DAYS_FALLBACK = 7;

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + Math.ceil(days));
  return d;
};

const round1 = (n) => Math.round(n * 10) / 10;

// Each breakdown row is rounded independently for readability (round1), but
// the displayed total is the CEILING of the raw sum (a delivery date can't
// be fractional). Those two roundings can disagree — e.g. a 4.004-day
// average displays as "4d" on its own row, but 1 (Store) + 4.004 (Vendor)
// ceils to 6, not 5, so the rows would visually read "1 + 4 = 5" right next
// to a "Total: 6d" that doesn't match. Fixed by having the LAST row absorb
// whatever rounding slack is needed so the rows always sum to exactly the
// displayed total, by construction.
function finalizeBreakdown(breakdown, totalDays) {
  const ceiledTotal = Math.ceil(totalDays);
  const rows = breakdown.map(b => ({ ...b, days: round1(b.days) }));
  if (rows.length > 0) {
    const sumOthers = rows.slice(0, -1).reduce((s, b) => s + b.days, 0);
    rows[rows.length - 1].days = round1(ceiledTotal - sumOthers);
  }
  return rows;
}

// GET /api/delivery-estimate/items?search=
// Cheap, lightweight list for the search panel — current stock + whichever
// average already exists (if any). No BOM traversal, no queue counting:
// that per-item calculation only happens in predictItems below, once Sales
// has actually picked item(s) and a quantity.
//
// Paginated (Load More): fetches PAGE_SIZE+1 rows and slices to PAGE_SIZE to
// know whether there's another page, instead of a separate countDocuments()
// call on every request.
const PAGE_SIZE = 50;

export const listEstimableItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search = '' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const query = { companyId, type: 'Product' };
    if (search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { code: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const rows = await Item.find(query)
      .select('code name qty internalManufacturing unit')
      .sort({ name: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE + 1)
      .lean();

    const hasMore = rows.length > PAGE_SIZE;
    const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    if (!items.length) return res.json({ success: true, data: [], hasMore: false, page });

    const codes = items.map(i => i.code);
    const stats = await ItemLeadTimeStats.find({
      company: companyId,
      itemCode: { $in: codes },
    }).select('itemCode pathType avgLeadDays sampleCount').lean();
    const statsByCode = new Map(stats.map(s => [s.itemCode, s]));

    const data = items.map(it => {
      const stat = statsByCode.get(it.code);
      return {
        code: it.code,
        name: it.name,
        qty: it.qty || 0,
        unit: it.unit || '',
        path: it.internalManufacturing ? 'Production' : 'Purchase',
        avgLeadDays: stat ? round1(stat.avgLeadDays) : null,
        sampleCount: stat?.sampleCount || 0,
      };
    });

    res.json({ success: true, data, hasMore, page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Core per-item prediction. See the design breakdown: finished-stock
// short-circuit, then Purchase path or Production path (with BOM material
// shortage folded in via max(), not sum, against the production queue).
async function predictOneItem(companyId, itemCode, quantity) {
  const item = await Item.findOne({ code: itemCode, companyId }).lean();
  if (!item) {
    return { itemCode, error: 'Item not found' };
  }

  const today = new Date();
  const breakdown = [{ label: 'Store processing', days: STORE_BUFFER_DAYS }];
  const availableStock = item.qty || 0;
  const shortfall = Math.max(0, quantity - availableStock);

  // 1. Already enough in finished stock — ready almost immediately.
  if (shortfall === 0) {
    const totalDays = STORE_BUFFER_DAYS;
    return {
      itemCode, itemName: item.name, quantityRequested: quantity,
      availableStock, shortfall: 0, path: 'In Stock', hasHistory: true,
      // Displayed total must match the actual date shown — addDays() rounds
      // UP to the next whole day (a delivery date can't be fractional), so
      // the displayed number has to use the same Math.ceil, not round1's
      // round-to-nearest-0.1 (which could show "~5 days" next to a date
      // that's actually 6 days out).
      breakdown: finalizeBreakdown(breakdown, totalDays), totalDays: Math.ceil(totalDays), predictedDate: addDays(today, totalDays),
    };
  }

  // 2. Bought from a vendor and resold as-is — no BOM, no production queue.
  if (!item.internalManufacturing) {
    const stats = await ItemLeadTimeStats.findOne({ company: companyId, itemCode, pathType: 'Purchase' }).lean();
    const hasHistory = !!stats;
    const avgDays = hasHistory ? stats.avgLeadDays : DEFAULT_LEAD_DAYS_FALLBACK;
    breakdown.push({ label: hasHistory ? 'Vendor purchase (avg)' : 'Vendor purchase (no history yet — default estimate)', days: avgDays });
    const totalDays = STORE_BUFFER_DAYS + avgDays;
    return {
      itemCode, itemName: item.name, quantityRequested: quantity,
      availableStock, shortfall, path: 'Purchase', hasHistory,
      breakdown: finalizeBreakdown(breakdown, totalDays), totalDays: Math.ceil(totalDays), predictedDate: addDays(today, totalDays),
    };
  }

  // 3. Manufactured in-house — check raw material availability (BOM) and
  // the production queue; the item can't start until BOTH the queue clears
  // AND materials are on hand, and those happen at the same time, not one
  // after another, so we take the max of the two, not the sum.
  let materialDelayDays = 0;
  const shortMaterials = [];

  const rdMachine = await Item.findOne({ code: itemCode, companyId, productKind: 'Machine' }).select('_id').lean();
  if (rdMachine) {
    const bom = await RDBOM.findOne({ machine: rdMachine._id, company: companyId }).select('materials').lean();
    const materials = (bom?.materials || []).filter(m => !m.isDiscontinued);
    if (materials.length) {
      const materialCodes = [...new Set(materials.map(m => m.code))];
      const [materialItems, materialStats] = await Promise.all([
        Item.find({ code: { $in: materialCodes }, companyId }).select('code qty').lean(),
        ItemLeadTimeStats.find({ company: companyId, itemCode: { $in: materialCodes }, pathType: 'Purchase' }).lean(),
      ]);
      const stockByCode = new Map(materialItems.map(m => [m.code, m.qty || 0]));
      const avgByCode = new Map(materialStats.map(s => [s.itemCode, s.avgLeadDays]));

      for (const mat of materials) {
        const neededQty = (mat.quantity || 0) * shortfall;
        const availableQty = stockByCode.get(mat.code) || 0;
        if (availableQty < neededQty) {
          const matAvg = avgByCode.has(mat.code) ? avgByCode.get(mat.code) : DEFAULT_LEAD_DAYS_FALLBACK;
          shortMaterials.push({
            code: mat.code, name: mat.item, needed: neededQty, available: availableQty,
            avgPurchaseDays: round1(matAvg),
          });
          materialDelayDays = Math.max(materialDelayDays, matAvg);
        }
      }
    }
  }

  // Production capacity is shared across machine types, not siloed per
  // machine — an order for a completely different machine still occupies
  // real production time ahead of this one. So the queue is every NOT-YET-
  // FINISHED order company-wide (Pending, BOM Pending, In Progress, AND On
  // Hold — anything that isn't Completed is still real unfinished workload
  // standing between now and when a new order could start; excluding
  // In Progress specifically would have under-counted work that's actively
  // happening right now), and each contributes its OWN item's average build
  // time (not this item's, and not prorated for partial progress — treated
  // the same flat way regardless of status), summed into a total "how much
  // work is sitting ahead of me" figure. No attempt to model parallel teams
  // — production is treated as working through this total sequentially,
  // which is the simplification we deliberately chose.
  const pendingOrders = await ProductionOrder.find({
    company: companyId,
    status: { $ne: 'Completed' },
  }).select('machineCode orderQuantity').lean();

  const queueCount = pendingOrders.length;
  let queueWaitDays = 0;
  if (queueCount > 0) {
    const pendingCodes = [...new Set(pendingOrders.map(o => o.machineCode))];
    const pendingStats = await ItemLeadTimeStats.find({
      company: companyId,
      itemCode: { $in: pendingCodes },
      pathType: 'Production',
    }).select('itemCode avgLeadDays').lean();
    const pendingAvgByCode = new Map(pendingStats.map(s => [s.itemCode, s.avgLeadDays]));

    // avgLeadDays is a genuine PER-UNIT figure (see productionMfgController's
    // completion hook, which records one sample per physical unit) — so a
    // pending order ahead of us contributes avg × its own orderQuantity, not
    // just avg once, since a 3-unit order ahead represents 3 units of work.
    queueWaitDays = pendingOrders.reduce((sum, o) => {
      const avg = pendingAvgByCode.has(o.machineCode) ? pendingAvgByCode.get(o.machineCode) : DEFAULT_LEAD_DAYS_FALLBACK;
      return sum + avg * Math.max(1, Number(o.orderQuantity) || 1);
    }, 0);
  }

  const prodStats = await ItemLeadTimeStats.findOne({ company: companyId, itemCode, pathType: 'Production' }).lean();
  const hasHistory = !!prodStats;
  const avgProductionDaysPerUnit = hasHistory ? prodStats.avgLeadDays : DEFAULT_LEAD_DAYS_FALLBACK;
  // Same per-unit reasoning applies to the new order itself — building
  // `shortfall` units takes roughly shortfall × the per-unit average, not a
  // flat single-unit amount regardless of how many are actually needed.
  const productionTimeDays = avgProductionDaysPerUnit * shortfall;

  const startDelay = Math.max(queueWaitDays, materialDelayDays);
  if (materialDelayDays > queueWaitDays) {
    breakdown.push({
      label: `Raw material purchase — ${shortMaterials.length} material${shortMaterials.length > 1 ? 's' : ''} short (longest wait wins)`,
      days: materialDelayDays,
    });
  } else if (queueWaitDays > 0) {
    breakdown.push({ label: `Production queue — ${queueCount} order${queueCount === 1 ? '' : 's'} ahead of this one`, days: queueWaitDays });
  }
  breakdown.push({
    label: hasHistory
      ? `Production time (avg ${round1(avgProductionDaysPerUnit)}d/unit × ${shortfall})`
      : `Production time (no history yet — default ${DEFAULT_LEAD_DAYS_FALLBACK}d/unit × ${shortfall})`,
    days: productionTimeDays,
  });

  const totalDays = STORE_BUFFER_DAYS + startDelay + productionTimeDays;

  return {
    itemCode, itemName: item.name, quantityRequested: quantity,
    availableStock, shortfall, path: 'Production', hasHistory,
    queueCount, materialDelayDays: round1(materialDelayDays), shortMaterials,
    breakdown: finalizeBreakdown(breakdown, totalDays), totalDays: Math.ceil(totalDays), predictedDate: addDays(today, totalDays),
  };
}

const DISCLAIMER = 'This is an estimate based on current stock, current production/purchase queues, and historical average times — not a guaranteed date. '
  + 'Actual delivery can vary with material availability, vendor performance, and production priority changes.';

// POST /api/delivery-estimate/predict  { items: [{ itemCode, quantity }] }
// Order-level date = the latest of every selected item's own predicted
// date, since the whole order dispatches together (same rule enforced
// throughout Dispatch Planning/Execution this session).
export const predictItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required' });
    }

    const results = await Promise.all(
      items.map(it => predictOneItem(companyId, it.itemCode, Number(it.quantity) || 1))
    );

    const valid = results.filter(r => !r.error);
    const combinedDate = valid.length
      ? new Date(Math.max(...valid.map(r => new Date(r.predictedDate).getTime())))
      : null;
    const combinedTotalDays = valid.length ? Math.max(...valid.map(r => r.totalDays)) : null;

    res.json({
      success: true,
      data: {
        items: results,
        combinedDate,
        combinedTotalDays,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
