// Feature 25, slice 4 (23 Nov 2026): loading what the KRA part of the scorecard needs, bounded
// by the period and the people asked for. The maths is in kraScore.js.
import mongoose from 'mongoose';
import KraTask from '../../models/KraTask.js';
import KraSet from '../../models/KraSet.js';
import { kraOfMany } from '../kra/kraService.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * The tasks that can count for these people in [from, to] (Dates) / [fromDate, toDate] ('YYYY-MM-DD'):
 * accepted in the period; routine items done or missed whose day is in it; and work due by the
 * period's end that was open then — either still open now or changed since the period began
 * (never every task ever given).
 */
export async function kraTasksFor(companyId, personIds, { from, to, fromDate, toDate }) {
  if (!personIds.length) return [];
  const until = new Date(Math.min(to.getTime(), Date.now()));
  return KraTask.find({
    company: oid(companyId), person: { $in: personIds.map(oid) },
    $or: [
      { type: { $ne: 'routine' }, acceptedAt: { $gte: from, $lte: to } },
      { type: 'routine', 'routine.day': { $gte: fromDate, $lte: toDate }, status: { $in: ['Accepted', 'Missed'] } },
      { type: { $ne: 'routine' }, dueAt: { $lte: until }, $and: [
        { $or: [{ status: { $ne: 'Cancelled' } }, { cancelledAt: { $gt: until } }] },
        { $or: [{ status: { $in: ['Assigned', 'InProgress', 'Rework', 'Submitted'] } }, { updatedAt: { $gte: from } }] },
      ] },
    ],
  }).select('person kra type size effortHours dueAt status acceptedAt cancelledAt firstSubmittedAt submissions.at reviews.at reviews.decision reviews.severity reviews.rating routine.day doneAt firstDoneAt').lean();
}

/**
 * Each person's KRA on the period's last day (kraOfMany), and for items their tasks are under that
 * have since dropped out, the name and weight from the version those tasks were given under.
 * Returns { kras: Map(person → { source, set, items } | null), dropped: Map(person → Map(itemId → { name, weight })) }.
 */
export async function weightsFor(companyId, people, toDate, tasks) {
  const kras = await kraOfMany(companyId, people, toDate);
  const need = new Map(); // setId → [{ person, itemId }]
  for (const t of tasks) {
    const k = kras.get(String(t.person));
    if (!k || k.items.some((i) => String(i.itemId) === String(t.kra.itemId))) continue;
    const s = String(t.kra.setId);
    if (!need.has(s)) need.set(s, []);
    need.get(s).push({ person: String(t.person), itemId: String(t.kra.itemId) });
  }
  const dropped = new Map();
  if (need.size) {
    const sets = await KraSet.find({ _id: { $in: [...need.keys()].map(oid) } }).select('items.itemId items.name items.weight').lean();
    for (const s of sets) {
      for (const { person, itemId } of need.get(String(s._id)) || []) {
        const it = (s.items || []).find((i) => String(i.itemId) === itemId);
        if (!it) continue;
        if (!dropped.has(person)) dropped.set(person, new Map());
        dropped.get(person).set(itemId, { name: it.name, weight: it.weight });
      }
    }
  }
  return { kras, dropped };
}
