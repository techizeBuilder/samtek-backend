// Make or buy — Child Parts and Sub Child Parts (2026-10-28,
// docs/make-or-buy-parts-2026-10.md). A part is either made here or bought
// finished from a vendor — one at a time, switched by R&D, no approval. The
// same radio Machines already have (Product Master's Purchasable / Internal
// Manufacturing). A part reads its own `partSourcing` ('make' unless R&D chose
// 'buy') — never `purchase`, which defaults to true on every Item. A Machine
// is bought when `purchase` is on and `internalManufacturing` off, as before.
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import notificationService from './notificationService.js';
import { validateProcessDefinition } from '../utils/processDefinitionValidation.js';

export const PART_KINDS = ['ChildPart', 'SubChildPart'];
export const ACCOUNTS_ROLES = ['Accounts Head', 'Account Employee'];
export const RD_ROLES = ['Research & Development Head', 'Research Development Employee'];

export class MakeBuyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const isPart = (item) => PART_KINDS.includes(item?.productKind);
export const isBought = (item) => (isPart(item)
  ? item?.partSourcing === 'buy'
  : item?.purchase === true && !item?.internalManufacturing);
// A Mongo filter: parts that are NOT bought (made — partSourcing missing or 'make').
export const MADE_PART_FILTER = { productKind: { $in: PART_KINDS }, partSourcing: { $ne: 'buy' } };
const kindLabel = (item) => (item.productKind === 'SubChildPart' ? 'Sub Child Part' : 'Child Part');
const who = (user) => user?.fullName || user?.username || user?.name || '';

// What a part still needs before it can be made here — empty = ready.
export async function makeMasterGaps(item) {
  const gaps = [];
  if (item.productKind === 'SubChildPart') {
    const d = item.subChildPartDetails || {};
    if (!d.sourceItem) gaps.push('its source raw material');
    if (!(Number(d.sourceQty) > 0)) gaps.push('how much source material one piece uses');
    if (validateProcessDefinition(d.processDefinition, { requireAtLeastOne: true, requireAtLeastOneQcStep: true })) {
      gaps.push('its processes (at least one, with a QC step)');
    }
  } else if (item.productKind === 'ChildPart') {
    const bom = await ChildPartBOM.findOne({ childPart: item._id, company: item.companyId }).select('subChildParts materials processDefinition').lean();
    const lines = [...(bom?.subChildParts || []), ...(bom?.materials || [])].filter(l => !l.isDiscontinued);
    if (!lines.length) gaps.push('at least one BOM line (a Sub Child Part or a material)');
    if (validateProcessDefinition(bom?.processDefinition, { requireAtLeastOne: true })) gaps.push('its processes');
  }
  return gaps;
}

// A bought part with no purchase cost and no estimate yet: its price is
// pending until Accounts enters one (a vendor's price carries their profit;
// our made cost doesn't — docs §3).
export const needsEstimate = (item) => isBought(item) && !(Number(item.purchaseCost) > 0);

async function notify(roles, companyId, title, message, data) {
  try {
    await notificationService.notifyRoles(roles, {
      title, message, type: 'purchase', icon: 'package', priority: 'medium', data, targetCompanyId: companyId,
    });
  } catch (err) { console.error('[MakeBuy] notify failed:', err.message); }
}

// Tells Accounts (who buy) what changed, and asks for an estimate when the
// part has never been bought.
export async function notifyBoughtNow(item) {
  const pending = needsEstimate(item);
  await notify(ACCOUNTS_ROLES, item.companyId,
    pending ? `Estimated price needed — ${item.code}` : `Now bought from a vendor — ${item.code}`,
    pending
      ? `${kindLabel(item)} ${item.code} (${item.name}) is now bought from a vendor and has never been bought. Enter an estimated vendor price on Purchase Inventory — until then machine prices using it are provisional.`
      : `${kindLabel(item)} ${item.code} (${item.name}) is now bought from a vendor; shortfalls raise purchase requests. Price in use: ₹${Number(item.purchaseCost).toFixed(2)} (${item.purchaseCostKind === 'estimate' ? 'estimate' : 'last purchase'}).`,
    { itemId: String(item._id), itemCode: item.code, makeBuy: 'buy', pricePending: pending });
}

// ── Price (docs §3) ────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The cost the BOM above uses for a part: its made cost, or — bought — its
// bought cost (last real purchase or Accounts' estimate). Bought with neither
// yet = pending: the made cost stands in as a placeholder (never ₹0).
export function activeCost(item, madeCost) {
  if (!isBought(item)) return { cost: madeCost, bought: false, pending: false };
  const bought = Number(item.purchaseCost) || 0;
  if (bought > 0) return { cost: bought, bought: true, pending: false };
  return { cost: madeCost, bought: true, pending: true };
}

// Machines whose price leans on this part (for the Company Admin's "price
// effect" note).
export async function machinesUsing(item) {
  const cpIds = item.productKind === 'ChildPart'
    ? [item._id]
    : (await ChildPartBOM.find({ company: item.companyId, 'subChildParts.subChildPart': item._id }).select('childPart').lean()).map(b => b.childPart);
  if (!cpIds.length) return [];
  const boms = await MachineBOM.find({ company: item.companyId, 'childParts.childPart': { $in: cpIds } }).select('machine').lean();
  return Item.find({ _id: { $in: boms.map(b => b.machine) } }).select('code name stdCost').lean();
}

// Re-prices a part after its Make / Buy or bought cost changed, and climbs to
// every Child Part / Machine using it. A Sub Child Part switched to Made gets
// its material cost re-worked at today's prices first.
export async function repricePart(item) {
  const cascade = await import('./priceCascadeService.js');
  if (item.productKind === 'SubChildPart') {
    const d = item.subChildPartDetails || {};
    if (!isBought(item) && d.sourceItem) {
      const source = await Item.findById(d.sourceItem);
      if (source) {
        const { computeSourceMetrics } = await import('../controllers/subChildPartMasterController.js');
        const { materialsCost, unitWeightKg } = await computeSourceMetrics(source, d.sourceQty, d.sourceUnit, d.sourceDimensionVariantId);
        await Item.updateOne({ _id: item._id }, { $set: { 'subChildPartDetails.materialsCost': materialsCost, 'subChildPartDetails.unitWeightKg': unitWeightKg } });
      }
    }
    await cascade.onSubChildPartChanged(item._id, item.companyId);
  } else if (item.productKind === 'ChildPart') {
    await cascade.onChildPartChanged(item._id, item.companyId);
  }
}

// "BP816 ₹4,000.00 → ₹4,221.08" for every machine whose cost moved.
const money = (n) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function priceEffect(before, after) {
  const was = new Map(before.map(m => [String(m._id), m]));
  return after
    .filter(m => Math.abs((Number(m.stdCost) || 0) - (Number(was.get(String(m._id))?.stdCost) || 0)) >= 0.005)
    .map(m => `${m.code} ${money(was.get(String(m._id))?.stdCost)} → ${money(m.stdCost)}`);
}

// A Machine's own Purchasable / Internal Manufacturing radio (Product
// Master) — same price rule as parts: bought with no purchase price yet is
// pending (Accounts asked for an estimate); otherwise the price follows the
// choice straight away.
export async function afterMachineSourcingChange(before, after, user) {
  const wasBought = isBought(before);
  const nowBought = isBought(after);
  if (wasBought === nowBought) return;
  const item = await Item.findById(after._id);
  if (!item) return;
  item.pricePending = needsEstimate(item);
  item.makeBuyHistory.push({ from: wasBought ? 'buy' : 'make', to: nowBought ? 'buy' : 'make', at: new Date(), by: user?._id || null, byName: who(user) });
  await item.save();
  if (nowBought) {
    if (Number(item.purchaseCost) > 0) {
      const { applyPricingToItem } = await import('./itemPricingService.js');
      await applyPricingToItem(item, Number(item.purchaseCost), 'Purchase');
    }
    await notify(ACCOUNTS_ROLES, item.companyId,
      item.pricePending ? `Estimated price needed — ${item.code}` : `Now bought from a vendor — ${item.code}`,
      item.pricePending
        ? `Machine ${item.code} (${item.name}) is now bought from a vendor and has never been bought. Enter an estimated vendor price on Purchase Inventory — until then its price is provisional.`
        : `Machine ${item.code} (${item.name}) is now bought from a vendor. Price in use: ${money(item.purchaseCost)}.`,
      { itemId: String(item._id), itemCode: item.code, makeBuy: 'buy', pricePending: item.pricePending });
  } else {
    const { onMachineChanged } = await import('./priceCascadeService.js');
    await onMachineChanged(item._id, item.companyId);
  }
}

// Daily: every bought part / machine still waiting for its estimate → one
// reminder to Accounts per company.
export async function remindPendingPrices() {
  const pending = (await Item.find({ pricePending: true }).select('code name companyId productKind partSourcing purchase internalManufacturing').lean()).filter(isBought);
  const byCompany = new Map();
  for (const it of pending) {
    const k = String(it.companyId);
    if (!byCompany.has(k)) byCompany.set(k, { companyId: it.companyId, items: [] });
    byCompany.get(k).items.push(it);
  }
  for (const { companyId, items } of byCompany.values()) {
    await notify(ACCOUNTS_ROLES, companyId, `${items.length} price${items.length > 1 ? 's' : ''} still pending`,
      `Enter an estimated vendor price on Purchase Inventory for: ${items.slice(0, 8).map(i => i.code).join(', ')}${items.length > 8 ? ` +${items.length - 8} more` : ''}. Machine prices using them are provisional until then.`,
      { pricePendingReminder: true, itemCodes: items.map(i => i.code) });
  }
  return { companies: byCompany.size, items: pending.length };
}

// R&D's switch. mode: 'make' | 'buy'. Returns the saved item. Throws
// MakeBuyError (status + plain message) for a refusal.
export async function switchMakeBuy(itemId, companyId, mode, user) {
  if (!['make', 'buy'].includes(mode)) throw new MakeBuyError(400, 'Choose Make or Buy.');
  const item = await Item.findOne({ _id: itemId, companyId, productKind: { $in: PART_KINDS } });
  if (!item) throw new MakeBuyError(404, 'Part not found.');
  const from = isBought(item) ? 'buy' : 'make';
  if (from === mode) throw new MakeBuyError(409, `${item.code} is already ${mode === 'buy' ? 'bought from a vendor' : 'made here'}.`);
  if (mode === 'make') {
    const gaps = await makeMasterGaps(item);
    if (gaps.length) throw new MakeBuyError(400, `Before ${item.code} can be made here, fill in ${gaps.join(', ')} (BOM Management).`);
  }

  const before = await machinesUsing(item);
  item.partSourcing = mode;
  item.purchase = mode === 'buy';
  item.internalManufacturing = mode === 'make';
  // The approval the part was released on was for the other path (its build
  // checklists vs its Incoming one): the QC List sign-off and the Release are
  // pulled back, and the Approval page flags it until it's released again
  // (2026-10-29). Design / BOM sign-offs are kept.
  const dk = item.productKind === 'SubChildPart' ? 'subChildPartDetails' : 'childPartDetails';
  const wasReleased = item[dk]?.releaseStatus === 'Released';
  if (!item[dk]) item[dk] = {};
  Object.assign(item[dk], { qcListApproved: false, qcListApprovedAt: null, qcListApprovedBy: null, releaseStatus: 'Not Released', releasedAt: null, releasedBy: null });
  item.markModified(dk);
  item.approvalRedo = { at: new Date(), from, to: mode, byName: who(user) };
  item.pricePending = needsEstimate(item);
  item.makeBuyHistory.push({ from, to: mode, at: new Date(), by: user?._id || null, byName: who(user) });
  await item.save();
  await repricePart(item);
  const effect = priceEffect(before, await machinesUsing(item));

  if (mode === 'buy') await notifyBoughtNow(item);
  else {
    await notify(ACCOUNTS_ROLES, companyId, `Now made in-house — ${item.code}`,
      `${kindLabel(item)} ${item.code} (${item.name}) is now made here; no more purchase requests are raised for it. Open POs still come in.`,
      { itemId: String(item._id), itemCode: item.code, makeBuy: 'make' });
  }
  await notify(RD_ROLES, companyId, `Re-approve ${item.code} — switched to ${mode === 'buy' ? 'Bought' : 'Made'}`,
    `${kindLabel(item)} ${item.code} (${item.name}) was switched to ${mode === 'buy' ? 'Bought' : 'Made'}${who(user) ? ` by ${who(user)}` : ''}. `
      + `Its QC List sign-off${wasReleased ? ' and Release were' : ' was'} pulled back — on the Approval page, `
      + (mode === 'buy'
        ? 'set and approve its Incoming (bought) checklist, then release it again.'
        : 'approve its build checklists (Design and BOM must be approved too), then release it again.')
      + ' Until then it gets no automatic orders.',
    { itemId: String(item._id), itemCode: item.code, makeBuy: mode, approvalRedo: true });
  await notify(['Company Admin'], companyId, `${item.code} switched to ${mode === 'buy' ? 'Bought' : 'Made'}`,
    `R&D (${who(user) || 'someone'}) switched ${kindLabel(item)} ${item.code} (${item.name}) from ${from === 'buy' ? 'Bought' : 'Made'} to ${mode === 'buy' ? 'Bought' : 'Made'}.`
      + (item.pricePending ? ' Its price is pending until Accounts enters an estimate — machine prices using it are provisional.' : '')
      + (effect.length ? ` Machine cost: ${effect.join('; ')}.` : ''),
    { itemId: String(item._id), itemCode: item.code, makeBuy: mode });
  return Item.findById(item._id);
}
