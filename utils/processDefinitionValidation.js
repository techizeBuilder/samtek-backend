// Shared clean/validate pair for the Category -> Internal Process
// "processDefinition" field (see ProcessDefinitionSchema.js), used by all
// three BOM-level controllers (subChildPartMasterController.js,
// childPartBOMController.js, machineBOMController.js) so the same rules
// apply everywhere instead of drifting between them.

const VALID_MATERIAL_SOURCES = ['ExplicitMaterials', 'AssembledPart'];

// Trims labels/names, drops empty categories/processes, coerces
// materialRefs to a plain array of id strings, and enforces the one
// materialSource business rule that isn't just "whatever the client sent":
// the very first internal process overall (first category, first process)
// has nothing built before it to hand off, so it's always
// 'ExplicitMaterials' regardless of what was posted — the UI already hides
// the choice for it, this is the server-side backstop (e.g. against a stale
// payload after reordering moved a different step into the first slot).
// materialRefs is no longer cleared when materialSource is 'AssembledPart'
// (corrected 2026-09-23 — see ProcessDefinitionSchema.js's own comment on
// why the two aren't mutually exclusive anymore: a step can ship the
// assembled part AND pick additional materials on top of it).
// materialQuantities is coerced the same defensive way — kept only for a
// ref that's also present in materialRefs, with a real positive number.
// Does NOT validate — call validateProcessDefinition on the result before saving.
export function cleanProcessDefinition(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .map(cat => ({
      label: String(cat?.label ?? '').trim(),
      internalProcesses: Array.isArray(cat?.internalProcesses)
        ? cat.internalProcesses
          .map(p => {
            const materialSource = VALID_MATERIAL_SOURCES.includes(p?.materialSource) ? p.materialSource : 'ExplicitMaterials';
            const materialRefs = Array.isArray(p?.materialRefs) ? p.materialRefs.map(String).filter(Boolean) : [];
            const refSet = new Set(materialRefs);
            const materialQuantities = Array.isArray(p?.materialQuantities)
              ? p.materialQuantities
                .map(q => ({ ref: String(q?.ref ?? ''), qty: Number(q?.qty) }))
                .filter(q => q.ref && refSet.has(q.ref) && Number.isFinite(q.qty) && q.qty > 0)
              : [];
            return {
              name: String(p?.name ?? '').trim(),
              type: p?.type,
              materialSource,
              materialRefs,
              materialQuantities,
              qcRequired: p?.qcRequired === true,
            };
          })
          .filter(p => p.name)
        : [],
    }))
    .filter(cat => cat.label && cat.internalProcesses.length > 0);

  const firstProcess = cleaned[0]?.internalProcesses?.[0];
  if (firstProcess) firstProcess.materialSource = 'ExplicitMaterials';

  return cleaned;
}

const VALID_TYPES = ['InHouse', 'OutSource'];

// Returns an error message string, or null if valid.
// - requireAtLeastOne: at least one category with at least one internal
//   process is required (parity with the old hard-required jobWorkTypes).
// - materialLineIds / assemblyLineIds: when provided (Child Part / Machine
//   only — Sub Child Part has no lines of its own to reference), every
//   materialRefs id on ANY internal process (generalized 2026-09-23 — this
//   used to only check OutSource-typed steps) must be one of these two sets
//   — materialLineIds for the flat materials[]/tools lines, assemblyLineIds
//   for the assembly-reference lines (subChildParts[] for Child Part,
//   childParts[] for Machine). Passed separately (not pre-unioned by the
//   caller) because assemblyLineIds also drives the consumption-pool check
//   below, which materialLineIds has no part in.
// - materialLineQuantities: {id: bomQuantity} for this BOM's own
//   materials[]/tools lines (assembly-reference lines don't use this — see
//   the consumption-pool check instead, which is an all-or-nothing "total
//   qty" rule, not a split). Only checked for a line actually referenced by
//   more than one step; a single-step reference is untouched, exactly like
//   today's zero-extra-input behavior.
// - requireExactlyOneQcStep: Child Part / Machine only (never Sub Child
//   Part — its QC point is always implicitly the last step, not a per-BOM
//   choice). Confirmed with the user 2026-09-22: exactly one internal
//   process must carry qcRequired:true once the process definition is
//   non-empty — multiple would each need their own distinct checklist,
//   which today's QC Parameters setup (one checklist per level) doesn't
//   support. Skipped entirely when there are zero internal processes at
//   all, matching this field's existing optional-for-now behavior at these
//   two levels.
export function validateProcessDefinition(processDefinition, {
  requireAtLeastOne = false,
  materialLineIds = null,
  assemblyLineIds = null,
  materialLineQuantities = null,
  requireExactlyOneQcStep = false,
} = {}) {
  const categories = Array.isArray(processDefinition) ? processDefinition : [];
  const allProcesses = categories.flatMap(cat => (Array.isArray(cat?.internalProcesses) ? cat.internalProcesses : []));

  if (requireAtLeastOne) {
    if (allProcesses.length === 0) return 'Define at least one process category with at least one internal process.';
  }

  if (requireExactlyOneQcStep && allProcesses.length > 0) {
    const qcCount = allProcesses.filter(p => p?.qcRequired).length;
    if (qcCount === 0) return 'Flag exactly one internal process as the QC checkpoint.';
    if (qcCount > 1) return 'Only one internal process can be the QC checkpoint — unflag the others first.';
  }

  const materialIdSet = materialLineIds ? new Set(materialLineIds.map(String)) : null;
  const assemblyIdSet = assemblyLineIds ? new Set(assemblyLineIds.map(String)) : null;
  const anyLineIdSet = (materialIdSet || assemblyIdSet)
    ? new Set([...(materialIdSet || []), ...(assemblyIdSet || [])])
    : null;

  for (const cat of categories) {
    if (!cat?.label) return 'Every process category needs a label.';
    for (const proc of (cat.internalProcesses || [])) {
      if (!proc?.name) return `Every internal process under "${cat.label}" needs a name.`;
      if (!VALID_TYPES.includes(proc.type)) return `"${proc.name}" must be typed In-House or Out Source.`;
      if (anyLineIdSet && Array.isArray(proc.materialRefs)) {
        for (const refId of proc.materialRefs) {
          if (!anyLineIdSet.has(String(refId))) return `"${proc.name}" references a material or sub-assembly that isn't on this BOM.`;
        }
      }
    }
  }

  // Assembly-reference pool (2026-09-23) — each sub-assembly line consumed
  // by exactly one step across the WHOLE definition, position-independent
  // (not "once AssembledPart appears nothing later can pick materials" —
  // that would wrongly block two categories independently building separate
  // things that only merge at a later one; see the discussion doc). A
  // reference claimed by two different steps is always a mistake (a
  // sub-assembly is a physical thing, consumed once); one never claimed
  // anywhere means the BOM lists a component the process never actually
  // uses. Skipped when assemblyLineIds isn't provided.
  if (assemblyIdSet && assemblyIdSet.size > 0) {
    const consumedBy = new Map(); // assembly id -> internal process name that claimed it
    for (const proc of allProcesses) {
      for (const refId of (proc.materialRefs || [])) {
        const key = String(refId);
        if (!assemblyIdSet.has(key)) continue;
        if (consumedBy.has(key)) {
          return `"${proc.name}" and "${consumedBy.get(key)}" both claim the same assembled part — a sub-assembly can only be consumed by one step.`;
        }
        consumedBy.set(key, proc.name);
      }
    }
    const unconsumedCount = [...assemblyIdSet].filter(id => !consumedBy.has(id)).length;
    if (unconsumedCount > 0) {
      return `Every sub-assembly on this BOM must be consumed by exactly one step — ${unconsumedCount} isn't picked anywhere yet.`;
    }
  }

  // Material/tool quantity cap (2026-09-23) — worked example: a BOM line of
  // 4 nut-bolts, 2 consumed at one step and 2 at a later one. Only checked
  // once a line is actually referenced by more than one step; every step
  // referencing it must then carry its own materialQuantities entry, and
  // the sum can never exceed the line's own BOM quantity.
  if (materialLineQuantities) {
    const stepsByLine = new Map(); // material id -> [{procName, qty}]
    for (const proc of allProcesses) {
      for (const refId of (proc.materialRefs || [])) {
        const key = String(refId);
        if (assemblyIdSet && assemblyIdSet.has(key)) continue; // assembly refs use the pool rule above, not this one
        if (!stepsByLine.has(key)) stepsByLine.set(key, []);
        const qEntry = (proc.materialQuantities || []).find(q => String(q.ref) === key);
        stepsByLine.get(key).push({ procName: proc.name, qty: qEntry ? Number(qEntry.qty) : null });
      }
    }
    for (const [id, steps] of stepsByLine) {
      if (steps.length <= 1) continue; // referenced by only one step — implicit full quantity, no check needed
      const missing = steps.find(s => !(s.qty > 0));
      if (missing) return `"${missing.procName}" needs a quantity for a material it shares with another step.`;
      const total = steps.reduce((sum, s) => sum + s.qty, 0);
      const bomQty = materialLineQuantities[id];
      if (bomQty != null && total > bomQty) {
        return `The material split across ${steps.length} steps adds up to ${total}, more than this BOM's own quantity of ${bomQty}.`;
      }
    }
  }

  return null;
}
