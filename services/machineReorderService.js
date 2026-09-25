// Machine — the top of the BOM hierarchy (Raw Material -> Sub Child Part ->
// Child Part -> Machine). Unlike the two tiers below it, a Machine order is
// never raised by a low-stock reorder sweep of its own — it's always raised
// by Store's order-form flow (storeFlowService.js's applyStoreDecisionToItem,
// CASE 2: an in-house-manufactured Sale item that's Not Available). This
// file holds the one thing that tier needed and never had: a real BOM-aware
// material check for the Machine order once it's created, cascading into
// real Child Part orders instead of flat Purchase Requests for the Child
// Parts it's built from, mirroring childPartReorderService.js's own
// checkSubChildPartMaterialAvailability one tier down exactly.
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
import { checkAndReserve } from './materialReservationService.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { sheetAreaFromItem } from '../controllers/sheetMetalPlanController.js';
import { createChildPartOrderForItem } from './childPartReorderService.js';
import { buildProcessSteps, buildStepsFromList, MACHINE_BOM_STEPS } from '../models/ProductionOrder.js';
import { buildOrderStepsFromProcessDefinition } from './processStepBuilderService.js';

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
    const { freeQty, shortfallQty } = await checkAndReserve({ item: cpItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId });
    if (shortfallQty === 0) continue;
    const result = await createChildPartOrderForItem(cpItem, companyId, { demandSource: 'MachineCascade', buildQtyOverride: neededQty, demandRefId: productionOrder._id });
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
    const { freeQty, shortfallQty } = await checkAndReserve({ item: matItem, neededQty, order: productionOrder, orderModel: 'ProductionOrder', companyId });
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
    const { freeQty: freeSheets, shortfallQty: sheetsShort } = await checkAndReserve({ item: matItem, neededQty: sheetsNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId });
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
    const { freeQty, shortfallQty } = await checkAndReserve({ item: matItem, neededQty: piecesNeeded, availableQty: variant.subStock || 0, order: productionOrder, orderModel: 'ProductionOrder', companyId });
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
      requestedQty: d?.quantity || 0,
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
    const available = (cpItem.qty || 0) >= issueTotal;
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
      const available = item ? (item.qty || 0) >= issueTotal : null;
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
        available = (variant.subStock || 0) >= issueTotal;
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
        available = (variant.subStock || 0) * catalogPieceLengthMm >= g.totalLengthMmPerUnit * buildQty;
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
  const alreadyRequested = existing?.quantity || 0;
  if (alreadyRequested + qty > row.issueTotal) {
    const remaining = Math.max(0, row.issueTotal - alreadyRequested);
    return {
      ok: false, code: 400,
      message: `Can only request ${remaining} more ${row.issueUnit} of "${row.name}" — the whole order needs ${row.issueTotal}.`,
    };
  }

  if (existing) {
    existing.quantity = alreadyRequested + qty;
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
