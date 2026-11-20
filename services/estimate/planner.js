// Delivery estimate (18 Nov 2026, revised 19 Nov): the pretend plan. Pure — no database.
// docs/delivery-estimate/01-logic.md (design, decisions; §11 = the 19 Nov revision).
//
// It walks forward day by day on working days. Work in hand goes first (Urgent,
// then earliest delivery date — the caller's `priority`); people planned on a step
// go onto it, people stay with the order they've been on (sticky); the new order
// gets who's left, never more than each part's usual number of people at once
// (cap). Nothing is saved; nobody is assigned.
//
// How Production works, and so the plan (§11):
//   - each unit has its steps in order; a step starts when the one before it on
//     that unit is done (and, after a QC step, QC has decided)
//   - a step waits only for ITS OWN needs: a material (from a date) or a part
//     from a child job, unit by unit (the parent's unit i needs i × perUnit of
//     the child's units done; a batch or bought child comes all at once)
//   - a step's time depends on how many people are on it (stage 5, 02e decision 5):
//     `hoursFor[k]` = hours with k people; progress is the fraction done, so when
//     people join or leave the rest goes at the new speed
//   - consecutive job-work steps go out in one trip (merged here)
//
// Time inside the plan is a number: dayIndex * 24 + hour (day 0 = today).
//
// Input:
//   today 'YYYY-MM-DD'
//   calendar { weeklyOffDays: [0], holidays: ['YYYY-MM-DD'] }       (company)
//   people [{ id, name, team, teamName, skills: [], hoursPerDay, rate, offDates: ['YYYY-MM-DD'] }]
//   jobs [{
//     id, label, kind: 'Machine'|'ChildPart'|'SubChildPart'|'Bought'|'Gather'|'WorkInHand',
//     isNew, priority (smaller first; the new order's jobs = Infinity),
//     units (Machine/ChildPart: one per piece; a Sub Child Part batch: 1),
//     cap, capMost, sticky: [personId],
//     children: [jobId], materialReady 'YYYY-MM-DD' | null (null = unknown),
//     materialWhy: 'Motor: to buy, usually 7 days',
//     steps: [{
//       name, kind: 'work'|'jobwork', skill,
//       hoursFor: { 1: h, 2: h, … } (hours with k people) — or personHours (split evenly),
//       maxCrew (or crew), days (job work), qc, qcWaitHours,
//       needs: [{ date, why } | { job, perUnit, stock, why }], planned: [personId],
//     }]
//   }]
//   Old-style input still works: a job's materialReady and any child no step names
//   become needs of its first step (the child as a whole).
//   settings { bufferPercent, bufferMinDays, packingDays, dispatchDays }
//   travelDays, horizonDays (366), qcDayHours (8)

const DAY_MS = 864e5;
const EPS = 1e-6;

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayIndexOf = (today, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

export function makeCalendar({ weeklyOffDays = [0], holidays = [] } = {}) {
  const hol = new Set(holidays);
  return { isWorking: (d) => !weeklyOffDays.includes(weekdayOf(d)) && !hol.has(d) };
}

/** The first working day on or after `date` (or after it, when inclusive is false). */
export function nextWorkingDay(cal, date, inclusive = true) {
  let d = inclusive ? date : addDays(date, 1);
  for (let i = 0; i < 800; i++) { if (cal.isWorking(d)) return d; d = addDays(d, 1); }
  return null;
}

/** The date `n` working days after `date`. */
export function addWorkingDays(cal, date, n) {
  let d = date;
  for (let k = 0; k < n;) { d = addDays(d, 1); if (cal.isWorking(d)) k++; }
  return d;
}

/** Working days d with from < d <= to. */
export function workingDaysBetween(cal, from, to) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (cal.isWorking(d)) n++;
  return n;
}

/** Decision B: a % of the working days, never below the minimum. */
export const bufferDays = (workingDays, { bufferPercent = 15, bufferMinDays = 2 } = {}) =>
  Math.max(bufferMinDays, Math.ceil((workingDays * bufferPercent) / 100 - EPS));

// Decision F: matched on the step's skill (its name by default); someone with no
// skills recorded can do anything. A step whose skill nobody has recorded is done
// by anyone too — skills aren't fully entered yet, and real work still gets done
// (otherwise the plan would wait forever). `held` = every skill someone holds.
const canDo = (person, step, held) => {
  const need = String(step.skill || step.name || '').trim().toLowerCase();
  if (!need || !(person.skills || []).length) return true;
  if (held && !held.has(need)) return true;
  return person.skills.some((s) => String(s).trim().toLowerCase() === need);
};

/** Hours a work step takes with k people: its table, else its work split evenly. null = unknown. */
export function hoursOf(step, k) {
  if (!(k >= 1)) return null;
  const t = step.hoursFor;
  if (t && Number(t[k]) > 0) return Number(t[k]);
  if (t) {
    // Past the table's end: the last known entry, split further evenly.
    const keys = Object.keys(t).map(Number).filter((x) => Number(t[x]) > 0).sort((a, b) => a - b);
    if (keys.length) { const last = keys[keys.length - 1]; return (Number(t[last]) * last) / k; }
  }
  if (step.personHours != null && Number(step.personHours) >= 0) return Number(step.personHours) / k;
  return null;
}
const knownStep = (s) => s.kind !== 'work' || hoursOf(s, 1) != null;

/** Consecutive job-work steps go out together, in one trip (§11 change 4): one step, the longer days. */
export function mergeJobwork(steps = []) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (s.kind === 'jobwork' && prev?.kind === 'jobwork') {
      out[out.length - 1] = {
        ...prev, name: `${prev.name} + ${s.name}`,
        days: prev.days == null || s.days == null ? null : Math.max(prev.days, s.days),
        qc: prev.qc || s.qc, qcWaitHours: s.qcWaitHours ?? prev.qcWaitHours,
        needs: [...(prev.needs || []), ...(s.needs || [])],
      };
    } else out.push({ ...s, needs: [...(s.needs || [])] });
  }
  return out;
}

/**
 * Plans the jobs. Returns { states: Map jobId → state, horizonHit }.
 * Exported for tests; estimate() below is what callers use.
 */
export function simulate({ today, calendar, people = [], jobs = [], horizonDays = 366, qcDayHours = 8 }) {
  const cal = calendar.isWorking ? calendar : makeCalendar(calendar);
  const dayOf = (t) => Math.floor(t / 24 + EPS);
  const dateOf = (i) => addDays(today, i);
  const startOfNextWorking = (dayIdx) => dayIndexOf(today, nextWorkingDay(cal, dateOf(dayIdx), false)) * 24;
  const startOfWorkingOnOrAfter = (date) => Math.max(0, dayIndexOf(today, nextWorkingDay(cal, date, true)) * 24);
  // After a QC checkpoint: the usual wait in working hours, or the end of the same working day.
  const afterQc = (t, waitHours) => {
    if (waitHours == null) return startOfNextWorking(dayOf(t));
    let day = dayOf(t);
    let left = waitHours;
    let at = t - day * 24; // hour inside the day
    for (let guard = 0; guard < 800; guard++) {
      const room = Math.max(0, qcDayHours - at);
      if (left <= room + EPS) return day * 24 + at + left;
      left -= room;
      day = startOfNextWorking(day) / 24;
      at = 0;
    }
    return Infinity;
  };

  // Each job's steps: merged job work, and the old-style job gates moved onto the first step.
  const byId = new Map();
  for (const j of jobs) {
    let steps = mergeJobwork(j.steps || []);
    if (steps.length) {
      const named = new Set(steps.flatMap((s) => (s.needs || []).map((n) => n.job).filter(Boolean)));
      const first = steps[0];
      if (j.materialReady) first.needs.push({ date: j.materialReady, why: j.materialWhy || '' });
      for (const cid of j.children || []) if (!named.has(cid)) first.needs.push({ job: cid, perUnit: 'all' });
    }
    const unitCount = Math.max(1, !steps.length ? 1 : (j.units || 1));
    byId.set(j.id, {
      job: { ...j, steps }, doneAt: null, startedAt: null, unitsDone: 0,
      peopleUsed: new Map(), // personId → first time used
      units: Array.from({ length: unitCount }, (_, i) => ({
        i, stepIdx: 0, frac: null, readyAt: 0, done: false, doneAt: null, crew: new Set(), lastCrew: new Set(), log: [], blocked: false,
      })),
      jobwork: [], // { unit, step, sentAt, back, backAt }
    });
  }
  const personById = new Map(people.map((p) => [String(p.id), p]));
  const held = new Set(people.flatMap((p) => (p.skills || []).map((s) => String(s).trim().toLowerCase())));
  const stickyOf = new Map(); // personId → [jobId] (in priority order)
  for (const j of [...jobs].sort((a, b) => a.priority - b.priority)) {
    for (const pid of j.sticky || []) {
      const k = String(pid);
      if (!stickyOf.has(k)) stickyOf.set(k, []);
      stickyOf.get(k).push(j.id);
    }
  }

  // A job with no steps: a bought item (done when its material is in), or a
  // "gather" job that also waits for other jobs (e.g. part of an item coming
  // from a for-stock order, decision T): done when they're done too.
  const settleNoStepJobs = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const st of byId.values()) {
        const j = st.job;
        if (j.steps.length || st.doneAt != null || j.materialReady == null) continue;
        const kids = (j.children || []).map((id) => byId.get(id));
        if (kids.some((c) => !c || c.doneAt == null)) continue;
        st.doneAt = Math.max(Math.max(0, dayIndexOf(today, j.materialReady)) * 24, ...kids.map((c) => c.doneAt));
        st.units[0].done = true;
        st.units[0].doneAt = st.doneAt;
        st.unitsDone = st.units.length;
        changed = true;
      }
    }
  };
  settleNoStepJobs();

  const sorted = [...byId.values()].sort((a, b) => a.job.priority - b.job.priority);
  const newJobs = sorted.filter((s) => s.job.isNew);
  // Stop once the new order is planned (with no new order, once everything is).
  const allNewDone = () => (newJobs.length ? newJobs : sorted).every((s) => s.doneAt != null);

  /**
   * When a need is met for unit ui (or Infinity, not yet): a date's working start;
   * a child as a whole (all, a batch, a bought or gather job); or i × perUnit of
   * the child's units, counting what came from stock first. Also which child unit it was.
   */
  const needMet = (need, ui) => {
    if (need.date !== undefined) return { at: need.date == null ? Infinity : startOfWorkingOnOrAfter(need.date) };
    const c = byId.get(need.job);
    if (!c) return { at: 0 };
    // What came from stock is there from the start; only the rest waits for the child.
    const want = need.perUnit === 'all' ? Infinity : Math.ceil((ui + 1) * Number(need.perUnit || 1) - (Number(need.stock) || 0) - EPS);
    if (want <= 0) return { at: 0 };
    if (need.perUnit === 'all' || c.units.length === 1) return { at: c.doneAt ?? Infinity, unit: c.units.length - 1 };
    if (want > c.units.length) return { at: c.doneAt ?? Infinity, unit: c.units.length - 1 };
    const done = c.units.filter((x) => x.done).sort((a, b) => a.doneAt - b.doneAt);
    if (done.length < want) return { at: Infinity };
    return { at: done[want - 1].doneAt, unit: done[want - 1].i };
  };
  // When every need of the unit's current step is met, and which one came last.
  const needsOf = (st, u) => {
    const step = st.job.steps[u.stepIdx];
    let at = 0, last = null;
    for (const n of step?.needs || []) {
      const m = needMet(n, u.i);
      if (m.at > at) { at = m.at; last = { ...n, childUnit: m.unit }; }
    }
    return { at, last };
  };
  const stepOf = (st, u) => st.job.steps[u.stepIdx];
  const unitReady = (st, u, t) => !u.done && !u.blocked && u.readyAt <= t + EPS && needsOf(st, u).at <= t + EPS;
  // The first time a unit's step becomes active: what it waited for.
  const logStart = (st, u, startAt) => {
    if (u.log[u.stepIdx]) return;
    const n = needsOf(st, u);
    u.log[u.stepIdx] = { prevAt: u.readyAt, needAt: n.at, need: n.last, startAt };
    if (st.startedAt == null || startAt < st.startedAt) st.startedAt = startAt;
  };

  const finishUnit = (st, u, at) => {
    u.done = true;
    u.doneAt = at;
    st.unitsDone += 1;
    if (st.unitsDone >= st.units.length) {
      st.doneAt = Math.max(...st.units.map((x) => x.doneAt));
      settleNoStepJobs();
    }
  };
  const finishUnitStep = (st, u, t) => {
    const step = stepOf(st, u);
    for (const pid of u.crew) busy.delete(pid);
    u.lastCrew = new Set(u.crew);
    u.crew.clear();
    u.stepIdx += 1;
    u.frac = null;
    u.readyAt = step.qc ? afterQc(t, step.qcWaitHours) : t;
    if (u.stepIdx >= st.job.steps.length) finishUnit(st, u, u.readyAt);
  };

  let busy = new Map(); // personId → { st, u } for the current day
  let horizonHit = false;

  for (let di = 0; di <= horizonDays; di++) {
    if (allNewDone()) break;
    const date = dateOf(di);
    if (!cal.isWorking(date)) continue;
    const t0 = di * 24;
    // Each person's hours today.
    const dayEnd = new Map();
    for (const p of people) {
      if ((p.offDates || []).includes(date)) continue;
      const h = (Number(p.hoursPerDay) || 0) * (p.rate == null ? 1 : Number(p.rate));
      if (h > EPS) dayEnd.set(String(p.id), t0 + h);
    }
    busy = new Map();
    let t = t0;

    for (let guard = 0; guard < 5000; guard++) {
      // Job work: send whatever is ready; it comes back N calendar days later.
      for (const st of sorted) {
        for (const u of st.units) {
          while (unitReady(st, u, t) && stepOf(st, u)?.kind === 'jobwork') {
            const step = stepOf(st, u);
            if (step.days == null) { u.blocked = true; break; }
            // Timed from ready to send (decision H): a step that became ready at the end
            // of a day was ready that day, even though the plan picks it up next morning.
            const sendAt = Math.max(u.readyAt, needsOf(st, u).at);
            logStart(st, u, sendAt);
            const back = addDays(dateOf(dayOf(sendAt)), Math.max(0, Math.round(step.days)));
            const backAt = startOfWorkingOnOrAfter(back);
            st.jobwork.push({ unit: u.i, step: step.name, sentAt: sendAt, back, backAt });
            u.stepIdx += 1;
            u.readyAt = step.qc ? afterQc(backAt, step.qcWaitHours) : backAt;
            if (u.stepIdx >= st.job.steps.length) finishUnit(st, u, u.readyAt);
          }
        }
      }

      // Who can take work right now.
      const freeNow = () => people.filter((p) => {
        const k = String(p.id);
        const end = dayEnd.get(k);
        return end != null && end > t + EPS && !busy.has(k);
      });
      const peopleOnJob = (st) => st.units.reduce((n, u) => n + u.crew.size, 0);
      const tryAssign = (st, u, p) => {
        const step = stepOf(st, u);
        if (!step || step.kind !== 'work' || !canDo(p, step, held)) return false;
        if (hoursOf(step, 1) == null) { u.blocked = true; return false; }
        const k = u.crew.size;
        if (k >= Math.max(1, step.maxCrew || step.crew || 1)) return false;
        if (peopleOnJob(st) >= Math.max(1, st.job.cap || 1)) return false;
        // Only when one more person really makes it faster (stage 5's times by number of people).
        if (k >= 1 && !(hoursOf(step, k + 1) < hoursOf(step, k) - EPS)) return false;
        if (u.frac == null) u.frac = 1;
        const id = String(p.id);
        u.crew.add(id);
        busy.set(id, { st, u });
        logStart(st, u, t);
        if (!st.peopleUsed.has(id)) st.peopleUsed.set(id, t);
        return true;
      };
      const readyUnits = (st) => st.units.filter((u) => unitReady(st, u, t) && stepOf(st, u)?.kind === 'work');

      // Pass 0: people already on a unit's step carry on with it.
      for (const st of sorted) for (const u of readyUnits(st)) {
        for (const k of u.lastCrew) {
          const p = personById.get(k);
          if (p && freeNow().includes(p)) tryAssign(st, u, p);
        }
      }
      // Pass 1: people Production planned on a step go onto it (§11 change 6).
      for (const st of sorted) for (const u of readyUnits(st)) {
        for (const k of stepOf(st, u).planned || []) {
          const p = personById.get(String(k));
          if (p && freeNow().includes(p)) tryAssign(st, u, p);
        }
      }
      // Pass 2: people stay with their order (sticky), when it has ready work.
      for (const p of freeNow()) {
        for (const jid of stickyOf.get(String(p.id)) || []) {
          const st = byId.get(jid);
          if (!st || st.doneAt != null) continue;
          let placed = false;
          for (const u of readyUnits(st)) { if (tryAssign(st, u, p)) { placed = true; break; } }
          if (placed) break;
        }
      }
      // Pass 3: everyone else, in priority order.
      for (const st of sorted) {
        for (const u of readyUnits(st)) {
          for (const p of freeNow()) {
            // Someone whose own order has ready work stays with it.
            const own = (stickyOf.get(String(p.id)) || []).map((id) => byId.get(id)).find((s) => s && s.doneAt == null && readyUnits(s).length);
            if (own && own !== st) continue;
            tryAssign(st, u, p);
          }
        }
      }

      // Next event: a step finishing, someone's day ending, a unit or a material becoming ready.
      let next = Infinity;
      const running = [];
      for (const st of sorted) for (const u of st.units) {
        if (u.crew.size) {
          running.push({ st, u });
          next = Math.min(next, t + u.frac * hoursOf(stepOf(st, u), u.crew.size));
        } else if (!u.done && !u.blocked) {
          if (u.readyAt > t + EPS) next = Math.min(next, u.readyAt);
          const n = needsOf(st, u).at;
          if (n > t + EPS && n < Infinity) next = Math.min(next, n);
        }
      }
      for (const [k, end] of dayEnd) if (busy.has(k)) next = Math.min(next, end);
      const latestEnd = Math.max(t0, ...dayEnd.values());
      if (!running.length) {
        // Nothing running: jump to the next ready time inside today, else end the day.
        if (!(next < latestEnd - EPS)) break;
      }
      if (next === Infinity || next > latestEnd + EPS) next = latestEnd;
      const dt = next - t;
      for (const { st, u } of running) u.frac -= dt / hoursOf(stepOf(st, u), u.crew.size);
      t = next;
      for (const { st, u } of running) if (u.frac <= EPS) finishUnitStep(st, u, t);
      // People whose day ended stop working (the step keeps its crew for tomorrow via lastCrew).
      for (const [k, end] of dayEnd) {
        if (end <= t + EPS && busy.has(k)) {
          const { u } = busy.get(k);
          u.crew.delete(k);
          u.lastCrew.add(k);
          busy.delete(k);
        }
      }
      if (t >= latestEnd - EPS) break;
    }
    // End of day: crews go home; they're first in line tomorrow (lastCrew).
    for (const st of sorted) for (const u of st.units) {
      for (const k of u.crew) u.lastCrew.add(k);
      u.crew.clear();
    }
    if (di === horizonDays) horizonHit = !allNewDone();
  }

  return { states: byId, horizonHit: horizonHit || !allNewDone() };
}

const fmtHour = (t) => Math.round((t % 24) * 100) / 100;

/**
 * The estimate for the new order's items. items: [{ key, label, jobId }] — each
 * item's top job (a machine, or a bought item's job). Returns the dates, the
 * buffer, what decided it, who it counted on, and anything unknown.
 */
export function estimate({ today, calendar, people = [], jobs = [], items = [], settings = {}, travelDays = 0, horizonDays = 366, qcDayHours = 8 }) {
  const cal = calendar.isWorking ? calendar : makeCalendar(calendar);
  // Unknowns in the new order mean no date (decision E).
  const unknown = [];
  for (const j of jobs.filter((x) => x.isNew)) {
    if (j.materialReady == null && !(j.steps || []).some((s) => (s.needs || []).length)) unknown.push({ kind: 'material', job: j.label, what: j.materialWhy || 'material' });
    for (const s of j.steps || []) {
      if (s.kind === 'work' && !knownStep(s)) unknown.push({ kind: 'step', job: j.label, what: s.name });
      if (s.kind === 'jobwork' && s.days == null) unknown.push({ kind: 'jobwork', job: j.label, what: s.name });
      for (const n of s.needs || []) if (n.date === null) unknown.push({ kind: 'material', job: j.label, what: n.why || 'material' });
    }
  }
  if (unknown.length) return { canEstimate: false, unknown };

  const { states, horizonHit } = simulate({ today, calendar: cal, people, jobs, horizonDays, qcDayHours });
  if (horizonHit) return { canEstimate: false, beyond: true, unknown: [] };

  const dateOfT = (t) => addDays(today, Math.floor(t / 24 + EPS));
  // Ready to pack: the start of the day it's ready (a part finishing mid-day packs from the next working day).
  const readyDate = (t) => {
    const d = dateOfT(t);
    return fmtHour(t) > EPS ? nextWorkingDay(cal, d, false) : nextWorkingDay(cal, d, true);
  };
  const packAndDispatch = (ready) => {
    const pack = Math.max(0, Number(settings.packingDays) || 0);
    const disp = Math.max(0, Number(settings.dispatchDays) || 0);
    if (pack + disp === 0) return ready;
    return addWorkingDays(cal, ready, pack + disp - 1);
  };

  const perItem = items.map((it) => {
    const st = states.get(it.jobId);
    const ready = readyDate(st.doneAt);
    return { key: it.key, label: it.label, ready, likely: packAndDispatch(ready), decidedBy: explain(st, states, dateOfT) };
  });
  const orderReady = perItem.reduce((m, x) => (x.ready > m ? x.ready : m), today);
  const likely = packAndDispatch(orderReady);
  const wd = workingDaysBetween(cal, today, likely);
  const buffer = bufferDays(wd, settings);
  const commit = addWorkingDays(cal, likely, buffer);
  const deliveredBy = addDays(commit, Math.max(0, Number(travelDays) || 0));

  // Who it counted on: teams (and how many people), never anyone's hours (decision K).
  const teams = new Map();
  const personById = new Map(people.map((p) => [String(p.id), p]));
  for (const st of states.values()) {
    if (!st.job.isNew) continue;
    for (const [pid, at] of st.peopleUsed) {
      const p = personById.get(pid);
      const name = p?.teamName || 'No team';
      const cur = teams.get(name) || { team: name, people: new Set(), from: dateOfT(at) };
      cur.people.add(pid);
      if (dateOfT(at) < cur.from) cur.from = dateOfT(at);
      teams.set(name, cur);
    }
  }
  const countedOn = [...teams.values()].map((x) => ({ team: x.team, people: x.people.size, from: x.from })).sort((a, b) => a.from.localeCompare(b.from));
  const fasterWith = jobs.filter((j) => j.isNew && (j.capMost || 0) > (j.cap || 1)).map((j) => ({ part: j.label, usual: j.cap, most: j.capMost }));

  return {
    canEstimate: true, items: perItem, ready: orderReady, likely, workingDays: wd, buffer, commit, travelDays: Math.max(0, Number(travelDays) || 0), deliveredBy,
    countedOn, fasterWith,
  };
}

// What decided a job's date, bottom-up, along the unit that finished last: what
// each step waited for (a material, a part from a child — followed down — or
// people) and the job work trips.
function explain(st, states, dateOfT) {
  const out = [];
  const seen = new Set();
  const walk = (s, unitIdx, depth) => {
    if (!s || depth > 8) return;
    const key = `${s.job.id}|${unitIdx}`;
    if (seen.has(key)) return;
    seen.add(key);
    const j = s.job;
    if (!j.isNew) {
      // Work in hand the new order counts on: a for-stock order (decision T).
      out.push({ kind: 'stockOrder', part: j.label, date: s.doneAt != null ? dateOfT(s.doneAt) : null });
      return;
    }
    if (!j.steps.length) {
      const kids = (j.children || []).map((id) => states.get(id)).filter(Boolean);
      if (kids.length) {
        // A gather job: whichever part of it was ready last.
        const last = kids.reduce((m, c) => (m == null || (c.doneAt ?? -1) > (m.doneAt ?? -1) ? c : m), null);
        walk(last, lastUnit(last), depth + 1);
        return;
      }
      out.push({ kind: 'material', part: j.label, date: j.materialReady, why: j.materialWhy || '' });
      return;
    }
    const u = s.units[unitIdx] || s.units[s.units.length - 1];
    j.steps.forEach((step, si) => {
      const log = u.log[si];
      if (!log) return;
      const waitedFor = log.needAt > log.prevAt + EPS && log.need;
      if (waitedFor) {
        if (log.need.date !== undefined) out.push({ kind: 'material', part: j.label, step: step.name, date: log.need.date, why: log.need.why || '' });
        else {
          const c = states.get(log.need.job);
          if (c && c.job.isNew && c.job.steps.length && c.units.length > 1 && log.need.perUnit !== 'all') {
            out.push({ kind: 'part', part: j.label, unit: u.i + 1, step: step.name, child: c.job.label, childUnit: (log.need.childUnit ?? 0) + 1, readyOn: dateOfT(log.needAt) });
          }
          walk(c, log.need.childUnit ?? lastUnit(c), depth + 1);
        }
      }
      const readyFrom = Math.max(log.prevAt, log.needAt, 0);
      if (step.kind === 'work' && log.startAt > readyFrom + EPS) {
        // I4 (deep test, 19 Nov): a wait inside the same day says how many hours it was.
        const sameDay = dateOfT(readyFrom) === dateOfT(log.startAt);
        out.push({ kind: 'people', part: j.label, step: step.name, readyFrom: dateOfT(readyFrom), startedOn: dateOfT(log.startAt), ...(sameDay ? { waitHours: Math.round((log.startAt - readyFrom) * 10) / 10 } : {}) });
      }
    });
    for (const w of s.jobwork.filter((x) => x.unit === u.i)) out.push({ kind: 'jobwork', part: j.label, step: w.step, sentOn: dateOfT(w.sentAt), back: w.back, usableFrom: dateOfT(w.backAt) });
  };
  const lastUnit = (s) => (s ? s.units.reduce((m, x) => (x.doneAt != null && (m == null || x.doneAt > s.units[m].doneAt) ? x.i : m), null) ?? s.units.length - 1 : 0);
  walk(st, lastUnit(st), 0);
  return out;
}
