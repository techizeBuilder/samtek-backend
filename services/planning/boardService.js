// Work Planning board (feature 11, 2026-11-14) — what is running, planned, ready,
// waiting and finished today. docs/client-features-2026-11/11-work-planning-board-logic.md
//
// Every step of every open order lands in ONE section (logic §4). "Can it start?"
// is Start's own checks (startBlockers in productionMfgController.js), so the
// board and the Start button never disagree. Open work: not paged.
import ProductionOrder from '../../models/ProductionOrder.js';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import StepRun from '../../models/StepRun.js';
import ProductionTeam from '../../models/ProductionTeam.js';
import User from '../../models/User.js';
import { stepHoursSoFar } from '../crew/crewService.js';
import { timingBand } from '../score/scoreCalc.js';

const IST = 5.5 * 3600 * 1000;
const indiaDay = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const startOfIndiaDay = (day) => new Date(`${day}T00:00:00+05:30`);
const nameOf = (u) => u?.fullName || u?.username || 'Unknown';
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// "Waiting" reasons (logic §4), in the order the board groups them.
export const WAIT_REASONS = {
  material: 'Material not in Production',
  bom: 'BOM not verified by R&D',
  store: 'Held at Store',
  qc: 'In QC',
  vendor: 'At the vendor',
  outsource: 'Outsourced step not sent yet',
  prev: 'Previous step not done',
};

// Why an outsourced or QC step holds its unit. Also used by the order tracker (feature 12).
export function holdOf(step) {
  if (step.status === 'QC Pending') return { key: 'qc', detail: `${step.step} waits for QC's decision` };
  if (step.type === 'Outsourcing') {
    if (step.outsourceStatus === 'Received') return { key: 'qc', detail: `${step.step} is back from the vendor, in QC` };
    if (step.outsourceStatus === 'Sent') return { key: 'vendor', detail: `${step.step} is with the vendor` };
    if (step.outsourceStatus === 'Requested') return { key: 'outsource', detail: `${step.step}: requested from Purchase, not sent yet` };
    return { key: 'outsource', detail: `${step.step}: not requested yet` };
  }
  return null;
}

const unitCount = (o) => (o.orderKind === 'SubChildPart' ? 1 : Math.max(1, Number(o.orderQuantity) || 1));

/**
 * The board for a company: { running, planned, ready, waiting, finished, teams }.
 * Filters (all on the server): kind (Machine / ChildPart / SubChildPart), team, search.
 */
export async function board(companyId, { search = '', kind = '', team = '' } = {}) {
  const { startBlockers, unitProcessesView, autoVerifyMachineOrder } = await import('../../controllers/productionMfgController.js');
  const orders = await ProductionOrder.find({ company: companyId, status: { $nin: ['Completed', 'Cancelled'] } }).lean();
  // A Machine order's BOM / design tick is set the first time Process Execution
  // opens it; do the same check here so "BOM not verified" means R&D really hasn't.
  for (const o of orders) {
    if (o.orderKind === 'Machine' && !o.bomVerified) o.bomVerified = await autoVerifyMachineOrder(o._id, companyId);
  }
  const ids = orders.map((o) => o._id);
  const crewEntries = await StepCrewEntry.find({ order: { $in: ids }, leftAt: null })
    .populate('person', 'fullName username employeeId').populate('team', 'name').populate('forTeam', 'name').lean();
  const crewOf = new Map();
  for (const e of crewEntries) {
    const k = `${e.order}|${e.unitIndex}|${e.stepIndex}`;
    if (!crewOf.has(k)) crewOf.set(k, []);
    crewOf.get(k).push({
      person: e.person?._id, name: nameOf(e.person), employeeId: e.person?.employeeId,
      team: e.team ? { _id: e.team._id, name: e.team.name } : null, borrowed: !!e.borrowed,
      covering: e.coveringFor ? { name: e.coveringForName, team: e.forTeam?.name || '' } : null,
      forTeam: e.forTeam?._id || null, joinedAt: e.joinedAt,
    });
  }

  const running = [], planned = [], ready = [], waiting = [];
  // One order's steps into the sections. Orders are checked side by side (the
  // material checks read the database), each in its own order.
  const place = async (o) => {
    const units = unitCount(o);
    for (let u = 0; u < units; u++) {
      const procs = unitProcessesView(o, u);
      const nextIdx = procs.findIndex((p) => p.status !== 'Completed');
      for (let i = 0; i < procs.length; i++) {
        const p = procs[i];
        const crew = crewOf.get(`${o._id}|${u}|${i}`) || [];
        const row = {
          order: o._id, orderNo: o.orderId, orderKind: o.orderKind || 'Machine', partName: o.machineName, partCode: o.machineCode,
          unit: u + 1, units, stepIndex: i, stepName: p.step, plannedHours: p.plannedHours ?? null,
          priority: o.priority || 'Normal', deliveryDate: o.deliveryDate || null, stepTeam: p.assignedTeam ? String(p.assignedTeam) : null, crew,
        };
        if (p.type === 'In-House' && p.status === 'In Progress') {
          running.push({ ...row, startedAt: p.startedAt });
        } else if (p.type === 'In-House' && p.status === 'Pending' && crew.length) {
          const block = await startBlockers(o, u, i, companyId);
          planned.push({ ...row, canStart: !block && p.plannedHours > 0, block: block ? { key: block.key, reason: block.message } : null, needsPlannedHours: !(p.plannedHours > 0) });
        } else if (i === nextIdx) {
          const hold = holdOf(p);
          if (hold) { waiting.push({ ...row, reasonKey: hold.key, reason: hold.detail }); continue; }
          if (p.type !== 'In-House' || p.status !== 'Pending') continue;
          const block = await startBlockers(o, u, i, companyId);
          if (block) waiting.push({ ...row, reasonKey: WAIT_REASONS[block.key] ? block.key : 'prev', reason: block.message });
          else ready.push(row);
        }
      }
    }
  };
  await Promise.all(orders.map(place));

  // Running: hours so far on the current round, and whether they're past the plan.
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  for (const r of running) {
    const h = await stepHoursSoFar(companyId, byId.get(String(r.order)), r.unit - 1, r.stepIndex);
    Object.assign(r, { since: h.start, soFar: r1(h.personHours), took: r1(h.workingHours), overPlan: r.plannedHours > 0 && h.workingHours > r.plannedHours });
  }

  // Finished today (India date): the saved runs.
  const day = indiaDay(new Date());
  const runs = await StepRun.find({ company: companyId, completedAt: { $gte: startOfIndiaDay(day) } }).sort({ completedAt: -1 }).lean();
  const people = new Map((await User.find({ _id: { $in: [...new Set(runs.flatMap((x) => (x.byPerson || []).map((p) => String(p.person))))] } }).select('fullName username').lean()).map((u) => [String(u._id), nameOf(u)]));
  const kindOf = new Map((await ProductionOrder.find({ _id: { $in: [...new Set(runs.map((x) => String(x.order)))] } }).select('orderKind').lean()).map((o) => [String(o._id), o.orderKind || 'Machine']));
  const finished = runs.map((x) => ({
    order: x.order, orderNo: x.orderNo, orderKind: kindOf.get(String(x.order)) || 'Machine', partName: x.partName, partCode: x.partCode,
    unit: (x.unitIndex || 0) + 1, stepIndex: x.stepIndex, stepName: x.stepName, plannedHours: x.plannedHours ?? null,
    took: r1(x.workingHours), personHours: r1(x.personHours), rework: !!x.rework, completedAt: x.completedAt,
    band: x.rework ? null : timingBand(x.plannedHours, x.workingHours),
    crew: (x.byPerson || []).map((p) => ({ person: p.person, name: people.get(String(p.person)) || 'Unknown' })),
    teams: (x.byTeam || []).map((t) => String(t.team)),
  }));

  // Filters.
  const s = String(search || '').trim().toLowerCase();
  const keep = (r) => {
    if (kind && r.orderKind !== kind) return false;
    if (team) {
      const t = String(team);
      const on = r.stepTeam === t || (r.teams || []).includes(t)
        || (r.crew || []).some((c) => String(c.team?._id || '') === t || String(c.forTeam || '') === t);
      if (!on) return false;
    }
    if (s) {
      const hay = [r.orderNo, r.partName, r.partCode, r.stepName, ...(r.crew || []).map((c) => c.name)].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  };
  const prio = (r) => (r.priority === 'Urgent' ? 0 : 1);
  const byDue = (a, b) => prio(a) - prio(b) || String(a.deliveryDate || '9').localeCompare(String(b.deliveryDate || '9')) || String(a.orderNo).localeCompare(String(b.orderNo));
  const teams = await ProductionTeam.find({ company: companyId, isActive: true }).select('name').sort({ name: 1 }).lean();
  return {
    date: day,
    running: running.filter(keep).sort((a, b) => new Date(a.since || 0) - new Date(b.since || 0)),
    planned: planned.filter(keep).sort(byDue),
    ready: ready.filter(keep).sort(byDue),
    waiting: waiting.filter(keep).sort((a, b) => Object.keys(WAIT_REASONS).indexOf(a.reasonKey) - Object.keys(WAIT_REASONS).indexOf(b.reasonKey) || byDue(a, b)),
    finished: finished.filter(keep),
    reasons: WAIT_REASONS,
    teams: teams.map((t) => ({ _id: t._id, name: t.name })),
  };
}
