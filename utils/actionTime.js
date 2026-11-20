// Feature 7 (2026-11-12): the real time of a Start, Complete, Add or Take off —
// "now", or an earlier time Production types because they clicked late.
// docs/client-features-2026-11/07-step-times-logic.md
import { TeamError } from '../services/productionTeamService.js';

const SKEW_MS = 2 * 60 * 1000;   // a clock a little ahead still counts as now
const BACKDATE_MS = 60 * 1000;   // more than a minute before the click = back-dated

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * value: an ISO time, or empty for now. notBefore: the earliest allowed time,
 * notBeforeWhy: what that time is ("the step started"). Returns { at, backdated }.
 */
export function actionTime(value, { notBefore = null, notBeforeWhy = '', now = new Date(), what = 'The time' } = {}) {
  if (value == null || value === '') return { at: now, backdated: false };
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new TeamError(400, `${what} isn't a valid date and time.`);
  if (at.getTime() > now.getTime() + SKEW_MS) throw new TeamError(400, `${what} can't be in the future.`);
  if (at.getTime() > now.getTime()) return { at: now, backdated: false };
  if (notBefore && at.getTime() < new Date(notBefore).getTime()) {
    throw new TeamError(400, `${what} can't be before ${notBeforeWhy} (${fmt(notBefore)}).`);
  }
  return { at, backdated: now.getTime() - at.getTime() > BACKDATE_MS };
}

export const fmtIndia = fmt;
