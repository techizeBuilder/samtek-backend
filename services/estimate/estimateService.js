// Delivery estimate (18 Nov 2026): the whole estimate for Sales — settings,
// people and calendar, the work list, the pretend plan, and how sure it is.
// docs/delivery-estimate/01-logic.md, 02-plan.md (slice 5).
import mongoose from 'mongoose';
import Lead from '../../models/Lead.js';
import User from '../../models/User.js';
import { Item } from '../../models/Inventory.js';
import { estimateSettings, EstimateError } from './numbers.js';
import { peopleAndCalendar, indiaToday, rawShiftHours, MIN_ATTENDANCE_DAYS } from './history.js';
import { shiftsOf } from '../crew/crewService.js';
import { buildWork } from './workList.js';
import { estimate } from './planner.js';

const MAX_ITEMS = 20;

/**
 * The estimate for a quote: items [{ itemId, qty }], travelDays (default: the
 * Company Admin's usual travel days). Never saves or assigns anything.
 */
export async function estimateQuote(companyId, { items = [], travelDays } = {}, { today = indiaToday(), now = Date.now() } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && mongoose.isValidObjectId(x.itemId) && Number(x.qty) > 0);
  if (!list.length) throw new EstimateError(400, 'Pick at least one item with a quantity.');
  if (list.length > MAX_ITEMS) throw new EstimateError(400, `At most ${MAX_ITEMS} items in one estimate.`);
  // Settings, people and the work list load side by side (the work list only needs the shift's hours).
  const workP = shiftsOf(companyId).then((sh) => buildWork(companyId, { items: list }, { today, hoursPerDay: rawShiftHours(sh.find((x) => String(x.name || '').trim().toLowerCase() === 'general') || sh[0] || null), now }));
  const [settings, pc, work] = await Promise.all([estimateSettings(companyId), peopleAndCalendar(companyId, today), workP]);
  const travel = travelDays === undefined || travelDays === null || travelDays === '' ? settings.travelDaysDefault : Number(travelDays);
  if (!Number.isFinite(travel) || travel < 0 || travel > 60) throw new EstimateError(400, 'Travel days must be from 0 to 60.');

  const { people, calendar, attendanceMeasured, attendanceMeasuredCount } = pc;
  const base = {
    today, settings, travelDays: travel,
    // Measured from 20 recorded working days a person (deep test, 19 Nov); before that, 100%.
    attendance: attendanceMeasured
      ? `measured for ${attendanceMeasuredCount} of ${people.length} people (the rest: under ${MIN_ATTENDANCE_DAYS} recorded days, counted as 100%)`
      : `not measured yet (under ${MIN_ATTENDANCE_DAYS} recorded days): counted as 100%`,
    roughOrders: work.notes.roughOrders,
    warnings: work.warnings || [], // e.g. a machine whose BOM R&D hasn't approved yet (§11 change 7)
  };
  if (work.unknown.length) return { ...base, canEstimate: false, unknown: dedupe(work.unknown) };

  const r = estimate({ today, calendar, people, jobs: work.jobs, items: work.items, settings, travelDays: travel });
  if (!r.canEstimate) return { ...base, ...r, unknown: dedupe(r.unknown || []) };

  // How sure (decision E and §7): Good = mostly history or approved standards (feature 19);
  // Rough = typed numbers (R&D's figures not approved yet) or work in hand at 1 day per step.
  const typed = new Set(work.notes.typed);
  const fromHistory = new Set(work.notes.history);
  const fromStandard = new Set(work.notes.standard || []);
  const sure = work.notes.roughOrders.length || typed.size > fromHistory.size + fromStandard.size ? 'Rough' : 'Good';
  return {
    ...base, ...r, sure,
    typed: [...typed], fromHistory: [...fromHistory], fromStandard: [...fromStandard], typedHours: [...new Set(work.notes.typedHours || [])], // I5: only these are "split evenly"
    items: r.items.map((x) => ({ ...x, qty: work.items.find((w) => w.key === x.key)?.qty, code: work.items.find((w) => w.key === x.key)?.code })),
  };
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((u) => { const k = `${u.kind}|${u.job}|${u.what}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

/** What Sales can pick: in-house machines, bought machines and motors (active), paged + searched on the server. */
export async function estimableItems(companyId, { search = '', page = 1, limit = 30 } = {}) {
  const q = { companyId: new mongoose.Types.ObjectId(String(companyId)), productKind: { $in: ['Machine', 'Motor'] }, isDiscontinued: { $ne: true } };
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ name: re }, { code: re }];
  }
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 30));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const [rows, total] = await Promise.all([
    Item.find(q).sort({ name: 1 }).skip((pg - 1) * lim).limit(lim).select('name code productKind internalManufacturing qty unit').lean(),
    Item.countDocuments(q),
  ]);
  return {
    items: rows.map((i) => ({ _id: i._id, name: i.name, code: i.code, kind: i.productKind, route: i.productKind === 'Machine' && i.internalManufacturing === true ? 'In-house' : 'Bought', stock: i.qty || 0, unit: i.unit || '' })),
    total, page: pg, limit: lim,
  };
}

/** "Use this date" (decision I): saves the estimate on the lead; the last 10 are kept. */
export async function saveOnLead(user, leadId, result = {}) {
  if (!mongoose.isValidObjectId(leadId)) throw new EstimateError(404, 'Lead not found');
  const lead = await Lead.findOne({ _id: leadId, companyId: user.companyId }).select('_id deliveryEstimate deliveryEstimateHistory').lean();
  if (!lead) throw new EstimateError(404, 'Lead not found');
  const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  if (!d(result.likely) || !d(result.commit)) throw new EstimateError(400, 'Estimate the order first.');
  const name = (await User.findById(user._id).select('fullName username').lean())?.fullName || user.username || '';
  const saved = {
    likely: d(result.likely), commit: d(result.commit), deliveredBy: d(result.deliveredBy) || d(result.commit),
    travelDays: Math.max(0, Number(result.travelDays) || 0), buffer: Math.max(0, Number(result.buffer) || 0), sure: ['Good', 'Rough'].includes(result.sure) ? result.sure : 'Rough',
    items: (Array.isArray(result.items) ? result.items : []).slice(0, 20).map((i) => ({ label: String(i.label || '').slice(0, 120), code: String(i.code || '').slice(0, 60), qty: Number(i.qty) || 0, likely: d(i.likely) })),
    why: String(result.why || '').slice(0, 500),
    at: new Date(), by: user._id, byName: name,
  };
  const history = [...(lead.deliveryEstimate ? [lead.deliveryEstimate] : []), ...(lead.deliveryEstimateHistory || [])].slice(0, 10);
  await Lead.updateOne({ _id: lead._id }, { $set: { deliveryEstimate: saved, deliveryEstimateHistory: history } });
  return { deliveryEstimate: saved, previous: lead.deliveryEstimate || null };
}
