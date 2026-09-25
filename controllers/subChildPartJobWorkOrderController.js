// Sub Child Part — Out-Source (Purchase) job-work order actions. See
// server/models/SubChildPartJobWorkOrder.js for the full shape/rationale.
// These orders are raised only by the cron (subChildPartOrderService.js) —
// no manual creation endpoint in this pass.
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { Item } from '../models/Inventory.js';
import SubChildPartSheetPlan from '../models/SubChildPartSheetPlan.js';
import QCJob from '../models/QCJob.js';
import { computeSubChildPartRawMaterialAvailabilityLive } from '../services/subChildPartOrderService.js';
import { dimensionSignature } from '../services/fabricationDemandService.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import { toMm } from '../utils/unitConversion.js';
import { captureSubChildPartActualCost } from './subChildPartMasterController.js';
import notificationService from '../services/notificationService.js';

// A tiny typed error so route handlers can just `throw` and the outer
// try/catch below picks the right HTTP status instead of always 500.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The item's own locked source variant (item.subChildPartDetails.sourceDimensionVariantId)
// — the ONE catalog size this Sub Child Part is always cut from. Purchase
// never picks a different catalog size; the only real choice is whether to
// draw from this fresh catalog stock or substitute a matching existing
// leftover instead (see resolveMaterialOptions/applyFirstRoundMaterial).
export function resolveCatalogVariant(item, sourceItem) {
  const id = item.subChildPartDetails?.sourceDimensionVariantId;
  return (sourceItem.dimensionVariants || []).find(v => String(v._id) === String(id)) || null;
}

async function loadOrderMaterials(order) {
  const item = await Item.findById(order.subChildPartItem);
  const sourceItem = await Item.findById(order.rawMaterial?.sourceItem);
  if (!item || !sourceItem) throw new HttpError(404, 'Sub Child Part or its source material Item no longer exists.');
  return { item, sourceItem };
}

// Sheet metal's "whole sheet" target dimension(s) a leftover must EXACTLY
// match to stand in for a fresh catalog sheet — the Sub Child Part's own
// Sheet Metal Plan's own sheets[] entries when one exists (the real
// physical sheets R&D planned to cut from), falling back to the catalog
// variant's own size when there's no plan yet.
export async function wholeSheetTargets(item, catalogVariant) {
  const plan = await SubChildPartSheetPlan.findOne({ subChildPart: item._id, company: item.companyId }).lean();
  const thickness = catalogVariant?.values?.thickness;
  if (plan?.sheets?.length) {
    return { plan, targets: plan.sheets.map(s => ({
      thickness, width: toMm(s.widthValue, s.widthUnit), length: toMm(s.lengthValue, s.lengthUnit),
    })) };
  }
  if (catalogVariant?.values?.width && catalogVariant?.values?.length) {
    return { plan: null, targets: [{ thickness, width: catalogVariant.values.width, length: catalogVariant.values.length }] };
  }
  return { plan: null, targets: [] };
}

// GET /api/purchase/sub-child-job-work/:id/material-options — everything
// the Send Round dialog needs for the material step, only meaningful
// before the first round (material only ever moves once, on round 1).
export const getSubChildPartJobWorkMaterialOptions = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if ((order.rounds || []).length > 0) {
      return res.status(400).json({ success: false, message: 'Material was already sent on the first round for this order — nothing left to choose here.' });
    }

    const { item, sourceItem } = await loadOrderMaterials(order);
    const availability = await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order);

    if (!sourceItem.fabricationRef) {
      return res.json({ success: true, data: { kind: 'plain', availability, sourceItem: { _id: sourceItem._id, code: sourceItem.code, name: sourceItem.name, qty: sourceItem.qty, unit: sourceItem.unit } } });
    }

    const catalogVariant = resolveCatalogVariant(item, sourceItem);
    const leftovers = (sourceItem.dimensionVariants || []).filter(v => v.isLeftover);

    if (availability.kind === 'sheet') {
      const { plan, targets } = await wholeSheetTargets(item, catalogVariant);
      const targetSigs = new Set(targets.map(t => dimensionSignature(t)));
      const leftoverOptions = leftovers.map(v => {
        const area = (Number(v.values?.width) || 0) * (Number(v.values?.length) || 0);
        return {
          _id: v._id, values: v.values, subStock: v.subStock,
          matchesWholeSheet: targetSigs.has(dimensionSignature(v.values)),
          cutCapacityAreaMm2: area, // Case 1: usable if area * subStock covers what's needed, checked at send time
        };
      });
      return res.json({ success: true, data: {
        kind: 'sheet', availability, sheetPlan: plan,
        catalogVariant: catalogVariant && { _id: catalogVariant._id, values: catalogVariant.values, subStock: catalogVariant.subStock },
        leftoverOptions,
      } });
    }

    // length
    const leftoverOptions = leftovers.map(v => ({
      _id: v._id, values: v.values, subStock: v.subStock,
      // Exact-remainder-match only (per the confirmed combining rule) — a
      // leftover piece whose own length exactly equals what's left over
      // after wholePieces of fresh catalog stock, used to hit the need
      // exactly with no new offcut. "Big enough but not exact" is never
      // offered here — normal rounding (one extra whole piece) applies instead.
      matchesRemainder: availability.remainderMm > 0 && Number(v.values?.length) === availability.remainderMm,
    }));
    res.json({ success: true, data: {
      kind: 'length', availability,
      catalogVariant: catalogVariant && { _id: catalogVariant._id, values: catalogVariant.values, subStock: catalogVariant.subStock },
      leftoverOptions,
    } });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// order.rawMaterial is a creation-time snapshot (see the model's own
// comment) — Store stock can move afterward, so both the list and detail
// GETs re-run the same availability math live, read-only (no Purchase
// Request side effect, and no new MaterialReservation write — see
// computeSubChildPartRawMaterialAvailabilityLive's own header comment on why
// this must stay separate from the PR-raising creation-time version the
// cron uses). Batches the two Item lookups per order into one query each
// rather than N+1, since the list endpoint has no pagination.
async function attachLiveAvailability(orders) {
  const subChildPartIds = orders.map(o => o.subChildPartItem).filter(Boolean);
  const sourceItemIds = orders.map(o => o.rawMaterial?.sourceItem).filter(Boolean);
  const [subChildParts, sourceItems] = await Promise.all([
    Item.find({ _id: { $in: subChildPartIds } }).lean(),
    Item.find({ _id: { $in: sourceItemIds } }).lean(),
  ]);
  const subChildPartById = new Map(subChildParts.map(i => [String(i._id), i]));
  const sourceItemById = new Map(sourceItems.map(i => [String(i._id), i]));

  for (const order of orders) {
    const item = subChildPartById.get(String(order.subChildPartItem));
    const sourceItem = sourceItemById.get(String(order.rawMaterial?.sourceItem));
    order.liveAvailability = (item && sourceItem)
      ? await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order)
      : null;
  }
  return orders;
}

// GET /api/purchase/sub-child-job-work
export const listSubChildPartJobWorkOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, status } = req.query;
    const query = { company: companyId };
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { itemCode: { $regex: search, $options: 'i' } },
        { itemName: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
      ];
    }
    const [data, total, pending, inProgress, pendingQC, completed, qcRejected] = await Promise.all([
      SubChildPartJobWorkOrder.find(query).sort({ createdAt: -1 }).lean(),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Pending' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'In Progress' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Pending QC' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Completed' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, 'qc.rejectedQty': { $gt: 0 } }),
    ]);
    await attachLiveAvailability(data);
    res.json({ success: true, data, summary: { total, pending, inProgress, pendingQC, completed, qcRejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase/sub-child-job-work/:id
export const getSubChildPartJobWorkOrder = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId })
      .populate('subChildPartItem', 'name code qty unit')
      .populate('rawMaterial.sourceItem', 'name code unit')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    // .populate() above replaced these ObjectId fields with partial Item
    // objects (name/code/qty/unit only) — extract the real _id back out to
    // fetch the FULL Item (subChildPartDetails included), which the
    // availability computation below actually needs.
    const subChildPartId = order.subChildPartItem?._id || order.subChildPartItem;
    const sourceItemId = order.rawMaterial?.sourceItem?._id || order.rawMaterial?.sourceItem;
    const [item, sourceItem] = await Promise.all([
      subChildPartId ? Item.findById(subChildPartId).lean() : null,
      sourceItemId ? Item.findById(sourceItemId).lean() : null,
    ]);
    order.liveAvailability = (item && sourceItem)
      ? await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order)
      : null;
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const coveredJobWorkTypes = (order) =>
  new Set(order.rounds.filter(r => r.status === 'Received').flatMap(r => r.jobWorkTypes));

// ── First-round material send — the only time this order's raw material
// actually leaves Store. Every later round just tracks job-work-types; the
// same physical material is already gone, moving on to the next operation.
async function applyFirstRoundMaterial(order, item, sourceItem, availability, materialBody, user) {
  if (availability.shortfallQty > 0) {
    throw new HttpError(400, `Material is short by ${availability.shortfallQty} ${availability.unit || ''} — cannot send until Store has enough stock.`);
  }

  if (availability.kind === 'plain') {
    const updated = await Item.findOneAndUpdate(
      { _id: sourceItem._id, companyId: order.company, qty: { $gte: availability.neededQty } },
      { $inc: { qty: -availability.neededQty } },
      { new: true }
    );
    if (!updated) throw new HttpError(400, 'Insufficient stock in Store — someone may have just used it.');
    order.rawMaterial.sentAt = new Date();
    order.rawMaterial.sentBy = user._id;
    return;
  }

  const { materialCase, leftoverVariantId, stockPiecesConsumed, immediateLeftover } = materialBody || {};
  if (!['cut', 'whole'].includes(materialCase)) {
    throw new HttpError(400, "Choose whether to send a cut piece or a whole sheet/piece.");
  }
  const catalogVariant = resolveCatalogVariant(item, sourceItem);
  if (!catalogVariant) throw new HttpError(400, "Could not resolve this Sub Child Part's own catalog source size.");

  if (availability.kind === 'sheet') {
    if (materialCase === 'whole') {
      await applyWholeSheetSend(order, item, sourceItem, availability, catalogVariant, leftoverVariantId, user);
    } else {
      await applyCutSend(order, sourceItem, catalogVariant, leftoverVariantId, stockPiecesConsumed, immediateLeftover, true, user, availability);
    }
  } else {
    await applyLengthSend(order, sourceItem, catalogVariant, availability, materialCase, leftoverVariantId, immediateLeftover, user);
  }
}

// Sheet metal, Case 2 ("send whole sheet(s)") — a flat decrement of
// availability.neededQty (whole catalog sheets) from ONE variant: either
// the catalog size itself, or an existing leftover that EXACTLY matches a
// whole-sheet target (see wholeSheetTargets) standing in for it. No mixing
// of the two sources in a single send — same "one variant per transfer"
// convention transferSheetMetalPlanToProduction already uses. The real
// leftover from this send isn't known yet — it's measured on the round
// that completes the order (see receiveSubChildPartJobWorkRound).
async function applyWholeSheetSend(order, item, sourceItem, availability, catalogVariant, leftoverVariantId, user) {
  const neededQty = availability.neededQty;
  let sourceVariant = catalogVariant;

  if (leftoverVariantId) {
    const leftoverVariant = sourceItem.dimensionVariants.id(leftoverVariantId);
    if (!leftoverVariant || !leftoverVariant.isLeftover) throw new HttpError(400, 'Chosen leftover no longer exists.');
    const { targets } = await wholeSheetTargets(item, catalogVariant);
    const targetSigs = new Set(targets.map(t => dimensionSignature(t)));
    if (!targetSigs.has(dimensionSignature(leftoverVariant.values))) {
      throw new HttpError(400, "This leftover doesn't match a whole sheet size for this Sub Child Part's plan.");
    }
    sourceVariant = leftoverVariant;
  }
  if ((sourceVariant.subStock || 0) < neededQty) {
    throw new HttpError(400, `Only ${sourceVariant.subStock || 0} of this size in stock — need ${neededQty}.`);
  }

  const updated = await Item.findOneAndUpdate(
    { _id: sourceItem._id, companyId: order.company, dimensionVariants: { $elemMatch: { _id: sourceVariant._id, subStock: { $gte: neededQty } } } },
    { $inc: { 'dimensionVariants.$.subStock': -neededQty } },
    { new: true }
  );
  if (!updated) throw new HttpError(400, 'Insufficient sheet stock in Store for this transfer.');

  order.rawMaterial.sentCase = 'whole';
  order.rawMaterial.sentDimensionVariantId = String(sourceVariant._id);
  order.rawMaterial.sentLeftoverUsedVariantId = leftoverVariantId ? String(leftoverVariantId) : null;
  order.rawMaterial.sentAt = new Date();
  order.rawMaterial.sentBy = user._id;
}

// Case 1 ("send a cut piece") for sheet metal — Purchase manually picks ONE
// stock size (catalog or an existing leftover with enough AREA — a Sub
// Child Part's sheet source is area-only, there's no fixed cut rectangle to
// match exactly here, unlike Case 2's whole-sheet substitution) and how
// many of it they're cutting from, optionally logging what's left
// immediately. Mirrors inventoryController.js's own
// transferFabricationMaterialToProduction (the Machine-BOM equivalent) —
// same capacity check, same leftover create/merge shape — just against
// this order's own rawMaterial snapshot instead of a materialDemands[] row.
async function applyCutSend(order, sourceItem, catalogVariant, leftoverVariantId, stockPiecesConsumed, immediateLeftover, isSheet, user, availability) {
  const piecesConsumed = Number(stockPiecesConsumed);
  if (!(piecesConsumed > 0)) throw new HttpError(400, 'Enter how many stock pieces are being consumed.');

  const sourceVariant = leftoverVariantId ? sourceItem.dimensionVariants.id(leftoverVariantId) : catalogVariant;
  if (!sourceVariant) throw new HttpError(400, 'Chosen stock size not found.');
  if (leftoverVariantId && !sourceVariant.isLeftover) throw new HttpError(400, 'Chosen leftover no longer exists.');
  if ((sourceVariant.subStock || 0) < piecesConsumed) {
    throw new HttpError(400, `Insufficient stock in the chosen size — only ${sourceVariant.subStock || 0} available.`);
  }

  if (isSheet) {
    const variantCapacity = (Number(sourceVariant.values?.width) || 0) * (Number(sourceVariant.values?.length) || 0);
    const totalCapacity = variantCapacity * piecesConsumed;
    if (totalCapacity < availability.totalAreaNeededMm2) {
      throw new HttpError(400, `Not enough material — ${piecesConsumed} piece(s) of this size only cover ${Math.round(totalCapacity)}mm², but this order needs ${Math.round(availability.totalAreaNeededMm2)}mm².`);
    }
  }

  const sourceValuesSnapshot = { ...(sourceVariant.values || {}) };
  sourceVariant.subStock -= piecesConsumed;

  let leftoverValuesRecorded = null;
  const hasLeftoverInput = immediateLeftover && Number(immediateLeftover.pieceCount) > 0
    && Number(immediateLeftover.lengthValue) > 0 && immediateLeftover.lengthUnit
    && (!isSheet || (Number(immediateLeftover.widthValue) > 0 && immediateLeftover.widthUnit));
  if (hasLeftoverInput) {
    const leftoverValues = { ...sourceValuesSnapshot };
    const lengthMm = toMm(immediateLeftover.lengthValue, immediateLeftover.lengthUnit);
    if (isSheet) {
      const widthMm = toMm(immediateLeftover.widthValue, immediateLeftover.widthUnit);
      if (lengthMm != null && widthMm != null) { leftoverValues.length = lengthMm; leftoverValues.width = widthMm; }
    } else if (lengthMm != null) {
      leftoverValues.length = lengthMm;
    }
    leftoverValuesRecorded = pushOrMergeLeftover(sourceItem, sourceVariant, leftoverValues, immediateLeftover.pieceCount);
  }

  await sourceItem.save();

  order.rawMaterial.sentCase = 'cut';
  order.rawMaterial.sentDimensionVariantId = String(sourceVariant._id);
  order.rawMaterial.sentLeftoverUsedVariantId = leftoverVariantId ? String(leftoverVariantId) : null;
  order.rawMaterial.sentAt = new Date();
  order.rawMaterial.sentBy = user._id;
}

// Length-based (non-sheet) fabrication — both cases first agree on how many
// pieces leave Store: wholePieces of the fresh catalog size, plus (only
// when an existing leftover's own length EXACTLY equals what's left over
// after those whole pieces) that one leftover piece, consumed fully,
// covering the need exactly with no new offcut. No exact match -> leftover
// is left untouched and one extra whole catalog piece is sent instead
// (plain rounding) — this is the confirmed rule, not a "big enough" check.
async function applyLengthSend(order, sourceItem, catalogVariant, availability, materialCase, leftoverVariantId, immediateLeftover, user) {
  const { wholePieces, remainderMm, catalogPieceLengthMm, totalLengthNeededMm } = availability;

  let combineVariant = null;
  if (leftoverVariantId) {
    combineVariant = sourceItem.dimensionVariants.id(leftoverVariantId);
    if (!combineVariant || !combineVariant.isLeftover) throw new HttpError(400, 'Chosen leftover no longer exists.');
    if (!(remainderMm > 0) || Number(combineVariant.values?.length) !== remainderMm) {
      throw new HttpError(400, "This leftover doesn't exactly match the remaining length needed — it can't be combined.");
    }
    if ((combineVariant.subStock || 0) < 1) throw new HttpError(400, 'That leftover piece is no longer in stock.');
  }
  const freshPiecesNeeded = combineVariant ? wholePieces : Math.ceil(totalLengthNeededMm / catalogPieceLengthMm);

  if ((catalogVariant.subStock || 0) < freshPiecesNeeded) {
    throw new HttpError(400, `Only ${catalogVariant.subStock || 0} catalog piece(s) in stock — need ${freshPiecesNeeded}.`);
  }

  if (materialCase === 'whole') {
    // $elemMatch (not two separate 'dimensionVariants.x'/'dimensionVariants.y'
    // conditions) — otherwise the positional $ in the update below is free to
    // resolve to WHICHEVER array element satisfies either condition, not
    // necessarily the one satisfying both, and can silently decrement the
    // wrong dimensionVariant when this document's array has other elements
    // that also happen to satisfy the subStock check (confirmed by a real
    // repro during this change's own verification pass — two sequential
    // updates without $elemMatch both landed on catalogVariant).
    if (freshPiecesNeeded > 0) {
      const updated = await Item.findOneAndUpdate(
        { _id: sourceItem._id, companyId: order.company, dimensionVariants: { $elemMatch: { _id: catalogVariant._id, subStock: { $gte: freshPiecesNeeded } } } },
        { $inc: { 'dimensionVariants.$.subStock': -freshPiecesNeeded } }, { new: true }
      );
      if (!updated) throw new HttpError(400, 'Insufficient stock in Store for this transfer.');
    }
    if (combineVariant) {
      const updated2 = await Item.findOneAndUpdate(
        { _id: sourceItem._id, companyId: order.company, dimensionVariants: { $elemMatch: { _id: combineVariant._id, subStock: { $gte: 1 } } } },
        { $inc: { 'dimensionVariants.$.subStock': -1 } }, { new: true }
      );
      if (!updated2) throw new HttpError(400, 'That leftover piece was just used elsewhere.');
    }
  } else {
    // 'cut' — direct mutate + save (not the atomic $inc above) since an
    // optional new leftover subdocument may be pushed in the same save,
    // same convention applyCutSend/transferFabricationMaterialToProduction use.
    if (freshPiecesNeeded > 0) catalogVariant.subStock -= freshPiecesNeeded;
    if (combineVariant) combineVariant.subStock -= 1;

    const hasLeftoverInput = immediateLeftover && Number(immediateLeftover.pieceCount) > 0
      && Number(immediateLeftover.lengthValue) > 0 && immediateLeftover.lengthUnit;
    if (hasLeftoverInput) {
      const leftoverValues = { ...(catalogVariant.values || {}) };
      const lengthMm = toMm(immediateLeftover.lengthValue, immediateLeftover.lengthUnit);
      if (lengthMm != null) leftoverValues.length = lengthMm;
      pushOrMergeLeftover(sourceItem, catalogVariant, leftoverValues, immediateLeftover.pieceCount);
    }
    await sourceItem.save();
  }

  order.rawMaterial.sentCase = materialCase;
  order.rawMaterial.sentDimensionVariantId = String(catalogVariant._id);
  order.rawMaterial.sentLeftoverUsedVariantId = combineVariant ? String(combineVariant._id) : null;
  order.rawMaterial.sentAt = new Date();
  order.rawMaterial.sentBy = user._id;
}

// Shared by applyCutSend/applyLengthSend's 'cut' path — find-or-create an
// isLeftover:true variant for a just-cut offcut, same merge-by-exact-match
// logic transferFabricationMaterialToProduction already uses.
function pushOrMergeLeftover(sourceItem, sourceVariant, leftoverValues, pieceCount) {
  const existingLeftover = sourceItem.dimensionVariants.find(
    dv => dv.isLeftover && dimensionSignature(dv.values) === dimensionSignature(leftoverValues)
  );
  if (existingLeftover) {
    existingLeftover.subStock = (existingLeftover.subStock || 0) + Number(pieceCount);
    return leftoverValues;
  }
  const { weightPerMeterKg, weightPerPieceKg } = calculateFabricationWeight(
    sourceVariant.category, leftoverValues, sourceVariant.densityValue, sourceVariant.densityUnit
  );
  sourceItem.dimensionVariants.push({
    category: sourceVariant.category, values: leftoverValues, designation: sourceVariant.designation || '',
    densityValue: sourceVariant.densityValue, densityUnit: sourceVariant.densityUnit,
    weightPerMeterKg, weightPerPieceKg, subStock: Number(pieceCount), isLeftover: true,
  });
  return leftoverValues;
}

// Case 2 leftover capture, on the round that completes the order — see
// receiveSubChildPartJobWorkRound. Credits a new (or matching existing)
// isLeftover:true variant, same find-or-merge logic as pushOrMergeLeftover,
// mirroring confirmReturn's own crediting logic (inventoryController.js).
async function captureFinalLeftover(order, sourceItem, leftoverBody) {
  const sentVariant = sourceItem.dimensionVariants.id(order.rawMaterial.sentDimensionVariantId);
  if (!sentVariant) throw new HttpError(400, 'Could not resolve the original catalog size this order was sent from.');
  const isSheet = getCategoryByKey(sentVariant.category)?.calcType === 'sheet';

  const { leftoverLengthValue, leftoverLengthUnit, leftoverWidthValue, leftoverWidthUnit } = leftoverBody || {};
  const lengthMm = toMm(leftoverLengthValue, leftoverLengthUnit);
  if (!lengthMm) {
    throw new HttpError(400, 'A measured leftover length is required to complete this order (enter 0 if there is none).');
  }
  let leftoverValues;
  if (isSheet) {
    const widthMm = toMm(leftoverWidthValue, leftoverWidthUnit);
    if (!widthMm) throw new HttpError(400, 'A measured leftover width is required for sheet metal.');
    leftoverValues = { thickness: sentVariant.values?.thickness, width: widthMm, length: lengthMm };
  } else {
    leftoverValues = { ...(sentVariant.values || {}), length: lengthMm };
  }
  pushOrMergeLeftover(sourceItem, sentVariant, leftoverValues, 1);
  order.rawMaterial.leftoverCaptured = true;
  order.rawMaterial.leftoverValues = leftoverValues;
  await sourceItem.save();
}

// POST /api/purchase/sub-child-job-work/:id/rounds — "Send Round"
export const sendSubChildPartJobWorkRound = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'This order is already completed.' });
    }

    const requested = Array.isArray(req.body.jobWorkTypes) ? req.body.jobWorkTypes.filter(Boolean) : [];
    if (!requested.length) {
      return res.status(400).json({ success: false, message: 'Select at least one job work type to send.' });
    }
    const covered = coveredJobWorkTypes(order);
    const validSet = new Set(order.jobWorkTypes);
    const invalid = requested.filter(t => !validSet.has(t) || covered.has(t));
    if (invalid.length) {
      return res.status(400).json({
        success: false,
        message: `These job work types can't be sent: ${invalid.join(', ')} (not on this order, or already received).`,
      });
    }

    if (order.rounds.length === 0) {
      const { item, sourceItem } = await loadOrderMaterials(order);
      // The real gate — reservation-aware, not the raw/naive figure, so this
      // check honors what every OTHER competing order has already claimed
      // (see computeSubChildPartRawMaterialAvailabilityLive's own comment).
      const availability = await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order);
      await applyFirstRoundMaterial(order, item, sourceItem, availability, req.body.material, req.user);
    }

    order.rounds.push({
      roundNumber: order.rounds.length + 1,
      jobWorkTypes: requested,
      status: 'Sent',
      sentAt: new Date(),
      sentBy: req.user._id,
    });
    if (order.status === 'Pending') order.status = 'In Progress';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Duplicated (not imported) from qcController.js/purchaseRequestController.js's
// own identical helper — this codebase's established convention for small,
// private per-controller ID generators rather than cross-importing them.
async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({ qcJobId: new RegExp(`^QC-${year}-`) }).sort({ qcJobId: -1 }).lean();
  let nextNumber = 1;
  if (lastJob?.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
  }
  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Sends the finished order's quantity to QC instead of crediting stock
// directly — mirrors createPurchaseQCJob (purchaseRequestController.js) as
// closely as this order shape allows. Stock is only credited once QC
// actually approves (qcController.js's submitDecision,
// source:'SubChildPartJobWork' branch). Also where the job's real cost is
// captured: Purchase enters what the whole order was invoiced for, divided
// here by orderQuantity into the per-unit BOM figure, alongside a fresh
// Materials Cost pull (the raw material's price may have moved since this
// Sub Child Part was last priced) — the Manual estimate flips to 'Actual'
// exactly like RDBOM.productionCost's own mechanic does at Production's
// Final Testing step, just entered as a batch total here since this order
// completes as one whole batch, not a tracked-per-unit build.
async function sendToQCAndCaptureCost(order, item, sourceItem, req) {
  const totalJobWorkCost = Number(req.body.totalJobWorkCost);
  if (!(totalJobWorkCost > 0)) {
    throw new HttpError(400, 'Enter the total job work cost for this order before completing the receive.');
  }

  await captureSubChildPartActualCost(item, sourceItem, totalJobWorkCost, order.orderQuantity);

  order.jobWorkCostTotal = totalJobWorkCost;
  order.qc.sentQty = order.orderQuantity;
  order.status = 'Pending QC';

  const existingQC = order.qcJobId ? await QCJob.findById(order.qcJobId) : null;
  if (!existingQC) {
    const qcJobId = await generateQCJobId();
    const qcJob = await QCJob.create({
      qcJobId,
      source: 'SubChildPartJobWork',
      subChildPartJobWorkOrderId: order._id,
      sourceRefId: order.orderId,
      sourceDepartment: 'Purchase',
      sentBy: req.user.fullName || req.user.username || 'Purchase Dept',
      itemName: item.name,
      itemCode: item.code,
      category: item.category || 'Assemblies',
      quantity: order.orderQuantity,
      unit: item.unit || 'pcs',
      receivedDate: new Date().toISOString().split('T')[0],
      status: 'Pending',
      company: order.company,
      createdBy: req.user._id,
      notes: `Automatically created from Sub Child Part Job Work order ${order.orderId}`,
    });
    order.qcJobId = qcJob._id;

    try {
      await notificationService.triggerQCNotification({
        action: 'qc_job_created',
        data: { qcJobId: qcJob.qcJobId, itemName: item.name, quantity: order.orderQuantity },
        targetCompanyId: order.company,
      });
    } catch (e) { console.error('[SubChildPartJobWork] QC notification error:', e); }
  }
}

// PUT /api/purchase/sub-child-job-work/:id/rounds/:roundId/receive — "Receive Round"
export const receiveSubChildPartJobWorkRound = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const round = order.rounds.id(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    if (round.status !== 'Sent') {
      return res.status(400).json({ success: false, message: 'This round has already been received.' });
    }

    round.status = 'Received';
    round.receivedAt = new Date();
    round.receivedBy = req.user._id;

    const covered = coveredJobWorkTypes(order);
    const nowComplete = order.jobWorkTypes.every(t => covered.has(t));
    if (nowComplete) {
      // Case 2 ("whole sheet/piece" sent on round 1) — the real leftover is
      // only knowable now, once the finished Sub Child Part actually comes
      // back. Required before this receive can go through; Case 1 (already
      // logged its leftover, if any, at send time) and plain material skip
      // this entirely.
      let sourceItem = null;
      if (order.rawMaterial?.sentCase === 'whole' && !order.rawMaterial.leftoverCaptured) {
        sourceItem = await Item.findById(order.rawMaterial.sourceItem);
        if (!sourceItem) return res.status(404).json({ success: false, message: 'Source material Item no longer exists.' });
        await captureFinalLeftover(order, sourceItem, req.body);
      }

      const item = await Item.findById(order.subChildPartItem);
      if (!item) return res.status(404).json({ success: false, message: 'Sub Child Part Item no longer exists.' });
      if (!sourceItem) sourceItem = await Item.findById(order.rawMaterial.sourceItem);
      if (!sourceItem) return res.status(404).json({ success: false, message: 'Source material Item no longer exists.' });

      // Stock is no longer credited here — it moves to QC first (see
      // sendToQCAndCaptureCost) and only gets credited once QC actually
      // approves (qcController.js's submitDecision).
      await sendToQCAndCaptureCost(order, item, sourceItem, req);
    }

    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase/sub-child-job-work/:id/material-options's own kind:'sheet'
// leftoverOptions.cutCapacityAreaMm2 is per ONE piece of that leftover size —
// the frontend multiplies by however many pieces the user is about to enter
// to check against availability.totalAreaNeededMm2 before submitting, same
// number applyCutSend re-validates server-side regardless.
