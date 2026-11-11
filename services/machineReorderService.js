// Machine — the top of the BOM hierarchy (Raw Material -> Sub Child Part ->
// Child Part -> Machine). A Machine order is raised three ways: Store's
// order-form flow (storeFlowService.js's applyStoreDecisionToItem, CASE 2: an
// in-house-manufactured Sale item that's Not Available), the New Stock Order
// form, and the low-stock sweep at the end of this file (2026-11-06). This
// file holds a real BOM-aware material check for the Machine order once it's
// created, cascading into real Child Part orders instead of flat Purchase
// Requests for the Child Parts it's built from, mirroring
// childPartReorderService.js's own checkSubChildPartMaterialAvailability one
// tier down exactly.
//
// Full cutover (2026-09-16), not a coexistence flow: the OLD RDBOM this
// order-creation path used to read is retired here entirely — confirmed
// with the user, who has already created real MachineBOM documents (BP816,
// PRO-0014) via R&D > BOM Management. A machine with no MachineBOM yet
// simply gets no check at all (see findMachineMaterialLines returning null)
// until one is created — RDBOM stays exactly where it already is, visible
// only inside BOM Management's own "Child Part / Machine BOM (Legacy)" tab.
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';
import MachineBOM from '../models/MachineBOM.js';
import Sale from '../models/Sale.js';
import { plainMaterialGroupsFromBOM, lengthFabricationGroupsFromBOM, sheetMetalCutGroupsFromBOM } from './bomMaterialGroupsService.js';
import { raisePlainPurchaseRequest, raiseFabricationPurchaseRequest } from './materialAvailabilityService.js';
import { isBought } from './makeBuyService.js';
import { isReleased, isPurchaseMachine } from './productApprovalService.js';
import { checkAndReserve, getFreeQty, getFreeQtyExcludingOrder } from './materialReservationService.js';
import { recordCascadeCover, cascadeOnRow, cascadeIssueLimit, finishedViaStore } from './cascadeDeliveryService.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { sheetAreaFromItem } from '../controllers/sheetMetalPlanController.js';
import { createChildPartOrderForItem, resolveCreatedBy } from './childPartReorderService.js';
import ProductionOrder, { buildProcessSteps, buildStepsFromList, MACHINE_BOM_STEPS } from '../models/ProductionOrder.js';
import { generateOrderId } from '../controllers/productionMfgController.js';
import notificationService from './notificationService.js';
import { buildOrderStepsFromProcessDefinition } from './processStepBuilderService.js';
import { outsourceMaterialOnOrder } from './outsourceEarmarkService.js';

// Resolves a Machine order's own machine Item — a Machine order (unlike
// Child Part/Sub Child Part) has no direct ObjectId ref to its own Item,
// only machineCode (String). Shared by every Material List function below
// (checkMachineAssemblyMaterialAvailability does its own equivalent lookup
// inline since it only needs the id, not the full item).
async function resolveMachineItem(order, companyId) {
  return Item.findOne({ code: order.machineCode, companyId, productKind: 'Machine' }).lean();
}

// Decides a brand-new Machine order's real processes[] shape — called
// explicitly at every order-creation site (never left to the schema's own
// `default: buildProcessSteps`, which fires with zero arguments and so can
// never see orderKind, let alone do an async MachineBOM lookup — see
// ProductionOrder.js's MACHINE_BOM_STEPS comment). Takes the raw machineCode
// field a new order is being created with, which is overloaded across
// creation sites — usually a real Item.code, but sometimes the Item's own
// ObjectId string (Store-originated QC-rejected rebuilds, see
// qcController.js's createRejectedProductionOrder) — so both shapes are
// tried, same dual-lookup convention storeFlowService.js's own
// resolveInventoryItem already uses. Falls through to the OLD 6-step shape
// whenever the Item or its MachineBOM can't be resolved — a machine with no
// MachineBOM yet behaves exactly as it always has.
export async function resolveMachineOrderProcesses(machineCode, companyId) {
  if (!machineCode) return buildProcessSteps('Machine');
  const query = mongoose.Types.ObjectId.isValid(machineCode)
    ? { _id: machineCode, companyId, productKind: 'Machine' }
    : { code: machineCode, companyId, productKind: 'Machine' };
  const item = await Item.findOne(query).select('_id').lean();
  if (!item) return buildProcessSteps('Machine');
  const bom = await MachineBOM.findOne({ machine: item._id, company: companyId }).select('processDefinition').lean();
  if (!bom) return buildProcessSteps('Machine');
  // Phase 2: build the real processes[] from this Machine's own BOM Process
  // Definition when one's been configured — falls back to the old hardcoded
  // MACHINE_BOM_STEPS shape for a MachineBOM that exists but hasn't had a
  // Process Definition set up yet (optional at this level, per Phase 1),
  // same "behave exactly as before until R&D opts in" convention as the
  // no-MachineBOM-at-all fallback above.
  return bom.processDefinition?.length
    ? buildOrderStepsFromProcessDefinition(bom.processDefinition)
    : buildStepsFromList(MACHINE_BOM_STEPS);
}

// Resolves a Machine Item's own MachineBOM. Returns `.materials` as a
// combined (childParts[] + materials[]) array, normalized/tagged with
// `lineKind` the same way findSubChildPartMaterialLines does one tier down
// (Child Part reference lines only ever have `.name`, never `.item` — the
// shape a BOM View-style modal would read) — now actually reused by
// getBomDesignStatus's Machine branch and the Machine Material List
// (2026-09-17). `unit: 'Pieces'` is added on each Child Part reference row
// since MachineBOM.js's ChildPartLineSchema has no `unit` field of its own
// (unlike ChildPartBOM.js's SubChildPartLineSchema, which does) — a Child
// Part is always counted in whole pieces, same convention Sub Child Part
// reference rows already use one tier down.
export async function findMachineMaterialLines(machineItemId, companyId) {
  const bom = await MachineBOM.findOne({ machine: machineItemId, company: companyId }).lean();
  if (!bom) return null;
  const childPartLines = (bom.childParts || []).filter(l => !l.isDiscontinued);
  const materialLines = (bom.materials || []).filter(m => !m.isDiscontinued);
  return {
    bom, childPartLines, materialLines,
    materials: [
      ...childPartLines.map(l => ({ ...l, item: l.name, unit: 'Pieces', lineKind: 'ChildPart' })),
      ...materialLines.map(m => ({ ...m, lineKind: 'Material' })),
    ],
  };
}

// Checks the Child Part cascade AND Tier 1 (plain) / 2 (sheet metal) / 3
// (length fabrication) direct-material shortfalls for one Machine
// production run, and — if this order carries a saleId/saleItemId (it
// always does, created from Store's order-form flow) — persists the result
// onto Sale.items[].materialAvailability the same way the old,
// now-retired computeMaterialAvailabilityForOrder used to (targeted
// Sale.updateOne, never a load-then-save of the whole document), so Store
// Orders' hover badge keeps working, now showing real Child Part orders
// instead of only flat Purchase Requests for that tier. Never touches
// order.materialDemands — same convention as every other order kind in this
// hierarchy: that array stays empty until Production's own "Issue" click
// (next session's Material List pass).
export async function checkMachineAssemblyMaterialAvailability(productionOrder, companyId) {
  // A Machine order (unlike Child Part/Sub Child Part) has no direct ObjectId
  // ref to its own Item — only machineCode (String) — same resolution
  // productionMfgController.js's getBomDesignStatus already uses for its own
  // Machine branch.
  const machineItem = await Item.findOne({ code: productionOrder.machineCode, companyId, productKind: 'Machine' }).select('_id').lean();
  if (!machineItem) {
    return { checked: false, reason: 'No Machine Item found for this order’s machineCode.' };
  }
  const found = await findMachineMaterialLines(machineItem._id, companyId);
  if (!found || !found.materials.length) {
    return { checked: false, reason: 'No Machine BOM found for this machine.' };
  }
  const { childPartLines, materialLines } = found;
  const pseudoBom = { materials: materialLines };
  const buildQty = Math.max(1, Number(productionOrder.orderQuantity) || 1);

  const available = [];
  const needsPurchase = [];
  const childParts = [];

  // ── Child Part cascade — a shortfall here raises a real Child Part order,
  // not a Purchase Request. Tagged demandSource:'MachineCascade' so it's
  // tracked independently from whatever that Child Part's OWN reorder-point
  // cron may have already raised (demandSource:'LowStock') — the two are
  // allowed to coexist, each capped at one open order at a time;
  // createChildPartOrderForItem's dedup guard is scoped by this same value.
  // Sized to the ACTUAL quantity this Machine build needs (this BOM line's
  // own per-unit quantity × this order's quantity), not the Child Part's
  // generic reorderQty — same convention already confirmed one tier down.
  for (const line of childPartLines) {
    const cpItem = await Item.findOne({ _id: line.childPart, companyId });
    if (!cpItem) continue;
    const neededQty = (Number(line.quantity) || 0) * buildQty;
    // Serial number work step 1 (2026-10-31, P1): a BUILT part reserves only
    // what free stock covers, and its cascade order is built for the
    // shortfall and delivers straight to this order. A bought part keeps the
    // full reservation (its purchase arrives into stock and Store issues it).
    const built = !isBought(cpItem);
    const { freeQty, shortfallQty } = await checkAndReserve({ item: cpItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `cp:${cpItem.code}`, capToFree: built });
    if (shortfallQty === 0) continue;
    // Bought from a vendor (make or buy, 2026-10-28): the shortfall is a
    // purchase request, like a short raw material — never a build order.
    if (isBought(cpItem)) {
      // Automatic orders wait for R&D's Release — a bought part too (2026-10-29).
      if (!isReleased(cpItem)) {
        console.warn(`[MachineCascade] ${productionOrder.orderId}: no purchase request for ${cpItem.code} (bought), short ${shortfallQty} — not released yet.`);
        continue;
      }
      const purchaseRequestId = await raisePlainPurchaseRequest({ item: cpItem, shortfallQty, order: productionOrder });
      needsPurchase.push({ code: cpItem.code, name: cpItem.name, neededQty, availableQty: freeQty, shortfallQty, unit: cpItem.unit || 'Pieces', purchaseRequestId });
      continue;
    }
    const result = await createChildPartOrderForItem(cpItem, companyId, { demandSource: 'MachineCascade', buildQtyOverride: shortfallQty, demandRefId: productionOrder._id, deliverToParent: true, parentOrderNo: productionOrder.orderId });
    if (result.order?.deliverToParent) {
      await recordCascadeCover(productionOrder._id, {
        partItem: cpItem._id, partCode: cpItem.code, partName: cpItem.name, unit: 'Pieces',
        qty: result.order.orderQuantity, viaStore: finishedViaStore(result.order), child: { model: 'ProductionOrder', orderRef: result.order._id, orderNo: result.order.orderId },
      });
    } else {
      // No order will deliver it (e.g. not released yet): the full need stays
      // on stock, as before.
      await checkAndReserve({ item: cpItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `cp:${cpItem.code}` });
    }
    // A short Child Part that got no order is otherwise silent (found
    // 2026-10-21: a machine order's Chamber was never raised and nothing said
    // why) — say which reason stopped it.
    if (!result.created) {
      console.warn(`[MachineCascade] ${productionOrder.orderId}: no Child Part order for ${cpItem.code} (${cpItem.name}), short ${shortfallQty} — ${result.reason || 'unknown reason'}.`);
    }
    childParts.push({
      code: cpItem.code, name: cpItem.name, neededQty, availableQty: freeQty, shortfallQty,
      productionOrderId: result.order?._id || null, productionOrderCode: result.order?.orderId || null,
    });
  }

  // ── Tier 1 — plain raw materials / tools.
  for (const g of plainMaterialGroupsFromBOM(pseudoBom)) {
    const matItem = await Item.findOne({ code: g.itemCode, companyId });
    if (!matItem) continue;
    const neededQty = g.perUnitQty * buildQty;
    const { freeQty, shortfallQty } = await checkAndReserve({ item: matItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId, lineKey: `plain:${matItem.code}` });
    if (shortfallQty === 0) {
      available.push({ code: g.itemCode, name: matItem.name, neededQty, availableQty: freeQty, unit: matItem.unit });
    } else {
      const purchaseRequestId = await raisePlainPurchaseRequest({ item: matItem, shortfallQty, order: productionOrder });
      needsPurchase.push({ code: g.itemCode, name: matItem.name, neededQty, availableQty: freeQty, shortfallQty, unit: matItem.unit, purchaseRequestId });
    }
  }

  // ── Tier 2 — sheet metal, grouped by the actual cut (sheetMetalCutGroupsFromBOM).
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
    const { freeQty: freeSheets, shortfallQty: sheetsShort } = await checkAndReserve({ item: matItem, neededQty: sheetsNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId, variantId: variant._id, lineKey: `sheet:${line.key}` });
    if (sheetsShort === 0) {
      available.push({ code: line.key, name: line.itemName, neededQty: sheetsNeeded, availableQty: freeSheets, unit: 'Pieces' });
    } else {
      const purchaseRequestId = await raiseFabricationPurchaseRequest({
        matItem, dimensionValues: variant.values, piecesShort: sheetsShort,
        compositeMaterialCode: line.key, order: productionOrder,
      });
      needsPurchase.push({ code: line.key, name: line.itemName, neededQty: sheetsNeeded, availableQty: freeSheets, shortfallQty: sheetsShort, unit: 'Pieces', purchaseRequestId });
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
    const key = `${g.itemCode}#${g.dimensionVariantId}`;
    // availableQty: this variant's own subStock, NOT matItem.qty (always 0
    // for a fabrication item — confirmed bug, 2026-09-18).
    const { freeQty, shortfallQty } = await checkAndReserve({ item: matItem, neededQty: piecesNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId, variantId: variant._id, lineKey: `length:${g.itemCode}#${g.dimensionVariantId}` });
    if (shortfallQty === 0) {
      available.push({ code: key, name: g.itemName, neededQty: piecesNeeded, availableQty: freeQty, unit: 'Pieces' });
    } else {
      const purchaseRequestId = await raiseFabricationPurchaseRequest({
        matItem, dimensionValues: variant.values, piecesShort: shortfallQty,
        compositeMaterialCode: key, order: productionOrder,
      });
      needsPurchase.push({ code: key, name: g.itemName, neededQty: piecesNeeded, availableQty: freeQty, shortfallQty, unit: 'Pieces', purchaseRequestId });
    }
  }

  if (productionOrder.saleId && productionOrder.saleItemId) {
    await Sale.updateOne(
      { _id: productionOrder.saleId, 'items._id': productionOrder.saleItemId },
      { $set: { 'items.$.materialAvailability': { computedAt: new Date(), available, needsPurchase, childParts } } }
    );
  }

  return { checked: true, available, needsPurchase, childParts };
}

// ─── Material List (2026-09-17) — mirrors childPartReorderService.js's
// computeSubChildPartMaterialRows/buildSubChildPartMaterialList/
// requestSubChildPartMaterial exactly, one tier up: Child Part reference
// rows instead of Sub Child Part ones, everything else (categorization,
// live availability, Issue capping) identical. Small helpers below are
// deliberately duplicated rather than imported from childPartReorderService.js
// — same per-file-independence convention already used for resolveCreatedBy
// across the three reorder services in this codebase.
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
// items whose Item Type is "Job Work" (sent out for a service). Informational
// only here (Machine's own Job Work step still reads the OLD RDBOM-based
// buildMaterialListGroups, untouched — see this file's own header comment) —
// kept for row-shape parity with the Child Part Material List, not wired
// into any gate yet.
const JOB_WORK_SHEET = 'Laser Cutting';
function jobWorkInfoFor(processType, subProcessType, jobWorkType) {
  if (subProcessType === 'Sheet Metal') return { isJobWorkInput: true, workType: JOB_WORK_SHEET };
  if ((processType || '').trim().toLowerCase() === 'job work') {
    return { isJobWorkInput: true, workType: jobWorkType || 'Job Work' };
  }
  return { isJobWorkInput: false, workType: null };
}

// Flat, fully-detailed row model — same single-source-of-truth convention
// computeSubChildPartMaterialRows uses (the API list and the issue-request
// endpoint both read from this, so the CAP a row shows and the CAP the
// request validates against always agree).
export async function computeMachineMaterialRows(order, companyId) {
  const machineItem = await resolveMachineItem(order, companyId);
  if (!machineItem) return { rows: [], buildQty: 1 };
  const found = await findMachineMaterialLines(machineItem._id, companyId);
  if (!found || !found.materials.length) return { rows: [], buildQty: 1 };
  const { childPartLines, materialLines } = found;
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

  // ── Child Part — one row per bom.childParts[] line. No Purchase Request
  // involved on shortfall (checkMachineAssemblyMaterialAvailability raises
  // a real Child Part order instead), so availability here reads
  // "In Production" instead of "Sent to Purchase" once short.
  for (const line of childPartLines) {
    const cpItem = await Item.findOne({ _id: line.childPart, companyId }).lean();
    if (!cpItem) continue;
    const issueTotal = (Number(line.quantity) || 0) * buildQty;
    const available = (await getFreeQtyExcludingOrder(cpItem._id, cpItem.qty || 0, companyId, order._id)) + (demandByKey.get(cpItem.code)?.transferredQuantity || 0) >= issueTotal;
    rows.push({
      category: 'Child Part', demandKey: cpItem.code, sourceItemCode: cpItem.code,
      code: cpItem.code, name: cpItem.name,
      processType: 'Child Part', subProcessType: 'Child Part',
      amount: null, perPieceQty: line.quantity, perPieceUnit: 'Pieces',
      totalAmount: null, totalQuantity: issueTotal, totalQuantityLabel: 'Pieces',
      issueUnit: 'Pieces', issueTotal,
      available,
      isChildPartRow: true,
      demandSeed: {
        materialCode: cpItem.code, materialName: cpItem.name, sourceItemCode: cpItem.code,
        fabricationCategory: '', dimensionVariantId: null, bomDimensions: {},
        amountValue: null, amountUnit: null, computedWeightPerPieceKg: null, unit: 'Pieces',
      },
      ...joinDemand(cpItem.code),
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
      demandSeed: {
        materialCode: line.key, materialName: line.itemName, sourceItemCode: line.itemCode,
        fabricationCategory: line.fabricationCategory, dimensionVariantId: line.dimensionVariantId,
        bomDimensions: {}, amountValue: line.amountValue ?? null, amountUnit: line.amountUnit ?? null,
        computedWeightPerPieceKg: null, unit: 'Pieces',
      },
      ...joinDemand(line.key),
    });
  }

  // ── Length Fabrication — grouped by {code, dimensionVariantId}.
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

  // Tag Job Work inputs (sheet metal + Item Type "Job Work") with their work
  // type — informational only for Machine, see this section's own header.
  for (const r of rows) {
    const { jobWorkType } = await resolveMeta(r.code);
    Object.assign(r, jobWorkInfoFor(r.processType, r.subProcessType, jobWorkType));
  }

  return { rows, buildQty };
}

const CATEGORY_ORDER = ['Child Part', 'Assembly Materials', 'Consumables', 'Sheet Metal', 'Length Fabrication'];

export async function buildMachineMaterialList(order, companyId) {
  const { rows } = await computeMachineMaterialRows(order, companyId);
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
        availability: r.available === null ? 'Unknown' : (r.available ? 'Available' : (r.isChildPartRow ? 'In Production' : 'Sent to Purchase')),
        requestedQty: r.requestedQty, transferredQty: r.transferredQty,
        issuedQty: r.issuedQty, returnPendingQty: r.returnPendingQty, demandStatus: r.demandStatus,
        toVendor: toVendor.get(r.demandKey)?.store > 0 ? { store: toVendor.get(r.demandKey).store, orders: toVendor.get(r.demandKey).orders } : null,
        // Serial number work step 1: built for this order by its cascade —
        // delivered straight here, so Store is asked only for the rest.
        cascade: r.isChildPartRow ? cascadeOnRow(order, r.demandKey) : null,
        issueLimit: cascadeIssueLimit(r.issueTotal, r.isChildPartRow ? cascadeOnRow(order, r.demandKey) : null, toVendor.get(r.demandKey)?.store || 0, r.issueUnit),
      })),
    };
    if (name === 'Child Part') {
      cat.note = 'A short Child Part raises its own order automatically — nothing to purchase here.';
    }
    if (name === 'Sheet Metal') {
      cat.note = 'This quantity completes the order. Return any usable leftover sheet to Store.';
    }
    categories.push(cat);
  }
  return { categories };
}

// Production's "Issue" button on the Material List — same cap/no-R&D-approval
// convention as requestSubChildPartMaterial one tier down.
export async function requestMachineMaterial(order, companyId, demandKey, requestQuantity) {
  const qty = Number(requestQuantity);
  if (!demandKey || !(qty > 0)) {
    return { ok: false, code: 400, message: 'A material and a positive quantity are required.' };
  }

  const { rows } = await computeMachineMaterialRows(order, companyId);
  const row = rows.find(r => r.demandKey === demandKey);
  if (!row) {
    return { ok: false, code: 404, message: 'That material is not on this order\'s material list.' };
  }

  const existing = order.materialDemands.find(d => d.materialCode === demandKey);
  // Serial number work step 1: what came straight from this order's cascade
  // isn't a request to Store, and what it still builds can't be asked of Store.
  const alreadyRequested = (existing?.quantity || 0) - (existing?.cascadeDeliveredQuantity || 0);
  const cascade = row.isChildPartRow ? cascadeOnRow(order, demandKey) : null;
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

// ─── Stock orders: the New Stock Order form and the low-stock sweep ──────────
// One rule and one order, so a build works the same however it was raised.
// docs/client-features-2026-11/01-machine-low-stock-discussion.md

// Why this machine can't have a stock order, or null. hasBom: its Machine BOM exists.
export const machineStockProblem = (item, hasBom) => {
  if (!item) return 'This machine was not found.';
  if (item.isDiscontinued) return `${item.name} is discontinued.`;
  if (isPurchaseMachine(item)) return `${item.name} is a Purchase Machine: it's bought, not built.`;
  if (!isReleased(item)) return `${item.name} isn't released by R&D yet.`;
  return hasBom ? null : `${item.name} has no BOM yet.`;
};

// Machine, source Stock, real BOM steps. Stock first, then a part order or a
// purchase request for what's short; a first Out Source step goes to Purchase at
// once (client change 2026-10-22); the bell goes to Production.
export async function createMachineStockOrder({ item, companyId, qty, deliveryDate, priority = 'Normal', createdBy }) {
  const orderId = await generateOrderId(companyId);
  // Explicit, never the schema's own bare default — see
  // resolveMachineOrderProcesses's own comment for why.
  const processes = await resolveMachineOrderProcesses(item.code, companyId);

  const order = await ProductionOrder.create({
    orderId,
    orderKind: 'Machine',
    machineCode: item.code,
    machineName: item.name,
    priority,
    source: 'Stock',
    orderQuantity: qty,
    receivedDate: new Date().toISOString().split('T')[0],
    deliveryDate,
    company: companyId,
    createdBy,
    processes,
  });

  let material = { checked: false };
  try {
    material = await checkMachineAssemblyMaterialAvailability(order, companyId);
  } catch (e) { console.error(`Stock order ${orderId} material check error:`, e); }

  try {
    const { autoRequestFirstOutsourceRun } = await import('../controllers/outsourceWorkController.js');
    await autoRequestFirstOutsourceRun(order);
  } catch (e) { console.error('Auto outsource request error:', e); }

  // 🔔 Notify Production Head & Employee about new order
  try {
    await notificationService.triggerProductionNotification({
      action: 'order_for_production',
      data: { orderCode: order.orderId, orderId: order._id, machineName: item.name },
      targetCompanyId: companyId,
    });
  } catch (e) { console.error('Production order notification error:', e); }

  return { order, material };
}

// Low stock (2026-11-06). Runs every 30 minutes (server/index.js). A machine is
// switched on by Material Flow as well as Min Stock, so a Min Stock typed long
// ago on Product Master starts nothing. One open stock order at a time, from the
// sweep or the form; a sales order doesn't count, because those machines go to
// a customer and never reach stock. A bought machine goes through the purchase
// sweep (jobs/lowStockReorderCron.js) instead.
export async function runMachineLowStockSweep({ companyId = null } = {}) {
  const stats = { scanned: 0, created: 0 };
  const items = await Item.find({
    ...(companyId ? { companyId } : { companyId: { $ne: null } }),
    productKind: 'Machine',
    isDiscontinued: { $ne: true },
    minStock: { $gt: 0 },
    materialFlow: { $in: ['High Flow', 'Medium Flow', 'Low Flow'] },
    'machineDetails.forwardToNextPhase': true,
  });

  for (const item of items) {
    stats.scanned++;
    try {
      if ((await getFreeQty(item._id, item.qty || 0, item.companyId)) > item.minStock) continue;
      const hasBom = !!(await MachineBOM.exists({ machine: item._id, company: item.companyId }));
      if (machineStockProblem(item, hasBom)) continue;
      const open = await ProductionOrder.exists({
        company: item.companyId,
        machineCode: item.code,
        source: 'Stock',
        orderKind: { $in: ['Machine', null] },
        status: { $nin: ['Completed', 'Cancelled'] },
      });
      if (open) continue;
      const createdBy = await resolveCreatedBy(item);
      if (!createdBy) {
        console.error(`[MachineLowStock] Skipping ${item.code} — no createdBy and no company user to fall back on.`);
        continue;
      }
      // Build Days is R&D's estimate; blank means today, like the part sweeps.
      const deliveryDate = new Date(Date.now() + (item.buildDays || 0) * 864e5).toISOString().split('T')[0];
      await createMachineStockOrder({ item, companyId: item.companyId, qty: item.reorderQty || 1, deliveryDate, createdBy });
      stats.created++;
    } catch (err) {
      console.error(`[MachineLowStock] Error processing machine ${item.code}:`, err);
    }
  }

  console.log(`[MachineLowStock] Sweep complete — scanned ${stats.scanned} machine(s), created ${stats.created} order(s).`);
  return stats;
}
