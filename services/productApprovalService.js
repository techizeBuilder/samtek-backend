// Product Approval Gate — one service for all three BOM tiers (Sub Child Part,
// Child Part, Machine). See docs/product-approval-gate-redesign-discussion-2026-09.md.
//
// Every tier carries the same approvals in its own details block (see
// models/Inventory.js's approvalGateFields): designStatus, bomApproved,
// qcListApproved, releaseStatus. "Released" is the last verdict — it gates
// Sales (Machines only) and the automatic supply chain (reorder cron + cascade
// orders), never the manual/internal build of a first unit.
//
// Rules implemented here:
//  - Design is recursive: an item's design only counts once every part below
//    it (Machine -> Child Parts -> Sub Child Parts) is design-approved too.
//  - BOM composition stays unrestricted; the block only appears at approval
//    time, naming the referenced parts to approve first.
//  - Machine ticked "Forward to Design & Prototype": Design + BOM + QC List +
//    a passed Prototype, then Release. Unticked (Purchase Machine): QC List
//    only, then Release. Child Part / Sub Child Part always run the full
//    pipeline (no Prototype — that is Machine-only).
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import QCItemChecklist from '../models/QCItemChecklist.js';
import RDPrototype from '../models/RDPrototype.js';
import { flattenProcessDefinition } from './processStepBuilderService.js';
import { isPart, isBought } from './makeBuyService.js';

export const APPROVAL_KINDS = ['SubChildPart', 'ChildPart', 'Machine'];

const DETAILS_KEY = {
  Machine: 'machineDetails',
  ChildPart: 'childPartDetails',
  SubChildPart: 'subChildPartDetails',
};
// QCItemChecklist.module for each tier (see qcChecklistController.js).
const QC_MODULE = {
  Machine: 'productMaster',
  ChildPart: 'childPart',
  SubChildPart: 'subChildPart',
};

export const detailsKey = (item) => DETAILS_KEY[item?.productKind] || null;

// The item's approval block with defaults filled in, so callers never have to
// guard against an old document that predates these fields.
export function approvalOf(item) {
  const d = item?.[detailsKey(item)] || {};
  return {
    designStatus: d.designStatus || 'Draft',
    rejectionNote: d.rejectionNote || '',
    bomApproved: !!d.bomApproved,
    qcListApproved: !!d.qcListApproved,
    releaseStatus: d.releaseStatus || 'Not Released',
  };
}

// Only a Machine can skip the Design/BOM/Prototype stages (the "Purchase
// Machine" path); Child Part and Sub Child Part always run the full pipeline.
export const isPurchaseMachine = (item) =>
  item?.productKind === 'Machine' && !item?.machineDetails?.forwardToNextPhase;

export const isReleased = (item) => approvalOf(item).releaseStatus === 'Released';

// Low-stock for machines (2026-11-06, docs/client-features-2026-11): which
// automatic reorder a machine takes. Forward on = built (the machine sweep);
// off with Purchasable on = bought (the purchase sweep); otherwise neither.
export const machineStockRoute = (item) => {
  if (item?.machineDetails?.forwardToNextPhase) return 'built';
  return item?.purchase === true ? 'bought' : 'none';
};

// A Child Part / Sub Child Part bought from a vendor (make or buy,
// 2026-10-29): like a Purchase Machine it has no Design or BOM stage — only
// its Incoming (bought) QC List, then Release. For a parent above it, it
// counts as passing Design / BOM (it has neither); it must still be Released.
export const isBoughtPart = (item) => isPart(item) && isBought(item);
// No Design / BOM (/ Prototype) stage: a Purchase Machine or a bought part.
export const isQcOnly = (item) => isPurchaseMachine(item) || isBoughtPart(item);

const brief = (it, reason) => ({
  _id: String(it._id), code: it.code, name: it.name, productKind: it.productKind, reason,
});

// The parts this item's own BOM references, one tier down. Discontinued
// lines are skipped (same convention as buildMachineDesignFiles).
export async function getReferencedParts(item, companyId) {
  let ids = [];
  if (item.productKind === 'Machine') {
    const bom = await MachineBOM.findOne({ company: companyId, machine: item._id }).select('childParts').lean();
    ids = (bom?.childParts || []).filter(l => !l.isDiscontinued).map(l => l.childPart);
  } else if (item.productKind === 'ChildPart') {
    const bom = await ChildPartBOM.findOne({ company: companyId, childPart: item._id }).select('subChildParts').lean();
    ids = (bom?.subChildParts || []).filter(l => !l.isDiscontinued).map(l => l.subChildPart);
  }
  if (ids.length === 0) return [];
  return Item.find({ _id: { $in: ids }, companyId }).lean();
}

// Recursive Design check (§3c). `blockers` lists every part in the subtree
// whose own design isn't Approved. `visited` guards against a BOM cycle.
export async function computeDesignReadiness(item, companyId, visited = new Set()) {
  const key = String(item._id);
  if (visited.has(key)) return { ok: true, blockers: [] };
  visited.add(key);

  if (isBoughtPart(item)) return { ok: true, blockers: [] };
  const blockers = [];
  const own = approvalOf(item).designStatus;
  if (own !== 'Approved') blockers.push(brief(item, `Design is ${own}`));

  for (const part of await getReferencedParts(item, companyId)) {
    const sub = await computeDesignReadiness(part, companyId, visited);
    blockers.push(...sub.blockers);
  }
  return { ok: blockers.length === 0, blockers };
}

// Direct children that don't satisfy `predicate` — used for the "approve
// these first" refusal on BOM approval and Release (Design recurses instead).
async function childrenFailing(item, companyId, predicate, reason) {
  const parts = await getReferencedParts(item, companyId);
  return parts.filter(p => !predicate(p)).map(p => brief(p, reason));
}

async function hasBomContent(item, companyId) {
  if (item.productKind === 'SubChildPart') return !!item.subChildPartDetails?.sourceItem;
  if (item.productKind === 'ChildPart') {
    const bom = await ChildPartBOM.findOne({ company: companyId, childPart: item._id }).select('subChildParts materials').lean();
    return ((bom?.subChildParts || []).length + (bom?.materials || []).length) > 0;
  }
  const bom = await MachineBOM.findOne({ company: companyId, machine: item._id }).select('childParts materials').lean();
  return ((bom?.childParts || []).length + (bom?.materials || []).length) > 0;
}

async function bomProcessDefinition(item, companyId) {
  if (item.productKind === 'SubChildPart') return item.subChildPartDetails?.processDefinition || [];
  if (item.productKind === 'ChildPart') {
    const bom = await ChildPartBOM.findOne({ company: companyId, childPart: item._id }).select('processDefinition').lean();
    return bom?.processDefinition || [];
  }
  const bom = await MachineBOM.findOne({ company: companyId, machine: item._id }).select('processDefinition').lean();
  return bom?.processDefinition || [];
}

// QC List readiness: the item's own configured checklist(s) must exist and be
// non-empty — every QC-flagged BOM step needs its own step checklist, and
// there must be at least one non-empty checklist overall (a Purchase Machine
// has no BOM steps, only its item-level 'final' checklist). "Every configured
// stage" is therefore covered: any stage doc that exists must be non-empty.
export async function computeQcReadiness(item, companyId) {
  const module = QC_MODULE[item.productKind];
  // A part's two paths have their own lists: bought → its Incoming list only;
  // made → its build lists only (an empty Incoming list never blocks it).
  const bought = isBoughtPart(item);
  const docs = (await QCItemChecklist.find({ company: companyId, item: item._id, module }).lean())
    .filter(d => (isPart(item) ? (d.stage === 'incoming') === bought : true));
  const problems = [];
  if (bought && !docs.some(d => (d.selectedItems || []).length > 0)) problems.push('The Incoming (bought) checklist has no rows — set it on R&D → QC');

  const empty = docs.filter(d => (d.selectedItems || []).length === 0);
  empty.forEach(d => problems.push(`${d.stepName ? `${d.stepCategory} › ${d.stepName}` : `${d.stage} checklist`} has no rows selected`));

  if (!isQcOnly(item)) {
    const steps = flattenProcessDefinition(await bomProcessDefinition(item, companyId)).filter(s => s.qcRequired);
    for (const s of steps) {
      const doc = docs.find(d => d.stepCategory === s.category && d.stepName === s.name);
      if (!doc || (doc.selectedItems || []).length === 0) problems.push(`QC step "${s.category} › ${s.name}" has no checklist configured`);
    }
  }
  if (!bought && !docs.some(d => (d.selectedItems || []).length > 0)) problems.push('No QC checklist is configured for this item');
  return { ok: problems.length === 0, problems };
}

export async function getPrototypeStatus(item, companyId) {
  if (item.productKind !== 'Machine') return null;
  const protos = await RDPrototype.find({ company: companyId, machine: item._id }).select('status').lean();
  if (protos.some(p => p.status === 'Passed')) return 'Passed';
  if (protos.length === 0) return 'None';
  return protos.some(p => p.status === 'In Progress') ? 'In Progress' : 'Failed';
}

// What's still needed before this item can be Released, as human-readable
// strings plus the structured blockers (parts to approve/release first).
export async function computeReleaseReadiness(item, companyId) {
  const a = approvalOf(item);
  const missing = [];
  let blockers = [];

  const qc = await computeQcReadiness(item, companyId);
  if (!a.qcListApproved) missing.push('QC List not approved');
  if (!qc.ok && !a.qcListApproved) missing.push(...qc.problems);

  if (!isQcOnly(item)) {
    const design = await computeDesignReadiness(item, companyId);
    if (!design.ok) {
      missing.push('Design not approved (including every part underneath)');
      blockers.push(...design.blockers);
    }
    if (!a.bomApproved) missing.push('BOM not approved');
    if (item.productKind === 'Machine' && (await getPrototypeStatus(item, companyId)) !== 'Passed') {
      missing.push('Prototype has not passed');
    }
    const unreleased = await childrenFailing(item, companyId, isReleased, 'Not Released');
    if (unreleased.length) {
      missing.push('Parts underneath are not Released yet');
      blockers.push(...unreleased);
    }
  }
  return { ready: missing.length === 0, missing, blockers };
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Every action returns { ok:true, item } or { ok:false, status, message,
// blockers? } — controllers translate that straight into the HTTP response.
const fail = (status, message, blockers) => ({ ok: false, status, message, ...(blockers ? { blockers } : {}) });

async function loadItem(id, companyId) {
  return Item.findOne({ _id: id, companyId, productKind: { $in: APPROVAL_KINDS } }).lean();
}

const setFields = (item, fields) =>
  Item.findOneAndUpdate(
    { _id: item._id },
    { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${detailsKey(item)}.${k}`, v])) },
    { new: true }
  ).lean();

// Design Approved — a simple approve/revoke, same flow as BOM and QC List
// (the old Draft -> Testing -> Approved/Rejected steps were dropped
// 2026-10-01). Approving is refused while any part underneath isn't
// design-approved (§3c); revoking sends the design back to Draft. Any item
// still carrying a legacy 'Testing'/'Rejected' status simply counts as not
// approved.
export async function setDesignApproved({ id, companyId, userId, approved }) {
  const item = await loadItem(id, companyId);
  if (!item) return fail(404, 'Item not found');
  if (isPurchaseMachine(item)) return fail(400, 'A Purchase Machine has no Design stage');
  if (isBoughtPart(item)) return fail(400, 'A bought part has no Design stage — only its Incoming QC List and Release');

  if (approved) {
    const sub = [];
    for (const part of await getReferencedParts(item, companyId)) sub.push(...(await computeDesignReadiness(part, companyId)).blockers);
    if (sub.length) return fail(409, 'Approve the parts underneath first — their designs are not approved yet', sub);
    return { ok: true, item: await setFields(item, { designStatus: 'Approved', rejectionNote: '', designApprovedAt: new Date(), designApprovedBy: userId }) };
  }
  const fields = { designStatus: 'Draft', designApprovedAt: null, designApprovedBy: null };
  // The Release rested on this design, so it is pulled back too.
  if (approvalOf(item).releaseStatus === 'Released') Object.assign(fields, { releaseStatus: 'Not Released', releasedAt: null, releasedBy: null });
  return { ok: true, item: await setFields(item, fields) };
}

// BOM Approved — independent of MachineBOM.isLocked. Needs actual BOM content
// ("can't approve nothing") and every directly referenced part already
// BOM-approved.
export async function setBomApproved({ id, companyId, userId, approved }) {
  const item = await loadItem(id, companyId);
  if (!item) return fail(404, 'Item not found');
  if (isPurchaseMachine(item)) return fail(400, 'A Purchase Machine has no BOM stage');
  if (isBoughtPart(item)) return fail(400, 'A bought part has no BOM stage — only its Incoming QC List and Release');
  if (approved) {
    if (!(await hasBomContent(item, companyId))) return fail(400, 'This BOM is empty — there is nothing to approve');
    // A bought part underneath has no BOM to approve — it passes.
    const blocked = await childrenFailing(item, companyId, p => approvalOf(p).bomApproved || isBoughtPart(p), 'BOM not approved');
    if (blocked.length) return fail(409, 'Approve the parts underneath first — their BOMs are not approved yet', blocked);
  }
  const fields = approved
    ? { bomApproved: true, bomApprovedAt: new Date(), bomApprovedBy: userId }
    : { bomApproved: false, bomApprovedAt: null, bomApprovedBy: null };
  if (!approved && approvalOf(item).releaseStatus === 'Released') Object.assign(fields, { releaseStatus: 'Not Released', releasedAt: null, releasedBy: null });
  return { ok: true, item: await setFields(item, fields) };
}

// QC List Approved — sign-off on the item's own configured QCItemChecklist.
export async function setQcListApproved({ id, companyId, userId, approved }) {
  const item = await loadItem(id, companyId);
  if (!item) return fail(404, 'Item not found');
  if (approved) {
    const qc = await computeQcReadiness(item, companyId);
    if (!qc.ok) return fail(400, `The QC checklist isn't complete: ${qc.problems.join('; ')}`);
  }
  const fields = approved
    ? { qcListApproved: true, qcListApprovedAt: new Date(), qcListApprovedBy: userId }
    : { qcListApproved: false, qcListApprovedAt: null, qcListApprovedBy: null };
  if (!approved && approvalOf(item).releaseStatus === 'Released') Object.assign(fields, { releaseStatus: 'Not Released', releasedAt: null, releasedBy: null });
  return { ok: true, item: await setFields(item, fields) };
}

// Release / pull back. Release is refused until everything the item's path
// needs is in place (see computeReleaseReadiness).
export async function setReleaseStatus({ id, companyId, userId, status }) {
  const item = await loadItem(id, companyId);
  if (!item) return fail(404, 'Item not found');
  if (!['Released', 'Not Released'].includes(status)) return fail(400, 'Invalid release status');
  if (status === 'Released') {
    const r = await computeReleaseReadiness(item, companyId);
    if (!r.ready) return fail(409, `Can't release yet: ${r.missing.join('; ')}`, r.blockers);
    // Released again after a make / buy switch or a BOM edit → nothing left to redo.
    if (item.approvalRedo?.at) await Item.updateOne({ _id: item._id }, { $set: { 'approvalRedo.at': null, 'approvalRedo.from': null, 'approvalRedo.to': null, 'approvalRedo.byName': '', 'approvalRedo.what': '' } });
    return { ok: true, item: await setFields(item, { releaseStatus: 'Released', releasedAt: new Date(), releasedBy: userId }) };
  }
  return { ok: true, item: await setFields(item, { releaseStatus: 'Not Released', releasedAt: null, releasedBy: null }) };
}

// Called whenever an item's QC checklist is edited — the sign-off no longer
// matches what was approved, so it resets (and a Release rests on it, so that
// is pulled back too).
// stage: the edited list's stage — a part's list for the OTHER make / buy path
// doesn't touch the sign-off in use (2026-10-29).
export async function invalidateQcApproval(itemId, companyId, stage = null) {
  const item = await Item.findOne({ _id: itemId, companyId, productKind: { $in: APPROVAL_KINDS } }).select('productKind partSourcing purchase internalManufacturing machineDetails childPartDetails subChildPartDetails').lean();
  if (!item || !approvalOf(item).qcListApproved) return;
  if (stage && isPart(item) && (stage === 'incoming') !== isBoughtPart(item)) return;
  await setFields(item, {
    qcListApproved: false, qcListApprovedAt: null, qcListApprovedBy: null,
    releaseStatus: 'Not Released', releasedAt: null, releasedBy: null,
  });
}

// R&D edited a BOM that was approved: what was signed off is no longer what's
// on it, so the BOM approval and Release are pulled back and the Approval page
// flags it (2026-11-02). Design and QC List stand. A parent above it isn't
// touched, as with a checklist edit. Open orders carry on as they are.
export async function invalidateBomApproval(itemId, companyId, { byName = '', what = '' } = {}) {
  const item = await loadItem(itemId, companyId);
  if (!item || !detailsKey(item) || isQcOnly(item) || !approvalOf(item).bomApproved) return false;
  await setFields(item, {
    bomApproved: false, bomApprovedAt: null, bomApprovedBy: null,
    releaseStatus: 'Not Released', releasedAt: null, releasedBy: null,
  });
  // A make / buy flag already there says more: it stays until the next Release.
  if (!item.approvalRedo?.at) await Item.updateOne({ _id: item._id }, { $set: { approvalRedo: { at: new Date(), from: null, to: null, byName, what } } });
  return true;
}

// One row per item for the Approval page: status + live readiness.
// status: 'redo' = flagged "needs re-approval" after a make / buy switch or a BOM edit;
// 'notApproved' = not Released and not flagged, so the two never overlap.
// redoCounts: how many are flagged, per tier (for the tabs). counts: this tier
// under the current search, for the filter.
export async function listApprovalItems({ companyId, kind, search, page = 1, limit = 20, status = '' }) {
  const base = { companyId, productKind: kind, isDiscontinued: { $ne: true } };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    base.$or = [{ name: rx }, { code: rx }];
  }
  const redoQuery = { ...base, 'approvalRedo.at': { $ne: null } };
  const notApprovedQuery = { ...base, [`${DETAILS_KEY[kind]}.releaseStatus`]: { $ne: 'Released' }, 'approvalRedo.at': null };
  const query = status === 'redo' ? redoQuery : status === 'notApproved' ? notApprovedQuery : base;
  const [items, total, all, redoN, notApprovedN, redo] = await Promise.all([
    Item.find(query).sort({ code: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Item.countDocuments(query),
    Item.countDocuments(base),
    Item.countDocuments(redoQuery),
    Item.countDocuments(notApprovedQuery),
    Item.aggregate([
      { $match: { companyId: new Item.base.Types.ObjectId(String(companyId)), productKind: { $in: APPROVAL_KINDS }, isDiscontinued: { $ne: true }, 'approvalRedo.at': { $ne: null } } },
      { $group: { _id: '$productKind', n: { $sum: 1 } } },
    ]),
  ]);
  const redoCounts = Object.fromEntries(redo.map(r => [r._id, r.n]));
  const rows = [];
  for (const item of items) {
    const a = approvalOf(item);
    const purchase = isPurchaseMachine(item);
    const qcOnly = isQcOnly(item);
    const release = await computeReleaseReadiness(item, companyId);
    rows.push({
      _id: String(item._id), code: item.code, name: item.name, category: item.category,
      productKind: item.productKind, image: item.image || '',
      purchaseMachine: purchase,
      boughtPart: isBoughtPart(item), qcOnly,
      approvalRedo: item.approvalRedo?.at ? item.approvalRedo : null,
      ...a,
      prototypeStatus: await getPrototypeStatus(item, companyId),
      designReadiness: qcOnly ? null : await computeDesignReadiness(item, companyId),
      releaseReadiness: release,
    });
  }
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)), redoCounts, counts: { all, notApproved: notApprovedN, redo: redoN } };
}
