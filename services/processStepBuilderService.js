// Turns a BOM's Process Definition (Category -> Internal Process, see
// server/models/ProcessDefinitionSchema.js) into the flat, ordered shape
// Production execution actually runs on — replacing the old hardcoded
// PROCESS_STEPS/SUB_CHILD_PART_STEPS/MACHINE_BOM_STEPS arrays
// (server/models/ProductionOrder.js) at every one of the three cascade
// creation points (subChildPartOrderService.js, childPartReorderService.js,
// machineReorderService.js/storeFlowService.js — see
// server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md,
// Phase 2 plan). Pure functions only — no DB access, no side effects.

// One category's internal processes, in order, tagged with which category
// they came from — categories are already gated (all of one category's
// internal processes complete before the next category starts, per Phase
// 1's design), so flattening by category-order-then-internal-order IS the
// real execution order, nothing else to compute.
export function flattenProcessDefinition(processDefinition) {
  const categories = Array.isArray(processDefinition) ? processDefinition : [];
  const flat = [];
  for (const cat of categories) {
    for (const proc of (cat.internalProcesses || [])) {
      flat.push({
        category: cat.label,
        name: proc.name,
        type: proc.type, // 'InHouse' | 'OutSource'
        materialSource: proc.materialSource || 'ExplicitMaterials',
        materialRefs: proc.materialRefs || [],
        materialQuantities: proc.materialQuantities || [],
        qcRequired: !!proc.qcRequired,
      });
    }
  }
  return flat;
}

// Whole-order classification — decides which document/flow an order gets
// at creation time (see subChildPartOrderService.js's createSubChildPartOrderForItem):
// 'PureOutSource' -> SubChildPartJobWorkOrder (Sub Child Part only, unchanged
// flow); 'PureInHouse' | 'Hybrid' -> a ProductionOrder with a real processes[]
// pipeline built by buildOrderStepsFromProcessDefinition below.
export function classifyProcessDefinition(flatSteps) {
  if (!flatSteps.length) return 'PureInHouse'; // no steps defined yet — treat as in-house, matches today's default (jobWork:false) behavior
  const hasOut = flatSteps.some(s => s.type === 'OutSource');
  const hasIn = flatSteps.some(s => s.type === 'InHouse');
  if (hasOut && hasIn) return 'Hybrid';
  return hasOut ? 'PureOutSource' : 'PureInHouse';
}

// Groups consecutive same-type runs — only Out Source runs are meaningful
// today (In-House steps don't need hand-off bundling), but this groups both
// so a caller can filter. Each group is a slice of `flatSteps` (with its own
// start index into that array, for stepIndices bookkeeping on
// ProductionOrder.outsourceHandoffs[] — see Stage 3). A lone Out Source step
// with In-House steps on both sides is its own group of length 1, same as a
// real multi-step run — no special-casing needed by callers.
export function groupConsecutiveOutSourceRuns(flatSteps) {
  const runs = [];
  let current = null;
  flatSteps.forEach((step, index) => {
    if (step.type === 'OutSource') {
      if (!current) {
        current = { startIndex: index, steps: [step] };
        runs.push(current);
      } else {
        current.steps.push(step);
      }
    } else {
      current = null;
    }
  });
  return runs;
}

// Maps ProcessStepSchema's own type enum ('Outsourcing'/'In-House') from
// Process Definition's ('OutSource'/'InHouse') — same two-value mapping
// PROCESS_TYPE_MAP used to hardcode per step NAME, now just a straight type
// translation since the type itself already comes from the BOM.
const STEP_TYPE_MAP = { InHouse: 'In-House', OutSource: 'Outsourcing' };

// Builds a fresh processes[] array (ProcessStepSchema-shaped, see
// ProductionOrder.js) from a BOM's Process Definition — the direct
// replacement for buildProcessSteps(orderKind)/buildStepsFromList at every
// cascade creation point. Every field the old hardcoded builder always set
// (status/assignedTeam/dates/qc*/notes/reworks/subEntries) stays identical;
// only the new Phase-2 fields (category/materialSource/materialRefs/
// qcRequired/outsourceStatus) are new here.
export function buildOrderStepsFromProcessDefinition(processDefinition) {
  const flat = flattenProcessDefinition(processDefinition);
  return flat.map(step => ({
    step: step.name,
    type: STEP_TYPE_MAP[step.type] || 'In-House',
    category: step.category,
    materialSource: step.materialSource,
    materialRefs: step.materialRefs,
    materialQuantities: step.materialQuantities,
    qcRequired: step.qcRequired,
    outsourceStatus: step.type === 'OutSource' ? 'NotStarted' : 'NotStarted',
    status: 'Pending',
    assignedTeam: null,
    startDate: null,
    endDate: null,
    startedAt: null,
    completedAt: null,
    qcStatus: 'Pending',
    qcBy: null,
    qcDate: null,
    notes: '',
    reworks: [],
    subEntries: [],
  }));
}

// Fresh copy of an EXISTING unit's real process steps, for a NEW unit
// (Units 2..N of a multi-quantity order) — reads directly off Unit 1's own
// processes[] (already-built ProcessStepSchema-shaped objects, whatever
// their origin), not the Process Definition. Mirrors ProcessExecution.jsx's
// own client-side buildFreshUnitProcesses() (built 2026-09-23 to fix
// category/type getting lost on Unit 2+ for DISPLAY) — this is the same fix
// on the server side (2026-09-24), needed because a unit whose first
// reachable step is Outsourcing never calls assignTeam/startProcess (the
// only two places productionMfgController.js's own lazy materialization
// used to fire from) — Production's UI never even shows those actions for
// an Outsourcing step, so that unit could never get touched at all.
// Copies category/type/materialSource/materialRefs/materialQuantities/
// qcRequired wholesale; resets only the per-unit progress fields.
export function buildFreshUnitProcesses(sourceProcesses) {
  return (sourceProcesses || []).map(p => ({
    step: p.step,
    type: p.type,
    category: p.category,
    materialSource: p.materialSource,
    materialRefs: p.materialRefs,
    materialQuantities: p.materialQuantities,
    qcRequired: p.qcRequired,
    outsourceStatus: 'NotStarted',
    status: 'Pending',
    assignedTeam: null,
    startDate: null,
    endDate: null,
    startedAt: null,
    completedAt: null,
    qcStatus: 'Pending',
    qcBy: null,
    qcDate: null,
    notes: '',
    reworks: [],
    subEntries: [],
  }));
}
