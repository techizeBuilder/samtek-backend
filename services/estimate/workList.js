// Delivery estimate (18 Nov 2026), slice 3: what has to be bought or built, and
// the work already in hand — the planner's input. Read-only: nothing is created,
// reserved or raised. docs/delivery-estimate/01-logic.md §3, 02-plan.md.
//
// The new order walks the same cascade the order form runs on submit:
//   Machine = Child Parts + its own (assembly) material; Child Part = Sub Child
//   Parts + its own material; Sub Child Part = its raw material. A part marked
//   bought (make or buy), a bought machine and a motor are bought (route 1).
// At every level only what free stock doesn't cover is built (decision R: free =
// stock − what confirmed orders still need, so it can be below 0; open POs fill
// that first, earliest first, and the new order gets what's left). Open
// for-stock production orders count too, at the date the plan finishes them (T).
import mongoose from 'mongoose';
import { Item } from '../../models/Inventory.js';
import MachineBOM from '../../models/MachineBOM.js';
import ChildPartBOM from '../../models/ChildPartBOM.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import PurchaseRequest from '../../models/PurchaseRequest.js';
import Purchase from '../../models/Purchase.js';
import MaterialReservation from '../../models/MaterialReservation.js';
import { plainMaterialGroupsFromBOM, lengthFabricationGroupsFromBOM, sheetMetalCutGroupsFromBOM } from '../bomMaterialGroupsService.js';
import { sheetAreaFromItem } from '../../controllers/sheetMetalPlanController.js';
import { computeSubChildPartRawMaterialAvailability } from '../subChildPartOrderService.js';
import { isBought } from '../makeBuyService.js';
import { stepHoursSoFar } from '../crew/crewService.js';
import { dimensionSignature } from '../fabricationDemandService.js';
import { computeDesignReadiness } from '../productApprovalService.js';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import {
  indiaToday, stepRunsFor, stepWork, stepTimes, usualCrew, peopleCapsFor, capFor, purchaseDaysFor, quotedDaysFor, jobworkDaysFor, qcWaitHours, recentCrews,
} from './history.js';
import { activeStandardsFor, workingOf, stepKeyOf, piecesFor } from '../standards/standardService.js';
import { standardFrom, standardHours, crewSegments } from '../standards/standardCalc.js';

const DAY_MS = 864e5;
const IST_MS = 5.5 * 3600 * 1000;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const indiaDateOf = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const norm = (s) => String(s || '').trim().toLowerCase();
const OPEN = ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC'];
const keyOf = (itemId, variantId) => `${itemId}|${variantId || ''}`;
const MADE = ['Machine', 'ChildPart', 'SubChildPart'];

/** Flat steps from a BOM's process definition (category order, then process order). */
export function flatSteps(def = []) {
  return (def || []).flatMap((c) => (c.internalProcesses || []).map((p) => ({ ...p, category: c.label })));
}

/** Bought (route 1): a motor, a bought machine, or a part marked bought. */
export const isBoughtItem = (item) => item.productKind === 'Motor'
  || (item.productKind === 'Machine' && item.internalManufacturing !== true) // Store's rule: in-house only when marked In-house Manufactured
  || isBought(item)
  || !MADE.includes(item.productKind);

/**
 * Everything the planner needs for a quote. request: { items: [{ itemId, qty }] }.
 * Returns { jobs, items, unknown, notes, qcWait }.
 */
export async function buildWork(companyId, request, { today = indiaToday(), hoursPerDay = 8, now = Date.now() } = {}) {
  const cid = oid(companyId);
  // typedHours: steps on R&D's figures not approved yet (I5); standard: steps on an approved standard (feature 19).
  const notes = { typed: [], typedHours: [], history: [], standard: [], roughOrders: [] };
  const unknown = [];
  const warnings = []; // e.g. a machine whose BOM R&D hasn't approved yet (§11 change 7)
  const jobs = [];
  let seq = 0;
  const newId = (p) => `${p}${++seq}`;
  // §13 (19 Nov): Purchase types the usual days to buy on Purchase → Inventory, which lists
  // only items with Purchase ticked — `listed` tells the screen which hint to give.
  const neverBought = (it) => unknown.push({ kind: 'material', job: it.name || it.code, what: `${it.name || it.code}: bought fewer than 3 times, no quote, no usual days to buy`, listed: it.purchase === true });

  // ── Items, loaded level by level (batched) ──
  const itemCache = new Map();
  const loadItems = async (ids = [], codes = []) => {
    const needIds = [...new Set(ids.map(String))].filter((i) => i && mongoose.isValidObjectId(i) && !itemCache.has(i));
    const have = new Set([...itemCache.values()].map((x) => x.code));
    const needCodes = [...new Set(codes)].filter((c) => c && !have.has(c));
    if (!needIds.length && !needCodes.length) return;
    const or = [];
    if (needIds.length) or.push({ _id: { $in: needIds.map(oid) } });
    if (needCodes.length) or.push({ code: { $in: needCodes } });
    for (const r of await Item.find({ companyId: cid, $or: or }).lean()) itemCache.set(String(r._id), r);
  };
  const byCode = (code) => [...itemCache.values()].find((x) => x.code === code) || null;

  const want = (request.items || []).filter((x) => x.itemId && Number(x.qty) > 0).map((x) => ({ itemId: String(x.itemId), qty: Math.ceil(Number(x.qty)) }));
  // The open orders (work in hand) don't depend on the quote: read them alongside.
  const openP = ProductionOrder.find({ company: cid, status: { $in: OPEN } })
    .select('orderId orderKind machineCode machineName orderQuantity source saleId priority deliveryDate createdAt status processes extraUnits').lean();
  await loadItems(want.map((w) => w.itemId));
  const top = want.map((w) => itemCache.get(w.itemId)).filter(Boolean);
  const mBoms = await MachineBOM.find({ company: cid, machine: { $in: top.filter((i) => i.productKind === 'Machine').map((i) => i._id) } }).lean();
  const mBomOf = new Map(mBoms.map((b) => [String(b.machine), b]));
  await loadItems(mBoms.flatMap((b) => (b.childParts || []).map((l) => String(l.childPart))), mBoms.flatMap((b) => (b.materials || []).map((m) => m.code)));
  const cpIds = [...itemCache.values()].filter((i) => i.productKind === 'ChildPart').map((i) => i._id);
  const cBoms = cpIds.length ? await ChildPartBOM.find({ company: cid, childPart: { $in: cpIds } }).lean() : [];
  const cBomOf = new Map(cBoms.map((b) => [String(b.childPart), b]));
  await loadItems(cBoms.flatMap((b) => (b.subChildParts || []).map((l) => String(l.subChildPart))), cBoms.flatMap((b) => (b.materials || []).map((m) => m.code)));
  await loadItems([...itemCache.values()].filter((i) => i.productKind === 'SubChildPart').map((i) => i.subChildPartDetails?.sourceItem).filter(Boolean).map(String));
  const allItems = [...itemCache.values()];

  // ── Free stock (decision R): stock − what confirmed orders still need, batched ──
  const reserved = new Map();
  const reservedP = allItems.length ? MaterialReservation.aggregate([
      { $match: { company: cid, item: { $in: allItems.map((i) => i._id) } } },
      { $group: { _id: { i: '$item', v: '$dimensionVariantId' }, rem: { $sum: { $max: [0, { $subtract: ['$quantity', { $ifNull: ['$issuedQuantity', 0] }] }] } } } },
    ]) : Promise.resolve([]);
  const taken = new Map(); // what this estimate has already used, shared across the tree
  const freeOf = (item, variantId = null) => {
    const v = variantId ? (item.dimensionVariants || []).find((x) => String(x._id) === String(variantId)) : null;
    const stock = variantId ? Number(v?.subStock) || 0 : Number(item.qty) || 0;
    return stock - (reserved.get(keyOf(item._id, variantId)) || 0) - (taken.get(keyOf(item._id, variantId)) || 0);
  };
  const take = (item, variantId, n) => taken.set(keyOf(item._id, variantId), (taken.get(keyOf(item._id, variantId)) || 0) + n);

  // ── Open POs (decision R), batched ──
  const incoming = new Map(); // code → [{ date, qty, values }], earliest first
  const incomingP = (async () => {
    const codes = [...new Set(allItems.map((i) => i.code).filter(Boolean))];
    const prs = codes.length ? await PurchaseRequest.find({ companyId: cid, materialCode: { $in: codes }, status: 'Ordered', purchaseOrder: { $ne: null } })
      .select('materialCode quantity convertedQuantity purchaseOrder fabricationDimensionLines').lean() : [];
    const pos = prs.length ? await Purchase.find({ _id: { $in: [...new Set(prs.map((p) => String(p.purchaseOrder)))].map(oid) } }).select('items expectedDeliveryDate').lean() : [];
    const lineOf = new Map();
    for (const po of pos) for (const l of po.items || []) if (l.purchaseRequest) lineOf.set(String(l.purchaseRequest), { line: l, po });
    for (const pr of prs) {
      const hit = lineOf.get(String(pr._id));
      let date = null;
      if (hit?.line?.expectedDeliveryDate) date = indiaDateOf(hit.line.expectedDeliveryDate);
      else if (hit?.line?.deliveryDays) date = addDays(today, hit.line.deliveryDays); // advance not paid yet: counted from today
      else if (hit?.po?.expectedDeliveryDate) date = indiaDateOf(hit.po.expectedDeliveryDate);
      if (date && date < today) date = today; // overdue: due now
      const qty = Number(pr.convertedQuantity) || Number(pr.quantity) || 0;
      if (!date || !(qty > 0)) continue;
      if (!incoming.has(pr.materialCode)) incoming.set(pr.materialCode, []);
      incoming.get(pr.materialCode).push({ date, qty, values: pr.fabricationDimensionLines?.[0]?.values || null });
    }
    for (const list of incoming.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  })();

  // ── Work in hand: open production orders ──
  const open = await openP;
  const since = new Date(now - 4 * DAY_MS); // the last 3 working days (a Sunday in between)
  const crewsP = recentCrews(companyId, open.map((o) => o._id), since);
  // People Production planned on steps not started yet (plan-ahead, §11 change 6): order|step → people.
  const plannedP = open.length ? StepCrewEntry.find({ order: { $in: open.map((o) => o._id) }, leftAt: null }).select('order unitIndex stepIndex person').lean() : Promise.resolve([]);

  // ── History, once per estimate ──
  const partCodes = [...new Set(allItems.filter((i) => MADE.includes(i.productKind)).map((i) => i.code).concat(open.map((o) => o.machineCode)).filter(Boolean))];
  const stepNames = [
    ...mBoms.flatMap((b) => flatSteps(b.processDefinition)), ...cBoms.flatMap((b) => flatSteps(b.processDefinition)),
    ...allItems.flatMap((i) => flatSteps(i.subChildPartDetails?.processDefinition)),
  ].map((s) => s.name).concat(open.flatMap((o) => [o.processes || [], ...(o.extraUnits || []).map((u) => u.processes || [])].flat().map((s) => s.step)));
  const [rows, , purchaseHist, quoted, jobworkDays, qcWait, runsMap, caps, standards] = await Promise.all([
    reservedP, incomingP,
    purchaseDaysFor(companyId, allItems.map((i) => i.code)),
    quotedDaysFor(companyId, allItems.map((i) => i.code)),
    jobworkDaysFor(companyId, stepNames),
    qcWaitHours(companyId),
    stepRunsFor(companyId, partCodes),
    peopleCapsFor(companyId, partCodes, now),
    activeStandardsFor(companyId, partCodes), // feature 19: the approved standards in force
  ]);
  for (const r of rows) {
    const k = r._id.v ? keyOf(r._id.i, r._id.v) : keyOf(r._id.i, null);
    reserved.set(k, (reserved.get(k) || 0) + r.rem);
  }

  /**
   * The material ladder (decisions R, S, U, V): when is `need` of this item (size)
   * in hand for the new order? Free stock → open POs (after confirmed orders) →
   * the usual purchase time. Returns { date, why, basis } or null (unknown).
   */
  const materialDate = (item, need, variantId = null) => {
    const label = item.name || item.code;
    if (!(need > 0)) return { date: today, why: '', basis: 'stock' };
    const free = freeOf(item, variantId);
    if (free >= need) { take(item, variantId, need); return { date: today, why: `${label}: in stock`, basis: 'stock' }; }
    const variant = variantId ? (item.dimensionVariants || []).find((x) => String(x._id) === String(variantId)) : null;
    const list = (incoming.get(item.code) || []).filter((x) => !variant || !x.values || JSON.stringify(x.values) === JSON.stringify(variant.values));
    let cum = free; // `taken` already lowered free, so POs used earlier in this estimate aren't counted twice
    let lastDate = null;
    for (const x of list) {
      cum += x.qty;
      lastDate = x.date;
      if (cum >= need) { take(item, variantId, need); return { date: x.date, why: `${label}: on a PO, due ${x.date}`, basis: 'po' }; }
    }
    const sizeKey = variant ? `${item.code}|${JSON.stringify(variant.values || {})}` : null;
    const hist = (sizeKey && purchaseHist.bySize.get(sizeKey)) || purchaseHist.byCode.get(item.code);
    let days = null, how = '';
    if (hist) { days = hist.days; how = `usually ${days} days`; notes.history.push(label); }
    else if (quoted.get(item.code) != null && purchaseHist.buyingDays != null) {
      days = quoted.get(item.code) + purchaseHist.buyingDays;
      how = `quoted ${quoted.get(item.code)} days + usually ${purchaseHist.buyingDays} days to buy`;
      notes.typed.push(label);
    } else if (Number(item.leadTime) > 0) { days = Number(item.leadTime); how = `Purchase's usual ${days} days to buy`; notes.typed.push(label); }
    if (days == null) return null;
    take(item, variantId, need);
    const buyDate = addDays(today, days);
    const date = lastDate && lastDate > buyDate ? lastDate : buyDate;
    return { date, why: `${label}: to buy, ${how}`, basis: 'buy' };
  };

  /**
   * Feature 19 (21 Nov 2026, logic §8): a step's standard — the approved one in force
   * (firm), else R&D's figures on the step not approved yet (typed → Rough), else null.
   * { std: { p1, setup, sigma, crew }, basis: 'standard' | 'typed' }.
   */
  const stdFor = (partCode, p) => {
    const a = standards.get(`${partCode}|${stepKeyOf(p.name ?? p.step)}`);
    if (a) return { std: workingOf(a), basis: 'standard' };
    const typed = standardFrom({ hoursPerPiece: p.usualHoursPerPiece, crew: p.standardCrew, setupHours: p.setupHours, splitAnswer: p.splitAnswer });
    return typed ? { std: typed, basis: 'typed' } : null;
  };
  /** Hours with 1…top people — the same formula Production is scored on. */
  const hoursTable = (std, pieces, top, share = 1) => {
    const out = {};
    for (let k = 1; k <= top; k++) out[k] = Math.max(share < 1 ? 0.5 : 0, share * standardHours(std, pieces, k));
    return out;
  };

  // One BOM step → a planner step. Its most people: the step's people count (decision F).
  const toStep = (partCode, partLabel, p, piecesPerUnit) => {
    if (p.type === 'OutSource') {
      const jw = jobworkDays.get(norm(p.name));
      if (jw) (jw.basis === 'history' ? notes.history : notes.typed).push(`${partLabel}: ${p.name}`);
      // B4 (deep test, 19 Nov): a job-work step with a QC tick is checked when it comes back
      // (outsource-v2: Store receives → QC → Production), so the next step waits for QC too.
      return { name: p.name, kind: 'jobwork', days: jw ? jw.days : null, qc: !!(p.qcRequired || p.finalQc), qcWaitHours: qcWait.hours };
    }
    // Feature 19: hours for 1…the step's people count, from its standard (setup once, the split answer).
    const st = stdFor(partCode, p);
    if (st?.basis === 'standard') notes.standard.push(`${partLabel}: ${p.name}`);
    if (st?.basis === 'typed') { notes.typed.push(`${partLabel}: ${p.name}`); notes.typedHours.push(`${partLabel}: ${p.name}`); }
    const maxCrew = st ? Math.max(1, st.std.crew || 1) : 1;
    return {
      name: p.name, kind: 'work', skill: p.name, hoursFor: st ? hoursTable(st.std, piecesPerUnit, maxCrew) : null, maxCrew,
      qc: !!(p.qcRequired || p.finalQc), qcWaitHours: qcWait.hours, refs: (p.materialRefs || []).map(String),
    };
  };

  // Its own material lines (plain, length, sheet) for `qty` builds, by group, each
  // with its date: { byLine: Map lineId → { key, date, why }, missing }. A group is
  // held by the first step that picks one of its lines (§11 change 3).
  const ownMaterials = (materials, qty) => {
    const lines = (materials || []).filter((m) => !m.isDiscontinued);
    const bom = { materials: lines };
    const byKey = new Map();
    let missing = false;
    const put = (key, it, m) => { if (!m) { missing = true; neverBought(it); } else byKey.set(key, { key, date: m.date, why: m.why }); };
    for (const g of plainMaterialGroupsFromBOM(bom)) {
      const it = byCode(g.itemCode);
      if (it) put(`p:${g.itemCode}`, it, materialDate(it, g.perUnitQty * qty));
    }
    for (const g of lengthFabricationGroupsFromBOM(bom)) {
      const it = byCode(g.itemCode);
      const v = it && (it.dimensionVariants || []).find((x) => String(x._id) === String(g.dimensionVariantId));
      const len = Number(v?.values?.length) || 0;
      if (it && len) put(`l:${g.itemCode}#${g.dimensionVariantId}`, it, materialDate(it, Math.ceil((g.totalLengthMmPerUnit * qty) / len), g.dimensionVariantId));
    }
    for (const g of sheetMetalCutGroupsFromBOM(bom)) {
      const it = byCode(g.itemCode);
      const sheet = it && sheetAreaFromItem(it, g.dimensionVariantId);
      if (it && sheet?.areaMm2 && g.areaMm2PerPiece) put(`s:${g.key}`, it, materialDate(it, Math.ceil((g.areaMm2PerPiece * g.quantity * qty) / sheet.areaMm2), g.dimensionVariantId));
    }
    // Each line → its group (the same keys the group helpers use).
    const byLine = new Map();
    for (const m of lines) {
      const key = !m.fabricationCategory ? `p:${m.code}`
        : m.isSheetMetal ? `s:${m.code}#${m.dimensionVariantId}#${dimensionSignature(m.bomDimensions)}`
        : `l:${m.code}#${m.dimensionVariantId}`;
      if (byKey.has(key)) byLine.set(String(m._id), byKey.get(key));
    }
    return { byLine, groups: [...byKey.values()], missing };
  };

  /**
   * §11 change 3: each step waits for its own picks (material and parts, unit by
   * unit). A group or part line nobody picks holds the first step. `lineNeeds`:
   * Map lineId → need ({ date, why } or { job, perUnit, stock, why }), plus group keys.
   */
  const placeNeeds = (steps, lineNeeds) => {
    const usedGroup = new Set();
    const usedLine = new Set();
    for (const s of steps) {
      s.needs = [];
      for (const ref of s.refs || []) {
        const n = lineNeeds.get(ref);
        if (!n || usedLine.has(ref)) continue;
        usedLine.add(ref);
        if (n.key) { if (usedGroup.has(n.key)) continue; usedGroup.add(n.key); s.needs.push({ date: n.date, why: n.why }); }
        else s.needs.push({ job: n.job, perUnit: n.perUnit, stock: n.stock, why: n.why });
      }
      delete s.refs;
    }
    const first = steps[0];
    for (const [ref, n] of lineNeeds) {
      if (usedLine.has(ref)) continue;
      if (n.key) { if (usedGroup.has(n.key)) continue; usedGroup.add(n.key); first.needs.push({ date: n.date, why: n.why }); }
      else first.needs.push({ job: n.job, perUnit: n.perUnit, stock: n.stock, why: n.why });
    }
  };

  // For-stock orders by part code (decision T), filled from the work in hand below.
  const stockOrders = new Map(); // code → [{ jobId, qty, used }]

  /** Builds `qty` of a made part: its steps (each with its own needs), its children. → job id or null. */
  const buildJob = async (item, qty, depth) => {
    const label = item.name || item.code;
    const kind = item.productKind;
    let defSteps = [], children = [];
    const lineNeeds = new Map();
    if (kind === 'Machine' || kind === 'ChildPart') {
      const bom = kind === 'Machine' ? mBomOf.get(String(item._id)) : cBomOf.get(String(item._id));
      if (!bom) { unknown.push({ kind: 'part', job: label, what: `${label}: no BOM` }); return null; }
      // §11 change 7: Production can't start a Machine until R&D approves its BOM.
      if (kind === 'Machine' && (!bom.isLocked || !(await computeDesignReadiness(item, companyId).catch(() => ({ ok: false }))).ok)) {
        warnings.push({ kind: 'bom', part: label });
      }
      defSteps = flatSteps(bom.processDefinition);
      const lines = ((kind === 'Machine' ? bom.childParts : bom.subChildParts) || []).filter((l) => !l.isDiscontinued);
      for (const l of lines) {
        const sub = itemCache.get(String(kind === 'Machine' ? l.childPart : l.subChildPart));
        if (!sub) continue;
        const r = await partJob(sub, (Number(l.quantity) || 0) * qty, depth + 1);
        if (!r) continue;
        children.push(r.id);
        // Unit by unit: each unit of this part uses line.quantity of the child.
        lineNeeds.set(String(l._id), { job: r.id, perUnit: Number(l.quantity) || 1, stock: r.stock, why: sub.name || sub.code });
      }
      const mats = ownMaterials(bom.materials, qty);
      if (mats.missing) return null;
      for (const [lineId, g] of mats.byLine) lineNeeds.set(lineId, g);
    } else {
      const d = item.subChildPartDetails || {};
      defSteps = flatSteps(d.processDefinition);
      const src = d.sourceItem ? itemCache.get(String(d.sourceItem)) : null;
      if (src) {
        const r = await computeSubChildPartRawMaterialAvailability(item, src, qty);
        if (r?.neededQty > 0) {
          const m = materialDate(src, r.neededQty, d.sourceDimensionVariantId || null);
          if (!m) { neverBought(src); return null; }
          // The batch's raw material holds its first step.
          lineNeeds.set('raw', { key: 'raw', date: m.date, why: m.why });
        }
      }
    }
    const units = kind === 'SubChildPart' ? 1 : qty;
    const piecesPerUnit = kind === 'SubChildPart' ? qty : 1;
    const steps = defSteps.map((p) => toStep(item.code, label, p, piecesPerUnit));
    // Feature 19 (logic §8): most people on the order at once = the part's largest step
    // count (per order, D1). No step with a standard or R&D's figures: history, as before.
    const c = jobCap(item.code, steps, defSteps);
    if (!steps.length) { unknown.push({ kind: 'part', job: label, what: `${label}: no steps` }); return null; }
    for (const s of steps) {
      if (s.kind === 'work' && s.hoursFor == null) unknown.push({ kind: 'step', job: label, what: s.name });
      if (s.kind === 'jobwork' && s.days == null) unknown.push({ kind: 'jobwork', job: label, what: s.name });
    }
    placeNeeds(steps, lineNeeds);
    const id = newId('J');
    jobs.push({ id, label, kind, isNew: true, priority: Infinity, units, cap: c.cap, capMost: c.most, capBasis: c.basis, children, materialReady: today, materialWhy: '', steps, code: item.code });
    return id;
  };

  /** The cap for a job: its largest step crew (feature 19), else history / step crews as before. */
  function jobCap(partCode, steps, defSteps = []) {
    const crews = steps.filter((x) => x.kind === 'work' && x.hoursFor).map((x) => x.maxCrew || 1);
    if (crews.length) { const top = Math.max(...crews); return { cap: top, most: top, basis: 'standard' }; }
    return capFor(caps, partCode, null, defSteps.map((p) => ({ kind: p.type === 'OutSource' ? 'jobwork' : 'work', crew: usualCrew(runsMap, partCode, p.name) || 1 })));
  }

  /**
   * The job that has `need` of `item` ready for the new order → { id, stock } (stock =
   * how many came from free stock, there from the start), or null with an unknown.
   */
  const partJob = async (item, need, depth = 0) => {
    const label = item.name || item.code;
    if (depth > 6) { unknown.push({ kind: 'part', job: label, what: 'too many levels' }); return null; }
    if (isBoughtItem(item)) {
      const m = materialDate(item, need);
      if (!m) neverBought(item);
      const id = newId('B');
      jobs.push({ id, label, kind: 'Bought', isNew: true, priority: Infinity, units: 1, cap: 1, children: [], materialReady: m?.date ?? null, materialWhy: m?.why || label, steps: [] });
      return { id, stock: 0 };
    }
    // Made: free stock first (case 0 at the machine level), then for-stock orders, then build.
    const fromStock = Math.max(0, Math.min(need, freeOf(item)));
    if (fromStock) take(item, null, fromStock);
    let rest = need - fromStock;
    const kids = [];
    for (const so of stockOrders.get(item.code) || []) {
      if (rest <= 0) break;
      const use = Math.min(so.qty - so.used, rest);
      if (use <= 0) continue;
      so.used += use;
      rest -= use;
      kids.push(so.jobId);
    }
    let build = null;
    if (rest > 0) {
      build = await buildJob(item, rest, depth);
      if (!build) return null;
    }
    // A new build alone is the job itself (its units count one by one, after the
    // stock); anything from a for-stock order gets the new order's own gather job
    // (all at once), so the plan stops once the new order is ready.
    if (build && !kids.length) return { id: build, stock: fromStock };
    if (build) kids.push(build);
    const id = newId(kids.length ? 'G' : 'S');
    jobs.push({ id, label, kind: kids.length ? 'Gather' : 'Bought', isNew: true, priority: Infinity, units: 1, cap: 1, children: kids, materialReady: today, materialWhy: kids.length ? '' : `${label}: in stock`, steps: [] });
    return { id, stock: fromStock };
  };

  // ── Work in hand → planner jobs (they go first) ──
  const [crews, plannedRows] = await Promise.all([crewsP, plannedP]);
  const plannedOn = new Map(); // order|step → people planned on that step (any unit; it isn't started)
  for (const r of plannedRows) {
    const k = `${r.order}|${r.stepIndex}`;
    if (!plannedOn.has(k)) plannedOn.set(k, new Set());
    plannedOn.get(k).add(String(r.person));
  }
  // Hours so far on running steps that have a plan (bounded: one step per person), read side by side:
  // person-hours, and who worked when (feature 19: the share of a standard done so far).
  const soFar = new Map();
  await Promise.all(open.flatMap((o) => [o.processes || [], ...(o.extraUnits || []).map((u) => u.processes || [])].flatMap((list, ui) => list.map((s, si) => [s, ui, si]))
    .filter(([s]) => s.status === 'In Progress' && Number(s.plannedHours) > 0 && s.type !== 'Outsourcing')
    .map(([, ui, si]) => stepHoursSoFar(companyId, o, ui, si).then((d) => soFar.set(`${o._id}|${ui}|${si}`, d || null)).catch(() => null))));
  const roughOrders = new Set();
  for (const o of open) {
    const partCode = o.machineCode;
    const label = `${o.orderId} (${o.machineName || partCode})`;
    const unitLists = [o.processes || [], ...(o.extraUnits || []).map((u) => u.processes || [])];
    const sub = o.orderKind === 'SubChildPart';
    const pieces = sub ? Math.max(1, Number(o.orderQuantity) || 1) : 1;
    // One job per order; each unit's remaining steps are planned as the longest
    // remaining list (a little cautious when units are uneven).
    let remaining = [];
    const sticky = [...(crews.get(String(o._id)) || [])];
    for (let ui = 0; ui < unitLists.length; ui++) {
      const list = unitLists[ui];
      const left = [];
      for (let si = 0; si < list.length; si++) {
        const s = list[si];
        if (s.status === 'Completed') continue;
        if (s.type === 'Outsourcing') {
          if (s.outsourceStatus === 'Received') continue;
          const jw = jobworkDays.get(norm(s.step));
          if (!jw) roughOrders.add(label);
          // A QC checkpoint on a job-work step is checked when it comes back (B4, deep test 19 Nov).
          left.push({ name: s.step, kind: 'jobwork', days: jw ? jw.days : 1, qc: !!(s.qcRequired || s.finalQc), qcWaitHours: qcWait.hours });
          continue;
        }
        // Production's planned people on a step not started yet are its crew (§11 change 6).
        const planned = s.status === 'Pending' ? [...(plannedOn.get(`${o._id}|${si}`) || [])] : [];
        const base = { name: s.step, kind: 'work', skill: s.step, qc: !!(s.qcRequired || s.finalQc), qcWaitHours: qcWait.hours, planned };
        // Feature 19 (logic §8): work in hand goes by the standard. Running on its start
        // snapshot: what's left of it (the share done so far, stretch by stretch). Not started:
        // the approved one in force (what Start will use). Else typed hours, else R&D's
        // figures, else 1 working day (decision Q).
        const n = piecesFor(o, s) || pieces;
        const snap = s.status === 'In Progress' && s.plannedSource === 'standard' && s.standard?.p1 > 0 ? s.standard : null;
        const active = s.status === 'Pending' ? standards.get(`${partCode}|${stepKeyOf(s.step)}`) : null;
        const sf = soFar.get(`${o._id}|${ui}|${si}`);
        if (snap) {
          const done = crewSegments(sf?.perPerson || []).reduce((t, x) => t + x.hours / (standardHours(snap, n, x.k) || Infinity), 0);
          const top = Math.max(1, snap.crew || 1);
          left.push({ ...base, hoursFor: hoursTable(snap, n, top, Math.max(0, 1 - done)), maxCrew: top });
        } else if (active) {
          const std = workingOf(active);
          left.push({ ...base, hoursFor: hoursTable(std, n, std.crew || 1), maxCrew: Math.max(1, std.crew || 1) });
        } else if (Number(s.plannedHours) > 0) {
          let ph = Number(s.plannedHours);
          if (s.status === 'In Progress') ph = Math.max(0.5, ph - (Number(sf?.personHours) || 0));
          left.push({ ...base, personHours: ph, crew: 1 });
        } else {
          const st = stdFor(partCode, s);
          if (st) left.push({ ...base, hoursFor: hoursTable(st.std, n, st.std.crew || 1), maxCrew: Math.max(1, st.std.crew || 1) });
          else { roughOrders.add(label); left.push({ ...base, personHours: hoursPerDay, crew: 1 }); } // decision Q: 1 working day per step
        }
      }
      if (left.length > remaining.length) remaining = left;
    }
    // Most people at once: its largest step crew (feature 19), never fewer than those already on it.
    const cap = Math.max(jobCap(partCode, remaining).cap, sticky.length);
    const id = `W${String(o._id)}`;
    const unitsLeft = sub ? 1 : unitLists.filter((l) => l.some((s) => s.status !== 'Completed')).length;
    jobs.push({
      id, label, kind: remaining.length ? 'WorkInHand' : 'Bought', isNew: false,
      // §11 change 5: Urgent first, then the earliest delivery date.
      priority: (o.priority === 'Urgent' ? 0 : 1e15) + (Date.parse(`${o.deliveryDate}T00:00:00Z`) || new Date(o.createdAt).getTime() || 0),
      units: Math.max(1, unitsLeft), cap, sticky, children: [], materialReady: today, steps: remaining, code: partCode,
    });
    if (o.source === 'Stock' && !o.saleId) {
      if (!stockOrders.has(partCode)) stockOrders.set(partCode, []);
      stockOrders.get(partCode).push({ jobId: id, qty: Math.max(1, Number(o.orderQuantity) || 1), used: 0 });
    }
  }
  notes.roughOrders = [...roughOrders];

  // ── The new order ──
  const items = [];
  for (const w of want) {
    const it = itemCache.get(w.itemId);
    if (!it) { unknown.push({ kind: 'part', job: w.itemId, what: 'item not found' }); continue; }
    const r = await partJob(it, w.qty);
    if (r) items.push({ key: String(it._id), label: it.name || it.code, code: it.code, qty: w.qty, jobId: r.id });
  }

  return { jobs, items, unknown, warnings, notes, qcWait };
}
