// Child Part — Low Stock Auto-Production sweep + material list/cascade.
//
// Replaces server/services/subChildPartReorderService.js (deleted 2026-09-16
// in the same pass that created this file). That file was named for the OLD
// hierarchy labels — it's actually for what's called Child Part today, not
// Sub Child Part — and walked the OLD RDChildPart/RDBOM tree, a holdover
// never migrated when the hierarchy was renamed. This is a FULL CUTOVER, not
// a new file coexisting alongside a frozen old one (unlike every BOM/catalog
// level below this, which deliberately keeps its old flow running forever,
// badged apart from the new one — see ChildPartBOM.js's own header comment
// for that convention). Confirmed safe with the real database before this
// rewrite: zero orderKind:'ChildPart' ProductionOrders existed (open or
// closed) and the one live productKind:'ChildPart' Item already had a
// ChildPartBOM — nothing in-flight, nothing un-migrated, so there was
// nothing to preserve a parallel path for.
//
// Every exported function name is kept IDENTICAL to the old file on purpose
// (only the cron entrypoint itself is renamed, runSubChildPartReorderSweep ->
// runChildPartReorderSweep) — every consumer (productionMfgController.js,
// index.js's cron registration) needs only its import path updated, and the
// frontend (ProcessExecution.jsx's Material List card, OrderManagement.jsx's
// Child Part tab) needs ZERO changes: it already calls these same routes
// unconditionally for orderKind:'ChildPart', and the material table renders
// whatever categories come back with no hardcoded category list.
//
// New in this rewrite: a Child Part's material list now includes its Sub
// Child Part reference lines (ChildPartBOM.subChildParts[]) as their own
// category, not just its direct materials — and a shortfall in a Sub Child
// Part reference now cascades into raising a real Sub Child Part order
// (createSubChildPartOrderForItem, subChildPartOrderService.js) instead of
// just a Purchase Request. That cascade order's own creation already
// re-checks ITS raw material and raises a Purchase Request if that's short —
// nothing extra needed here for that second tier, it happens for free.
//
// Update (2026-09-24): the "process section" this file originally deferred
// is built — every order now gets a real processes[] pipeline from its own
// Process Definition (processStepBuilderService.js). The per-unit
// Fabrication-consumption helpers that used to live below
// (getSubChildPartFabricationConsumables/Shortfall/Status,
// commitSubChildPartUnitConsumption — hardcoded to one legacy step name,
// "every non-Job-Work BOM row") were removed once that generalized: see
// productionMfgController.js's resolveStepMaterialLines/
// commitStepMaterialConsumption instead, which does the same job per any
// step's own materialRefs. getSubChildPartJobWorkRows and everything else
// below is unaffected — still a pure function of
// computeSubChildPartMaterialRows.
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import ProductionOrder, { buildProcessSteps } from '../models/ProductionOrder.js';
import User from '../models/User.js';
import { generateOrderId } from '../controllers/productionMfgController.js';
import { sheetAreaFromItem } from '../controllers/sheetMetalPlanController.js';
import { plainMaterialGroupsFromBOM, lengthFabricationGroupsFromBOM, sheetMetalCutGroupsFromBOM } from './bomMaterialGroupsService.js';
import { raisePlainPurchaseRequest, raiseFabricationPurchaseRequest } from './materialAvailabilityService.js';
import { isBought } from './makeBuyService.js';
import { checkAndReserve, getFreeQtyExcludingOrder, getFreeQty } from './materialReservationService.js';
import { recordCascadeCover, cascadeOnRow, cascadeIssueLimit, finishedViaStore } from './cascadeDeliveryService.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { createSubChildPartOrderForItem } from './subChildPartOrderService.js';
import { isReleased } from './productApprovalService.js';
import { buildOrderStepsFromProcessDefinition } from './processStepBuilderService.js';
import notificationService from './notificationService.js';
import { outsourceMaterialOnOrder } from './outsourceEarmarkService.js';

const today = () => new Date().toISOString().split('T')[0];
// A Child Part order still in any of these is "already being worked" —
// dedup guard so the sweep doesn't raise a second one on top of an
// unfinished run every time it ticks.
const OPEN_STATUSES = ['Pending', 'BOM Pending', 'In Progress', 'On Hold'];

// Resolves a Child Part Item's own ChildPartBOM. Returns `.materials` as a
// combined (subChildParts[] + materials[]) array — used two ways: (1)
// productionMfgController.js's getBomDesignStatus only ever checks
// `materials.length > 0` to answer "does this Child Part have a material
// list yet" (works unmodified for a Child Part built entirely from Sub
// Child Part references, zero direct materials); (2) that SAME array is
// what the BOM View modal (Order Management's "View" button) renders
// directly, field-for-field — so each entry is normalized here onto the
// shape that modal already expects (`item`/`code`/`quantity`/`unit`) rather
// than left in its own raw schema shape. Sub Child Part lines only ever had
// `.name` (their own SubChildPartLineSchema field), never `.item` (the
// MaterialLineSchema field the modal reads) — left unmapped, their name
// silently disappeared from that view, showing only a bare code. Every
// entry also gets a `lineKind` tag ('SubChildPart' vs 'Material') so the
// modal can group/label them instead of one undifferentiated flat list —
// deliberately not named `category`, which already means something else
// entirely on a material line (its Item's own Category Management
// classification, MaterialLineSchema's own `.category` field — spreading a
// same-named tag over it here would silently clobber that real value).
// Real production/availability logic below reads subChildPartLines/
// materialLines directly instead of this synthesized array.
export async function findSubChildPartMaterialLines(childPartItemId, companyId) {
  const bom = await ChildPartBOM.findOne({ childPart: childPartItemId, company: companyId }).lean();
  if (!bom) return null;
  const subChildPartLines = (bom.subChildParts || []).filter(l => !l.isDiscontinued);
  const materialLines = (bom.materials || []).filter(m => !m.isDiscontinued);
  return {
    bom, subChildPartLines, materialLines,
    materials: [
      ...subChildPartLines.map(l => ({ ...l, item: l.name, lineKind: 'SubChildPart' })),
      ...materialLines.map(m => ({ ...m, lineKind: 'Material' })),
    ],
  };
}

// Checks the Sub Child Part cascade AND Tier 1 (plain) / 2 (sheet metal) / 3
// (length fabrication) direct-material shortfalls for one Child Part
// production run. Never touches order.materialDemands — same convention as
// every other order kind in this hierarchy: that array stays empty until
// Production's own "Issue" click (requestSubChildPartMaterial below).
export async function checkSubChildPartMaterialAvailability(productionOrder, companyId) {
  const found = await findSubChildPartMaterialLines(productionOrder.subChildPartItem, companyId);
  if (!found || !found.materials.length) {
    return { checked: false, reason: 'No Child Part Master BOM found for this Child Part.' };
  }
  const { subChildPartLines, materialLines } = found;
  const pseudoBom = { materials: materialLines };
  const buildQty = Math.max(1, Number(productionOrder.orderQuantity) || 1);

  // ── Sub Child Part cascade — a shortfall here raises a real Sub Child
  // Part order (Out-Source or In-House, per that Sub Child Part's own
  // jobWork flag), not a Purchase Request. Tagged demandSource:
  // 'ChildPartCascade' so it's tracked independently from whatever that Sub
  // Child Part's OWN reorder-point cron may have already raised
  // (demandSource: 'LowStock') — the two are allowed to coexist, each
  // capped at one open order at a time; createSubChildPartOrderForItem's
  // dedup guard is scoped by this same value, so calling this again is safe
  // even if a cascade order for the same Sub Child Part already exists.
  // Sized to the ACTUAL quantity this Child Part build needs (this BOM
  // line's own per-unit quantity × this order's quantity), not that Sub
  // Child Part's generic reorderQty — confirmed with the user 2026-09-16.
  // Propagate, don't hardcode: a Child Part order raised by a Machine's own
  // cascade (demandSource:'MachineCascade') must cascade AS 'MachineCascade'
  // too, not 'ChildPartCascade' — otherwise it'd collide with (or be
  // silently "covered by") a Sub Child Part order raised independently by a
  // cron-triggered Child Part order's own cascade for the same Sub Child
  // Part. A Child Part order raised by its own 'LowStock' cron keeps
  // cascading as 'ChildPartCascade', unchanged.
  const cascadeDemandSource = productionOrder.demandSource === 'MachineCascade' ? 'MachineCascade' : 'ChildPartCascade';
  // What was raised, for the New Stock Order form's message.
  const partOrders = []; const noOrder = []; const purchases = [];
  for (const line of subChildPartLines) {
    const subItem = await Item.findOne({ _id: line.subChildPart, companyId });
    if (!subItem) continue;
    const neededQty = (Number(line.quantity) || 0) * buildQty;
    // Serial number work step 1 (2026-10-31, P1) — see machineReorderService:
    // a built part reserves only free stock; the cascade builds the shortfall.
    const { shortfallQty } = await checkAndReserve({ item: subItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `scp:${subItem.code}`, capToFree: !isBought(subItem) });
    if (shortfallQty === 0) continue;
    // Bought from a vendor (make or buy, 2026-10-28): a purchase request,
    // never a build order.
    if (isBought(subItem)) {
      // Automatic orders wait for R&D's Release — a bought part too (2026-10-29).
      if (!isReleased(subItem)) {
        console.warn(`[ChildPartCascade] ${productionOrder.orderId}: no purchase request for ${subItem.code} (bought), short ${shortfallQty} — not released yet.`);
        noOrder.push(`${subItem.name} short ${shortfallQty}`);
        continue;
      }
      purchases.push(await raisePlainPurchaseRequest({ item: subItem, shortfallQty, order: productionOrder }));
      continue;
    }
    const res = await createSubChildPartOrderForItem(subItem, companyId, { demandSource: cascadeDemandSource, buildQtyOverride: shortfallQty, demandRefId: productionOrder._id, deliverToParent: true, parentOrderNo: productionOrder.orderId });
    if (res.order?.deliverToParent) {
      await recordCascadeCover(productionOrder._id, {
        partItem: subItem._id, partCode: subItem.code, partName: subItem.name, unit: line.unit || 'Pieces',
        qty: res.order.orderQuantity,
        viaStore: finishedViaStore(res.order, res.kind === 'out-source' ? 'SubChildPartJobWorkOrder' : 'ProductionOrder'),
        child: { model: res.kind === 'out-source' ? 'SubChildPartJobWorkOrder' : 'ProductionOrder', orderRef: res.order._id, orderNo: res.order.orderId },
      });
      partOrders.push(`${res.order.orderId} (${subItem.name})`);
    } else {
      // No order will deliver it (e.g. not released yet): the full need stays
      // on stock, as before.
      await checkAndReserve({ item: subItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `scp:${subItem.code}` });
      noOrder.push(`${subItem.name} short ${shortfallQty}`);
    }
  }

  // ── Tier 1 — plain raw materials / tools.
  for (const g of plainMaterialGroupsFromBOM(pseudoBom)) {
    const matItem = await Item.findOne({ code: g.itemCode, companyId });
    if (!matItem) continue;
    const neededQty = g.perUnitQty * buildQty;
    const { shortfallQty } = await checkAndReserve({ item: matItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `plain:${matItem.code}` });
    if (shortfallQty > 0) {
      purchases.push(await raisePlainPurchaseRequest({ item: matItem, shortfallQty, order: productionOrder }));
    }
  }

  // ── Tier 2 — sheet metal, grouped by the actual cut (sheetMetalCutGroupsFromBOM).
  // A sheet-metal BOM line only ever records the cut's AREA (never
  // length/width), so "sheets needed" is total area ÷ one catalog sheet's
  // own area, rounded up — same simple area-division the old cron used.
  for (const line of sheetMetalCutGroupsFromBOM(pseudoBom)) {
    if (!line.areaMm2PerPiece) continue;
    const matItem = await Item.findOne({ code: line.itemCode, companyId });
    if (!matItem) continue;
    const variant = (matItem.dimensionVariants || []).find(v => String(v._id) === String(line.dimensionVariantId));
    if (!variant) continue;
    const catalogSheet = sheetAreaFromItem(matItem, line.dimensionVariantId);
    if (!catalogSheet || !catalogSheet.areaMm2) continue;

    const totalAreaNeededMm2 = line.areaMm2PerPiece * line.quantity * buildQty;
    const sheetsNeeded = Math.ceil(totalAreaNeededMm2 / catalogSheet.areaMm2);
    // availableQty: this variant's own subStock, NOT matItem.qty (always 0
    // for a fabrication item — confirmed bug, 2026-09-18).
    const { shortfallQty: sheetsShort } = await checkAndReserve({ item: matItem, neededQty: sheetsNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId, variantId: variant._id, lineKey: `sheet:${line.key}` });
    if (sheetsShort > 0) {
      purchases.push(await raiseFabricationPurchaseRequest({
        matItem, dimensionValues: variant.values, piecesShort: sheetsShort,
        compositeMaterialCode: line.key, order: productionOrder,
      }));
    }
  }

  // ── Tier 3 — non-sheet-metal length-based fabrication.
  for (const g of lengthFabricationGroupsFromBOM(pseudoBom)) {
    const matItem = await Item.findOne({ code: g.itemCode, companyId });
    if (!matItem) continue;
    const variant = (matItem.dimensionVariants || []).find(v => String(v._id) === String(g.dimensionVariantId));
    const catalogPieceLengthMm = Number(variant?.values?.length) || 0;
    if (!variant || !catalogPieceLengthMm) continue;
    const totalLengthNeededMm = g.totalLengthMmPerUnit * buildQty;
    const piecesNeeded = Math.ceil(totalLengthNeededMm / catalogPieceLengthMm);
    // availableQty: this variant's own subStock, NOT matItem.qty (always 0
    // for a fabrication item — confirmed bug, 2026-09-18).
    const { shortfallQty: piecesShort } = await checkAndReserve({ item: matItem, neededQty: piecesNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId, variantId: variant._id, lineKey: `length:${g.itemCode}#${g.dimensionVariantId}` });
    if (piecesShort > 0) {
      purchases.push(await raiseFabricationPurchaseRequest({
        matItem, dimensionValues: variant.values, piecesShort,
        compositeMaterialCode: `${g.itemCode}#${g.dimensionVariantId}`, order: productionOrder,
      }));
    }
  }

  return { checked: true, partOrders, noOrder, purchases: purchases.filter(Boolean) };
}

// Material List — one categorized view of what building the whole order
// actually needs, reusing the exact same grouping/comparison math
// checkSubChildPartMaterialAvailability already uses to decide real
// purchases/cascades (so this list can never disagree with what actually
// got raised). Five categories now: Sub Child Part (NEW — the order's own
// Sub Child Part references) / Raw Material / Tool / Sheet Metal / Length
// Fabrication.
//
// Issue/receive/return: each row carries an `issueTotal` (the CAP — whole
// sheets for Sheet Metal, whole BOM cut-pieces for Length Fabrication, the
// needed qty for Sub Child Part references, plain total otherwise), a
// stable `demandKey`, the metadata needed to seed an order.materialDemands[]
// entry, and — joined from that array — the live requested/transferred/
// issued state. Everything downstream (Store's Pending Transfers,
// receiveMaterialInProduction, returnMaterialToStore, confirmReturn) then
// works on it exactly like a machine demand.

const dimSig = (dims) => dimensionSignature(dims || {});

async function itemMetaResolver(companyId) {
  const cache = new Map();
  return async (code) => {
    if (cache.has(code)) return cache.get(code);
    const item = await Item.findOne({ code, companyId }).lean();
    const processType = item?.itemProcessType === 'Fabrication Item' ? 'Fabrication Item' : (item?.itemType || '');
    const subProcessType = processType === 'Fabrication Item'
      ? (item?.isSheetMetal ? 'Sheet Metal' : 'Non Sheet Metal')
      : processType;
    const meta = { item, processType, subProcessType, jobWorkType: item?.jobWorkType || '' };
    cache.set(code, meta);
    return meta;
  };
}

// Job Work draws from two kinds of material — sheet metal (laser-cut) and
// items whose Item Type is "Job Work" (sent out for a service). Both are
// already identifiable from the row's Process/Sub-Process Type (see
// itemMetaResolver), so nothing new is stored on the BOM.
const JOB_WORK_SHEET = 'Laser Cutting';
function jobWorkInfoFor(processType, subProcessType, jobWorkType) {
  if (subProcessType === 'Sheet Metal') return { isJobWorkInput: true, workType: JOB_WORK_SHEET };
  if ((processType || '').trim().toLowerCase() === 'job work') {
    return { isJobWorkInput: true, workType: jobWorkType || 'Job Work' };
  }
  return { isJobWorkInput: false, workType: null };
}

// Flat, fully-detailed row model — the single source both the API list
// (grouped into categories) and the issue-request endpoint read from, so
// the CAP a row shows and the CAP the request validates against are always
// the same number.
export async function computeSubChildPartMaterialRows(order, companyId) {
  const found = await findSubChildPartMaterialLines(order.subChildPartItem, companyId);
  if (!found || !found.materials.length) return { rows: [], buildQty: 1 };
  const { subChildPartLines, materialLines } = found;
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const resolveMeta = await itemMetaResolver(companyId);

  const demandByKey = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
  const joinDemand = (key) => {
    const d = demandByKey.get(key);
    return {
      // What was asked of Store — not what came straight from this order's
      // own cascade (serial number work step 1).
      requestedQty: (d?.quantity || 0) - (d?.cascadeDeliveredQuantity || 0),
      cascadeDeliveredQty: d?.cascadeDeliveredQuantity || 0,
      transferredQty: d?.transferredQuantity || 0,
      issuedQty: d?.issuedQuantity || 0,
      returnPendingQty: d?.returnPendingQuantity || 0,
      demandStatus: d?.status || null,
    };
  };

  const rows = [];

  // ── Sub Child Part — one row per bom.subChildParts[] line. No Purchase
  // Request involved on shortfall (a production order is raised instead —
  // see checkSubChildPartMaterialAvailability above), so availability here
  // reads "In Production" instead of "Sent to Purchase" once short.
  for (const line of subChildPartLines) {
    const subItem = await Item.findOne({ _id: line.subChildPart, companyId }).lean();
    if (!subItem) continue;
    const issueTotal = (Number(line.quantity) || 0) * buildQty;
    const available = (await getFreeQtyExcludingOrder(subItem._id, subItem.qty || 0, companyId, order._id)) + (demandByKey.get(subItem.code)?.transferredQuantity || 0) >= issueTotal;
    rows.push({
      category: 'Sub Child Part', demandKey: subItem.code, sourceItemCode: subItem.code,
      code: subItem.code, name: subItem.name,
      processType: 'Sub Child Part', subProcessType: 'Sub Child Part',
      amount: null, perPieceQty: line.quantity, perPieceUnit: line.unit,
      totalAmount: null, totalQuantity: issueTotal, totalQuantityLabel: line.unit,
      issueUnit: line.unit, issueTotal,
      available,
      isSubChildPartRow: true,
      demandSeed: {
        materialCode: subItem.code, materialName: subItem.name, sourceItemCode: subItem.code,
        fabricationCategory: '', dimensionVariantId: null, bomDimensions: {},
        amountValue: null, amountUnit: null, computedWeightPerPieceKg: null, unit: line.unit,
      },
      ...joinDemand(subItem.code),
    });
  }

  // ── Assembly Materials / Consumable — non-fabrication, split by materialKind.
  const nonFabLines = materialLines.filter(m => !m.fabricationCategory);
  for (const [category, lines] of [
    ['Assembly Materials', nonFabLines.filter(m => m.materialKind !== 'tool')],
    ['Consumables', nonFabLines.filter(m => m.materialKind === 'tool')],
  ]) {
    if (!lines.length) continue;
    const totalsByCode = new Map();
    for (const g of plainMaterialGroupsFromBOM({ materials: lines })) {
      totalsByCode.set(g.itemCode, g.perUnitQty * buildQty);
    }
    for (const m of lines) {
      const { item, processType, subProcessType } = await resolveMeta(m.code);
      const issueTotal = totalsByCode.get(m.code) ?? (Number(m.quantity) || 0) * buildQty;
      // Available to THIS order (2026-10-09): free after earlier orders' claims
      // (own claim excluded) plus what Store already transferred to it.
      const available = item ? (await getFreeQtyExcludingOrder(item._id, item.qty || 0, companyId, order._id)) + (demandByKey.get(m.code)?.transferredQuantity || 0) >= issueTotal : null;
      rows.push({
        category, demandKey: m.code, sourceItemCode: m.code, code: m.code, name: m.item,
        processType, subProcessType,
        amount: m.amountValue != null ? { value: m.amountValue, unit: m.amountUnit } : null,
        perPieceQty: m.quantity, perPieceUnit: m.unit,
        totalAmount: m.amountValue != null ? m.amountValue * buildQty : null,
        totalQuantity: issueTotal, totalQuantityLabel: m.unit,
        issueUnit: m.unit, issueTotal,
        available,
        demandSeed: {
          materialCode: m.code, materialName: m.item, sourceItemCode: m.code,
          fabricationCategory: '', dimensionVariantId: null, bomDimensions: {},
          amountValue: m.amountValue ?? null, amountUnit: m.amountUnit ?? null,
          computedWeightPerPieceKg: null, unit: m.unit,
        },
        ...joinDemand(m.code),
      });
    }
  }

  // ── Sheet Metal — grouped by the actual cut.
  for (const line of sheetMetalCutGroupsFromBOM({ materials: materialLines })) {
    const { item, processType, subProcessType } = await resolveMeta(line.itemCode);
    let issueTotal = 0, available = null;
    if (item && line.areaMm2PerPiece) {
      const variant = (item.dimensionVariants || []).find(v => String(v._id) === String(line.dimensionVariantId));
      const catalogSheet = sheetAreaFromItem(item, line.dimensionVariantId);
      if (variant && catalogSheet?.areaMm2) {
        issueTotal = Math.ceil((line.areaMm2PerPiece * line.quantity * buildQty) / catalogSheet.areaMm2);
        available = (await getFreeQtyExcludingOrder(item._id, variant.subStock || 0, companyId, order._id, { variantId: variant._id })) + (demandByKey.get(line.key)?.transferredQuantity || 0) >= issueTotal;
      }
    }
    rows.push({
      category: 'Sheet Metal', demandKey: line.key, sourceItemCode: line.itemCode, code: line.itemCode, name: line.itemName,
      processType, subProcessType,
      amount: line.amountValue != null ? { value: line.amountValue, unit: line.amountUnit } : null,
      perPieceQty: line.quantity, perPieceUnit: 'Pieces',
      totalAmount: line.amountValue != null ? line.amountValue * buildQty : null,
      totalQuantity: issueTotal, totalQuantityLabel: 'sheet(s)',
      issueUnit: 'sheet(s)', issueTotal,
      available,
      // Flat-piece demand: Store ships whole catalog sheets, Production cuts
      // on the floor and returns the measured leftover.
      demandSeed: {
        materialCode: line.key, materialName: line.itemName, sourceItemCode: line.itemCode,
        fabricationCategory: line.fabricationCategory, dimensionVariantId: line.dimensionVariantId,
        bomDimensions: {}, amountValue: line.amountValue ?? null, amountUnit: line.amountUnit ?? null,
        computedWeightPerPieceKg: null, unit: 'Pieces',
      },
      ...joinDemand(line.key),
    });
  }

  // ── Length Fabrication — grouped by {code, dimensionVariantId}. Issued in
  // whole BOM cut-pieces; Store cuts to size and keeps the leftover.
  for (const g of lengthFabricationGroupsFromBOM({ materials: materialLines })) {
    const { item, processType, subProcessType } = await resolveMeta(g.itemCode);
    const sampleLine = materialLines.find(m => m.code === g.itemCode && String(m.dimensionVariantId) === String(g.dimensionVariantId));
    const perPieceLengthMm = Number(sampleLine?.bomDimensions?.length) || 0;
    let issueTotal = 0, available = null;
    if (item && perPieceLengthMm) {
      const variant = (item.dimensionVariants || []).find(v => String(v._id) === String(g.dimensionVariantId));
      const catalogPieceLengthMm = Number(variant?.values?.length) || 0;
      issueTotal = Math.round((g.totalLengthMmPerUnit / perPieceLengthMm) * buildQty);
      if (variant && catalogPieceLengthMm) {
        const freePieces = await getFreeQtyExcludingOrder(item._id, variant.subStock || 0, companyId, order._id, { variantId: variant._id });
        const transferredCuts = demandByKey.get(`${g.itemCode}#${g.dimensionVariantId}#${dimSig(sampleLine?.bomDimensions)}`)?.transferredQuantity || 0;
        available = freePieces * catalogPieceLengthMm + transferredCuts * perPieceLengthMm >= g.totalLengthMmPerUnit * buildQty;
      }
    }
    const key = `${g.itemCode}#${g.dimensionVariantId}#${dimSig(sampleLine?.bomDimensions)}`;
    rows.push({
      category: 'Length Fabrication', demandKey: key, sourceItemCode: g.itemCode, code: g.itemCode, name: g.itemName,
      processType, subProcessType,
      amount: sampleLine?.amountValue != null ? { value: sampleLine.amountValue, unit: sampleLine.amountUnit } : null,
      perPieceQty: 1, perPieceUnit: 'piece',
      totalAmount: sampleLine?.amountValue != null ? sampleLine.amountValue * buildQty : null,
      totalQuantity: issueTotal, totalQuantityLabel: 'piece(s)',
      issueUnit: 'piece(s)', issueTotal,
      available,
      demandSeed: {
        materialCode: key, materialName: g.itemName, sourceItemCode: g.itemCode,
        fabricationCategory: g.fabricationCategory, dimensionVariantId: g.dimensionVariantId,
        bomDimensions: sampleLine?.bomDimensions || {},
        amountValue: sampleLine?.amountValue ?? null, amountUnit: sampleLine?.amountUnit ?? null,
        computedWeightPerPieceKg: sampleLine?.computedWeightPerPieceKg ?? null, unit: 'Pieces',
      },
      ...joinDemand(key),
    });
  }

  // Tag Job Work inputs (sheet metal + Item Type "Job Work") with their
  // work type — resolveMeta is cached so this re-lookup is free. Sub Child
  // Part rows never match (their processType is 'Sub Child Part').
  for (const r of rows) {
    const { jobWorkType } = await resolveMeta(r.code);
    Object.assign(r, jobWorkInfoFor(r.processType, r.subProcessType, jobWorkType));
  }

  return { rows, buildQty };
}

// The Job Work step's material inputs for a Child Part order — sheet metal
// (laser cutting) + "Job Work" Item-Type rows. Carried over from the old
// file, unreachable until the "process section" pass gives a Child Part
// order a real Job-Work-equivalent step (processes:[] today — see this
// file's header comment).
export async function getSubChildPartJobWorkRows(order, companyId) {
  const { rows } = await computeSubChildPartMaterialRows(order, companyId);
  return rows.filter(r => r.isJobWorkInput).map(r => ({
    demandKey: r.demandKey, code: r.code, name: r.name,
    workType: r.workType, subProcessType: r.subProcessType, processType: r.processType,
    issueTotal: r.issueTotal, issuedQty: r.issuedQty || 0, demandStatus: r.demandStatus,
    availability: r.available === null ? 'Unknown' : (r.available ? 'Available' : 'Sent to Purchase'),
    issued: r.demandStatus === 'Issued',
  }));
}

export async function getSubChildPartUnissuedJobWorkMaterials(order, companyId) {
  const rows = await getSubChildPartJobWorkRows(order, companyId);
  return rows.filter(r => !r.issued).map(r => `${r.name} (${r.code})`);
}

// Fabrication-specific per-unit consumption tracking (getSubChildPartFabricationConsumables/
// Shortfall/Status + commitSubChildPartUnitConsumption) removed 2026-09-24 —
// superseded by productionMfgController.js's resolveStepMaterialLines/
// commitStepMaterialConsumption, generalized to any step's own materialRefs
// instead of "every non-Job-Work BOM row" hardcoded to one legacy step name.
// See the discussion doc's "Per-step material consumable tracking" section.

const CATEGORY_ORDER = ['Sub Child Part', 'Assembly Materials', 'Consumables', 'Sheet Metal', 'Length Fabrication'];

export async function buildSubChildPartMaterialList(order, companyId) {
  const { rows } = await computeSubChildPartMaterialRows(order, companyId);
  // outsource-v2 slice 5: material planned to go to a vendor straight from
  // Store (an Outsource Order's material plan) — Production can't issue it.
  const toVendor = order._id ? await outsourceMaterialOnOrder(order._id) : new Map();
  const categories = [];
  for (const name of CATEGORY_ORDER) {
    const catRows = rows.filter(r => r.category === name);
    if (!catRows.length) continue;
    const cat = {
      name,
      materials: catRows.map(r => ({
        demandKey: r.demandKey, code: r.code, name: r.name,
        processType: r.processType, subProcessType: r.subProcessType,
        amount: r.amount, quantity: r.perPieceQty, unit: r.perPieceUnit,
        totalAmount: r.totalAmount, totalQuantity: r.totalQuantity, totalQuantityLabel: r.totalQuantityLabel,
        issueUnit: r.issueUnit, issueTotal: r.issueTotal,
        availability: r.available === null ? 'Unknown' : (r.available ? 'Available' : (r.isSubChildPartRow ? 'In Production' : 'Sent to Purchase')),
        requestedQty: r.requestedQty, transferredQty: r.transferredQty,
        issuedQty: r.issuedQty, returnPendingQty: r.returnPendingQty, demandStatus: r.demandStatus,
        toVendor: toVendor.get(r.demandKey)?.store > 0 ? { store: toVendor.get(r.demandKey).store, orders: toVendor.get(r.demandKey).orders } : null,
        // Serial number work step 1: built for this order by its cascade —
        // delivered straight here, so Store is asked only for the rest.
        cascade: r.isSubChildPartRow ? cascadeOnRow(order, r.demandKey) : null,
        issueLimit: cascadeIssueLimit(r.issueTotal, r.isSubChildPartRow ? cascadeOnRow(order, r.demandKey) : null, toVendor.get(r.demandKey)?.store || 0, r.issueUnit),
      })),
    };
    if (name === 'Sub Child Part') {
      cat.note = 'A short Sub Child Part raises its own order (Out-Source or In-House) automatically — nothing to purchase here.';
    }
    if (name === 'Sheet Metal') {
      cat.note = 'This quantity completes the order. Return any usable leftover sheet to Store.';
    }
    categories.push(cat);
  }
  return { categories };
}

// Production's "Issue" button on the Material List — raises (or grows) one
// row's material request. No R&D approval step (it's a stock-replenishment
// build), so it goes straight to 'Requested' and shows in Store's Pending
// Transfers immediately. Capped so the cumulative demand can never exceed
// what the whole order needs. Works uniformly for Sub Child Part reference
// rows and direct-material rows — both carry a demandSeed/issueTotal in the
// same shape.
export async function requestSubChildPartMaterial(order, companyId, demandKey, requestQuantity) {
  const qty = Number(requestQuantity);
  if (!demandKey || !(qty > 0)) {
    return { ok: false, code: 400, message: 'A material and a positive quantity are required.' };
  }

  const { rows } = await computeSubChildPartMaterialRows(order, companyId);
  const row = rows.find(r => r.demandKey === demandKey);
  if (!row) {
    return { ok: false, code: 404, message: 'That material is not on this order\'s material list.' };
  }

  const existing = order.materialDemands.find(d => d.materialCode === demandKey);
  // Serial number work step 1: what came straight from this order's cascade
  // isn't a request to Store, and what it still builds can't be asked of Store.
  const alreadyRequested = (existing?.quantity || 0) - (existing?.cascadeDeliveredQuantity || 0);
  const cascade = row.isSubChildPartRow ? cascadeOnRow(order, demandKey) : null;
  // outsource-v2 slice 5: the part going to a vendor straight from Store
  // can't be issued to Production as well.
  const vendor = (await outsourceMaterialOnOrder(order._id)).get(demandKey);
  const limit = cascadeIssueLimit(row.issueTotal, cascade, vendor?.store || 0, row.issueUnit);
  if (alreadyRequested + qty > limit) {
    const remaining = Math.max(0, Math.round((limit - alreadyRequested) * 1000) / 1000);
    return {
      ok: false, code: 400,
      message: cascade
        ? `Can only request ${remaining} more ${row.issueUnit} of "${row.name}" from Store — the whole order needs ${row.issueTotal}, and ${cascade.covered} come straight from ${cascade.orders.join(', ') || 'its own build order'} (built for this order).`
        : vendor?.store > 0
        ? `Can only request ${remaining} more ${row.issueUnit} of "${row.name}" — the whole order needs ${row.issueTotal}, and ${Math.round(vendor.store * 1000) / 1000} goes to the vendor straight from Store (${vendor.orders.join(", ")}).`
        : `Can only request ${remaining} more ${row.issueUnit} of "${row.name}" — the whole order needs ${row.issueTotal}.`,
    };
  }

  if (existing) {
    existing.quantity = (existing.quantity || 0) + qty;
    // Re-open a demand that was already fully issued so Store sends the rest.
    if (existing.status === 'Issued' && existing.issuedQuantity < existing.quantity) {
      existing.status = 'Requested';
      order.materialIssued = false;
    }
  } else {
    order.materialDemands.push({
      ...row.demandSeed,
      quantity: qty,
      status: 'Requested',
    });
  }
  await order.save();
  return { ok: true, data: order };
}

// ProductionOrder.createdBy is required — normally just item.createdBy (set
// when the Child Part was created via BOM Management). Falls back to a real
// user of the same company when it's missing so one bad record can't crash
// this item out of every sweep run forever — and backfills it onto the Item
// so this fallback only ever runs once per affected item. Duplicated (not
// imported) from the sibling cron files' own identical helper — established
// project convention, see subChildPartOrderService.js's own copy.
const fallbackCreatedByCache = new Map(); // companyId string -> userId | null
export async function resolveCreatedBy(item) {
  if (item.createdBy) return item.createdBy;
  const key = String(item.companyId);
  if (fallbackCreatedByCache.has(key)) return fallbackCreatedByCache.get(key);
  const fallbackUser = await User.findOne({
    companyId: item.companyId,
    role: { $in: ['Research & Development Head', 'Production Head'] },
  }).select('_id').lean() || await User.findOne({ companyId: item.companyId }).select('_id').lean();
  const fallbackId = fallbackUser?._id || null;
  fallbackCreatedByCache.set(key, fallbackId);
  if (fallbackId) {
    await Item.updateOne({ _id: item._id }, { $set: { createdBy: fallbackId } });
    console.warn(`[ChildPartReorder] Item ${item.code} had no createdBy — backfilled with a company user (${fallbackId}).`);
  }
  return fallbackId;
}

// Child Part orders are only ever raised by these two independent triggers —
// a shared list so dedup query construction below can't silently typo a
// third value into existence (mirrors subChildPartOrderService.js's own
// DEMAND_SOURCES/demandSourceMatch pattern one tier down).
const DEMAND_SOURCES = ['LowStock', 'MachineCascade'];

// 'LowStock' also matches records that predate this field entirely (every
// order raised before the Machine cascade existed IS a LowStock order by
// definition) — no migration/backfill needed to introduce it. For
// 'MachineCascade', ALSO requires an exact demandRefId match — two
// different Machine orders both cascading for the same Child Part are two
// different demands, not one; without this, the second one's cascade
// attempt would see "an order already exists" and silently drop its own
// need (confirmed bug, 2026-09-17).
function demandSourceMatch(demandSource, demandRefId) {
  return demandSource === 'LowStock'
    ? { $or: [{ demandSource: 'LowStock' }, { demandSource: { $exists: false } }] }
    : { demandSource, demandRefId };
}

// Reusable per-item order-raise — extracted (2026-09-16) from what used to
// be runChildPartReorderSweep's own per-item loop body, so the Machine
// cascade (machineReorderService.js's checkMachineAssemblyMaterialAvailability
// — a Machine order needing more of this Child Part than is on hand) can
// trigger a Child Part order for a specific Item without duplicating this
// file's own creation/cascade/notification logic. Mirrors
// subChildPartOrderService.js's createSubChildPartOrderForItem exactly, one
// tier up. Deliberately does NOT re-check item.qty vs item.minStock — that's
// runChildPartReorderSweep's OWN trigger (this Child Part's own reorder
// point); a caller invoking this directly has a different reason to want
// this Item built and must not be silently blocked by that unrelated check.
//
// `demandSource` ('LowStock' by default, or 'MachineCascade' from the
// Machine cascade) scopes BOTH the dedup check and what gets written onto
// the created order — the two sources are deliberately allowed to each have
// their own open order for the same Child Part Item at once (same reasoning
// already confirmed for the Sub Child Part tier: a Child Part's own
// reorder-point build and a specific Machine's build needing more of it
// right now are genuinely different reasons to build more, not the same
// demand twice), each capped independently at one open order at a time.
// `buildQtyOverride` lets the cascade size its own order to the actual
// quantity the Machine's BOM line requires (line.quantity × that Machine
// order's own quantity) instead of this Child Part's generic reorderQty.
// `byHand` (New Stock Order, 2026-11-05): { deliveryDate, priority, createdBy }.
// Production asked for this quantity on purpose, so an open low-stock order
// doesn't stop it. It still counts as one: the sweep won't add another meanwhile.
export async function createChildPartOrderForItem(item, companyId, { demandSource = 'LowStock', buildQtyOverride, demandRefId = null, deliverToParent = false, parentOrderNo = '', byHand = null } = {}) {
  if (!DEMAND_SOURCES.includes(demandSource)) {
    throw new Error(`createChildPartOrderForItem: unknown demandSource "${demandSource}"`);
  }
  // Make or buy (2026-10-28): a bought part is never built — covers the
  // low-stock sweep and every cascade in one place.
  if (isBought(item)) return { created: false, reason: 'bought-from-vendor' };

  // Product Approval Gate (docs/product-approval-gate-redesign-discussion-2026-09.md
  // §3f): every caller of this function is automatic — the reorder cron and
  // the Machine -> Child Part cascade — and neither may start a part's orders
  // until R&D has Released it. The manual/internal path that builds the first
  // unit for QC/Prototype never goes through here.
  if (!isReleased(item)) return { created: false, reason: 'not-released' };

  const existing = await ProductionOrder.findOne({
    subChildPartItem: item._id, orderKind: 'ChildPart', status: { $in: OPEN_STATUSES }, ...demandSourceMatch(demandSource, demandRefId),
  }).select('_id orderId orderQuantity deliverToParent processes.type').lean();
  if (existing && !byHand) return { created: false, reason: 'open-order-exists', order: existing };

  const createdBy = byHand?.createdBy || await resolveCreatedBy(item);
  if (!createdBy) {
    console.error(`[ChildPartReorder] Skipping ${item.code} — no createdBy and no company user found to fall back to.`);
    return { created: false, reason: 'no-createdBy' };
  }

  const buildQty = buildQtyOverride != null
    ? Math.max(1, Number(buildQtyOverride) || 1)
    : Math.max(1, Number(item.reorderQty) || 1);

  // Phase 2: build the real processes[] from this Child Part's own BOM
  // Process Definition (server/models/ProcessDefinitionSchema.js) instead
  // of the hardcoded SUB_CHILD_PART_STEPS shape — see
  // server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md.
  // Falls back to the old hardcoded 3-step pipeline when no Process
  // Definition has been configured yet (it's optional at this level, per
  // Phase 1) — same "behave exactly as before until R&D opts in" fallback
  // convention machineReorderService.js's resolveMachineOrderProcesses
  // already uses one tier up for a machine with no MachineBOM.
  const bomForProcesses = await ChildPartBOM.findOne({ childPart: item._id, company: companyId }).select('processDefinition').lean();
  const processes = bomForProcesses?.processDefinition?.length
    ? buildOrderStepsFromProcessDefinition(bomForProcesses.processDefinition)
    : buildProcessSteps('ChildPart');

  const orderId = await generateOrderId(companyId);
  const order = await ProductionOrder.create({
    orderId,
    orderKind: 'ChildPart',
    subChildPartItem: item._id,
    machineCode: item.code,
    machineName: item.name,
    orderQuantity: buildQty,
    demandSource,
    demandRefId,
    deliverToParent: !!(deliverToParent && demandRefId),
    parentOrderNo: deliverToParent && demandRefId ? parentOrderNo : '',
    source: 'Stock',
    priority: byHand?.priority || 'Normal',
    receivedDate: today(),
    deliveryDate: byHand?.deliveryDate || today(),
    company: companyId,
    createdBy,
    // Explicit, never the schema's own bare default — Mongoose calls a
    // `default` function with zero arguments, so it can never see
    // orderKind and would silently hand this order the full 6-step Machine
    // pipeline instead of Child Part's own trimmed one (see this file's
    // 2026-09-19 fix note in git history). No custody auto-routing branch
    // here even when processes[0] is an Out Source step — Child Part orders
    // always land with Production first, full stop (confirmed 2026-09-22,
    // unlike Sub Child Part).
    processes,
  });

  // By hand the order already exists, so a failed check is reported, not thrown.
  let material = { checked: false };
  try {
    material = await checkSubChildPartMaterialAvailability(order, companyId);
  } catch (e) {
    if (!byHand) throw e;
    console.error(`[ChildPartReorder] ${order.orderId} material check error:`, e);
  }

  // 2026-10-22 (client change — replaces the 2026-09-22 "Production first,
  // full stop" rule above): a first Out Source step goes to Purchase at once,
  // all units in one request.
  try {
    const { autoRequestFirstOutsourceRun } = await import('../controllers/outsourceWorkController.js');
    await autoRequestFirstOutsourceRun(order);
  } catch (e) { console.error('[ChildPartReorder] auto outsource request error:', e); }

  try {
    await notificationService.triggerProductionNotification({
      action: 'order_for_production',
      data: { orderCode: order.orderId, orderId: order._id, machineName: item.name },
      targetCompanyId: companyId,
    });
  } catch (e) { console.error('[ChildPartReorder] notification error:', e); }

  return { created: true, order, material };
}

export async function runChildPartReorderSweep() {
  const stats = { scanned: 0, created: 0 };
  // Gated through ChildPartBOM existence — never a bare
  // Item.find({productKind:'ChildPart'}) — same "an Item belongs to this
  // catalog purely by having a ChildPartBOM document" rule
  // childPartBOMController.js already enforces on every read.
  const boms = await ChildPartBOM.find({}).populate({
    path: 'childPart',
    match: { isDiscontinued: { $ne: true }, minStock: { $gt: 0 } },
  });

  for (const bom of boms) {
    const item = bom.childPart; // null when populate's match filtered it out
    if (!item) continue;
    stats.scanned++;
    try {
      // Free stock (2026-10-09, user decision): stock still reserved for
      // orders doesn't count toward the minimum.
      if ((await getFreeQty(item._id, item.qty || 0, item.companyId)) > (item.minStock || 0)) continue;
      const result = await createChildPartOrderForItem(item, item.companyId);
      if (result.created) stats.created++;
    } catch (err) {
      console.error(`[ChildPartReorder] Error processing item ${item.code}:`, err);
    }
  }

  console.log(`[ChildPartReorder] Sweep complete — scanned ${stats.scanned} item(s), created ${stats.created} production order(s).`);
  return stats;
}
