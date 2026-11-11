// Pieces written off at an outsource vendor ("not coming", 2026-10-26 —
// docs/outsource-v2/partial-returns-2026-10.md). A Sub Child Part order's
// orderQuantity stays what was ordered; every "how many pieces are really in
// this batch" place subtracts these. Pure — works on documents or lean objects.

const entries = (order) => order?.lostAtVendor || [];

// All pieces lost on this order (a job-work order: every trip).
export function lostTotal(order) {
  return entries(order).reduce((s, l) => s + (Number(l.qty) || 0), 0);
}

// A production order's pieces lost on steps after `afterIdx` up to and
// including `uptoIdx` — not the ones lost on a rework resend (those were
// already taken off that QC step's batch as scrap).
export function lostBetween(order, afterIdx, uptoIdx) {
  return entries(order)
    .filter(l => !l.onRework && l.stepIndex != null && l.stepIndex > afterIdx && l.stepIndex <= uptoIdx)
    .reduce((s, l) => s + (Number(l.qty) || 0), 0);
}

// Pieces lost on one hand-off (its rework resend quantity is smaller by these).
export function lostOnHandoff(order, handoffId) {
  return entries(order)
    .filter(l => l.handoffId && String(l.handoffId) === String(handoffId))
    .reduce((s, l) => s + (Number(l.qty) || 0), 0);
}
