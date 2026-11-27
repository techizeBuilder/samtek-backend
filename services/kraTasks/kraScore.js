// Feature 25, slice 4 (23 Nov 2026): KRA tasks into the scorecard's work parts. Pure maths.
// docs/client-features-2026-11/25-kra-tasks-logic.md → "Slice 4 details" (with the worked example).
//
// For someone with a KRA, each of No delay, Accuracy, Work quality and Task completion =
//   Σ (KRA item weight × the item's result) ÷ Σ weights, over the items that have a result.
// Step work's result is the step result (stepParts); other items' results come from their tasks
// and routine items in the period, each counted by its planned hours. Productivity is steps only.
export const RATING_POINTS = { Excellent: 100, Good: 80, Average: 60, Poor: 30 };
export const KRA_PARTS = ['noDelay', 'accuracy', 'quality', 'taskCompletion'];
export const MIN_TASKS = 3;
const OPEN = ['Assigned', 'InProgress', 'Rework'];
const t = (d) => (d ? new Date(d).getTime() : null);

/** The grace after the due date for a task of this size (settings: graceShortMinutes, graceMediumHours, graceLongDays). */
export function graceMs(size, s = {}) {
  if (size === 'long') return (Number(s.graceLongDays ?? 1) || 0) * 86400000;
  if (size === 'medium') return (Number(s.graceMediumHours ?? 2) || 0) * 3600000;
  return (Number(s.graceShortMinutes ?? 30) || 0) * 60000;
}
const errorOf = (review) => (!review ? 0 : review.decision === 'Accepted' ? 0 : review.severity === 'Minor' ? 0.5 : 1);

/**
 * One task as it stood at `until` (the period's end, or now): { state: 'finished' | 'open' | 'waiting' | 'none',
 * onTime, error, rating, hours }. `from`: the period's start (a task accepted before it isn't this period's).
 */
export function taskFacts(task, { from, until, settings = {} }) {
  const F = t(from), U = t(until);
  const hours = Number(task.effortHours) || 0;
  const reviews = task.reviews || [];
  if (task.type === 'routine') {
    // The caller passes routine items whose day is in the period.
    if (task.status === 'Accepted' && (task.doneAt || task.firstDoneAt)) {
      const first = t(task.firstDoneAt || task.doneAt);
      return { state: 'finished', hours, onTime: first <= t(task.dueAt), error: errorOf(reviews[0]), rating: null };
    }
    if (task.status === 'Missed') return { state: 'open', hours };
    return { state: 'none', hours }; // not yet done (its day not over), or sent back and waiting for the redo
  }
  if (task.cancelledAt && t(task.cancelledAt) <= U) return { state: 'none', hours };
  if (task.status === 'Cancelled' && !task.cancelledAt) return { state: 'none', hours };
  const accepted = t(task.acceptedAt);
  if (accepted && accepted <= U) {
    if (F != null && accepted < F) return { state: 'none', hours };
    const lastAccept = [...reviews].reverse().find((r) => r.decision === 'Accepted');
    const firstSub = t(task.firstSubmittedAt);
    return {
      state: 'finished', hours,
      onTime: firstSub != null && firstSub <= t(task.dueAt) + graceMs(task.size, settings),
      error: errorOf(reviews[0]),
      rating: lastAccept && RATING_POINTS[lastAccept.rating] != null ? RATING_POINTS[lastAccept.rating] : null,
    };
  }
  if (t(task.dueAt) > U) return { state: 'none', hours }; // not yet due
  // Due by then and not accepted by then: waiting for review if its last submission by then came after
  // the last send-back by then; otherwise open (never submitted, or sent back and not resubmitted).
  const lastSub = Math.max(-1, ...(task.submissions || []).map((s) => t(s.at)).filter((x) => x != null && x <= U));
  const lastRework = Math.max(-1, ...reviews.filter((r) => r.decision === 'Rework').map((r) => t(r.at)).filter((x) => x != null && x <= U));
  if (lastSub > -1 && lastSub > lastRework) return { state: 'waiting', hours };
  return { state: 'open', hours };
}

/** Per KRA item (by itemId): { itemId, name, finished, open, noDelay, accuracy, quality, completion } (shares 0–1 or null). */
export function itemResults(tasks = [], { from, until, settings = {} }) {
  const by = new Map();
  for (const task of tasks) {
    const k = String(task.kra?.itemId || '');
    if (!k) continue;
    if (!by.has(k)) by.set(k, { itemId: k, name: task.kra?.name || '', F: [], O: [] });
    const f = taskFacts(task, { from, until, settings });
    if (f.state === 'finished') by.get(k).F.push(f);
    else if (f.state === 'open') by.get(k).O.push(f);
  }
  const sum = (list, fn) => list.reduce((s, x) => s + x.hours * fn(x), 0);
  const out = new Map();
  for (const [k, g] of by) {
    const fh = sum(g.F, () => 1), oh = sum(g.O, () => 1);
    const rated = g.F.filter((x) => x.rating != null);
    const rh = sum(rated, () => 1);
    out.set(k, {
      itemId: k, name: g.name, finished: g.F.length, open: g.O.length,
      noDelay: fh > 0 ? sum(g.F, (x) => (x.onTime ? 1 : 0)) / fh : null,
      accuracy: fh > 0 ? sum(g.F, (x) => 1 - x.error) / fh : null,
      quality: rh > 0 ? sum(rated, (x) => x.rating) / rh / 100 : null,
      completion: fh + oh > 0 ? fh / (fh + oh) : null,
    });
  }
  return out;
}

const STEP_OF = { noDelay: 'noDelay', accuracy: 'accuracy', quality: 'quality', taskCompletion: 'taskCompletion' };
const RESULT_OF = { noDelay: 'noDelay', accuracy: 'accuracy', quality: 'quality', taskCompletion: 'completion' };

/**
 * The work parts for someone with a KRA.
 * items: the KRA items in force on the period's last day [{ itemId, name, weight, builtIn }];
 * dropped: Map(itemId → { name, weight }) for items since dropped (their tasks' own version);
 * results: itemResults(); steps: stepParts() output.
 * Returns { noDelay, accuracy, quality, taskCompletion, productivity, rows } — parts like stepParts'
 * ({ share, ...detail }), rows for the KRA view.
 */
export function kraWorkParts({ items = [], dropped = new Map(), results = new Map(), steps = {}, minTasks = MIN_TASKS }) {
  const counted = [...results.values()].reduce((s, r) => s + r.finished + r.open, 0);
  const enough = counted >= minTasks;
  const hasStepWork = items.some((i) => i.builtIn === 'stepWork');
  const rows = [];
  for (const i of items) {
    const w = Number(i.weight) || 0;
    if (i.builtIn === 'stepWork') {
      const r = Object.fromEntries(KRA_PARTS.map((k) => [RESULT_OF[k], steps[STEP_OF[k]]?.share ?? null]));
      const any = KRA_PARTS.some((k) => r[RESULT_OF[k]] != null);
      rows.push({ itemId: String(i.itemId), name: i.name, weight: w, builtIn: 'stepWork', steps: steps.measuredSteps || 0, ...r, leftOut: !any, why: any ? null : 'steps' });
      continue;
    }
    const r = results.get(String(i.itemId));
    const has = enough && r && (r.finished + r.open) > 0;
    rows.push({ itemId: String(i.itemId), name: i.name, weight: w, builtIn: null, finished: r?.finished || 0, open: r?.open || 0,
      noDelay: has ? r.noDelay : null, accuracy: has ? r.accuracy : null, quality: has ? r.quality : null, completion: has ? r.completion : null,
      leftOut: !has, why: has ? null : r && !enough ? 'tasks' : 'none' });
  }
  for (const [k, r] of results) {
    if (rows.some((x) => x.itemId === k)) continue;
    const d = dropped.get(k);
    if (!d) continue;
    const has = enough && (r.finished + r.open) > 0;
    rows.push({ itemId: k, name: d.name || r.name, weight: Number(d.weight) || 0, builtIn: null, dropped: true, finished: r.finished, open: r.open,
      noDelay: has ? r.noDelay : null, accuracy: has ? r.accuracy : null, quality: has ? r.quality : null, completion: has ? r.completion : null,
      leftOut: !has, why: has ? null : 'tasks' });
  }
  const parts = {};
  for (const k of KRA_PARTS) {
    const used = rows.filter((x) => x[RESULT_OF[k]] != null && x.weight > 0);
    const wsum = used.reduce((s, x) => s + x.weight, 0);
    parts[k] = wsum > 0
      ? { share: used.reduce((s, x) => s + x.weight * x[RESULT_OF[k]], 0) / wsum, fromKra: true, items: used.map((x) => ({ name: x.name, weight: x.weight, share: x[RESULT_OF[k]] })) }
      : { share: null, fromKra: true, why: counted && !enough ? 'tasks' : 'kra' };
  }
  // Productivity: steps only, and only when Step work is part of the KRA.
  parts.productivity = hasStepWork ? steps.productivity || { share: null, why: 'steps' } : { share: null, why: 'kra' };
  return { ...parts, rows, counted, enoughTasks: enough };
}
