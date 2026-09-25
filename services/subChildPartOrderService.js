// Sub Child Part (the real, new, LOWEST BOM hierarchy level —
// Item.subChildPartDetails, productKind:'SubChildPart') — Low Stock
// Auto-Order sweep.
//
// NOT to be confused with childPartReorderService.js, a separate cron one
// level up for 'ChildPart' (the level renamed FROM "Sub Child Part" before
// the 2026-09 hierarchy correction — see that file's own header comment).
// That file imports createSubChildPartOrderForItem from this one (its own
// Sub Child Part cascade — a Child Part short on a Sub Child Part reference
// raises a real order here), but otherwise this is an independent sweep for
// the level below it.
//
// A Sub Child Part's own BOM is exactly ONE raw material line
// (subChildPartDetails.sourceItem/sourceQty/sourceUnit/
// sourceDimensionVariantId — see subChildPartMasterController.js's
// computeSourceMetrics, the cost/weight analogue of this file's own
// resolveSubChildPartRawMaterialNeed). When a Sub Child Part's stock hits
// Min Stock, this:
//  1. Checks that one raw material's availability, auto-raising a Purchase
//     Request for any shortfall (same raisePlainPurchaseRequest/
//     raiseFabricationPurchaseRequest helpers materialAvailabilityService.js
//     already uses elsewhere).
//  2. Routes the order itself by subChildPartDetails.jobWork:
//     - false (In-House) -> a ProductionOrder (orderKind:'SubChildPart'),
//       single order-level flow (no per-step pipeline — see
//       subChildPartOrderMfgController.js).
//     - true (Out-Source) -> a SubChildPartJobWorkOrder (Purchase-side,
//       multi-round send/receive by job-work-type).
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import SubChildPartSheetPlan from '../models/SubChildPartSheetPlan.js';
import User from '../models/User.js';
import { generateOrderId } from '../controllers/productionMfgController.js';
import { buildFabricationBomDimensions, dimensionSignature } from '../services/fabricationDemandService.js';
import { sheetAreaFromItem } from '../controllers/sheetMetalPlanController.js';
import { raisePlainPurchaseRequest, raiseFabricationPurchaseRequest } from './materialAvailabilityService.js';
import { checkAndReserve, getFreeQtyExcludingOrder } from './materialReservationService.js';
import { flattenProcessDefinition, classifyProcessDefinition, buildOrderStepsFromProcessDefinition } from './processStepBuilderService.js';
import notificationService from './notificationService.js';

const today = () => new Date().toISOString().split('T')[0];
// 'Pending QC' included in both — an order awaiting a QC decision is still
// open (bug found + fixed 2026-09-15: this list wasn't updated when 'Pending
// QC' was first added to either status enum, so the cron could have raised a
// duplicate order for the same Sub Child Part while one was already sitting
// in QC review).
const OPEN_PRODUCTION_STATUSES = ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC'];
const OPEN_JOB_WORK_STATUSES = ['Pending', 'In Progress', 'Pending QC'];

// ProductionOrder.createdBy / SubChildPartJobWorkOrder.createdBy are both
// required — normally just item.createdBy. Deliberately DUPLICATED (not
// imported) from childPartReorderService.js's identical helper — same
// project convention every one of these cron files follows rather than
// sharing one small utility across files whose lifecycles are otherwise
// independent. Falls back to a real user of the same company so one bad
// record can't crash this item out of every sweep run.
const fallbackCreatedByCache = new Map();
async function resolveCreatedBy(item) {
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
    console.warn(`[SubChildPartOrder] Item ${item.code} had no createdBy — backfilled with a company user (${fallbackId}).`);
  }
  return fallbackId;
}

export async function generateSubChildPartOrderId() {
  let attempts = 0;
  const year = new Date().getFullYear();
  while (attempts < 20) {
    const count = await SubChildPartJobWorkOrder.countDocuments({});
    const candidate = `SCJW-${year}-${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await SubChildPartJobWorkOrder.findOne({ orderId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  return `SCJW-${Date.now().toString().slice(-6)}`;
}

// Pure (no writes, no PurchaseRequest side effect — one read, for the
// sheet-metal branch's Sheet Metal Plan lookup below) computation of how
// much of sourceItem's own stock a Sub Child Part build of buildQty needs,
// vs. what's actually on hand right now. Shared by the cron's own
// resolveSubChildPartRawMaterialNeed below (creation-time, may raise a PR)
// AND by exported live-recheck callers (the job-work list/detail GET and
// the Send Round guard — see subChildPartJobWorkOrderController.js) that
// must NEVER raise a duplicate PR just from reading current status.
export async function computeSubChildPartRawMaterialAvailability(item, sourceItem, buildQty) {
  const { sourceQty, sourceUnit, sourceDimensionVariantId } = item.subChildPartDetails;

  if (!sourceItem.fabricationRef) {
    // Plain stock item — sourceQty/sourceUnit are always the source item's
    // own locked Used Unit (see subChildPartMasterController.js's own
    // comment on this), so no unit conversion is ever needed here.
    const neededQty = (Number(sourceQty) || 0) * buildQty;
    const availableQty = sourceItem.qty || 0;
    const shortfallQty = Math.max(0, neededQty - availableQty);
    return {
      kind: 'plain', neededQty, unit: sourceItem.unit, availableQty, shortfallQty,
      variant: null, compositeCode: null,
      demandSeed: {
        materialCode: sourceItem.code, materialName: sourceItem.name, sourceItemCode: sourceItem.code,
        quantity: neededQty, unit: sourceItem.unit, status: 'Requested',
        fabricationCategory: '', dimensionVariantId: null, bomDimensions: {},
        amountValue: null, amountUnit: null, computedWeightPerPieceKg: null,
      },
    };
  }

  // Fabrication source item — sheet metal vs length-based, same 2-tier split
  // childPartReorderService.js's own Tiers 2/3 use for the level above.
  const bomDimensionsPerUnit = buildFabricationBomDimensions(sourceItem, sourceDimensionVariantId, sourceQty, sourceUnit);
  const variant = (sourceItem.dimensionVariants || []).find(v => String(v._id) === String(sourceDimensionVariantId));
  if (!bomDimensionsPerUnit || !variant) {
    return { kind: null, neededQty: null, unit: null, availableQty: null, shortfallQty: 0, variant: null, compositeCode: null, demandSeed: null };
  }

  if (sourceItem.isSheetMetal) {
    const catalogSheet = sheetAreaFromItem(sourceItem, sourceDimensionVariantId);
    if (!catalogSheet?.areaMm2) {
      return { kind: 'sheet', neededQty: null, unit: null, availableQty: null, shortfallQty: 0, variant, compositeCode: null, demandSeed: null };
    }
    const totalAreaNeededMm2 = (Number(bomDimensionsPerUnit.area) || 0) * buildQty;

    // Prefer a real, fit-validated Sheet Metal Plan's own sheet count
    // (scaled to THIS buildQty) over the theoretical area estimate, when one
    // exists — real cutting layouts can waste more than pure area math
    // accounts for. The plan itself isn't a stable "per unit" figure (it's
    // sheetsUsed physical sheets for a run of exactly plan.orderQty units —
    // see subChildPartSheetPlanController.js's saveSubChildPartSheetPlan),
    // so it's scaled as a ratio rather than trusted directly. No plan yet
    // (common — nothing requires one to exist, unlike Machine BOM's own
    // lockBOM gate) falls back to the existing area-estimate behavior.
    const plan = await SubChildPartSheetPlan.findOne({ subChildPart: item._id, company: item.companyId }).lean();
    let sheetsNeeded, sheetsNeededSource;
    if (plan?.sheetsUsed > 0 && plan?.orderQty > 0) {
      sheetsNeeded = Math.ceil((plan.sheetsUsed / plan.orderQty) * buildQty);
      sheetsNeededSource = 'plan';
    } else {
      sheetsNeeded = Math.ceil(totalAreaNeededMm2 / catalogSheet.areaMm2);
      sheetsNeededSource = 'estimate';
    }

    const availableSheets = variant.subStock || 0;
    const shortfallQty = Math.max(0, sheetsNeeded - availableSheets);
    const compositeCode = `${sourceItem.code}#${sourceDimensionVariantId}#${dimensionSignature(bomDimensionsPerUnit)}`;
    return {
      kind: 'sheet', neededQty: sheetsNeeded, unit: 'sheet(s)', availableQty: availableSheets, shortfallQty,
      variant, compositeCode, sheetsNeededSource,
      // Sub Child Part's own sheet source is area-only (no fixed cut
      // rectangle — see subChildPartMasterController.js) — carried through
      // for the job-work Send Round's own capacity checks (a Case-1 "cut
      // piece" send just needs a variant with enough AREA, not an exact
      // shape match; only Case-2's whole-sheet substitution needs an exact
      // catalogSheet dimension match). Computed unconditionally regardless
      // of which method decided sheetsNeeded above.
      sourceDimensionVariantId, catalogSheet, totalAreaNeededMm2,
      demandSeed: {
        materialCode: compositeCode, materialName: sourceItem.name, sourceItemCode: sourceItem.code,
        quantity: sheetsNeeded, unit: 'Pieces', status: 'Requested',
        fabricationCategory: sourceItem.dimensionVariants?.[0]?.category || '', dimensionVariantId: sourceDimensionVariantId,
        // amountValue/amountUnit — the per-unit area this Sub Child Part
        // consumes (item.subChildPartDetails' own sourceQty/sourceUnit,
        // already in a human unit, no mm re-conversion needed) — carried
        // onto the demandSeed so Store's own Material List row (and this
        // tier's new Material List, buildSubChildPartRawMaterialList
        // below) can show a real per-piece "Amount", matching every other
        // tier's demandSeed convention (was left null/null here before).
        bomDimensions: {}, amountValue: sourceQty, amountUnit: sourceUnit, computedWeightPerPieceKg: null,
      },
    };
  }

  // Length-based (non-sheet) fabrication.
  const catalogPieceLengthMm = Number(variant.values?.length) || 0;
  if (!catalogPieceLengthMm) {
    return { kind: 'length', neededQty: null, unit: null, availableQty: null, shortfallQty: 0, variant, compositeCode: null, demandSeed: null };
  }
  const perPieceLengthMm = Number(bomDimensionsPerUnit.length) || 0;
  const totalLengthNeededMm = perPieceLengthMm * buildQty;
  const piecesNeeded = Math.ceil(totalLengthNeededMm / catalogPieceLengthMm);
  const availableQty = variant.subStock || 0;
  const shortfallQty = Math.max(0, piecesNeeded - availableQty);
  const compositeCode = `${sourceItem.code}#${sourceDimensionVariantId}`;
  const remainderMm = totalLengthNeededMm - (Math.floor(totalLengthNeededMm / catalogPieceLengthMm) * catalogPieceLengthMm);
  return {
    kind: 'length', neededQty: piecesNeeded, unit: 'piece(s)', availableQty, shortfallQty,
    variant, compositeCode,
    // Carried through for the job-work Send Round's leftover-combining
    // check: wholePieces of the fresh catalog variant + (if an existing
    // leftover's length exactly equals remainderMm) that one leftover piece
    // covers the need exactly, with no new offcut created.
    sourceDimensionVariantId, catalogPieceLengthMm, totalLengthNeededMm,
    wholePieces: Math.floor(totalLengthNeededMm / catalogPieceLengthMm),
    remainderMm,
    demandSeed: {
      materialCode: compositeCode, materialName: sourceItem.name, sourceItemCode: sourceItem.code,
      quantity: piecesNeeded, unit: 'Pieces', status: 'Requested',
      fabricationCategory: sourceItem.dimensionVariants?.[0]?.category || '', dimensionVariantId: sourceDimensionVariantId,
      // amountValue/amountUnit — see the sheet branch's own comment above.
      bomDimensions: bomDimensionsPerUnit, amountValue: sourceQty, amountUnit: sourceUnit, computedWeightPerPieceKg: null,
    },
  };
}

// Resolves the two real Items a Sub Child Part order's own Material List
// needs (the Sub Child Part Item itself + its one source raw material) —
// shared by buildSubChildPartRawMaterialList and requestSubChildPartRawMaterial
// below, same "resolve once, reuse" shape requestSubChildPartOrderMaterial
// (subChildPartOrderMfgController.js) already used before this pass.
async function resolveSubChildPartMaterialItems(order, companyId) {
  if (!order.subChildPartItem) return null;
  const item = await Item.findOne({ _id: order.subChildPartItem, companyId });
  if (!item?.subChildPartDetails?.sourceItem) return null;
  const sourceItem = await Item.findOne({ _id: item.subChildPartDetails.sourceItem, companyId });
  if (!sourceItem) return null;
  return { item, sourceItem };
}

// A Sub Child Part order's own Material List — always exactly one row
// (Item.subChildPartDetails is always a single source material), so this
// wraps computeSubChildPartRawMaterialAvailability's result directly into
// the same {categories:[{name, materials:[...]}]} shape Child Part's own
// Material List (computeSubChildPartMaterialRows/buildSubChildPartMaterialList,
// childPartReorderService.js — legacy naming, that one actually serves
// Child Part orders) and Machine's own (machineReorderService.js) already
// use, reusing the exact same frontend table. `amount`/`totalAmount` (the
// raw area/length consumed) are only meaningful for the two fabrication
// kinds — a plain item has just one number (its own qty/unit), same
// convention Child Part's own rows already use.
export async function buildSubChildPartRawMaterialList(order, companyId) {
  const resolved = await resolveSubChildPartMaterialItems(order, companyId);
  if (!resolved) return { categories: [] };
  const { item, sourceItem } = resolved;

  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const computed = await computeSubChildPartRawMaterialAvailability(item, sourceItem, buildQty);
  if (!computed.demandSeed) return { categories: [] };

  const { sourceQty, sourceUnit } = item.subChildPartDetails;
  const isFabrication = computed.kind === 'sheet' || computed.kind === 'length';
  const demandKey = computed.demandSeed.materialCode;
  const demand = (order.materialDemands || []).find(d => d.materialCode === demandKey);

  const material = {
    demandKey, code: sourceItem.code, name: sourceItem.name,
    processType: 'Raw Material',
    subProcessType: computed.kind === 'plain' ? 'Raw Material' : (sourceItem.isSheetMetal ? 'Sheet Metal' : 'Length Fabrication'),
    amount: isFabrication ? { value: sourceQty, unit: sourceUnit } : null,
    // quantity/unit — a plain (non-fabrication) source material's per-unit
    // qty is exact and meaningful (sourceQty itself, no rounding), so it's
    // shown. For the two fabrication kinds it's deliberately left blank
    // ("—" in the table) instead of totalQuantity/buildQty — confirmed
    // with the user 2026-09-19: the physical unit Store/Production actually
    // exchange is always a WHOLE catalog sheet/piece (totalQuantity is a
    // ceiling-rounded whole-piece count for the entire order), so a
    // fractional "per Sub Child Part unit" piece count (e.g. "0.5
    // sheet(s)") doesn't correspond to anything anyone actually does —
    // reconciling that rounding is exactly what the Return/leftover flow
    // is for.
    quantity: isFabrication ? null : sourceQty, unit: isFabrication ? null : sourceUnit,
    totalAmount: isFabrication ? Number((sourceQty * buildQty).toFixed(4)) : null,
    totalQuantity: computed.neededQty, totalQuantityLabel: computed.unit,
    issueUnit: computed.demandSeed.unit, issueTotal: computed.neededQty,
    availability: computed.shortfallQty === 0 ? 'Available' : 'Sent to Purchase',
    requestedQty: demand?.quantity || 0, transferredQty: demand?.transferredQuantity || 0,
    issuedQty: demand?.issuedQuantity || 0, returnPendingQty: demand?.returnPendingQuantity || 0,
    demandStatus: demand?.status || null,
  };
  // Category name = the row's own real kind ('Sheet Metal' / 'Length
  // Fabrication' / 'Raw Material'), NOT a hardcoded 'Raw Material' wrapper
  // — matching Child Part's/Machine's own Material List builders exactly.
  // Real bug, confirmed 2026-09-19: the frontend's Return dialog
  // (ProcessExecution.jsx) decides whether to ask for a measured leftover
  // length+width by checking row.category === 'Sheet Metal' (row.category
  // comes straight from this categories[].name) — hardcoding it to 'Raw
  // Material' meant that check was always false for a Sub Child Part row,
  // so the leftover fields never rendered, and the backend's own (correct)
  // returnMaterialToStore then rejected every sheet-metal-kind Sub Child
  // Part return with "A measured leftover length is required...".
  return { categories: [{ name: material.subProcessType, materials: [material] }] };
}

// Production's "Issue" button on this Material List — direct structural
// mirror of requestSubChildPartMaterial (childPartReorderService.js) one
// tier up: capped at the row's real total need, incremental (grows an
// existing demand rather than replacing it), no checkAndReserve/Purchase-
// Request side effect here — that already happened at order-creation time
// (resolveSubChildPartRawMaterialNeed below); Issue is purely a
// materialDemands[] write, same philosophy Child Part's/Machine's own
// requestXMaterial functions already use.
export async function requestSubChildPartRawMaterial(order, companyId, demandKey, requestQuantity) {
  const qty = Number(requestQuantity);
  if (!demandKey || !(qty > 0)) {
    return { ok: false, code: 400, message: 'A material and a positive quantity are required.' };
  }
  const resolved = await resolveSubChildPartMaterialItems(order, companyId);
  if (!resolved) {
    return { ok: false, code: 400, message: 'This Sub Child Part has no source raw material configured.' };
  }
  const { item, sourceItem } = resolved;

  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const computed = await computeSubChildPartRawMaterialAvailability(item, sourceItem, buildQty);
  if (!computed.demandSeed || computed.demandSeed.materialCode !== demandKey) {
    return { ok: false, code: 404, message: 'That material is not on this order\'s material list.' };
  }

  const existing = order.materialDemands.find(d => d.materialCode === demandKey);
  const alreadyRequested = existing?.quantity || 0;
  if (alreadyRequested + qty > computed.neededQty) {
    const remaining = Math.max(0, computed.neededQty - alreadyRequested);
    return {
      ok: false, code: 400,
      message: `Can only request ${remaining} more ${computed.demandSeed.unit} of "${sourceItem.name}" — the whole order needs ${computed.neededQty}.`,
    };
  }

  if (existing) {
    existing.quantity = alreadyRequested + qty;
    if (existing.status === 'Issued' && existing.issuedQuantity < existing.quantity) {
      existing.status = 'Requested';
      order.materialIssued = false;
    }
  } else {
    order.materialDemands.push({ ...computed.demandSeed, quantity: qty, status: 'Requested' });
  }
  await order.save();
  return { ok: true, data: order };
}

// Availability-aware analogue of subChildPartMasterController.js's
// computeSourceMetrics — resolves how much of sourceItem's own stock this
// order needs, checks it against what's on hand, and auto-raises a Purchase
// Request for any shortfall. Returns a demandSeed (for the In-House route's
// materialDemands[] — see MaterialDemandSchema) alongside the raw numbers
// (for the Out-Source route's rawMaterial snapshot).
//
// This is the one CREATION-TIME wrapper around
// computeSubChildPartRawMaterialAvailability (which stays pure/side-effect-
// free — see its own comment, it's also called from live-recheck GET/guard
// paths that must never mutate state just from reading status) — so the
// reservation ledger (checkAndReserve, materialReservationService.js) is
// wired in HERE, not there. Fixes a real, verified bug (2026-09-17): two
// different orders each independently checking this same raw material's
// RAW qty (with no awareness of what the other had already claimed) could
// both see "enough for me" even when their combined need exceeded actual
// stock — checkAndReserve tracks what's already claimed and shrinks
// shortfallQty accordingly for every caller after the first.
async function resolveSubChildPartRawMaterialNeed(item, sourceItem, buildQty, order) {
  const computed = await computeSubChildPartRawMaterialAvailability(item, sourceItem, buildQty);
  if (computed.neededQty == null) return { ...computed, purchaseRequestId: null };

  // availableQty: computed.availableQty, not the checkAndReserve default —
  // computeSubChildPartRawMaterialAvailability above already correctly
  // resolved this (sourceItem.qty for 'plain', the real dimension variant's
  // subStock for 'sheet'/'length' — see its own lines 104/152/183), so pass
  // it straight through instead of letting checkAndReserve silently
  // recompute a wrong one off sourceItem.qty for a fabrication source item
  // (confirmed bug, 2026-09-18 — that recomputed value was overwriting this
  // correct one at the return below).
  const { freeQty, shortfallQty } = await checkAndReserve({
    item: sourceItem, neededQty: computed.neededQty, availableQty: computed.availableQty, order,
    orderModel: order.constructor.modelName, companyId: item.companyId,
  });

  let purchaseRequestId = null;
  if (shortfallQty > 0) {
    if (computed.kind === 'plain') {
      purchaseRequestId = await raisePlainPurchaseRequest({ item: sourceItem, shortfallQty, order });
    } else if (computed.kind === 'sheet' || computed.kind === 'length') {
      purchaseRequestId = await raiseFabricationPurchaseRequest({
        matItem: sourceItem, dimensionValues: computed.variant?.values, piecesShort: shortfallQty,
        compositeMaterialCode: computed.compositeCode, order,
      });
    }
  }
  return { ...computed, availableQty: freeQty, shortfallQty, purchaseRequestId };
}

// Live-recheck sibling of resolveSubChildPartRawMaterialNeed above — same
// idea (layer the reservation ledger on top of the pure
// computeSubChildPartRawMaterialAvailability), but READ-ONLY: no
// checkAndReserve write, no Purchase Request. For the Sub Child Part Job
// Work page's own list/detail badge and its real send-time gate
// (subChildPartJobWorkOrderController.js) — both need an honest,
// reservation-aware shortfall number on every re-read, not just once at
// order creation. Excludes the order's OWN existing reservation from the
// free-qty sum (getFreeQtyExcludingOrder, not getFreeQty) — otherwise a
// re-check of this same order's own availability would double-count its own
// already-secured claim as if it were a competing order's, understating
// what's really free for it. Confirmed with the user (2026-09-19): shortfall
// here stays strictly catalog-variant-based, same as the pure function
// underneath — never folds in leftover (isLeftover:true) stock; a leftover
// is only ever a "use case" (an alternate source Purchase can choose at the
// actual send action), never a factor in whether a shortfall is reported.
export async function computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order) {
  const computed = await computeSubChildPartRawMaterialAvailability(item, sourceItem, order.orderQuantity);
  if (computed.neededQty == null) return computed;
  const freeQty = await getFreeQtyExcludingOrder(sourceItem._id, computed.availableQty, item.companyId, order._id);
  const shortfallQty = Math.min(computed.neededQty, Math.max(0, computed.neededQty - freeQty));
  return { ...computed, availableQty: freeQty, shortfallQty };
}

// Sub Child Part orders/job-work are only ever raised by these three
// independent triggers — a shared list so "is X a real known source" checks
// (dedup query construction below) can't silently typo a fourth value into
// existence. 'MachineCascade' reaches this tier via propagation, not a
// direct call — see childPartReorderService.js's
// checkSubChildPartMaterialAvailability, which passes through whatever
// demandSource the Child Part order it's operating on was itself raised
// with, instead of always hardcoding 'ChildPartCascade'.
const DEMAND_SOURCES = ['LowStock', 'ChildPartCascade', 'MachineCascade'];

// Dedup match for one demandSource — 'LowStock' also matches records that
// predate this field entirely (every order raised before the cascade
// existed IS a LowStock order by definition; treating a missing value as
// 'LowStock' here means no migration/backfill was needed to introduce it).
// For a cascade-type source, ALSO requires an exact demandRefId match — two
// different Child Part orders both cascading for the same Sub Child Part
// are two different demands, not one; without this, the second one's
// cascade attempt would see "an order already exists" and silently drop
// its own need (confirmed bug, 2026-09-17).
function demandSourceMatch(demandSource, demandRefId) {
  return demandSource === 'LowStock'
    ? { $or: [{ demandSource: 'LowStock' }, { demandSource: { $exists: false } }] }
    : { demandSource, demandRefId };
}

// Reusable per-item order-raise — extracted (2026-09-16) from what used to be
// runSubChildPartOrderSweep's own per-item loop body, so the Child Part
// cascade (childPartReorderService.js's checkSubChildPartMaterialAvailability
// — a Child Part order needing more of this Sub Child Part than is on hand)
// can trigger a Sub Child Part order for a specific Item without duplicating
// this file's own creation/routing/raw-material-check/notification logic.
// Deliberately does NOT re-check item.qty vs item.minStock — that's
// runSubChildPartOrderSweep's OWN trigger (this Sub Child Part's own reorder
// point); a caller invoking this directly has a different reason to want
// this Item built and must not be silently blocked by that unrelated check.
//
// `demandSource` ('LowStock' by default, or 'ChildPartCascade' from the
// cascade) scopes BOTH the dedup check and what gets written onto the
// created order — the two sources are deliberately allowed to each have
// their own open order for the same Sub Child Part Item at once (confirmed
// with the user 2026-09-16: a Sub Child Part's own reorder-point build and a
// specific Child Part's build needing more of it right now are genuinely
// different reasons to build more, not the same demand twice), each capped
// independently at one open order at a time. `buildQtyOverride` lets the
// cascade size its own order to the actual quantity the Child Part's BOM
// line requires (line.quantity × that Child Part order's own quantity)
// instead of this Sub Child Part's generic reorderQty — the cascade's whole
// point is a build has a specific need right now, not "however much this
// Sub Child Part normally restocks by."
export async function createSubChildPartOrderForItem(item, companyId, { demandSource = 'LowStock', buildQtyOverride, demandRefId = null } = {}) {
  if (!DEMAND_SOURCES.includes(demandSource)) {
    throw new Error(`createSubChildPartOrderForItem: unknown demandSource "${demandSource}"`);
  }
  if (!item.subChildPartDetails?.sourceItem) {
    console.error(`[SubChildPartOrder] Skipping ${item.code} — no source raw material configured.`);
    return { created: false, reason: 'no-source-item' };
  }

  // Phase 2: routing now reads the dynamic Process Definition instead of
  // the removed jobWork boolean (see server/docs/process-inhouse-outsource-
  // redesign-discussion-2026-09.md). A PURE Out Source order behaves
  // exactly as before — the one case SubChildPartJobWorkOrder still owns
  // entirely, untouched. PureInHouse and Hybrid both get a real
  // ProductionOrder with a dynamic processes[] pipeline below (replacing
  // the old always-empty processes: [] and the bespoke single-stage flow
  // subChildPartOrderMfgController.js used to route in-house orders
  // through) — a Hybrid order is the one genuinely new shape here.
  const flatSteps = flattenProcessDefinition(item.subChildPartDetails.processDefinition);
  const classification = classifyProcessDefinition(flatSteps);
  const isOutSource = classification === 'PureOutSource';

  if (isOutSource) {
    const existing = await SubChildPartJobWorkOrder.exists({
      subChildPartItem: item._id, status: { $in: OPEN_JOB_WORK_STATUSES }, ...demandSourceMatch(demandSource, demandRefId),
    });
    if (existing) return { created: false, reason: 'open-job-work-exists' };
  } else {
    const existing = await ProductionOrder.exists({
      subChildPartItem: item._id, orderKind: 'SubChildPart', status: { $in: OPEN_PRODUCTION_STATUSES }, ...demandSourceMatch(demandSource, demandRefId),
    });
    if (existing) return { created: false, reason: 'open-order-exists' };
  }

  const createdBy = await resolveCreatedBy(item);
  if (!createdBy) {
    console.error(`[SubChildPartOrder] Skipping ${item.code} — no createdBy and no company user found to fall back to.`);
    return { created: false, reason: 'no-createdBy' };
  }

  const sourceItem = await Item.findOne({ _id: item.subChildPartDetails.sourceItem, companyId: item.companyId });
  if (!sourceItem) {
    console.error(`[SubChildPartOrder] Skipping ${item.code} — its source raw material Item no longer exists.`);
    return { created: false, reason: 'source-item-missing' };
  }

  const buildQty = buildQtyOverride != null
    ? Math.max(1, Number(buildQtyOverride) || 1)
    : Math.max(1, Number(item.reorderQty) || 1);
  // Derived from the Out Source internal process names on the Process
  // Definition — replaces the old jobWorkTypes field, but kept as the same
  // flat string array shape for SubChildPartJobWorkOrder's own checklist
  // (its rounds mechanic keys off these names, unchanged since before
  // Phase 1) and for ProductionOrder.subChildPartJobWorkTypes' informational
  // display.
  const jobWorkTypes = flatSteps.filter(s => s.type === 'OutSource').map(s => s.name);

  if (isOutSource) {
    const orderId = await generateSubChildPartOrderId();
    // Create first (rawMaterial check needs order._id for PurchaseRequest.storeOrderId), then patch the snapshot in.
    const order = await SubChildPartJobWorkOrder.create({
      orderId,
      subChildPartItem: item._id,
      itemCode: item.code,
      itemName: item.name,
      orderQuantity: buildQty,
      demandSource,
      demandRefId,
      jobWorkTypes,
      company: item.companyId,
      createdBy,
      receivedDate: today(),
      deliveryDate: today(),
    });
    const need = await resolveSubChildPartRawMaterialNeed(item, sourceItem, buildQty, order);
    order.rawMaterial = {
      sourceItem: sourceItem._id, neededQty: need.neededQty, unit: need.unit,
      availableQty: need.availableQty, shortfallQty: need.shortfallQty,
      purchaseRequestId: need.purchaseRequestId, checkedAt: new Date(),
    };
    await order.save();

    try {
      await notificationService.triggerAccountsNotification({
        action: 'sub_child_job_work_created',
        data: {
          orderId: order.orderId, orderRecordId: String(order._id),
          itemCode: item.code, itemName: item.name,
          orderQuantity: buildQty, jobWorkTypes,
        },
        targetCompanyId: item.companyId,
      });
    } catch (e) { console.error('[SubChildPartOrder] notification error:', e); }
    return { created: true, kind: 'out-source', order };
  }

  const orderId = await generateOrderId(item.companyId);
  const processes = buildOrderStepsFromProcessDefinition(item.subChildPartDetails.processDefinition);
  const order = await ProductionOrder.create({
    orderId,
    orderKind: 'SubChildPart',
    subChildPartItem: item._id,
    machineCode: item.code,
    machineName: item.name,
    orderQuantity: buildQty,
    demandSource,
    demandRefId,
    source: 'Stock',
    receivedDate: today(),
    deliveryDate: today(),
    company: item.companyId,
    createdBy,
    processes,
    subChildPartJobWorkTypes: jobWorkTypes,
  });
  // Availability is still checked now (raises a Purchase Request for
  // any shortfall, same as the Out-Source branch above), but the
  // demandSeed itself is deliberately NOT pushed onto materialDemands
  // here — that would make Store's Pending Transfers show this
  // material the instant the order exists, before Production is even
  // ready for it. Its Store demand is only ever created by Production's
  // explicit "Issue" action — see requestSubChildPartOrderMaterial in
  // subChildPartOrderMfgController.js.
  await resolveSubChildPartRawMaterialNeed(item, sourceItem, buildQty, order);

  // A Hybrid order whose first step is Out Source is still auto-routed to
  // Purchase directly — the same custody rule a pure Out Source Sub Child
  // Part order already gets, and the ONLY level where this auto-bypass
  // applies (confirmed 2026-09-22: Child Part/Machine always require
  // Production's own explicit "Send for Outsourcing" click, even on their
  // own first step — see childPartReorderService.js/machineReorderService.js,
  // which never do this). Seeds the first hand-off as already 'Requested'
  // so Purchase can act on it directly with no Production click needed for
  // this one; Production only gets a Send action once it reaches a LATER
  // Out Source step (outsourceWorkController.js, Stage 3).
  const firstStepIsOutSource = classification === 'Hybrid' && processes[0]?.type === 'Outsourcing';
  if (firstStepIsOutSource) {
    order.processes[0].outsourceStatus = 'Requested';
    order.outsourceHandoffs.push({
      unitIndices: [0],
      stepIndices: [0],
      stepNames: [processes[0].step],
      isFirstStepOfOrder: true,
      status: 'Requested',
      requestedAt: new Date(),
    });
    await order.save();
  }

  try {
    await notificationService.triggerProductionNotification({
      action: 'order_for_production',
      data: { orderCode: orderId, orderId: order._id, machineName: item.name },
      targetCompanyId: item.companyId,
    });
    if (firstStepIsOutSource) {
      await notificationService.triggerAccountsNotification({
        action: 'sub_child_job_work_created',
        data: {
          orderId: order.orderId, orderRecordId: String(order._id),
          itemCode: item.code, itemName: item.name,
          orderQuantity: buildQty, jobWorkTypes: [processes[0].step],
        },
        targetCompanyId: item.companyId,
      });
    }
  } catch (e) { console.error('[SubChildPartOrder] notification error:', e); }
  return { created: true, kind: classification === 'Hybrid' ? 'hybrid' : 'in-house', order };
}

export async function runSubChildPartOrderSweep() {
  const stats = { scanned: 0, created: 0 };
  const items = await Item.find({
    productKind: 'SubChildPart',
    isDiscontinued: { $ne: true },
    minStock: { $gt: 0 },
  });

  for (const item of items) {
    stats.scanned++;
    try {
      if ((item.qty || 0) > (item.minStock || 0)) continue;
      const result = await createSubChildPartOrderForItem(item, item.companyId);
      if (result.created) stats.created++;
    } catch (err) {
      console.error(`[SubChildPartOrder] Error processing item ${item.code}:`, err);
    }
  }

  console.log(`[SubChildPartOrder] Sweep complete — scanned ${stats.scanned} item(s), created ${stats.created} order(s).`);
  return stats;
}
