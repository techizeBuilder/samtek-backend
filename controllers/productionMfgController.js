import ProductionOrder, { PROCESS_STEPS, PROCESS_TYPE_MAP, buildStepsFromList, stepsForKind } from '../models/ProductionOrder.js';
import ProductionTeam from '../models/ProductionTeam.js';
import Sale from '../models/Sale.js';
import QCJob from '../models/QCJob.js';
import notificationService from '../services/notificationService.js';
import RDRequest from '../models/RDRequest.js'
import RDBOM from '../models/RDBOM.js';
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js'; // Adjust path
import MaterialIssueLog from '../models/MaterialIssueLog.js';
import { recalculateItemPricing } from '../services/itemPricingService.js';
import { resolveFabricationWeight, dimensionSignature, buildFabricationBomDimensions } from '../services/fabricationDemandService.js';
import { toMm } from '../utils/unitConversion.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import { buildMachineDesignFiles } from './rdController.js';
import { buildFreshUnitProcesses } from '../services/processStepBuilderService.js';
import { findSubChildPartMaterialLines, buildSubChildPartMaterialList, requestSubChildPartMaterial, getSubChildPartJobWorkRows, getSubChildPartUnissuedJobWorkMaterials } from '../services/childPartReorderService.js';
import { findMachineMaterialLines, buildMachineMaterialList, requestMachineMaterial, resolveMachineOrderProcesses } from '../services/machineReorderService.js';
import { recalculateChildPartCost } from './childPartBOMController.js';
import MachineBOM from '../models/MachineBOM.js';
import { syncMachineBOMPricing } from './machineBOMController.js';

import PDFDocument from 'pdfkit';


import MaterialReturnLog from '../models/MaterialReturnLog.js';
import SheetMetalPlan from '../models/SheetMetalPlan.js';
import { sheetMetalGroupsFromBOM } from './sheetMetalPlanController.js';
import { plainMaterialGroupsFromBOM, lengthFabricationGroupsFromBOM } from '../services/bomMaterialGroupsService.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import RFQ from '../models/RFQ.js';
import Purchase from '../models/Purchase.js';
import RDChildPart from '../models/RDChildPart.js';
import { ensurePartChecksStructure, resolvePartChecklistRows, resolveChildPartUnitChecklistRows, ensureFlatChecklist, resolveFlatChecklistRows, attachPartReference, MANUFACTURING_SOURCE_TYPES } from '../services/qcChecklistPullService.js';

// Department-Head-only gate for Issue Material + Receive — mirrors
// productionExpenseController.js's own HEAD_ROLES/canManage pattern exactly,
// layered on top of the route-level checkPermission('production','orders',...)
// gate (unchanged) rather than replacing it, since other actions on the same
// page (Add Demand, Adjust Qty, Return, View) stay open to regular
// Production Employees.
const HEAD_ROLES = ['Production Head', 'Superadmin', 'Super Admin'];

// A non-fabrication material whose Used Unit is Length/Area/Volume needs an
// amountValue too (see addMaterialDemand below) — mirrors rdController.js's
// identically-named helper for BOM materials. purchaseCost is ₹ per Used
// Unit, and a flat quantity alone can't say "2 pieces of 1m length each" the
// way it can say "5 kg" or "3 pieces" for Mass/Count materials.
const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const itemNeedsAmount = (sourceItem) => !sourceItem.fabricationRef && AMOUNT_UNIT_TYPES.includes(sourceItem.unitType);




const today = () => new Date().toISOString().split('T')[0];

// ─── ORDER ID GENERATOR ───────────────────────────────────────────────────────
export async function generateOrderId(companyId) {
  const year = new Date().getFullYear();
  const count = await ProductionOrder.countDocuments({ company: companyId });
  return `ORD-${year}-${String(count + 1).padStart(3, '0')}`;
}

// Auto-creates (or reuses) the ONE central QC job for a Production Order's
// output — same dedup rule regardless of who calls it or when, so there is
// only ever one job per order no matter which caller reaches it first:
// approveQC (once the last process step is self-approved — unchanged for a
// non-manufactured product) and, identically, once a Repair job is marked
// complete, OR (new, 2026-09-01) Production opening its Parts QC panel for
// an in-house/outsource-manufactured order — which now creates this SAME
// job much earlier and starts seeding partChecks[] into it, instead of it
// only ever coming into existence at the very end. Client's own reasoning:
// one record per machine, so its full QC history is in one place, not
// scattered across several jobs (see QCJob.js's own comment).
function qcJobSourceForOrder(order) {
  // orderKind:'SubChildPart' orders are also created with source:'Stock' (see
  // subChildPartOrderService.js) — same as a Machine built for the
  // company's own stock — so without this branch they'd collide with that
  // existing, differently-shaped 'Stock' QCJob flow. A dedicated source
  // keeps them cleanly distinguishable (mirrors why the Purchase/Out-Source
  // route got its own 'SubChildPartJobWork' source instead of reusing an
  // existing one).
  if (order.orderKind === 'SubChildPart') return 'SubChildPartProduction';
  // Same collision-avoidance reasoning as the SubChildPart branch above — a
  // Child Part order is also created with source:'Stock' (see
  // childPartReorderService.js), and its QC is a genuinely different shape
  // (one job, but per-UNIT nested review — see QCJob.js's UnitQCEntrySchema)
  // from either 'Stock' or the generic Production/partChecks flow.
  if (order.orderKind === 'ChildPart') return 'ChildPartProduction';
  return order.source === 'QC_Rejected' ? 'QC_Rejected' : (order.source === 'Stock' ? 'Stock' : 'Production');
}

export async function ensureQCJobForOrder(order, sentBy, userId) {
  const existingQC = await QCJob.findOne({
    source: qcJobSourceForOrder(order),
    sourceRefId: order.orderId,
    company: order.company
  });
  if (existingQC) {
    // No-op for a non-manufactured product (ensurePartChecksStructure itself
    // returns false — wrong productKind/productSourceType) — cheap enough
    // to just always try rather than duplicate that gate here. Same for
    // ensureUnitChecksStructure (Child Part only, mutually exclusive with
    // the above — a job is never both sources at once).
    if (await ensurePartChecksStructure(existingQC, order.company)) await existingQC.save();
    if (ensureUnitChecksStructure(existingQC, order)) await existingQC.save();
    return existingQC;
  }

  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
  }
  const qcJobId = `QC-${year}-${String(nextNumber).padStart(4, '0')}`;

  let qcCategory = 'Finished Good';
  try {
    const inventoryItem = await Item.findOne({
      $or: [{ code: order.machineCode }, { name: order.machineName }],
      companyId: order.company
    });
    if (inventoryItem && inventoryItem.category) qcCategory = inventoryItem.category;
  } catch (itemErr) {
    console.error('Error looking up inventory item for category:', itemErr);
  }

  const qcJob = await QCJob.create({
    qcJobId,
    source: qcJobSourceForOrder(order),
    sourceRefId: order.orderId,
    sourceDepartment: 'Production',
    sentBy: sentBy || 'Production Dept',
    itemName: order.machineName,
    itemCode: order.machineCode,
    category: qcCategory,
    quantity: order.orderQuantity || 1,
    unit: 'pcs',
    receivedDate: today(),
    status: order.orderKind === 'SubChildPart' ? 'Draft' : 'Pending',
    saleId: order.saleId,
    saleItemId: order.saleItemId || null,
    orderCode: order.orderCode || '',
    company: order.company,
    createdBy: userId,
    // Repair jobs carry forward what was actually fixed/replaced, so QC can see
    // it while re-inspecting instead of just a generic auto-created message.
    notes: (order.reworkDecision === 'Repair' && order.repair?.notes)
      ? `Repaired: ${order.repair.notes}`
      : `Automatically created from completed Production Order: ${order.orderId}`
  });
  console.log(`✅ QC Job ${qcJobId} automatically created for Production Order ${order.orderId}`);

  try {
    await notificationService.triggerQCNotification({
      action: 'qc_job_created',
      data: { qcJobId, itemName: order.machineName, jobId: qcJob._id },
      targetCompanyId: order.company,
    });
  } catch (e) { console.error('QC job notification error:', e); }

  if (await ensurePartChecksStructure(qcJob, order.company)) await qcJob.save();
  if (ensureUnitChecksStructure(qcJob, order)) await qcJob.save();

  return qcJob;
}

// A Machine order built from a dynamic Process Definition (a step flagged
// qcRequired) — its QC runs per unit, the Child Part model (agreed
// 2026-09-24, see the Phase 2 discussion doc's "Machine QC checkpoint —
// per-unit redesign"): one unitChecks[] entry per unit, each submitted and
// decided on its own. A legacy Machine order (old 'Final Testing' step, no
// flag anywhere) keeps the flat shared-checklist flow unchanged.
export function isPerUnitMachineOrder(order) {
  return order?.orderKind === 'Machine' && (order.processes || []).some(p => p.qcRequired);
}

// Structural seed only (no checklist rows yet) for a Child Part order's
// unitChecks[] — one entry per unit (job.quantity, snapshotted from
// order.orderQuantity at creation above). Confirmed with the user as the
// deliberate "one QCJob, nested per-unit" shape to mirror from
// PartQCEntrySchema/ensurePartChecksStructure, just keyed by unit instead of
// by Sub Child Part — each unit reaches/leaves QC entirely independently of
// its siblings. Row-level Initial/Process definitions are resolved
// separately, lazily, the first time Production actually opens ONE unit's
// checklist (see getChildPartUnitChecklistRows) — no reason to resolve every
// unit's rows just because the job was opened once. Same skeleton for a
// per-unit Machine order's job (2026-09-24, isPerUnitMachineOrder) — its
// single-stage rows are resolved the same lazy way, in getQcCheckpoint.
function ensureUnitChecksStructure(job, order) {
  if (job.source !== 'ChildPartProduction' && !isPerUnitMachineOrder(order)) return false;
  if (job.unitChecks?.length > 0) return false;
  const buildQty = Math.max(1, Number(job.quantity) || 1);
  job.unitChecks = Array.from({ length: buildQty }, (_, i) => ({ unitNumber: i + 1 }));
  return true;
}

// ─── Sub Child Part QC (in-house/outsource manufactured products only) ─────
// Production self-performs Initial then Process on each Sub Child Part —
// only once Process is saved (with Initial already done) does the part
// automatically arrive in QC's queue, no separate "send to QC" action (see
// QCJob.js's PartQCEntrySchema comment, confirmed 2026-09-01). Everything
// here operates on the ONE QCJob this order shares with its Final Check —
// created here, early, the first time Production opens this panel, instead
// of only once every stage self-approves.

// GET /orders/:id/parts-qc — ensures the shared QCJob exists (+ its
// partChecks structurally seeded from the real BOM) and returns just that
// list, for Production's own panel. Empty array for a Purchase/Job-Work
// product — nothing to show there, Fabrication stays a whole-order stage.
export const getPartsQC = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    await qcJob.populate('partChecks.assignedTeam', 'name supervisor members');
    // designFile/materials per part — the real BOM spec Production is being
    // asked to verify "Design"/"Material"/"Size (Amount)/Qty" against
    // (confirmed 2026-09-02, was missing entirely before).
    const machineItem = await Item.findOne({ code: order.machineCode, companyId: req.user.companyId }).select('_id').lean();
    const partChecks = machineItem ? await attachPartReference(qcJob.partChecks, machineItem._id, req.user.companyId) : qcJob.partChecks;
    res.json({ success: true, data: { qcJobId: qcJob.qcJobId, partChecks } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /orders/:id/parts-qc/:partCheckId/assign-team — "allot work" on this
// one Sub Child Part. Blocked until every BOM material line THIS part
// itself needs has actually been received in Production (confirmed
// 2026-09-01) — narrower than Job Work's whole-order version of the same
// gate (assignTeam above), since a part only ever needs its own lines, not
// everything the rest of the BOM happens to need too. Clearing the team
// (teamId falsy) is always allowed.
export const assignPartTeam = async (req, res) => {
  try {
    const { teamId } = req.body;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: req.user.companyId });
    const part = qcJob?.partChecks?.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found — open the Parts QC panel first.' });

    if (teamId) {
      const unissued = await getPartUnissuedMaterials(order, req.user.companyId, part.childPartName, part.subChildPartName);
      if (unissued.length > 0) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production, can't allot work on this part: ${unissued.join(', ')}.` });
      }
    }

    part.assignedTeam = teamId || null;
    await qcJob.save();
    await qcJob.populate('partChecks.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: qcJob.partChecks.id(part._id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /orders/:id/parts-qc/:partCheckId/start — can't start without a team
// allotted first (confirmed 2026-09-01); the Initial/Process checklists
// themselves also refuse to save until this is set — see savePartChecklist.
export const startPart = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: req.user.companyId });
    const part = qcJob?.partChecks?.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found — open the Parts QC panel first.' });
    if (!part.assignedTeam) {
      return res.status(400).json({ success: false, message: 'Assign a team to this part before starting it.' });
    }
    if (!['Awaiting Production', 'Rejected'].includes(part.status)) {
      return res.status(400).json({ success: false, message: `This part is currently ${part.status} — it can't be (re)started right now.` });
    }

    part.startedAt = new Date();
    await qcJob.save();
    res.json({ success: true, data: part });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:id/parts-qc/:partCheckId/:stage(initial|process) — the row
// definitions for this part+stage (always freshly resolved from R&D's
// current selection, never cached — a master-checklist edit mid-build
// should show up immediately) merged with whatever Production already saved
// here, if this is a reopen rather than a first visit.
export const getPartChecklistRows = async (req, res) => {
  try {
    const { stage } = req.params;
    if (!['initial', 'process'].includes(stage)) return res.status(400).json({ success: false, message: 'stage must be initial or process' });

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const machineItem = await Item.findOne({ code: order.machineCode, companyId: req.user.companyId }).lean();
    if (!machineItem) return res.status(404).json({ success: false, message: 'Machine item not found' });

    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: req.user.companyId }).lean();
    const part = qcJob?.partChecks?.find(p => String(p._id) === req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found — open the Parts QC panel first.' });

    // Sequential within one part (confirmed 2026-09-01): Process can't even
    // be opened for entry until Initial has been saved at least once.
    if (stage === 'process' && part.initial.length === 0) {
      return res.status(400).json({ success: false, message: 'Complete the Initial checklist for this part before Process.' });
    }

    const rows = await resolvePartChecklistRows(machineItem._id, part.childPartId, part.subChildPartId, stage, req.user.companyId);
    const saved = part[stage] || [];
    const savedByParam = new Map(saved.map(r => [r.parameter, r]));
    // .lean() above means a saved row created before qcStatus/qcRemarks/type
    // existed on the schema comes back with those keys genuinely missing (no
    // Mongoose defaults applied) — normalize here so an old, never-reviewed
    // row reads as 'Pending', not `undefined` (which the frontend would
    // otherwise mistake for a real QC verdict).
    const merged = rows.map(r => {
      const found = savedByParam.get(r.parameter);
      return found ? { type: 'checkbox', qcStatus: 'Pending', qcRemarks: '', ...found } : r;
    });

    res.json({ success: true, data: { rows: merged, partStatus: part.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /orders/:id/parts-qc/:partCheckId/:stage(initial|process) — Production
// saves its own tick/value results. Saving 'process' is the automatic
// hand-off to QC — see this function's own gate below.
export const savePartChecklist = async (req, res) => {
  try {
    const { stage } = req.params;
    if (!['initial', 'process'].includes(stage)) return res.status(400).json({ success: false, message: 'stage must be initial or process' });
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
    if (results.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before saving.' });
    }

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: req.user.companyId });
    const part = qcJob?.partChecks?.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found — open the Parts QC panel first.' });

    if (!part.startedAt) {
      return res.status(400).json({ success: false, message: 'Assign a team and start this part before filling its checklist.' });
    }
    if (stage === 'process' && part.initial.length === 0) {
      return res.status(400).json({ success: false, message: 'Complete the Initial checklist for this part before Process.' });
    }
    // A part mid-QC-review or already approved can't be silently overwritten
    // from underneath QC — Production can still fix a Rejected part (that's
    // the whole point of a reject) or resave before it's been picked up yet.
    if (!['Awaiting Production', 'Rejected'].includes(part.status)) {
      return res.status(400).json({ success: false, message: `This part is currently ${part.status} — it can't be edited right now.` });
    }

    // Fresh row objects each save — qcStatus/qcRemarks aren't included, so
    // they fall back to schema defaults (Pending/''), correctly clearing out
    // any stale QC verdict from a prior round when Production resubmits
    // after a reject (confirmed 2026-09-02).
    part[stage] = results.map(r => ({ parameter: r.parameter, standardValue: r.standardValue || '', type: r.type === 'value' ? 'value' : 'checkbox', actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' }));

    if (stage === 'process') {
      part.status = 'QC Pending';
      part.producedBy = req.user.fullName || req.user.username || 'Production';
      part.producedAt = new Date();
      part.rejectReason = ''; // clears a previous rejection note now that it's been resubmitted
    }

    await qcJob.save();
    if (stage === 'process') {
      try {
        await notificationService.triggerQCNotification({
          action: 'qc_job_created',
          data: { qcJobId: qcJob.qcJobId, itemName: `${part.subChildPartName} (${qcJob.itemName})`, jobId: qcJob._id },
          targetCompanyId: req.user.companyId,
        });
      } catch (e) { /* non-fatal */ }
    }

    res.json({ success: true, data: part });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Child Part per-UNIT QC (module:'childPart', staged Initial/Process) ──
// Mirrors the Sub-Child-Part-of-a-Machine partChecks flow above almost
// exactly (getPartChecklistRows/savePartChecklist), just keyed by
// unitNumber instead of childPartId/subChildPartId — one QCJob per Child
// Part order, but each unit reaches/leaves QC entirely independently of its
// siblings (confirmed with the user 2026-09-16 — this does NOT wait for
// every unit the way Machine's own Final Testing does). No
// assignedTeam/startedAt of its own — gated on this unit's own Assembly
// step (real processes[]/extraUnits[] tracking) being Completed instead,
// since Child Part already tracks that, unlike a Sub Child Part inside a
// Machine's old BOM which has no other pipeline tracking it at all.

// GET /orders/:id/child-part/:unitNumber/:stage(initial|process)
export const getChildPartUnitChecklistRows = async (req, res) => {
  try {
    const { stage } = req.params;
    if (!['initial', 'process'].includes(stage)) return res.status(400).json({ success: false, message: 'stage must be initial or process' });
    const unitNumber = parseInt(req.params.unitNumber, 10);
    if (!Number.isFinite(unitNumber) || unitNumber < 1) return res.status(400).json({ success: false, message: 'Invalid unit number' });

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order || order.orderKind !== 'ChildPart') return res.status(404).json({ success: false, message: 'Order not found' });

    // ensureQCJobForOrder (not a bare findOne) — this is the FIRST place a
    // Child Part order's QCJob/unitChecks[] structure needs to exist, no
    // separate "open the panel first" action the way Machine's Parts QC has.
    const qcJobDoc = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    const qcJob = qcJobDoc.toObject();
    const entry = qcJob.unitChecks.find(u => u.unitNumber === unitNumber);
    if (!entry) return res.status(404).json({ success: false, message: 'Invalid unit number for this order.' });

    if (stage === 'process' && entry.initial.length === 0) {
      return res.status(400).json({ success: false, message: 'Complete the Initial checklist for this unit before Process.' });
    }

    const rows = await resolveChildPartUnitChecklistRows(order.subChildPartItem, stage, req.user.companyId);
    const saved = entry[stage] || [];
    const savedByParam = new Map(saved.map(r => [r.parameter, r]));
    // A saved row created before qcStatus/qcRemarks existed on the schema
    // comes back with those keys genuinely missing — normalize so an old,
    // never-reviewed row reads as 'Pending', not `undefined`.
    const merged = rows.map(r => {
      const found = savedByParam.get(r.parameter);
      return found ? { type: 'checkbox', qcStatus: 'Pending', qcRemarks: '', ...found } : r;
    });

    res.json({ success: true, data: { rows: merged, unitStatus: entry.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /orders/:id/child-part/:unitNumber/:stage(initial|process) —
// Production saves its own tick/value results. Saving 'process' is the
// automatic hand-off to QC (no separate "Submit" action — confirmed with
// the user as the exact Machine partChecks pattern to mirror).
export const saveChildPartUnitChecklist = async (req, res) => {
  try {
    const { stage } = req.params;
    if (!['initial', 'process'].includes(stage)) return res.status(400).json({ success: false, message: 'stage must be initial or process' });
    const unitNumber = parseInt(req.params.unitNumber, 10);
    if (!Number.isFinite(unitNumber) || unitNumber < 1) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
    if (results.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before saving.' });
    }

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order || order.orderKind !== 'ChildPart') return res.status(404).json({ success: false, message: 'Order not found' });

    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    const entry = qcJob.unitChecks.find(u => u.unitNumber === unitNumber);
    if (!entry) return res.status(404).json({ success: false, message: 'Invalid unit number for this order.' });

    // Assembly no longer needs to already be 'Completed' before its own
    // checklist can be filled (redesigned 2026-09-19) — 'In Progress' (i.e.
    // Started) is now the precondition, since submitting the Process stage
    // below is what completes Assembly, not the other way around.
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || procs[1]?.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: "Start this unit's Assembly before filling its QC checklist." });
    }
    if (stage === 'process' && entry.initial.length === 0) {
      return res.status(400).json({ success: false, message: 'Complete the Initial checklist for this unit before Process.' });
    }
    // A unit mid-QC-review or already approved can't be silently overwritten
    // from underneath QC — Production can still fix a Rejected unit (the
    // whole point of a reject) or resave before it's been picked up yet.
    if (!['Awaiting Production', 'Rejected'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `This unit is currently ${entry.status} — it can't be edited right now.` });
    }

    // Fresh row objects each save — qcStatus/qcRemarks aren't included, so
    // they fall back to schema defaults (Pending/''), correctly clearing out
    // any stale QC verdict from a prior round when Production resubmits
    // after a reject.
    entry[stage] = results.map(r => ({ parameter: r.parameter, standardValue: r.standardValue || '', type: r.type === 'value' ? 'value' : 'checkbox', actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' }));

    if (stage === 'process') {
      entry.status = 'QC Pending';
      entry.producedBy = req.user.fullName || req.user.username || 'Production';
      entry.producedAt = new Date();
      entry.rejectReason = ''; // clears a previous rejection note now that it's been resubmitted

      // Submitting Process IS what completes Assembly now (redesigned
      // 2026-09-19) — markProcessComplete refuses Assembly outright, so this
      // is the only path that advances it. No fabricated qcStatus/qcBy: this
      // only means "sent to QC", not "QC approved" — decideChildPartUnit
      // still owns the real verdict, and reopens this back to 'In Progress'
      // on a Reject (mirrors reopenFinalTestingForRejection's pattern).
      procs[1].status = 'Completed';
      procs[1].endDate = today();
      procs[1].completedAt = new Date();
    }

    await qcJob.save();
    if (stage === 'process') {
      await order.save();
      try {
        await notificationService.triggerQCNotification({
          action: 'qc_job_created',
          data: { qcJobId: qcJob.qcJobId, itemName: `${order.machineName} — Unit ${unitNumber}`, jobId: qcJob._id },
          targetCompanyId: req.user.companyId,
        });
      } catch (e) { /* non-fatal */ }
    }

    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /orders/:id/child-part/:unitNumber/complete-painting — the actual
// completion of this unit's build: requires Painting's own gate already
// passed (startProcess's live unitChecks.status==='Approved' check) and a
// real total cost for this one unit's build (same required-field
// convention Sub Child Part's own submitSubChildPartOrderToQC uses for
// totalJobWorkCost). Mirrors Machine's own per-unit cost capture exactly
// (approveQC's isFinalStep branch: "a later unit's build always wins over
// an earlier one") — Painting is Child Part's own final step, just reached
// through its own dedicated action instead of the generic approveQC, since
// Machine's isFinalStep math (PROCESS_STEPS.length-1) doesn't apply to
// Child Part's shorter 3-step pipeline.
export const completeChildPartUnitPainting = async (req, res) => {
  try {
    const unitNumber = parseInt(req.params.unitNumber, 10);
    if (!Number.isFinite(unitNumber) || unitNumber < 1) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const toNonNegNumber = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
    const productionCost = toNonNegNumber(req.body.productionCost);
    const productionExpense = toNonNegNumber(req.body.productionExpense);
    if (productionCost === undefined || productionExpense === undefined) {
      return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required to complete Painting.' });
    }

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order || order.orderKind !== 'ChildPart') return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    if (procs[2]?.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: 'Painting is not in progress for this unit.' });
    }

    procs[2].status = 'Completed';
    procs[2].qcStatus = 'Approved';
    procs[2].endDate = today();
    procs[2].completedAt = new Date();

    if (!order.subChildPartItem) {
      return res.status(400).json({ success: false, message: 'This order has no linked Child Part Item.' });
    }
    await recalculateChildPartCost(order.subChildPartItem, req.user.companyId, { productionCost, productionExpense });
    await Item.updateOne({ _id: order.subChildPartItem, companyId: req.user.companyId }, { $inc: { qty: 1 } });

    if (allUnitsCompleted(order)) order.status = 'Completed';
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Final Testing checklist (every Production Order, not just manufactured
// ones — Final applies uniformly regardless of purchase vs in-house, see
// qcChecklistPullService.js's flatModuleStageForItem) ───────────────────────
// Production fills THE SAME job.checklist[] QC will review — no separate
// "Production's copy" — mirroring the Sub Child Part pattern one level up:
// Production records it first, QC can still edit before deciding (confirmed
// 2026-09-02: wire R&D's Final checklist into Production first, then QC).

// GET /orders/:id/final-checklist — ensures the shared QCJob exists this
// early (same one Sub Child Part QC already created, for a manufactured
// product) and its checklist is pulled, then returns it.
export const getFinalChecklist = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    if (!qcJob.checklist?.length && await ensureFlatChecklist(qcJob, req.user.companyId)) await qcJob.save();
    res.json({ success: true, data: { rows: qcJob.checklist, filledBy: qcJob.finalCheckFilledBy, filledAt: qcJob.finalCheckFilledAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Extracted from the old approveQC self-certify path (its own isFinalStep
// branch) — pushes a Machine/Motor's real build cost into whichever BOM
// exists (old RDBOM and/or new MachineBOM), same "later unit wins" rule.
// Now called once, from saveFinalChecklist's first-ever submission
// (redesigned 2026-09-19 — see that function's own comment), instead of
// Production's old separate self-certify click.
export async function applyManufacturedFinalCost(order, finalCost, finalExpense) {
  const mfgItem = await Item.findOne({
    $or: [{ code: order.machineCode }, { name: order.machineName }],
    companyId: order.company
  });
  if (!mfgItem || (mfgItem.productKind !== 'Machine' && mfgItem.productKind !== 'Motor')) return;

  const detailsKey = mfgItem.productKind === 'Machine' ? 'machineDetails' : 'motorDetails';
  if (!mfgItem[detailsKey]?.firstBuiltAt) {
    mfgItem[detailsKey] = mfgItem[detailsKey] || {};
    mfgItem[detailsKey].firstBuiltAt = new Date();
    await mfgItem.save();
  }
  if (!mfgItem.internalManufacturing) return;

  const bom = await RDBOM.findOne({ machine: mfgItem._id, company: order.company });
  if (bom) {
    bom.productionCost = finalCost;
    bom.productionExpense = finalExpense;
    bom.productionCostSource = 'Actual';
    bom.productionCostUpdatedAt = new Date();
    await bom.save();
  }
  await recalculateItemPricing(mfgItem);

  const machineBom = await MachineBOM.findOne({ machine: mfgItem._id, company: order.company });
  if (machineBom) {
    machineBom.productionCost = finalCost;
    machineBom.productionExpense = finalExpense;
    machineBom.productionCostSource = 'Actual';
    machineBom.productionCostUpdatedAt = new Date();
    await machineBom.save();
    await syncMachineBOMPricing(mfgItem, machineBom);
  }
}

// PUT /orders/:id/final-checklist — Production's own fill-in AND, on the
// first-ever submission, the real completion action for this unit's Final
// Testing step (redesigned 2026-09-19 — replaces the old Start -> fill
// checklist -> separately click "Mark Complete" -> separately self-certify
// "Approve QC" chain, same vestigial-self-certify problem already fixed for
// Child Part's Assembly the same day). Submitting IS what sends this unit to
// QC and locks the checklist — gated on THIS unit's own Final Testing step
// still being 'In Progress' (not a bare qcJob-status check, which gave zero
// real enforcement: Production could resubmit endlessly before ever
// touching "Mark Complete", confirmed as a real reported bug). Reopens only
// on a genuine QC reject (qcController.js's reopenFinalTestingForRejection),
// never on Production's own say-so.
//
// productionCost/productionExpense are required ONLY on the first-ever
// submission (tracked by qcJob.finalCheckFilledAt being unset) — confirmed
// with the user: Production reports the real build cost once, and a
// QC-reject/rework resubmission must NOT ask for it again.
export const saveFinalChecklist = async (req, res) => {
  try {
    const { results, productionCost, productionExpense } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
    if (results.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before saving.' });
    }
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    const idx = procs ? procs.findIndex(p => p.step === 'Final Testing') : -1;
    if (idx === -1) return res.status(400).json({ success: false, message: 'This order has no Final Testing step.' });
    const proc = procs[idx];
    if (proc.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: `Final Testing isn't in progress for this unit (currently ${proc.status}) — it can't be edited right now.` });
    }

    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: req.user.companyId });
    if (!qcJob) return res.status(404).json({ success: false, message: 'Open the Final Testing checklist first.' });
    if (!qcJob.checklist?.length) return res.status(400).json({ success: false, message: 'No Final checklist configured for this product yet.' });

    // The checklist is shared across every unit of a multi-quantity order
    // (one qcJob, not one per unit — see QCJob.js's own comment), but each
    // unit's own Final Testing step is independent — so a DIFFERENT unit
    // could already be sitting at 'QC Pending', awaiting a decision on
    // exactly the checklist this submission is about to overwrite. Refused
    // rather than silently clobbering whatever QC is currently looking at.
    const otherUnitProcsList = [order.processes, ...order.extraUnits.map(u => u.processes)].filter(p => p !== procs);
    const anotherUnitAwaitingQC = otherUnitProcsList.some(p => p.find(x => x.step === 'Final Testing')?.status === 'QC Pending');
    if (anotherUnitAwaitingQC) {
      return res.status(400).json({ success: false, message: 'Another unit of this order is already awaiting a QC decision on this same checklist — wait for that to be decided first.' });
    }

    const isFirstSubmission = !qcJob.finalCheckFilledAt;
    let finalCost, finalExpense;
    if (isFirstSubmission) {
      const toNonNegNumber = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
      finalCost = toNonNegNumber(productionCost);
      finalExpense = toNonNegNumber(productionExpense);
      if (finalCost === undefined || finalExpense === undefined) {
        return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required on the first submission.' });
      }
    }
    // 'Rejected' is the normal resubmit-after-reject case (see
    // qcController.js's reopenFinalTestingForRejection). 'Approved' can also
    // reach here for a multi-unit order: QC already decided Pass for an
    // EARLIER unit's own submission (this SAME shared checklist), and now a
    // DIFFERENT unit — independently still 'In Progress' the whole time —
    // is submitting for the first time. Without also reopening here, the
    // qcJob would stay stuck at 'Approved' forever: submitDecision only ever
    // matches a job at status:'In Progress', so QC could never decide on
    // this unit either (the exact "permanently stuck" bug this whole
    // redesign was meant to close — found via a real stuck order,
    // PROD-2026-304928, then re-confirmed reachable through this second
    // path via a fresh trace, not just assumed fixed).
    const needsReopenForReview = qcJob.status === 'Rejected' || qcJob.status === 'Approved';

    const byParam = new Map(results.map(r => [r.parameter, r]));
    qcJob.checklist = qcJob.checklist.map(row => {
      const r = byParam.get(row.parameter);
      // Same reset-on-resubmit as savePartChecklist above: omitting
      // qcStatus/qcRemarks here lets them fall back to schema defaults,
      // clearing out QC's prior verdict now that Production has changed the
      // underlying row.
      return r ? { parameter: row.parameter, standardValue: row.standardValue, type: row.type, actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' } : row.toObject();
    });
    qcJob.finalCheckFilledBy = req.user.fullName || req.user.username || 'Production';
    qcJob.finalCheckFilledAt = new Date();
    if (isFirstSubmission) {
      qcJob.finalCheckProductionCost = finalCost;
      qcJob.finalCheckProductionExpense = finalExpense;
    }
    // Automatic re-send to QC once fixed — no manual "resubmit" action,
    // same principle as everything else in this flow (confirmed 2026-09-01/02).
    if (needsReopenForReview) {
      qcJob.status = 'Pending';
      qcJob.decision = '';
      qcJob.failReason = '';
    }
    await qcJob.save();

    if (isFirstSubmission) {
      try {
        await applyManufacturedFinalCost(order, finalCost, finalExpense);
      } catch (pricingErr) {
        console.error('❌ Error recalculating item pricing on Final Testing submission:', pricingErr);
      }
    }

    const wasAllSubmitted = allUnitsFinalTestingSubmitted(order);
    proc.status = 'QC Pending';
    proc.endDate = today();
    proc.completedAt = new Date();
    await order.save();

    // 🏪 "Production Completed" — every unit's Final Testing has now been
    // submitted (relocated from the old approveQC self-certify flow, which
    // used to fire this on Production's OWN say-so with no real QC review
    // behind it at all — redesigned 2026-09-19). This is deliberately NOT
    // the order's real completion (order.status/'Approved from QC' — that
    // still only happens once QC actually passes it, in qcController.js's
    // submitDecision). Guarded by a before/after transition check so a
    // later reject→resubmit cycle on one unit doesn't re-notify Packing on
    // every resubmission.
    if (!wasAllSubmitted && allUnitsFinalTestingSubmitted(order)) {
      try {
        let linkedSale = null;
        if (order.saleId) linkedSale = await Sale.findById(order.saleId);
        if (!linkedSale) {
          const notesRefMatch = order.notes ? order.notes.match(/Ref:\s*(\S+)/) : null;
          const sourceRefId = notesRefMatch ? notesRefMatch[1] : null;
          if (sourceRefId) {
            linkedSale = await Sale.findOne({
              $or: [
                { invoiceNumber: sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(sourceRefId) ? sourceRefId : null }
              ]
            });
          }
        }
        if (linkedSale) {
          const { setSaleItemStatus } = await import('../services/storeFlowService.js');
          await setSaleItemStatus(linkedSale, order.saleItemId, 'Production Completed');
        }
      } catch (saleUpdateErr) {
        console.error('❌ Error updating Sale storeQCStatus on Final Testing submission:', saleUpdateErr);
      }
      try {
        await notificationService.triggerProductionNotification({
          action: 'production_completed',
          data: { orderCode: order.orderId, batchNo: order.orderId, orderId: order._id, machineName: order.machineName },
          targetCompanyId: order.company,
        });
      } catch (e) { console.error('Production completed notification error:', e); }
    }

    res.json({ success: true, data: { rows: qcJob.checklist, filledBy: qcJob.finalCheckFilledBy, filledAt: qcJob.finalCheckFilledAt, productionCost: qcJob.finalCheckProductionCost, productionExpense: qcJob.finalCheckProductionExpense } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ORDERS ───────────────────────────────────────────────────────────────────

const VALID_ORDER_STATUSES = ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC', 'Completed'];

export const getOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 20, search, status, source, orderKind } = req.query;
    const skip = (page - 1) * limit;

    const query = { company: companyId };
    if (status && status !== 'all' && VALID_ORDER_STATUSES.includes(status)) {
      query.status = status;
    }
    // Orders page's own Machine Orders / Sub Child Part Orders tabs — every
    // pre-existing record has no orderKind at all, so 'Machine' also matches
    // that missing-field case (never silently hides older orders).
    if (orderKind === 'ChildPart') {
      query.orderKind = 'ChildPart';
    } else if (orderKind === 'SubChildPart') {
      query.orderKind = 'SubChildPart';
    } else if (orderKind === 'Machine') {
      query.$or = (query.$or || []).concat([{ orderKind: 'Machine' }, { orderKind: { $exists: false } }]);
    }

    // $and holds the search/source conditions separately since both would
    // otherwise need the top-level `$or` key.
    const andConditions = [];
    if (search) {
      andConditions.push({
        $or: [
          { orderId: { $regex: search, $options: 'i' } },
          { orderCode: { $regex: search, $options: 'i' } },
          { machineCode: { $regex: search, $options: 'i' } },
          { machineName: { $regex: search, $options: 'i' } },
        ]
      });
    }
    if (source === 'Store') {
      // Legacy records predate the `source` field, so missing == Store.
      andConditions.push({ $or: [{ source: { $exists: false } }, { source: 'Store' }] });
    } else if (source === 'QC_Rejected' || source === 'Stock') {
      query.source = source;
    }
    if (andConditions.length) query.$and = andConditions;

    // Summary ignores search/status/source (still ALL of that tab's orders,
    // not "count of this search" — matching the stat-card behavior the
    // Orders page has always had, global counters per machine-document, same
    // meaning as before grouping existed below) but DOES follow the
    // Machine/Sub Child Part tab split, same orderKind scoping as `query`
    // above — otherwise the cards on the Sub Child Part Orders tab (e.g.
    // "Store Orders", meaningless there since a Sub Child Part order's
    // source is always 'Stock') showed the whole company's combined total
    // across both tabs instead of just the tab actually being viewed.
    const summaryMatch = { company: new mongoose.Types.ObjectId(companyId) };
    if (orderKind === 'ChildPart') {
      summaryMatch.orderKind = 'ChildPart';
    } else if (orderKind === 'SubChildPart') {
      summaryMatch.orderKind = 'SubChildPart';
    } else if (orderKind === 'Machine') {
      summaryMatch.$or = [{ orderKind: 'Machine' }, { orderKind: { $exists: false } }];
    }
    const summaryAggPromise = ProductionOrder.aggregate([
      { $match: summaryMatch },
      {
        $facet: {
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          priorityCounts: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
          sourceCounts: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
        }
      }
    ]);

    // `grouped=true` (Orders page's main list only — see OrderManagement.jsx)
    // — one row per real order instead of one per machine-document. Every
    // other caller of this same endpoint (Job Cards, Process & QC's
    // useProductionOrdersList) omits this param and gets the exact unchanged
    // flat per-document list/pagination below, so nothing else needs to
    // change shape for them.
    //
    // Two-query approach instead of one aggregation pipeline: keeps the
    // grouping key logic as plain, testable JS (mirrors
    // OrderManagement.jsx's own getRealOrderId exactly, so "how many real
    // orders exist" always agrees with what the list already displayed
    // before grouping existed) rather than re-encoding the same branching
    // logic a second time as Mongo aggregation operators.
    let orders, total;
    if (req.query.grouped === 'true') {
      const lightDocs = await ProductionOrder.find(query)
        .select('_id orderCode source machineCode rejectionDetails.originalOrderId createdAt')
        .sort({ createdAt: -1 })
        .lean();

      // Mirrors getRealOrderId (OrderManagement.jsx) exactly, with one
      // addition: Stock production has no real order at all (that function
      // returns null for it) — grouping literal `null` together would
      // wrongly merge every unrelated Stock entry into one row, so each one
      // gets its own unique key instead, same as it displays today.
      const groupKeyFor = (o) => {
        if (o.orderCode) return o.orderCode;
        if (o.source === 'QC_Rejected') return o.rejectionDetails?.originalOrderId || o.machineCode || `_solo_${o._id}`;
        if (!o.source || o.source === 'Store') return o.machineCode || `_solo_${o._id}`;
        return `_solo_${o._id}`; // Stock
      };

      const groupMap = new Map();
      for (const doc of lightDocs) {
        const key = groupKeyFor(doc);
        let g = groupMap.get(key);
        if (!g) { g = { key, ids: [], maxCreatedAt: doc.createdAt }; groupMap.set(key, g); }
        g.ids.push(doc._id);
        if (doc.createdAt > g.maxCreatedAt) g.maxCreatedAt = doc.createdAt;
      }
      // Groups ordered by their most recently active machine, same overall
      // recency ordering the ungrouped list already used.
      const allGroups = [...groupMap.values()].sort((a, b) => b.maxCreatedAt - a.maxCreatedAt);
      total = allGroups.length;
      const pageGroups = allGroups.slice(skip, skip + parseInt(limit));

      const idsToFetch = pageGroups.flatMap(g => g.ids);
      const fullDocs = await ProductionOrder.find({ _id: { $in: idsToFetch } })
        .populate('processes.assignedTeam', 'name supervisor members')
        .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
        .lean();
      const byId = new Map(fullDocs.map(d => [String(d._id), d]));

      orders = pageGroups.map(g => ({
        groupKey: g.key,
        // Oldest first — mirrors the order machines were added on the Order
        // Form (Sale.items[]), since that's the order ProductionOrder docs
        // are created in (storeFlowService.js's autoCheckAllOrderItems).
        machines: g.ids
          .map(id => byId.get(String(id)))
          .filter(Boolean)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      }));
    } else {
      [orders, total] = await Promise.all([
        ProductionOrder.find(query)
          .populate('processes.assignedTeam', 'name supervisor members')
          .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        ProductionOrder.countDocuments(query),
      ]);
    }

    const summaryAgg = await summaryAggPromise;
    const facet = summaryAgg[0] || { statusCounts: [], priorityCounts: [], sourceCounts: [], total: [] };
    const countFrom = (arr, key) => (arr.find(a => a._id === key)?.count) || 0;
    const summary = {
      total: facet.total[0]?.count || 0,
      pending: countFrom(facet.statusCounts, 'Pending'),
      bomPending: countFrom(facet.statusCounts, 'BOM Pending'),
      inProgress: countFrom(facet.statusCounts, 'In Progress'),
      onHold: countFrom(facet.statusCounts, 'On Hold'),
      completed: countFrom(facet.statusCounts, 'Completed'),
      urgent: countFrom(facet.priorityCounts, 'Urgent'),
      storeOrders: countFrom(facet.sourceCounts, 'Store'),
      rejectedOrders: countFrom(facet.sourceCounts, 'QC_Rejected'),
    };

    res.json({
      success: true,
      data: {
        orders,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
        summary,
      }
    });
  } catch (err) {
    console.error('❌ Error in getOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Lightweight "current work" feed for board/kanban-style pages (Work
// Planning, Process & QC order-picker, Manpower's live board) — these only
// ever operate on non-Completed orders, so unlike getOrders above this isn't
// paginated: it's bounded by how much work is actually in flight, not by
// total order history. Orders completed within the last 7 days stay visible
// too, so Process & QC's picker doesn't yank a just-finished order out from
// under a user mid-workflow.
export const getActiveOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const orders = await ProductionOrder.find({
      company: companyId,
      $or: [
        { status: { $ne: 'Completed' } },
        { updatedAt: { $gte: sevenDaysAgo } },
      ],
    })
      .populate('processes.assignedTeam', 'name supervisor members')
      .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('❌ Error in getActiveOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// On-demand history for a single team, used by Manpower's "View Full
// History" modal — fetched only when that modal opens, so the shared
// context never has to carry every team's entire history up front.
export const getTeamOrderHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { teamId } = req.params;

    const orders = await ProductionOrder.find({
      company: companyId,
      $or: [
        { 'processes.assignedTeam': teamId },
        { 'extraUnits.processes.assignedTeam': teamId },
      ],
    })
      .populate('processes.assignedTeam', 'name supervisor members')
      .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('❌ Error in getTeamOrderHistory:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { machineCode, machineName, priority, deliveryDate, source, rejectionDetails } = req.body;
    if (!machineCode || !machineName || !deliveryDate) {
      return res.status(400).json({ success: false, message: 'machineCode, machineName and deliveryDate are required' });
    }

    // Generate appropriate order ID based on source
    let orderId;
    if (source === 'QC_Rejected') {
      const year = new Date().getFullYear();
      const lastRejectedOrder = await ProductionOrder.findOne({
        orderId: new RegExp(`^REJ-${year}-`)
      }).sort({ orderId: -1 }).lean();

      let nextNumber = 1;
      if (lastRejectedOrder && lastRejectedOrder.orderId) {
        const parts = lastRejectedOrder.orderId.split('-');
        if (parts.length === 3) {
          const lastNumber = parseInt(parts[2]);
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }
      orderId = `REJ-${year}-${String(nextNumber).padStart(4, '0')}`;
    } else {
      orderId = await generateOrderId(req.user.companyId);
    }

    // Explicit, never the schema's own bare default — see
    // resolveMachineOrderProcesses's own comment for why.
    const processes = await resolveMachineOrderProcesses(machineCode, req.user.companyId);

    const order = await ProductionOrder.create({
      orderId,
      machineCode,
      machineName,
      priority: priority || (source === 'QC_Rejected' ? 'Urgent' : 'Normal'),
      source: source || 'Stock', // manually created = 'Stock' by default (no linked sale)
      rejectionDetails: rejectionDetails || {},
      receivedDate: today(),
      deliveryDate,
      company: req.user.companyId,
      createdBy: req.user._id,
      processes,
    });

    // 🔔 Notify Production Head & Employee about new order
    try {
      await notificationService.triggerProductionNotification({
        action: 'order_for_production',
        data: { orderCode: order.orderId, orderId: order._id, machineName },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Production order notification error:', e); }

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyBOM = async (req, res) => {
  try {
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { bomVerified: true },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyDesign = async (req, res) => {
  try {
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { designVerified: true },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Fast-fetch utility
const getTrueMachineCode = async (machineName, companyId) => {
  const item = await Item.findOne({ name: machineName, companyId })
    .select('code -_id')
    .lean();

  if (!item) throw new Error(`Machine name "${machineName}" not found in Inventory.`);
  return item.code;
};

export const raiseRDRequest = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({
      _id: req.params.id,
      company: req.user.companyId
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // 1. Get the true code from inventory based on the machine name
    const trueCode = await getTrueMachineCode(order.machineName, req.user.companyId);

    // 2. Create the workspace for R&D
    await RDRequest.create({
      productionOrderId: order._id,
      machineCode: trueCode, // Pass the corrected code
      machineName: order.machineName,
      company: req.user.companyId
    });

    // 3. Update the Production Order with the corrected code and new status
    order.machineCode = trueCode;
    order.rdRequestRaised = true;
    order.status = 'BOM Pending';
    await order.save();

    res.json({ success: true, message: 'R&D Request raised successfully.', data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/production-mfg/orders/:id/bom-design-status
//
// Replaces the per-order "Raise R&D Request" cycle for the common case: if
// R&D has already locked this machine's BOM (/r&d/bom-management) AND
// approved its design (/r&d/design-approval — Item.machineDetails.designStatus
// === 'Approved'), Production never needs to ask — it just gets what's
// already there. Called whenever Process Execution loads an order; auto-sets
// bomVerified/designVerified the first time both are true (same flags
// raiseRDRequest's R&D-approval path already sets, so every existing reader
// of them — including the Orders list — keeps working unchanged), then it's
// a no-op on every later call. If either isn't ready yet, the frontend falls
// back to the existing "Raise R&D Request" button/flow untouched.
// Shared by both branches below — persists the auto-verify side effect and
// builds the common part of the response. Kept as one place so a Machine
// order and a Sub Child Part order both auto-verify/clear rdRequestRaised
// exactly the same way once their own bomLocked/designApproved go true.
async function applyAutoVerify(order, bomLocked, designApproved) {
  let autoVerifiedNow = false;
  if (bomLocked && designApproved && (!order.bomVerified || !order.designVerified)) {
    order.bomVerified = true;
    order.designVerified = true;
    order.rdRequestRaised = false;
    if (order.status === 'BOM Pending') order.status = 'Pending';
    await order.save();
    autoVerifiedNow = true;
  }
  return autoVerifiedNow;
}

export const getBomDesignStatus = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // A Sub Child Part order has no machine, no whole-BOM to lock, and no
    // design-approval workflow of its own — those concepts don't map onto a
    // part the way they do a machine. Re-interpreted instead as two plain
    // existence checks: does R&D have a Design File on file for this part
    // (the same file required at creation), and has R&D actually defined
    // what it's built from yet (any material lines on whichever machine it's
    // linked to — there's no separate BOM to lock, so "materials exist" is
    // the equivalent readiness signal for Production). No BOM PDF here
    // either — `materials` is returned directly so the UI can show the list
    // itself instead of a document.
    if (order.orderKind === 'ChildPart') {
      const item = await Item.findOne({ _id: order.subChildPartItem, companyId, productKind: 'ChildPart' }).lean();
      if (!item) {
        return res.json({
          success: true,
          data: {
            bomLocked: false, designApproved: false, designStatus: null, bomId: null,
            designFiles: [], materials: [], autoVerified: false, autoVerifiedNow: false,
            order: { bomVerified: order.bomVerified, designVerified: order.designVerified, rdRequestRaised: order.rdRequestRaised, status: order.status },
          }
        });
      }

      const found = await findSubChildPartMaterialLines(item._id, companyId);
      const materials = found?.materials || [];
      const bomLocked = materials.length > 0;

      // Gate stays on the Child Part's OWN image only (informational, not
      // gating, for the Sub Child Part images added below) — a design call
      // confirmed with the user 2026-09-16 rather than requiring every
      // referenced Sub Child Part to also have one before this counts as
      // approved.
      const designApproved = !!item.image;
      const designFiles = [];
      if (item.image) {
        designFiles.push({ _id: item._id, name: item.name, version: '', fileUrl: item.image, source: 'Child Part' });
      }
      // Roll up each referenced Sub Child Part's own design image too — this
      // view previously only ever showed the Child Part's own image, same
      // gap this same rollup already closed at the Machine level
      // (buildMachineDesignFiles walks Child Part -> Sub Child Part; this
      // is the equivalent one level down).
      if (found?.subChildPartLines?.length) {
        const subChildPartItems = await Item.find({
          _id: { $in: found.subChildPartLines.map(l => l.subChildPart) }, companyId,
        }).select('name image').lean();
        for (const sub of subChildPartItems) {
          if (sub.image) {
            designFiles.push({ _id: sub._id, name: sub.name, version: '', fileUrl: sub.image, source: 'Sub Child Part' });
          }
        }
      }

      const autoVerifiedNow = await applyAutoVerify(order, bomLocked, designApproved);

      return res.json({
        success: true,
        data: {
          bomLocked, designApproved, designStatus: designApproved ? 'Present' : 'Missing',
          bomId: null,
          designFiles, materials,
          autoVerified: bomLocked && designApproved,
          autoVerifiedNow,
          order: { bomVerified: order.bomVerified, designVerified: order.designVerified, rdRequestRaised: order.rdRequestRaised, status: order.status },
        },
      });
    }

    const machineItem = await Item.findOne({ code: order.machineCode, companyId, productKind: 'Machine' }).lean();
    if (!machineItem) {
      return res.json({
        success: true,
        data: {
          bomLocked: false, designApproved: false, designStatus: null, bomId: null,
          designFiles: [], autoVerified: false, autoVerifiedNow: false,
          order: { bomVerified: order.bomVerified, designVerified: order.designVerified, rdRequestRaised: order.rdRequestRaised, status: order.status },
        }
      });
    }

    // MachineBOM only — no RDBOM fallback (full cutover, 2026-09-16,
    // confirmed with the user: real MachineBOM documents already exist and
    // this order-creation-facing verification point reads the new hierarchy
    // exclusively now, same "old stays frozen in BOM Management's own
    // Legacy tab, order flow cuts over" rule already applied to Child Part's
    // own order-creation cron). A machine with no MachineBOM yet correctly
    // reads bomLocked:false — nothing to lock yet, not a bug. Reuses
    // findMachineMaterialLines (machineReorderService.js) — one query now
    // resolves both the lock flag AND the materials array (2026-09-17,
    // needed so Process Execution's BOM view has real content to show
    // before the BOM is even locked — see that function's own comment).
    const found = await findMachineMaterialLines(machineItem._id, companyId);
    const bom = found?.bom || null;
    const bomLocked = !!bom?.isLocked;
    const designStatus = machineItem.machineDetails?.designStatus || 'Draft';
    const designApproved = designStatus === 'Approved';
    const designFiles = await buildMachineDesignFiles(machineItem._id, companyId);

    const autoVerifiedNow = await applyAutoVerify(order, bomLocked, designApproved);

    res.json({
      success: true,
      data: {
        bomLocked, designApproved, designStatus,
        bomId: bom?._id || null,
        // MachineBOM's own download route is keyed by the machine ITEM's id
        // (GET /api/rd/machine-bom/:machineId/download), unlike the old
        // RDBOM one (GET /api/rd/boms/:bomId/download) — kept as its own
        // field rather than overloading bomId's meaning, so the frontend's
        // "View/Download BOM" button can build the right URL.
        machineItemId: machineItem._id,
        // The Machine's Child Part references + own materials — lets
        // Process Execution show a real View of the BOM's content
        // regardless of lock status (2026-09-17), same as the ChildPart
        // branch above already does.
        materials: found?.materials || [],
        designFiles,
        autoVerified: bomLocked && designApproved,
        autoVerifiedNow,
        order: { bomVerified: order.bomVerified, designVerified: order.designVerified, rdRequestRaised: order.rdRequestRaised, status: order.status },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:id/sub-child-part-material-list — Child Part order only
// (see childPartReorderService.js's buildSubChildPartMaterialList).
export const getSubChildPartMaterialList = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderKind !== 'ChildPart') {
      return res.status(400).json({ success: false, message: 'This order is not a Sub Child Part order.' });
    }
    const data = await buildSubChildPartMaterialList(order, companyId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /orders/:id/sub-child-part-material/request — Production's "Issue"
// button raises/grows one material row's request (straight to 'Requested',
// no R&D approval — stock build). Body: { demandKey, requestQuantity }.
export const requestSubChildPartMaterialController = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderKind !== 'ChildPart') {
      return res.status(400).json({ success: false, message: 'This order is not a Sub Child Part order.' });
    }
    const { demandKey, requestQuantity } = req.body || {};
    const result = await requestSubChildPartMaterial(order, companyId, demandKey, requestQuantity);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: 'Material request sent to Store.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:id/machine-material-list — Machine order only (2026-09-17,
// see machineReorderService.js's buildMachineMaterialList). Direct mirror of
// getSubChildPartMaterialList one tier down. Legacy orderKind fallback
// (missing/unset === Machine) matches OrderManagement.jsx's own kind filter.
export const getMachineMaterialList = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderKind && order.orderKind !== 'Machine') {
      return res.status(400).json({ success: false, message: 'This order is not a Machine order.' });
    }
    const data = await buildMachineMaterialList(order, companyId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /orders/:id/machine-material/request — Production's "Issue" button,
// direct mirror of requestSubChildPartMaterialController one tier down.
export const requestMachineMaterialController = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderKind && order.orderKind !== 'Machine') {
      return res.status(400).json({ success: false, message: 'This order is not a Machine order.' });
    }
    const { demandKey, requestQuantity } = req.body || {};
    const result = await requestMachineMaterial(order, companyId, demandKey, requestQuantity);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: 'Material request sent to Store.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:id/sub-child-part-job-work — the Job Work step's material
// inputs (sheet metal → Laser Cutting, "Job Work" Item-Type → its Job Work
// Type) and whether each is received yet. Drives the Job Work card's
// expanded panel; the assign-team/start gate uses the same data.
export const getSubChildPartJobWork = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderKind !== 'ChildPart') {
      return res.status(400).json({ success: false, message: 'This order is not a Sub Child Part order.' });
    }
    const rows = await getSubChildPartJobWorkRows(order, companyId);
    res.json({ success: true, data: { rows, allIssued: rows.every(r => r.issued) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:id/processes/:stepIndex/material-status?unit=N — Stage 3d
// (2026-09-24) — the generalized twin of the Fabrication status endpoint
// above, for ANY step carrying its own materialRefs (Child Part or
// Machine), not just the one legacy-named Child Part step. Same response
// shape ({ materials, allReady }) so the frontend can render both with one
// component. Shown regardless of the step's own status — Production wants
// to see ahead of time whether the NEXT unit will have enough, not just
// while a step is actively in progress.
export const getStepMaterialStatusController = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    const materials = await resolveStepMaterialLines(order, procs[idx], companyId);
    res.json({ success: true, data: { materials, allReady: materials.every(m => m.enough) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── MATERIAL LIST — direct-from-BOM, no R&D request needed ────────────────────
// Standard BOM materials no longer need a per-production R&D request/approval
// cycle (that requirement is now reserved for a genuinely new/changed BOM,
// per the client's own framing — deferred until those requirements arrive).
// This computes the live list straight from the locked RDBOM, using the same
// grouping math Store Orders' material-availability check already uses
// (bomMaterialGroupsService.js), and cross-references each group against
// order.materialDemands to show either the real demand (already issued) or a
// "Not Issued" row with just an Issue Material button. Add Demand (out-of-BOM
// extras) is untouched — still its own separate R&D "Material Change" path.
function groupKeyFor(itemCode, dimensionVariantId) {
  return dimensionVariantId ? `${itemCode}#${dimensionVariantId}` : itemCode;
}

async function buildMaterialListGroups(order, companyId) {
  const machineItem = await Item.findOne({ code: order.machineCode, companyId, productKind: 'Machine' }).lean();
  if (!machineItem) return { groups: [], bom: null };
  const bom = await RDBOM.findOne({ machine: machineItem._id, company: companyId }).lean();
  if (!bom || !bom.materials?.length) return { groups: [], bom };

  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const groups = [];

  for (const g of plainMaterialGroupsFromBOM(bom)) {
    groups.push({
      key: groupKeyFor(g.itemCode, null),
      itemCode: g.itemCode,
      name: g.itemName,
      unit: g.unit,
      neededQty: g.perUnitQty * buildQty,
      childParts: g.childParts,
      fabricationCategory: '',
      dimensionVariantId: null,
      sheetMetalPlanId: null,
    });
  }

  const sheetGroups = sheetMetalGroupsFromBOM(bom);
  if (sheetGroups.length) {
    const plans = await SheetMetalPlan.find({ bom: bom._id, company: companyId }).lean();
    const planByKey = new Map(plans.map(p => [groupKeyFor(p.itemCode, p.dimensionVariantId), p]));
    for (const g of sheetGroups) {
      const key = groupKeyFor(g.itemCode, g.dimensionVariantId);
      const plan = planByKey.get(key);
      if (!plan) continue; // unplanned group — lockBOM's gate should prevent this; skip defensively
      groups.push({
        key,
        itemCode: g.itemCode,
        name: g.itemName,
        unit: 'Pieces',
        neededQty: plan.sheetsNeededPerUnit * buildQty,
        childParts: g.childParts,
        fabricationCategory: 'sheet_plate',
        dimensionVariantId: g.dimensionVariantId,
        sheetMetalPlanId: plan._id,
      });
    }
  }

  for (const g of lengthFabricationGroupsFromBOM(bom)) {
    const matItem = await Item.findOne({ code: g.itemCode, companyId });
    const variant = (matItem?.dimensionVariants || []).find(v => String(v._id) === String(g.dimensionVariantId));
    const catalogPieceLengthMm = Number(variant?.values?.length) || 0;
    if (!variant || !catalogPieceLengthMm) continue;
    const key = groupKeyFor(g.itemCode, g.dimensionVariantId);
    groups.push({
      key,
      itemCode: g.itemCode,
      name: g.itemName,
      unit: 'Pieces',
      neededQty: Math.ceil((g.totalLengthMmPerUnit * buildQty) / catalogPieceLengthMm),
      childParts: g.childParts,
      fabricationCategory: g.fabricationCategory,
      dimensionVariantId: g.dimensionVariantId,
      sheetMetalPlanId: null,
    });
  }

  return { groups, bom };
}

// Names of every Material List row not yet fully received in Production —
// "received" means status 'Issued' specifically (confirmed 2026-09-01:
// "material needs to be present in production means we have received it"),
// not merely requested/in transit. `filterGroups`, when given, narrows this
// to only the groups relevant to one Sub Child Part (see
// getPartMaterialGate below) — omitted, it's the whole order's Material
// List, which is what Job Work's own gate uses for now (kept as one
// whole-order stage rather than broken into parts, per the same
// confirmation — easy to narrow later once it needs to be).
async function getUnissuedMaterials(order, companyId, filterGroups = null) {
  const { groups } = await buildMaterialListGroups(order, companyId);
  const relevant = filterGroups ? groups.filter(filterGroups) : groups;
  const demandByKey = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
  return relevant.filter(g => demandByKey.get(g.key)?.status !== 'Issued').map(g => g.name);
}

// True for a MachineBOM-driven Machine order's own 2-step pipeline
// (['Assembly', 'Final Testing'] — see ProductionOrder.js's MACHINE_BOM_STEPS)
// — decided once at order-creation time (resolveMachineOrderProcesses,
// machineReorderService.js) and readable straight off the order's own real
// processes[] shape from then on, no MachineBOM re-query needed. An old
// RDBOM-only Machine order never matches this (still the 6-step shape), so
// every check gated on it is a guaranteed no-op for them.
function isMachineBOMPipeline(procs) {
  return procs?.length === 2 && procs[0]?.step === 'Assembly' && procs[1]?.step === 'Final Testing';
}

// Same idea as getUnissuedMaterials above, but for a MachineBOM-driven
// order's own Assembly step — keyed off the NEW Material List's own live
// ledger (order.materialDemands[], populated by requestMachineMaterial/
// Store's handshake, Pass B/C) instead of the OLD RDBOM-driven
// buildMaterialListGroups Job Work still uses. Already embedded on the
// order document, so no extra query needed, unlike getUnissuedMaterials.
function getUnissuedMachineBOMMaterials(order) {
  return (order.materialDemands || [])
    .filter(d => d.status !== 'Issued')
    .map(d => d.materialName);
}

// Closes the "In-House material consumption gap" (2026-09-23, see the
// discussion doc's own section) — resolves a dynamic step's own materialRefs
// (Phase 1's per-step picker, generalized off Out-Source-only) against the
// order's real BOM lines and joins each one against the live materialDemands
// ledger, one row per referenced line. Deliberately does NOT reuse
// buildMaterialListGroups/getUnissuedMaterials above — those read from the
// legacy RDBOM model (see that function's own comment), which a dynamic
// Process-Definition order was never built from. Resolves against the SAME
// ChildPartBOM/MachineBOM-driven lines the order's own Material List
// already uses (findSubChildPartMaterialLines/findMachineMaterialLines),
// matching the exact lookup outsourceWorkController.js's
// getHandoffMaterialInfo already proved out for a first-step hand-off.
//
// Same per-line shape getSubChildPartFabricationStatus (childPartReorderService.js)
// already returns for its own, differently-scoped "all BOM rows" set —
// mirrored deliberately, not reinvented, so the frontend table can render
// either one identically. perUnitNeed comes straight off the BOM line's own
// quantity (no sheet-metal/length-fabrication area recomputation — same
// simplification outsourceWorkController.js's getHandoffMaterialInfo already
// made for its own per-materialRefs-line lookup, for the same reason: this
// is a derived display/bookkeeping feature, not the real quantity engine).
// Returns [] for a step with no materialRefs at all (an AssembledPart-only
// step with nothing extra picked, or any legacy hardcoded-pipeline step,
// which never carries materialRefs in the first place) — every caller below
// treats an empty result as a safe no-op.
export async function resolveStepMaterialLines(order, proc, companyId) {
  const refs = (proc?.materialRefs || []).map(String);
  if (!refs.length) return [];

  let found = null;
  if (order.orderKind === 'ChildPart') {
    found = await findSubChildPartMaterialLines(order.subChildPartItem, companyId);
  } else if (order.orderKind !== 'SubChildPart') {
    const mfgItem = await Item.findOne({ $or: [{ code: order.machineCode }, { name: order.machineName }], companyId }).lean();
    if (mfgItem) found = await findMachineMaterialLines(mfgItem._id, companyId);
  }
  if (!found) return []; // nothing this can resolve against

  const lines = found.materials.filter(m => refs.includes(String(m._id)));
  if (!lines.length) return [];

  const demandByCode = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
  return lines.map(l => {
    const d = demandByCode.get(l.code);
    const onFloor = Math.max(0, (d?.issuedQuantity || 0) - (d?.consumedQuantity || 0) - (d?.returnPendingQuantity || 0));
    const perUnitNeed = Number(l.quantity) || 0;
    return {
      demandKey: l.code, code: l.code, name: l.item, unit: l.unit || 'Pieces',
      perUnitNeed, onFloor,
      issuedQty: d?.issuedQuantity || 0, consumedQty: d?.consumedQuantity || 0,
      // This UNIT's own share (2026-09-24, found live: the "Consumed" column
      // used to show consumedQty above — order.materialDemands' own running
      // total across every unit that's passed this step — on every single
      // unit's own card. Two units each starting a 1-per-unit step legitimately
      // sums to 2 order-wide, but showing that same "2" on a card that also
      // says "Need/unit: 1" reads as this ONE unit over-consuming, when it
      // didn't. commitStepMaterialConsumption fires exactly once, unconditionally,
      // at the same moment THIS proc's own status first leaves 'Pending'
      // (startProcess, or receiveOutsourceHandoffRound for an Out Source
      // step) — so "has this specific unit's copy of this step already left
      // Pending" is a reliable, already-available signal for "did this unit
      // draw its own share yet", no new storage needed.
      consumedByUnit: proc.status !== 'Pending' ? perUnitNeed : 0,
      returnPendingQty: d?.returnPendingQuantity || 0, demandStatus: d?.status || null,
      enough: onFloor + 1e-6 >= perUnitNeed,
    };
  });
}

// Thin boolean wrapper over resolveStepMaterialLines, for assignTeam's own
// gate (which only ever needs a yes/no, never the full rows).
async function resolveStepMaterialIssuance(order, proc, companyId) {
  const lines = await resolveStepMaterialLines(order, proc, companyId);
  const unissued = lines.filter(l => l.demandStatus !== 'Issued').map(l => l.name);
  return unissued.length ? { ok: false, unissued } : { ok: true };
}

// Records that one unit's worth of a step's own referenced material has now
// been used — mirrors commitSubChildPartUnitConsumption (childPartReorderService.js)
// exactly, just against the already-resolved, correctly step-scoped `lines`
// instead of re-deriving "every BOM row". Pure bookkeeping, not a gate —
// fires regardless of whether `enough` was true, same as the function it
// mirrors. Caller must still .save() the order afterward.
export function commitStepMaterialConsumption(order, lines) {
  const demandByCode = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
  for (const l of lines) {
    if (!(l.perUnitNeed > 0)) continue;
    const d = demandByCode.get(l.demandKey);
    if (d) d.consumedQuantity = (d.consumedQuantity || 0) + l.perUnitNeed;
  }
}

// Same check, narrowed to one Sub Child Part's own BOM material lines —
// matched by name (RDBOM.MaterialSchema's childPart/subChildPart snapshot
// fields, the same ones the Material List's own "(N parts)" hover already
// reads off each group's g.childParts) since a group can be shared by
// several parts and doesn't carry their ids, only their name snapshots.
async function getPartUnissuedMaterials(order, companyId, childPartName, subChildPartName) {
  return getUnissuedMaterials(order, companyId, g =>
    g.childParts.some(cp => cp.childPart === childPartName && cp.subChildPart === subChildPartName)
  );
}

// Live "can Production actually request this right now" info — computed
// fresh on every load, never trusted from the frozen order-submission-time
// snapshot (Sale.items[].materialAvailability — stock can move in either
// direction since then: consumed by another order, or topped up by an
// unrelated purchase). That snapshot is only ever used below as the LINK to
// the auto-raised Purchase Request/RFQ/PO chain when live stock is still
// short, never as the availability verdict itself.
//
// Only computed for rows currently sitting on an outstanding (unfulfilled)
// quantity — a never-issued row (no demand yet) or one whose demand is back
// at status 'Requested' (the state an R&D-approved Adjust Qty resets it to
// when Production needs MORE than what's already been transferred — see
// rdController.js's Material Change approval). Every other status (In
// Transit/Issued/Pending R&D/R&D Rejected/Pending Return) isn't "about to
// request issue", so those rows get no entry at all (confirmed 2026-08-31).
async function computeLiveMaterialAvailability(materialList, order, companyId) {
  const candidates = materialList.filter(row => !row.demand || row.demand.status === 'Requested');
  if (!candidates.length) return new Map();

  // Only order-triggered runs (order.saleId set) ever had this snapshot
  // computed at all — a Stock/manual run's shortfalls always resolve to
  // 'short_no_pr' below, same as an out-of-BOM "Add Demand" extra that
  // postdates the order form and was never part of that check either.
  const needsPurchaseByCode = new Map();
  if (order.saleId && order.saleItemId) {
    const sale = await Sale.findById(order.saleId).lean();
    const saleItem = sale?.items?.find(i => String(i._id) === String(order.saleItemId));
    for (const np of saleItem?.materialAvailability?.needsPurchase || []) {
      needsPurchaseByCode.set(np.code, np);
    }
  }

  const result = new Map();
  for (const row of candidates) {
    const matItem = await Item.findOne({ code: row.itemCode, companyId }).lean();
    if (!matItem) { result.set(row.key, { state: 'unknown' }); continue; }

    // A demand's own dimensionVariantId (fabrication only) always wins over
    // the BOM group's, since an out-of-BOM "Add Demand" fabrication line's
    // key isn't the {code}#{dimensionVariantId} scheme buildMaterialListGroups
    // uses (it's a dimension-signature key — see addMaterialDemand) and would
    // resolve to the wrong variant if parsed back out of row.key instead.
    const dimensionVariantId = row.demand?.dimensionVariantId ?? row.dimensionVariantId ?? null;
    const outstandingQty = row.demand
      ? Math.max(0, row.demand.quantity - (row.demand.transferredQuantity || 0))
      : row.neededQty;

    let availableQty;
    if (dimensionVariantId) {
      const variant = (matItem.dimensionVariants || []).find(v => String(v._id) === String(dimensionVariantId));
      availableQty = variant?.subStock || 0;
    } else {
      availableQty = matItem.qty || 0;
    }

    if (availableQty >= outstandingQty) {
      result.set(row.key, { state: 'available', availableQty });
      continue;
    }

    const np = needsPurchaseByCode.get(row.key);
    if (!np?.purchaseRequestId) {
      result.set(row.key, { state: 'short_no_pr', availableQty });
      continue;
    }

    const pr = await PurchaseRequest.findOne({ requestId: np.purchaseRequestId, companyId }).select('_id').lean();
    const rfq = pr ? await RFQ.findOne({ purchaseRequest: pr._id, companyId }).select('status purchaseOrder').lean() : null;
    if (!rfq || rfq.status !== 'Awarded' || !rfq.purchaseOrder) {
      result.set(row.key, { state: 'short_pr_pending', availableQty, purchaseRequestId: np.purchaseRequestId });
      continue;
    }

    const po = await Purchase.findById(rfq.purchaseOrder).select('expectedDeliveryDate').lean();
    result.set(row.key, {
      state: 'short_eta', availableQty,
      purchaseRequestId: np.purchaseRequestId, expectedDeliveryDate: po?.expectedDeliveryDate || null,
    });
  }
  return result;
}

// GET /orders/:id/material-list
export const getMaterialList = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const { groups } = await buildMaterialListGroups(order, req.user.companyId);
    const demandByKey = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
    const groupKeys = new Set(groups.map(g => g.key));

    const materialList = groups.map(g => ({
      key: g.key,
      itemCode: g.itemCode,
      name: g.name,
      unit: g.unit,
      neededQty: g.neededQty,
      childParts: g.childParts,
      dimensionVariantId: g.dimensionVariantId,
      demand: demandByKey.get(g.key) || null,
    }));

    // Out-of-BOM extras ("Add Demand") never match a live BOM group key
    // (their key is a per-cut dimension signature or a plain typed code —
    // see addMaterialDemand — not this file's {code}#{dimensionVariantId}
    // scheme), so without this they'd silently disappear from the list
    // entirely instead of showing as "Out of BOM" like they always have.
    for (const d of order.materialDemands || []) {
      if (!groupKeys.has(d.materialCode)) {
        materialList.push({
          key: d.materialCode, itemCode: d.sourceItemCode || d.materialCode,
          name: d.materialName, unit: d.unit, neededQty: d.quantity, childParts: [],
          dimensionVariantId: null, demand: d,
        });
      }
    }

    const availabilityByKey = await computeLiveMaterialAvailability(materialList, order, req.user.companyId);
    for (const row of materialList) {
      row.availability = availabilityByKey.get(row.key) || null;
    }

    res.json({ success: true, data: materialList });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /orders/:id/materials/issue — body: { groupKey }
export const issueMaterialToStore = async (req, res) => {
  try {
    if (!HEAD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only a Production Head can issue material to Store.' });
    }
    const { groupKey } = req.body;
    if (!groupKey) return res.status(400).json({ success: false, message: 'groupKey is required.' });

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.materialDemands.some(d => d.materialCode === groupKey)) {
      return res.status(400).json({ success: false, message: 'This material has already been issued.' });
    }

    // Never trust a client-sent quantity — re-derive the group fresh from
    // the BOM, same server-authoritative principle every other BOM
    // calculation in this app already follows.
    const { groups } = await buildMaterialListGroups(order, req.user.companyId);
    const group = groups.find(g => g.key === groupKey);
    if (!group) return res.status(404).json({ success: false, message: 'This material is not part of the current BOM.' });

    const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
    order.materialDemands.push({
      materialCode: group.key,
      sourceItemCode: group.itemCode,
      materialName: group.name,
      bomQuantity: group.neededQty / buildQty,
      quantity: group.neededQty,
      unit: group.unit,
      status: 'Requested',
      fabricationCategory: group.fabricationCategory || '',
      dimensionVariantId: group.dimensionVariantId || null,
      sheetMetalPlanId: group.sheetMetalPlanId || null,
      bomDimensions: {},
    });
    await order.save();

    res.json({ success: true, message: `${group.name} issued to Store.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── QC-REJECTED ORDER: REWORK / REPAIR DECISION ───────────────────────────────
// A QC_Rejected order sits with reworkDecision='Pending' (BOM/R&D UI hidden)
// until Production explicitly picks one of these two paths.

export const decideRework = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, source: 'QC_Rejected' });
    if (!order) return res.status(404).json({ success: false, message: 'Rejected order not found' });
    if (order.reworkDecision !== 'Pending') {
      return res.status(400).json({ success: false, message: `Decision already made: ${order.reworkDecision}` });
    }
    // Rework = rebuild from scratch, same as this order's default automatic
    // pipeline (BOM verify → material issue → process steps → QC), just now
    // gated behind an explicit choice instead of firing immediately.
    order.reworkDecision = 'Rework';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const decideRepair = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, source: 'QC_Rejected' });
    if (!order) return res.status(404).json({ success: false, message: 'Rejected order not found' });
    if (order.reworkDecision !== 'Pending') {
      return res.status(400).json({ success: false, message: `Decision already made: ${order.reworkDecision}` });
    }
    order.reworkDecision = 'Repair';
    order.status = 'On Hold'; // parks it out of the normal active-production board
    order.repair.status = 'Pending';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── REPAIR PRODUCTION MODULE ──────────────────────────────────────────────────
// Repair jobs are QC_Rejected Production Orders that were routed here instead
// of the full rebuild pipeline — same record, filtered by reworkDecision.

export const getRepairJobs = async (req, res) => {
  try {
    const orders = await ProductionOrder.find({ company: req.user.companyId, reworkDecision: 'Repair' })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startRepair = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (!assignedTo || !assignedTo.trim()) {
      return res.status(400).json({ success: false, message: 'A supervisor/team must be assigned before starting a repair.' });
    }
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, reworkDecision: 'Repair' },
      { 'repair.status': 'In Progress', 'repair.assignedTo': assignedTo.trim() },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Repair job not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completeRepair = async (req, res) => {
  try {
    const { notes } = req.body;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, reworkDecision: 'Repair' });
    if (!order) return res.status(404).json({ success: false, message: 'Repair job not found' });
    if (order.repair.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'Repair already completed' });
    }

    order.repair.status = 'Completed';
    order.repair.notes = notes || order.repair.notes;
    order.repair.completedAt = new Date();
    order.status = 'Completed';
    await order.save();

    // Repaired qty re-enters the same central QC intake pipeline as any
    // finished production run — Approve in QC then behaves exactly like a
    // normal QC_Rejected Pass (routes straight to dispatch for the original
    // order); Fail re-runs this same Rework/Repair choice again.
    try {
      await ensureQCJobForOrder(order, 'Repair Dept', req.user._id);
    } catch (qcErr) {
      console.error('❌ Error creating QC Job for completed repair:', qcErr);
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};







export const receiveMaterialInProduction = async (req, res) => {
  try {
    if (!HEAD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only a Production Head can confirm material receipt.' });
    }
    const { materialCode, receivedQuantity } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const recQty = Number(receivedQuantity);

    if (!materialCode || !recQty || recQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and received quantity are required.' });
    }

    // 1. Fetch the Order
    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // 2. Find the specific material demand
    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);
    if (demandIndex === -1) {
      return res.status(404).json({ success: false, message: 'Material not found in this order.' });
    }
    const demand = order.materialDemands[demandIndex];

    // 3. Gatekeeper: Is it in transit?
    if (demand.status !== 'In Transit') {
      return res.status(400).json({ success: false, message: 'No material currently in transit to receive.' });
    }

    // 4. Calculate exactly how much is sitting on the cart
    const inTransitQty = (demand.transferredQuantity || 0) - (demand.issuedQuantity || 0);

    // 🚨 NEW STRICT GATEKEEPER: Force exact receipt
    if (recQty !== inTransitQty) {
      return res.status(400).json({
        success: false,
        message: `Partial receipts disabled. You must receive exactly the in-transit amount: ${inTransitQty} ${demand.unit}.`
      });
    }

    // 5. UPDATE RECEIVED QUANTITY
    const newIssuedQty = (demand.issuedQuantity || 0) + recQty;
    order.materialDemands[demandIndex].issuedQuantity = newIssuedQty;

    // 6. SIMPLIFIED STATUS ROUTING
    // Since they always receive the full cart, there is no "Scenario B". 
    // It's either completely fulfilled, or they still need more from the store.
    if (newIssuedQty >= demand.quantity) {
      order.materialDemands[demandIndex].status = 'Issued';
    } else {
      order.materialDemands[demandIndex].status = 'Requested';
    }

    // 7. Auto-Complete Check for the whole order
    const allIssued = order.materialDemands.every(m => m.status === 'Issued');
    if (allIssued) {
      order.materialIssued = true;
    }

    await order.save();

    // 8. GENERATE AUDIT LOG
    await MaterialIssueLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: demand.materialCode,
      materialName: demand.materialName,
      sourceItemCode: demand.sourceItemCode || demand.materialCode,
      fabricationCategory: demand.fabricationCategory || '',
      bomDimensions: demand.bomDimensions || null,
      quantityIssued: recQty,
      unit: demand.unit,
      issuedTo: req.user._id,
      company: companyId
    });

    res.json({
      success: true,
      data: order,
      message: `Successfully received all ${recQty} ${demand.unit} of ${demand.materialName}.`
    });

  } catch (err) {
    console.error("Error receiving material:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─────────────────────────────────────────────────────────────
// API 1: ADD / UPDATE MATERIAL DEMAND (Production Floor)
// ─────────────────────────────────────────────────────────────
export const addMaterialDemand = async (req, res) => {
  try {
    const { materialCode, materialName, quantity, unit, dimensionVariantId, amountValue, amountUnit, targetDemandCode } = req.body;

    if (!materialCode || !materialName || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'All material fields are required' });
    }

    const companyId = req.user.companyId;
    const orderId = req.params.id;

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // materialCode may not match any real Inventory item at all — Production
    // can request an ad-hoc/out-of-catalog material by name (existing
    // behavior, unchanged: no Item required). Fabrication-aware pricing only
    // kicks in when it DOES resolve to a fabrication-linked Item.
    const sourceItem = await Item.findOne({ code: materialCode.trim(), companyId });

    // Fabrication materials (sourceItem.fabricationRef set) are keyed by
    // weight+cut, not a flat code — mirrors rdController.js's
    // processRDRequest merge-key logic. targetDemandCode, when given, pins
    // this request to one EXACT existing demand line (Production adjusting
    // an already-demanded cut's quantity) instead of deriving a key from
    // freshly-entered dimensions — avoids a mistyped dimension silently
    // creating a duplicate line instead of updating the right one.
    let demandMaterialCode = targetDemandCode || materialCode;
    let fabricationFields = sourceItem ? { sourceItemCode: sourceItem.code } : {};

    if (!targetDemandCode && sourceItem?.fabricationRef) {
      if (!dimensionVariantId || !(Number(amountValue) > 0) || !amountUnit) {
        return res.status(400).json({ success: false, message: 'A dimension size, amount, and amount unit are required for a Fabrication Master material.' });
      }
      const bomDimensions = buildFabricationBomDimensions(sourceItem, dimensionVariantId, amountValue, amountUnit);
      if (!bomDimensions) {
        return res.status(400).json({ success: false, message: 'Chosen dimension size not found on this item, or the amount unit is invalid for its shape.' });
      }
      const fabWeight = await resolveFabricationWeight(sourceItem, bomDimensions, bomDimensions.designation);
      if (!fabWeight || !(fabWeight.weightPerPieceKg > 0)) {
        return res.status(400).json({ success: false, message: 'Could not resolve this fabrication item\'s weight from the chosen size and amount.' });
      }
      demandMaterialCode = `${sourceItem.code}#${dimensionSignature(bomDimensions)}`;
      fabricationFields = {
        sourceItemCode: sourceItem.code,
        bomDimensions,
        fabricationCategory: fabWeight.fabricationCategory,
        computedWeightPerPieceKg: fabWeight.weightPerPieceKg,
        unitPrice: Math.round(fabWeight.weightPerPieceKg * (sourceItem.weightUnitPrice || 0) * 100) / 100,
        dimensionVariantId,
        amountValue: Number(amountValue),
        amountUnit,
      };
    } else if (!targetDemandCode && sourceItem && itemNeedsAmount(sourceItem)) {
      // Non-fabrication Length/Area/Volume material — carries an amountValue
      // (the per-piece size) purely as display metadata; `quantity` (below,
      // shared with every other demand) is already the resolved TOTAL amount
      // needed, computed client-side from Amount x Pieces before it ever
      // reaches here (see UnitAmountField.jsx) — so pricing/stock deduction
      // stay flat, unaffected by amountValue, same as every other material.
      // amountUnit is never trusted from the client — always the item's own
      // Used Unit (the form no longer offers a separate amount-unit picker).
      if (!(Number(amountValue) > 0)) {
        return res.status(400).json({ success: false, message: `An amount (in ${sourceItem.unit}) is required for this material.` });
      }
      demandMaterialCode = `${sourceItem.code}#${Number(amountValue)}${sourceItem.unit}`;
      fabricationFields = {
        sourceItemCode: sourceItem.code,
        unitPrice: sourceItem.purchaseCost || 0,
        amountValue: Number(amountValue),
        amountUnit: sourceItem.unit,
      };
    }

    const materialExists = order.materialDemands.find(m => m.materialCode === demandMaterialCode);

    // 🚨 ONLY BLOCK: Prevent changing demand if the physical
    // material is actively being moved by the store right now.
    if (materialExists && materialExists.status === 'In Transit') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change demand while this material is currently In Transit from the store.'
      });
    }

    const originalBomQty = materialExists && materialExists.bomQuantity !== undefined
      ? materialExists.bomQuantity : null;

    // Capture previous quantity so we can revert if R&D rejects
    const previousQuantity = materialExists ? materialExists.quantity : null;

    let updatedOrder;
    if (materialExists) {
      updatedOrder = await ProductionOrder.findOneAndUpdate(
        { _id: orderId, "materialDemands.materialCode": demandMaterialCode },
        {
          $set: {
            "materialDemands.$.status": "Pending R&D",
            "materialDemands.$.quantity": Number(quantity),
            "materialDemands.$.unit": unit
          }
        },
        { new: true }
      );
    } else {
      updatedOrder = await ProductionOrder.findOneAndUpdate(
        { _id: orderId },
        {
          $push: {
            materialDemands: {
              materialCode: demandMaterialCode, materialName, bomQuantity: null,
              quantity: Number(quantity), unit, status: 'Pending R&D',
              ...fabricationFields,
            }
          }
        },
        { new: true }
      );
    }

    await RDRequest.create({
      productionOrderId: order._id,
      machineCode: order.machineCode,
      machineName: order.machineName,
      requestType: 'Material Change',
      materialChangeDetails: {
        materialCode: demandMaterialCode,
        materialName,
        bomQuantity: originalBomQty,
        requestedQuantity: Number(quantity),
        previousQuantity, // 👈 Saved for Rejection Rollbacks
        unit
      },
      company: companyId
    });

    res.json({ success: true, data: updatedOrder, message: 'Demand sent to R&D for approval.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// controllers/productionMfgController.js

export const returnMaterialToStore = async (req, res) => {
  try {
    // 🚨 Added returnType ('Excess' or 'Defect') from the production client interface
    const {
      materialCode, returnQuantity, reason, returnType,
      leftoverLengthValue, leftoverLengthUnit, leftoverWidthValue, leftoverWidthUnit,
    } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const retQty = Number(returnQuantity);

    if (!materialCode || !retQty || retQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and return quantity are required.' });
    }

    if (!['Excess', 'Defect'].includes(returnType)) {
      return res.status(400).json({ success: false, message: 'Invalid return type. Must be Excess or Defect.' });
    }

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const demand = order.materialDemands.find(m => m.materialCode === materialCode);
    if (!demand) return res.status(404).json({ success: false, message: 'Material not found in this order.' });

    // Calculate real physical availability left on the floor
    const availableOnFloor = (demand.issuedQuantity || 0) - (demand.returnPendingQuantity || 0);

    if (retQty > availableOnFloor) {
      return res.status(400).json({
        success: false,
        message: `Cannot return ${retQty}. Only have ${availableOnFloor} items available on the production floor.`
      });
    }

    // "Flat piece" demands (fabricationCategory set, empty bomDimensions) —
    // both Sheet Metal Plan-driven demands AND the flat length-fabrication
    // group demands (see bomMaterialGroupsService.js) — carry no per-cut
    // bomDimensions of their own (Store shipped whole catalog pieces, not a
    // specific cut). Production does the actual cutting on the floor, so
    // whatever's genuinely left over has to be measured here, not assumed.
    // A demand WITH a specific bomDimensions cut is different: Store already
    // cut it to that exact size before issuing, so any unused whole pieces
    // Production returns are already exactly that size — confirmReturn's
    // existing bomDimensions fallback already credits those correctly, no
    // measurement needed.
    //
    // Sheet metal needs a real Length AND Width (a laser-cut offcut is a
    // genuine rectangle, not just a number) — thickness is inherited from
    // the source catalog variant, never re-entered. Non-sheet fabrication
    // (perMeter categories) needs only a Length; every other physical
    // property (cross-section fields, etc.) is inherited from the source
    // variant, same pattern Store's own outbound leftover entry already uses
    // (transferFabricationMaterialToProduction). Required for this demand
    // type — without it there's no dimension key to credit stock against on
    // Accept (see confirmReturn).
    let leftoverValues = null;
    const isFlatPieceDemand = !!demand.fabricationCategory
      && (!demand.bomDimensions || Object.keys(demand.bomDimensions).length === 0);
    if (isFlatPieceDemand) {
      const category = getCategoryByKey(demand.fabricationCategory);
      const isSheet = category?.calcType === 'sheet';

      const sourceItem = await Item.findOne({ code: demand.sourceItemCode || materialCode, companyId }).lean();
      const sourceVariant = (sourceItem?.dimensionVariants || []).find(v => String(v._id) === String(demand.dimensionVariantId));
      if (!sourceVariant) {
        return res.status(400).json({ success: false, message: 'Could not resolve the original catalog size this demand was cut from.' });
      }

      const lengthMm = toMm(leftoverLengthValue, leftoverLengthUnit);
      if (!lengthMm) {
        return res.status(400).json({ success: false, message: 'A measured leftover length is required to return this fabrication material.' });
      }

      if (isSheet) {
        const widthMm = toMm(leftoverWidthValue, leftoverWidthUnit);
        if (!widthMm) {
          return res.status(400).json({ success: false, message: 'A measured leftover width is required to return sheet metal material.' });
        }
        leftoverValues = { thickness: sourceVariant.values?.thickness, width: widthMm, length: lengthMm };
      } else {
        leftoverValues = { ...(sourceVariant.values || {}), length: lengthMm };
      }
    }

    // ✅ Increment the specific quantitative lock field instead of altering demand.status
    demand.returnPendingQuantity = (demand.returnPendingQuantity || 0) + retQty;
    await order.save();

    // Log the transaction request along with the context tag for the store panel
    await MaterialReturnLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: demand.materialCode,
      sourceItemCode: demand.sourceItemCode || demand.materialCode,
      fabricationCategory: demand.fabricationCategory || '',
      bomDimensions: demand.bomDimensions || null,
      leftoverValues,
      isSheetMetalPlanReturn: !!demand.sheetMetalPlanId,
      materialName: demand.materialName,
      quantityReturned: retQty,
      unit: demand.unit,
      returnedBy: req.user._id,
      reason: reason || `${returnType} material return`,
      returnType: returnType, // 👈 Saved directly to log database schema
      company: companyId,
      status: 'Pending'
    });

    res.json({
      success: true,
      message: `${returnType} return request for ${retQty} ${demand.unit} submitted. Awaiting Store verification.`
    });

  } catch (err) {
    console.error("Error in returnMaterialToStore:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// download the material list

export const downloadMaterialListPDF = async (req, res) => {
  try {
    const { id } = req.params;

    // Find production order profile records
    const order = await ProductionOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Production order document not found." });
    }

    // Initialize a clean, letter-sized document with structural margins
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

    // Set streaming response configurations
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=MaterialList-${order.orderId}.pdf`);

    doc.pipe(res);

    // ── BRAND IDENTITY HEADER ──
    doc.fillColor('#1e293b').fontSize(22).font('Helvetica-Bold').text('SAMTEK MACHINERY', 50, 50);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Production Material Ledger & Performance Report', 50, 75);

    // Horizontal visual bounding divider line
    doc.moveTo(50, 92).lineTo(562, 92).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // ── METADATA PROFILE BLOCK ──
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(`Production Order ID: #${order.orderId}`, 50, 115);

    doc.fillColor('#334155').fontSize(9).font('Helvetica');
    doc.text(`Machine Asset: ${order.machineCode} — ${order.machineName}`, 50, 135);
    doc.text(`Fulfillment State: ${order.status}`, 50, 150);
    doc.text(`Target Delivery Frame: ${order.deliveryDate}`, 50, 165);
    doc.text(`Generated Date: ${new Date().toLocaleDateString()}`, 50, 180);

    // ── MATERIAL DEMAND SUMMARY TABLE HEADER ──
    doc.fillColor('#1e3a8a').fontSize(11).font('Helvetica-Bold').text('Completed Material Allocation Ledger', 50, 215);

    const tableTop = 235;
    doc.rect(50, tableTop, 512, 22).fill('#f8fafc');

    // Draw Table Columns String Labels
    doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold');
    doc.text('Item Code', 60, tableTop + 6, { width: 80 });
    doc.text('Material Name', 150, tableTop + 6, { width: 160 });
    doc.text('Req Qty', 320, tableTop + 6, { width: 50, align: 'center' });
    doc.text('Transferred', 380, tableTop + 6, { width: 65, align: 'center' });
    doc.text('Issued', 455, tableTop + 6, { width: 50, align: 'center' });
    doc.text('Status', 510, tableTop + 6, { width: 45, align: 'right' });

    let currentY = tableTop + 22;

    // ── INTERACTION LOOP FOR PRODUCTION ORDER DEMANDS ──
    order.materialDemands.forEach((item) => {
      // Fabrication demand lines carry a synthetic per-cut materialCode
      // (itemCode#dimensionSignature) used as a tracking key — the real
      // Inventory code is sourceItemCode. The ledger should print the real
      // code and show what size was cut, not the internal tracking key.
      const hasCut = item.fabricationCategory && item.bomDimensions && Object.keys(item.bomDimensions).length > 0;
      const rowHeight = hasCut ? 30 : 22;

      // Check for page overflow limits dynamically
      if (currentY + rowHeight > 700) {
        doc.addPage();
        currentY = 50; // Reset height position for additional pages
      }

      // Draw border line separator frame
      doc.moveTo(50, currentY + rowHeight).lineTo(562, currentY + rowHeight).strokeColor('#f1f5f9').lineWidth(1).stroke();

      // Populate Item Text Strings
      doc.fillColor('#334155').fontSize(9).font('Helvetica');
      doc.text(item.sourceItemCode || item.materialCode, 60, currentY + 7, { width: 80 });
      doc.text(item.materialName, 150, currentY + 7, { width: 160 });
      doc.text(`${item.quantity} ${item.unit}`, 320, currentY + 7, { width: 50, align: 'center' });
      doc.text(`${item.transferredQuantity} ${item.unit}`, 380, currentY + 7, { width: 65, align: 'center' });
      doc.text(`${item.issuedQuantity} ${item.unit}`, 455, currentY + 7, { width: 50, align: 'center' });

      // Format styling explicitly for status string layout values
      const statusColor = item.status === 'Issued' ? '#16a34a' : '#475569';
      doc.fillColor(statusColor).font('Helvetica-Bold');
      doc.text(item.status, 510, currentY + 7, { width: 45, align: 'right' });

      if (hasCut) {
        const dimsText = Object.entries(item.bomDimensions)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${k}:${v}`).join(', ');
        doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text(`Cut: ${dimsText}`, 150, currentY + 19, { width: 300 });
      }

      currentY += rowHeight;
    });

    // Finalize compilation processing
    doc.end();

  } catch (error) {
    console.error("Critical error building production ledger summary PDF file streams:", error);
    res.status(500).json({ message: "Internal application error building asset documentation reports." });
  }
};

export const updateMaterialStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, 'materialDemands._id': req.params.materialId },
      { $set: { 'materialDemands.$.status': status } },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order or material not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PROCESS OPERATIONS ───────────────────────────────────────────────────────

// stepIndex — a rough sanity pre-filter only (0 to the longest pipeline any
// order kind ever has, PROCESS_STEPS.length). The PRECISE bound — against
// THIS order's own real processes[]/procs.length, which varies by order
// (old 6-step Machine, trimmed 3-step Child Part, new 2-step MachineBOM
// Machine — see ProductionOrder.js's MACHINE_BOM_STEPS) — can only be
// checked once the order itself is resolved, so every caller re-checks
// `idx >= procs.length` right after resolving `procs` (same spot the
// existing `if (!procs) return...` check already lives).
function getStepIndex(req, res) {
  const idx = parseInt(req.params.stepIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= PROCESS_STEPS.length) {
    res.status(400).json({ success: false, message: 'Invalid step index' });
    return -1;
  }
  return idx;
}

// Which physical unit (1-based) a process-execution call targets. Defaults
// to 1 so every existing caller that never sends `unit` keeps operating on
// the order's original `processes` field exactly as before.
function getUnitNumber(req) {
  const raw = req.query.unit ?? req.body?.unit;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// Resolves the process-steps array to mutate for a given unit number.
// Unit 1 = order.processes (unchanged legacy path). Units 2..N live in
// order.extraUnits[0..N-2], lazily created here the first time a multi-unit
// order's process tab is actually touched. Returns null for an out-of-range
// unit number (caller should respond 400).
function getUnitProcesses(order, unitNumber) {
  if (unitNumber <= 1) return order.processes;
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  if (unitNumber > buildQty) return null;
  while (order.extraUnits.length < buildQty - 1) {
    // Mirror Unit 1's OWN real step OBJECTS (2026-09-24 fix — see
    // buildFreshUnitProcesses's own comment) — copies category/type/
    // materialSource/materialRefs/materialQuantities/qcRequired wholesale,
    // not just step NAMES. The old buildStepsFromList(names-only) fallback
    // silently lost every dynamic Phase-2 field and re-derived `type` from
    // the static legacy PROCESS_TYPE_MAP (only knows old hardcoded names),
    // wrongly stamping a dynamic Out Source step as 'In-House' by default.
    // Falls back to the orderKind-keyed default only if Unit 1 itself is
    // somehow still empty (legacy pre-fix ChildPart data, see
    // new-bom-hierarchy-bug-fixes.md #3/#6) — never fabricates a shape for
    // Sub Child Part, whose processes[] is empty by design under the old
    // bespoke flow (a real dynamic Sub Child Part order always has real
    // processes[], so this branch is effectively legacy-only).
    const fresh = order.processes.length
      ? buildFreshUnitProcesses(order.processes)
      : (order.orderKind === 'ChildPart' ? buildStepsFromList(stepsForKind('ChildPart')) : []);
    order.extraUnits.push({ processes: fresh });
  }
  return order.extraUnits[unitNumber - 2].processes;
}

// Stage 3b — the ONE real QC checkpoint's position in a unit's flattened
// processes[], derived from Phase 1's per-step `qcRequired` flag instead of
// a hardcoded step name/index. Sub Child Part has no flag at all (Phase 1's
// BOM UI hides the toggle there) — its rule is fixed: always the true last
// step, never a per-BOM choice (see the Phase 2 discussion doc's "QC
// placement" section). Returns -1 for a legacy order with no dynamic
// Process Definition (nothing flagged, not Sub Child Part) — callers treat
// -1 as "no checkpoint here, fall through to the existing hardcoded-name
// behavior unchanged," so this is purely additive for every order that
// predates this flag.
export function qcCheckpointIndex(order, procs) {
  if (order.orderKind === 'SubChildPart') return procs.length - 1;
  return procs.findIndex(p => p.qcRequired);
}

// Stage 3b (2026-09-23) — extracted from approveQC's own tail (its
// historical, unchanged call site) so the same Dispatch/Sale/lead-time/
// QCJob side effects can also fire from the new completeFinalProcessStep
// endpoint below, the other place a Machine order can now newly reach
// allUnitsCompleted (its QC checkpoint sitting before the true last step —
// a real dynamic-BOM shape the old fixed Final-Testing-is-always-last
// pipeline never allowed). Caller has already set order.status itself;
// this only runs the "just transitioned into Completed" side effects.
// Machine-only — Child Part has never had a Sale/Dispatch concept (it
// feeds Machine assembly as plain inventory), so its own completion paths
// (completeChildPartUnitPainting, decideChildPartUnit) never call this.
//
// perUnitQc (2026-09-24): a per-unit Machine order (isPerUnitMachineOrder)
// has already counted every unit toward the Sale item as 'Approved from QC'
// one at a time (completeMachineUnit below) — the old 'Production Completed'
// write here would overwrite that with a status the packing gate never
// accepts, and its QCJob already exists. Only lead-time + notification run.
async function finalizeMachineOrderCompletion(order, actorName, userId, { perUnitQc = false } = {}) {
  try {
    const { recordLeadTimeSample } = await import('../utils/leadTimeStats.js');
    const units = [order.processes, ...order.extraUnits.map(u => u.processes)];
    for (const unitProcs of units) {
      const starts = unitProcs.map(p => p.startedAt || p.startDate).filter(Boolean).map(d => new Date(d).getTime());
      const ends = unitProcs.map(p => p.completedAt || p.endDate).filter(Boolean).map(d => new Date(d).getTime());
      if (!starts.length || !ends.length) continue;
      const durationDays = Math.max(0, (Math.max(...ends) - Math.min(...starts)) / (1000 * 60 * 60 * 24));
      await recordLeadTimeSample(order.company, order.machineCode, order.machineName, 'Production', durationDays);
    }
  } catch (e) {
    console.error('Failed to record production lead-time sample:', e.message);
  }

  try {
    await notificationService.triggerProductionNotification({
      action: 'production_completed',
      data: { orderCode: order.orderId, batchNo: order.orderId, orderId: order._id, machineName: order.machineName },
      targetCompanyId: order.company,
    });
  } catch (e) { console.error('Production completed notification error:', e); }

  if (perUnitQc) return;

  try {
    const linkedSale = await findLinkedSale(order);
    if (linkedSale) {
      const { setSaleItemStatus } = await import('../services/storeFlowService.js');
      const perItem = await setSaleItemStatus(linkedSale, order.saleItemId, 'Production Completed');
      console.log(`🏪 [Production Completed] 'Production Completed' for Sale ${linkedSale._id}${perItem ? ` (item ${order.saleItemId})` : ' (sale-level)'}`);
    } else {
      console.warn(`⚠️ [Production Completed] Could not find linked Sale for ProductionOrder ${order.orderId}`);
    }
  } catch (saleUpdateErr) {
    console.error('❌ Error updating Sale storeQCStatus on production completion:', saleUpdateErr);
  }

  try {
    await ensureQCJobForOrder(order, actorName, userId);
  } catch (qcCreateErr) {
    console.error('❌ Error creating QC Job for completed production order:', qcCreateErr);
  }
}

// The order's own saleId first, then the legacy "Ref: <invoice/saleId>"
// notes convention — extracted unchanged from finalizeMachineOrderCompletion
// so completeMachineUnit resolves the Sale exactly the same way.
async function findLinkedSale(order) {
  let linkedSale = null;
  if (order.saleId) linkedSale = await Sale.findById(order.saleId);
  if (!linkedSale) {
    const notesRefMatch = order.notes ? order.notes.match(/Ref:\s*(\S+)/) : null;
    const sourceRefId = notesRefMatch ? notesRefMatch[1] : null;
    if (sourceRefId) {
      linkedSale = await Sale.findOne({
        $or: [
          { invoiceNumber: sourceRefId },
          { _id: /^[0-9a-fA-F]{24}$/.test(sourceRefId) ? sourceRefId : null }
        ]
      });
    }
  }
  return linkedSale;
}

// Per-unit Machine QC (agreed 2026-09-24 — see the Phase 2 discussion doc's
// "Machine QC checkpoint — per-unit redesign"): the ONE place a unit of a
// per-unit Machine order becomes done — its checkpoint QC-approved AND its
// true last step finished. Whichever of those happens last calls this:
// decideChildPartUnit (qcController.js) when the checkpoint IS the last
// step, completeFinalProcessStep below when it's mid-sequence (or
// outsourceWorkController.js's receive, for an outsourced last step).
// Caller has already set that unit's steps' statuses (not yet saved); this
// saves the order.
//
// A done unit counts once: +1 'Approved from QC' on the Sale item
// (setSaleItemStatus accumulates approvedQty — the item only turns ready at
// its full quantity, so the whole-order packing gate is untouched), or +1
// machine stock for a no-Sale (stock) order — the existing Dispatch-vs-Stock
// fork, via saleId. entry.readyAt makes a repeat call a no-op for the credit.
export async function completeMachineUnit(order, job, unitNumber, { actorName, userId } = {}) {
  const qcJob = job || await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: order.company });
  const entry = qcJob?.unitChecks?.find(u => u.unitNumber === unitNumber);

  if (entry && !entry.readyAt) {
    if (order.saleId) {
      try {
        const linkedSale = await findLinkedSale(order);
        if (linkedSale) {
          const { setSaleItemStatus } = await import('../services/storeFlowService.js');
          await setSaleItemStatus(linkedSale, order.saleItemId, 'Approved from QC', { qty: 1 });
        } else {
          console.warn(`⚠️ [Machine unit done] Could not find linked Sale for ProductionOrder ${order.orderId}`);
        }
      } catch (e) { console.error('❌ Error updating Sale on Machine unit completion:', e); }
    } else {
      await Item.updateOne(
        { $or: [{ code: order.machineCode }, { name: order.machineName }], companyId: order.company },
        { $inc: { qty: 1 } }
      );
    }
    entry.readyAt = new Date();
    if (qcJob.unitChecks.every(u => u.readyAt)) {
      qcJob.status = 'Approved';
      qcJob.decision = 'Pass';
      qcJob.inspectionEndDate = today();
      qcJob.transferredToStore = true;
    }
    await qcJob.save();
  }

  const wasCompleted = order.status === 'Completed';
  if (allUnitsCompleted(order)) order.status = 'Completed';
  await order.save();
  if (order.status === 'Completed' && !wasCompleted) {
    await finalizeMachineOrderCompletion(order, actorName, userId, { perUnitQc: true });
  }
}

// True once every step of every unit (the main `processes` plus all
// `extraUnits`) is Completed. For orderQuantity === 1 orders, extraUnits is
// always [], so this is identical to the original "all processes complete"
// check.
export function allUnitsCompleted(order) {
  const mainDone = order.processes.every(p => p.status === 'Completed');

  // extraUnits entries are created LAZILY (see getUnitProcesses) — only the
  // first time that unit's tab is actually opened/worked on. If a unit has
  // never been touched, there's no entry for it at all yet, which is not
  // the same as "no steps outstanding" for it. Without this check,
  // `[].every(...)` on a still-empty extraUnits array is vacuously true,
  // which silently marked a whole multi-unit order Completed the moment
  // Unit 1 alone finished, even with Units 2/3 never started.
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const extraUnitsExpected = buildQty - 1;
  if (order.extraUnits.length < extraUnitsExpected) return false;

  const extraDone = order.extraUnits.every(u => u.processes.every(p => p.status === 'Completed'));
  return mainDone && extraDone;
}

// True once every unit's own Final Testing step has at least been
// SUBMITTED (status 'QC Pending' or 'Completed', i.e. no longer 'Pending'/
// 'In Progress') — the new "Production says every unit is built" checkpoint
// (redesigned 2026-09-19), replacing the old whole-order allUnitsCompleted
// check that used to gate the "Production Completed" Sale-status update
// inside approveQC's old self-certify flow (which could fire without QC
// ever having reviewed anything). Same lazy-extraUnits guard as
// allUnitsCompleted, same reason.
function allUnitsFinalTestingSubmitted(order) {
  const submitted = (procs) => {
    const ft = procs.find(p => p.step === 'Final Testing');
    return !!ft && ft.status !== 'Pending' && ft.status !== 'In Progress';
  };
  if (!submitted(order.processes)) return false;

  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  if (order.extraUnits.length < buildQty - 1) return false;
  return order.extraUnits.every(u => submitted(u.processes));
}

export const assignTeam = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { teamId } = req.body;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    // Job Work dropped from Child Part's own pipeline (2026-09-16 — a Sub
    // Child Part is independently stocked/replenished by its own order flow
    // now, see ProductionOrder.js's SUB_CHILD_PART_STEPS comment), so the
    // old idx===0 Job-Work-only checks (once-per-order guard, whole-order
    // material check) are gone — Fabrication (now idx 0) gets its own
    // material+team gate at Start time instead (startProcess below), not
    // here at team-assignment time. Name-based (not idx===0) since a
    // MachineBOM-driven order's own idx 0 is 'Assembly', not 'Job Work' —
    // see the isMachineBOMPipeline branch right below for its own gate.
    if (procs[idx].step === 'Job Work' && teamId && order.orderKind !== 'ChildPart') {
      const unissued = await getUnissuedMaterials(order, req.user.companyId);
      if (unissued.length > 0) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production, can't allot work: ${unissued.join(', ')}.` });
      }
    } else if (procs[idx].step === 'Assembly' && teamId && isMachineBOMPipeline(procs)) {
      // MachineBOM-driven order's own Assembly — same "can't allot work
      // until the material's actually in Production" rule Job Work uses,
      // just against the new Material List's own live ledger instead of
      // the old RDBOM-driven one (confirmed with the user 2026-09-17).
      const unissued = getUnissuedMachineBOMMaterials(order);
      if (unissued.length > 0) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production, can't allot work: ${unissued.join(', ')}.` });
      }
    }

    // Generalized twin of the two branches above, for a dynamic Process
    // Definition step (2026-09-23 — see resolveStepMaterialIssuance's own
    // comment). Always a safe no-op for anything the branches above already
    // cover, since a legacy hardcoded-pipeline step never carries
    // materialRefs at all.
    if (teamId) {
      const issuance = await resolveStepMaterialIssuance(order, procs[idx], req.user.companyId);
      if (!issuance.ok) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production, can't allot work: ${issuance.unissued.join(', ')}.` });
      }
    }

    procs[idx].assignedTeam = teamId || null;
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startProcess = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const unitNumber = getUnitNumber(req);

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // ─────────────────────────────────────────────────────────────
    // NEW GATEKEEPERS: BOM & Material Issue Validation
    // ─────────────────────────────────────────────────────────────
    // bomVerified/materialIssued only ever mean anything for a Machine
    // order — they're flipped exclusively by processRDRequest's Initial BOM
    // approval workflow against RDBOM/MachineBOM (see
    // bom-hierarchy-redesign-build-2026-09.md §20). Neither Child Part nor
    // Sub Child Part has any R&D verification concept at any tier — both
    // must skip this gate, not just one of them.
    //
    // Bug fixed 2026-09-24: this used to be a single `isSCP` variable
    // ("is Sub Child Part") that actually checked orderKind==='ChildPart' —
    // the middle tier, not the lowest one — so a genuine Sub Child Part
    // order fell through into this gate and got permanently 400'd on Start
    // (bomVerified/materialIssued default false and are never set for that
    // kind). Split into two correctly-scoped checks: isMachine for this gate
    // and the two other Machine-only branches below, isChildPart (renamed
    // from the same misleading isSCP) kept for the one check further down
    // that genuinely does mean Child Part specifically.
    const isMachine = order.orderKind === 'Machine';
    const isChildPart = order.orderKind === 'ChildPart';
    if (isMachine) {
      if (!order.bomVerified) {
        return res.status(400).json({
          success: false,
          message: 'Cannot start process: BOM has not been verified by R&D yet.'
        });
      }

      if (!order.materialIssued) {
        return res.status(400).json({
          success: false,
          message: 'Cannot start process: All required materials have not been issued yet.'
        });
      }
    }
    // ─────────────────────────────────────────────────────────────

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    // Job Work (Machine only — dropped from Child Part's own pipeline
    // 2026-09-16, see ProductionOrder.js's SUB_CHILD_PART_STEPS comment) —
    // can't start without a team allotted first, and a fresh check that
    // nothing Job Work itself needs is still unreceived. Name-based (not
    // idx===0) since a MachineBOM-driven order's own idx 0 is 'Assembly',
    // not 'Job Work' — see the isMachineBOMPipeline branch right below.
    if (isMachine && procs[idx].step === 'Job Work') {
      if (!procs[idx].assignedTeam) {
        return res.status(400).json({ success: false, message: 'Assign a team to Job Work before starting it.' });
      }
      const unissued = await getUnissuedMaterials(order, req.user.companyId);
      if (unissued.length > 0) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production: ${unissued.join(', ')}.` });
      }
    } else if (isMachine && procs[idx].step === 'Assembly' && isMachineBOMPipeline(procs)) {
      // MachineBOM-driven order's own Assembly — same belt-and-braces
      // assign-time + start-time double-check Job Work's own gate uses,
      // against the new Material List's own live ledger (confirmed with
      // the user 2026-09-17). Team-assignment itself is still covered by
      // the generic stepNeedsTeamGate below (Assembly isn't excluded from
      // it) — only the extra material check is specific to this branch.
      const unissued = getUnissuedMachineBOMMaterials(order);
      if (unissued.length > 0) {
        return res.status(400).json({ success: false, message: `Material not yet received in Production: ${unissued.join(', ')}.` });
      }
    }

    // Generalized twin of the two branches above, for a dynamic Process
    // Definition step (2026-09-23, extended same day to resolve full rows
    // instead of a bare boolean — see resolveStepMaterialLines's own
    // comment). A safe no-op for anything already covered by name above
    // (legacy steps never carry materialRefs). materialLines is captured
    // here (not just the issuance boolean) so it can be committed further
    // down, once every other gate for this step has passed — see
    // commitStepMaterialConsumption's own call site below.
    const materialLines = await resolveStepMaterialLines(order, procs[idx], req.user.companyId);
    const unissuedMaterialLines = materialLines.filter(l => l.demandStatus !== 'Issued').map(l => l.name);
    if (unissuedMaterialLines.length) {
      return res.status(400).json({ success: false, message: `Material not yet received in Production: ${unissuedMaterialLines.join(', ')}.` });
    }
    // Child Part order — Fabrication (idx 0, the first real step now that
    // Job Work is dropped) runs PER UNIT with its own team, same as every
    // other step (generic stepNeedsTeamGate below). Legacy-shape-only
    // shortfall-check + commit removed 2026-09-24 (the project is still in
    // active development, no need to carry a fallback for an order shape
    // nothing creates anymore) — every Child Part order now goes through
    // the generalized materialLines/commitStepMaterialConsumption path
    // above uniformly, idx 0 included, same as any other step.
    //
    // The OLD "Painting (idx 2) can't Start until QC-approved" check that
    // used to live here (hardcoded to literal index 2, from the fixed
    // Fabrication->Assembly->Painting pipeline) was removed 2026-09-24 —
    // found wrongly firing on a dynamic order's real checkpoint step (which
    // can legitimately sit at index 2 itself, blocking it from ever
    // starting at all). It was also redundant: decideChildPartUnit already
    // sets the checkpoint's own processes[] status to 'Completed' on
    // Approve, so the generic "previous step must be Completed" gate a few
    // lines below already correctly blocks the step AFTER the checkpoint
    // until QC approves it — no separate live QCJob lookup needed.

    // Every step needs a team assigned, EXCEPT Machine's own Job Work/
    // Fabrication (their own dedicated gates above handle those — Job Work
    // has its own team+material check together; Fabrication auto-advances
    // with no team of its own, driven by individual Sub Child Part team
    // assignments instead, see SubChildPartQCPanel). A MachineBOM-driven
    // order has neither name, so Assembly IS covered by this generic gate,
    // same as every step after it. Child Part no longer has an idx-0
    // exception (removed 2026-09-24 along with the legacy Fabrication-
    // specific block above) — every one of its steps, idx 0 included, needs
    // a team the same way now.
    const stepNeedsTeamGate = isChildPart || !['Job Work', 'Fabrication'].includes(procs[idx].step);
    if (stepNeedsTeamGate && !procs[idx].assignedTeam) {
      return res.status(400).json({ success: false, message: `Assign a team to ${procs[idx].step} before starting it.` });
    }

    // Gate: previous step (of this same unit) must be completed. Child
    // Part's Fabrication (idx 0) has no predecessor to check at all now
    // (Job Work is gone) — the old Machine-only "Sub Child Part Fabrication
    // has no real previous step" carve-out is no longer needed either,
    // since idx>0 already excludes it. Message reads the real procs[]
    // step names directly, not stepsForKind(order.orderKind)[idx] — that
    // static lookup can't tell a MachineBOM-driven order's real shape from
    // an old-RDBOM one (both share orderKind:'Machine').
    if (idx > 0 && procs[idx - 1].status !== 'Completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start ${procs[idx].step}: ${procs[idx - 1].step} not yet completed`
      });
    }

    // Bookkeeping, not a gate (2026-09-23) — records this unit's own use of
    // whatever THIS step references, regardless of `enough`, same as
    // commitSubChildPartUnitConsumption never checking it either. Keeps
    // "on floor" accurate for the NEXT unit's own pass through this same
    // step, across however many material-referencing steps a dynamic order
    // has (see resolveStepMaterialLines's own comment) — not just the
    // legacy Fabrication-only case.
    if (materialLines.length) commitStepMaterialConsumption(order, materialLines);

    procs[idx].status = 'In Progress';
    procs[idx].startDate = today(); // Assuming today() is defined in your file
    procs[idx].startedAt = new Date(); // precise timestamp, see ProcessStepSchema comment
    order.status = 'In Progress';

    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markProcessComplete = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    const proc = procs[idx];

    // ── Child Part order — its own trimmed pipeline (Fabrication →
    // Assembly → Painting, Job Work dropped 2026-09-16), one build per
    // physical unit. Fabrication pauses at 'QC Pending' for the generic
    // self-certify Approve rubber-stamp (approveQC), same as every other
    // order kind's own steps. Assembly and Painting are NOT completable
    // through this generic endpoint (redesigned 2026-09-19 — the old
    // Start -> Mark Complete -> generic self-certify Approve QC -> only
    // THEN the real checklist unlocked flow was backwards busywork: nothing
    // downstream ever read Assembly's own qcStatus/qcBy, the self-certify
    // step existed only to unlock the real Initial/Process checklist panel).
    // Assembly's real completion now happens by submitting its Process
    // checklist (saveChildPartUnitChecklist) — Start there directly once
    // this step is In Progress. Painting needs a real cost entry and stock
    // credit, done through the dedicated completeChildPartUnitPainting
    // action instead (see below), which also checks allUnitsCompleted
    // itself once it's done.
    if (order.orderKind === 'ChildPart') {
      if (proc.status !== 'In Progress') {
        return res.status(400).json({ success: false, message: `${proc.step} is not in progress.` });
      }
      if (proc.step === 'Painting') {
        return res.status(400).json({ success: false, message: 'Complete Painting through the cost-capture action, not this endpoint.' });
      }
      if (proc.step === 'Assembly') {
        return res.status(400).json({ success: false, message: "Complete Assembly by submitting this unit's Process QC checklist, not this endpoint." });
      }

      // Stage 3b (2026-09-23) — a real dynamic Process Definition (a BOM-
      // configured qcRequired flag, not this legacy 3-step fallback) never
      // literally names its checkpoint "Assembly" or its last step
      // "Painting", so the two refusals above alone don't catch it. Same
      // generalization as the fallback further down this function: the
      // checkpoint completes via its own QC-checklist endpoint
      // (decideChildPartUnit decides it), the true last step (when it
      // isn't also the checkpoint) via the new cost-capture action, and
      // every OTHER step — no QC gate at all once a real checkpoint exists
      // — straight to Completed.
      const cpIdx = qcCheckpointIndex(order, procs);
      if (cpIdx !== -1) {
        if (idx === cpIdx) {
          return res.status(400).json({ success: false, message: "Complete this step by submitting its QC checklist, not this endpoint." });
        }
        if (idx === procs.length - 1) {
          return res.status(400).json({ success: false, message: 'Complete this final step through the cost-capture action, not this endpoint.' });
        }
        proc.status = 'Completed';
        proc.endDate = today();
        proc.completedAt = new Date();
        // No auto-advance of the next step (2026-09-24, fixed — found live:
        // completing this step was silently skipping team-assignment AND
        // the startProcess gate for whatever came next, checkpoint or not,
        // since a step already sitting at 'In Progress' never goes through
        // startProcess at all). The next step just stays 'Pending' — already
        // "unlocked" via the existing canStart (prior step Completed) check
        // on the frontend, so it falls through to the exact same Assign
        // Team -> Start flow every order's own first step already uses.
        // An Outsourcing next step was already excluded from auto-advance
        // before this fix and needed no further change — its status is (and
        // always was) driven entirely by its own hand-off lifecycle
        // (requestOutsourceHandoff/receiveOutsourceHandoffRound), never by
        // the previous step completing.
        await order.save();
        await order.populate('processes.assignedTeam', 'name supervisor members');
        await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
        return res.json({ success: true, data: order });
      }

      proc.status = 'QC Pending';
      proc.endDate = today();
      proc.completedAt = new Date();
      await order.save();
      await order.populate('processes.assignedTeam', 'name supervisor members');
      await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
      return res.json({ success: true, data: order });
    }

    if (proc.step === 'Fabrication') {
      // Real gate now — every Sub Child Part on the shared QCJob must be QC-
      // Approved (see SubChildPartQCPanel/decidePartCheck), replacing the
      // old subEntries-based check (2026-09-02) which nothing populates
      // anymore now that Fabrication's own Assign Team/Start are gone.
      // ensureQCJobForOrder (not a bare findOne) so a manufactured product
      // whose Parts QC panel nobody's opened yet still gets its partChecks
      // seeded and correctly gated here, rather than reading an empty array
      // and wrongly treating "never touched" the same as "nothing to check".
      const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
      const partChecks = qcJob.partChecks || [];
      // partChecks only ever gets seeded from the OLD RDChildPart tree
      // (ensurePartChecksStructure) — a MachineBOM-driven order (the new
      // hierarchy) has none, by design: every Child Part it references
      // already passed its own independent QC before ever being issued to
      // this order (see Child Part's own Fabrication -> Assembly -> QC ->
      // Painting pipeline), so there's nothing left to individually check
      // here (confirmed with the user 2026-09-17). Only take the
      // auto-complete shortcut below when there actually were real parts
      // individually reviewed; otherwise fall through to the same plain
      // QC Pending / self-certify Approve step every other stage already
      // uses — skipping straight to 'Completed' with a fabricated
      // "Sub Child Part QC" label would misrecord a step nothing actually
      // reviewed.
      if (partChecks.length > 0) {
        if (partChecks.some(p => p.status !== 'Approved')) {
          return res.status(400).json({ success: false, message: 'All Sub Child Parts must be QC-approved before marking Fabrication as complete.' });
        }
        // Every Sub Child Part already went through its own individual QC
        // decision (decidePartCheck) — a further whole-stage Approve/Reject QC
        // click here would just be redundant, and worse, would let someone
        // reject a stage whose every part already individually passed. So
        // unlike every other step, Fabrication skips 'QC Pending' and the
        // separate approveQC/rejectQC step entirely, completing immediately
        // once the gate above passes — the parent-level QC flow was meant to
        // be fully retired here, not just Assign Team/Start (corrected
        // 2026-09-02, this half was missed the first time).
        proc.status = 'Completed';
        proc.qcStatus = 'Approved';
        proc.qcBy = 'Sub Child Part QC';
        proc.qcDate = today();
        proc.endDate = today();
        proc.completedAt = new Date();
        if (allUnitsCompleted(order)) {
          order.status = 'Completed';
        }
        await order.save();
        await order.populate('processes.assignedTeam', 'name supervisor members');
        await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
        return res.json({ success: true, data: order });
      }
      // No individual parts to check — fall through to the generic QC
      // Pending / approveQC self-certify path below, same as every other step.
    }

    // MachineBOM-driven order's own Assembly (the new pipeline's first
    // step) — no self-certify QC step at all, unlike every other step here.
    // There's nothing individual to review (this order's Child Parts were
    // each already QC'd on their own pipeline before reaching this order —
    // see the Fabrication branch's own comment above for the same
    // reasoning), and unlike the old Fabrication branch this never fakes a
    // qcStatus/qcBy label for work nobody actually reviewed — they're left
    // at their schema defaults. Confirmed with the user 2026-09-17: Assembly
    // is just assign-team + material-check + start + work + Mark Complete,
    // straight to Completed, no Approve/Reject dialog. Production starts
    // Final Testing explicitly afterward — no auto-advance, unlike the old
    // Fabrication's own no-manual-start special case.
    if (proc.step === 'Assembly' && isMachineBOMPipeline(procs)) {
      if (proc.status !== 'In Progress') {
        return res.status(400).json({ success: false, message: 'Assembly is not in progress.' });
      }
      proc.status = 'Completed';
      proc.endDate = today();
      proc.completedAt = new Date();
      await order.save();
      await order.populate('processes.assignedTeam', 'name supervisor members');
      await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
      return res.json({ success: true, data: order });
    }

    // Final Testing has no separate "Mark Complete" anymore (redesigned
    // 2026-09-19, same vestigial-self-certify problem already fixed for
    // Child Part's Assembly the same day) — submitting the checklist
    // (saveFinalChecklist) IS what sends this unit to QC now, cost/expense
    // included on the first submit. Refused here so this generic endpoint
    // can't be used to route around that.
    if (proc.step === 'Final Testing') {
      return res.status(400).json({ success: false, message: "Complete Final Testing by submitting its checklist, not this endpoint." });
    }

    // Stage 3b (2026-09-23) — same generalization as the ChildPart branch
    // above, for every other order kind (Machine, Sub Child Part). Only
    // engages for a real dynamic checkpoint (qcCheckpointIndex !== -1);
    // every legacy hardcoded-pipeline order (nothing flagged, not Sub Child
    // Part) falls straight through to the unchanged generic QC Pending
    // self-certify path below, exactly as before this change.
    const dynCpIdx = qcCheckpointIndex(order, procs);
    if (dynCpIdx !== -1) {
      if (idx === dynCpIdx) {
        return res.status(400).json({
          success: false,
          message: proc.type === 'Outsourcing'
            ? 'This step is completed by submitting its QC checklist (once Purchase has received the hand-off), not here.'
            : "Complete this step by submitting its QC checklist, not this endpoint.",
        });
      }
      if (idx === procs.length - 1) {
        return res.status(400).json({ success: false, message: 'Complete this final step through the cost-capture action, not this endpoint.' });
      }
      proc.status = 'Completed';
      proc.endDate = today();
      proc.completedAt = new Date();
      // No auto-advance of the next step (2026-09-24, fixed) — see the
      // matching comment in the ChildPart branch above for the full
      // reasoning; same fix, same rationale, for every other order kind.
      await order.save();
      await order.populate('processes.assignedTeam', 'name supervisor members');
      await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
      return res.json({ success: true, data: order });
    }

    proc.status = 'QC Pending';
    proc.endDate = today();
    proc.completedAt = new Date(); // precise timestamp, see ProcessStepSchema comment
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const approveQC = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { qcBy } = req.body;
    if (!qcBy) return res.status(400).json({ success: false, message: 'qcBy is required' });

    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    // Assembly no longer has a self-certify QC step at all (redesigned
    // 2026-09-19 — see markProcessComplete's own matching refusal); it
    // completes automatically when saveChildPartUnitChecklist's Process
    // stage is submitted. Blocked here too since this generic endpoint
    // isn't otherwise scoped by orderKind/step.
    if (order.orderKind === 'ChildPart' && procs[idx]?.step === 'Assembly') {
      return res.status(400).json({ success: false, message: "Assembly completes automatically when its Process QC checklist is submitted — there's nothing to approve here." });
    }

    // Final Testing also has no self-certify QC step anymore (redesigned
    // 2026-09-19, same reasoning as the Assembly block above) — it completes
    // automatically when saveFinalChecklist's checklist is submitted (cost/
    // expense captured there too, once, on the first submission), and the
    // REAL decision is QC's own review (qcController.js's submitDecision),
    // not Production self-certifying here. idx===procs.length-1 is always
    // 'Final Testing' for every real Machine pipeline shape (old 6-step or
    // the new 2-step MachineBOM one), so blocking it by name here also
    // means this function's own isFinalStep/order-completion machinery
    // below it can never actually fire anymore for any real order kind —
    // left in place as a harmless, inert fallback rather than deleted, in
    // case some order shape not accounted for here ever reaches it.
    if (procs[idx]?.step === 'Final Testing') {
      return res.status(400).json({ success: false, message: "Final Testing completes automatically when its checklist is submitted, and is decided by QC's own review — there's nothing to approve here." });
    }

    // Stage 3b (2026-09-23) — a dynamic Process Definition's real QC
    // checkpoint (qcCheckpointIndex) is decided by the real QC department
    // (submitDecision, or decideChildPartUnit for Child Part), never
    // self-certified here — same reasoning as the two name-matched refusals
    // above, just position-based instead of literal-name so it also covers
    // whatever R&D actually named the flagged step. No-op for a legacy
    // order with nothing flagged (qcCheckpointIndex returns -1 there).
    if (qcCheckpointIndex(order, procs) === idx) {
      return res.status(400).json({ success: false, message: "This step's QC checkpoint is decided by QC's own review, not self-certified here." });
    }

    const wasCompleted = order.status === 'Completed';
    procs[idx].status = 'Completed';
    procs[idx].qcStatus = 'Approved';
    procs[idx].qcBy = qcBy;
    procs[idx].qcDate = today();
    // Machine order: Fabrication no longer has its own manual Start
    // (2026-09-02) — work now begins per Sub Child Part (SubChildPartQCPanel),
    // independent of the stage itself needing an explicit start click. The
    // moment the step immediately before it (always Job Work today)
    // completes, Fabrication auto-advances to In Progress so that panel —
    // gated on status !== 'Pending' — actually renders. A Sub Child Part
    // order's Fabrication is per-unit and DOES have a manual Start (with a
    // material gate), so it must not auto-advance.
    if (order.orderKind !== 'ChildPart' && procs[idx + 1]?.step === 'Fabrication' && procs[idx + 1].status === 'Pending') {
      procs[idx + 1].status = 'In Progress';
      procs[idx + 1].startDate = today();
      procs[idx + 1].startedAt = new Date();
    }
    // Order is only fully Completed once every step of every unit (main +
    // extraUnits) is done — for single-quantity orders this is identical to
    // the original "all processes complete" check.
    if (allUnitsCompleted(order)) {
      order.status = 'Completed';
    }
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');

    // (firstBuiltAt + BOM production cost/pricing used to be pushed here,
    // gated on isFinalStep — removed 2026-09-19, since Final Testing is
    // refused above before ever reaching this point now. That push happens
    // once, at saveFinalChecklist's first submission, via
    // applyManufacturedFinalCost — see that function's own comment.)

    // Lead-time sampling / Dispatch notification / Sale status / QCJob
    // creation — extracted into finalizeMachineOrderCompletion (Stage 3b,
    // 2026-09-23) so completeFinalProcessStep can reuse the exact same
    // logic for the other place a Machine order can now reach
    // allUnitsCompleted. Only on the transition into Completed, never on a
    // later re-save.
    if (order.status === 'Completed' && !wasCompleted) {
      await finalizeMachineOrderCompletion(order, qcBy, req.user._id);
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const rejectQC = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { qcBy, reason } = req.body;
    if (!qcBy) return res.status(400).json({ success: false, message: 'qcBy is required' });
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const proc = procs[idx];
    // Final Testing is decided by QC's own review (qcController.js's
    // submitDecision), not Production rejecting their own submission —
    // redesigned 2026-09-19, same reasoning as approveQC's own refusal.
    // reopenFinalTestingForRejection already handles the real reopen once
    // QC actually fails it.
    if (proc?.step === 'Final Testing') {
      return res.status(400).json({ success: false, message: "Final Testing is decided by QC's own review, not this endpoint." });
    }
    // Stage 3b — same position-based twin of approveQC's own refusal above.
    if (qcCheckpointIndex(order, procs) === idx) {
      return res.status(400).json({ success: false, message: "This step's QC checkpoint is decided by QC's own review, not this endpoint." });
    }
    proc.status = 'In Progress';
    proc.qcStatus = 'Rejected';
    proc.qcBy = qcBy;
    proc.qcDate = today();
    proc.notes = reason || proc.notes;
    proc.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy });
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/production-mfg/orders/:id/qc-checkpoint/submit?unit=N — Stage 3b
// (2026-09-23). Production's self-check + submit for the ONE real QC
// checkpoint (qcCheckpointIndex), generalizing saveFinalChecklist/
// saveSubChildPartChecklist/saveChildPartUnitChecklist's "Process" stage
// into one endpoint driven by position instead of by which of those three
// hardcoded flows this particular order happens to use. Only valid for an
// In-House-typed checkpoint — an Out Source one has no self-check layer at
// all (see the Stage 3b plan's design recap); it's completed by Purchase
// receiving the hand-off instead (outsourceWorkController.js's
// receiveOutsourceHandoffRound already creates the QCJob for that case).
//
// Cost/expense is a SEPARATE position from the checkpoint (see the plan's
// worked example: a coating checkpoint mid-sequence, cost captured later on
// post-painting, the true last step) — only required here when the
// checkpoint happens to BE the true last step (Sub Child Part, always;
// Child Part/Machine, only when R&D flagged the last step). Otherwise it's
// captured later by completeFinalProcessStep below.
// GET /api/production-mfg/orders/:id/qc-checkpoint?unit=N — Stage 3b
// (2026-09-23). Resolves where THIS order's one real QC checkpoint sits and
// returns whatever the frontend needs to render it, generically: which
// shape to render (Child Part's staged unitChecks[] vs the flat one-stage
// checklist Sub Child Part/Machine share), whether cost/expense is due here
// or later (isTrueLastStep), and the current rows/fill state. Ensures the
// QCJob exists (same ensureQCJobForOrder every other checklist GET uses) so
// opening this panel is enough to seed it, same as today's getFinalChecklist/
// getSubChildPartChecklist.
export const getQcCheckpoint = async (req, res) => {
  try {
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });

    const cpIdx = qcCheckpointIndex(order, procs);
    if (cpIdx === -1) return res.json({ success: true, data: { checkpointIndex: -1 } });
    const proc = procs[cpIdx];
    const isTrueLastStep = cpIdx === procs.length - 1;

    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);

    // Per-unit Machine (2026-09-24) — same unitChecks[] entry shape as Child
    // Part below, but single-stage: Machine's own checklist is Product
    // Master's one flat Final stage (flatModuleStageForItem), not Child
    // Part's Initial/Process pair, so it lives in the entry's process[]
    // alone. Rows resolved fresh and merged with whatever this unit already
    // saved, exactly like the Child Part merge.
    if (order.orderKind === 'Machine') {
      const entry = qcJob.unitChecks.find(u => u.unitNumber === unitNumber);
      let mergedEntry = entry ? entry.toObject() : null;
      if (mergedEntry) {
        const masterRows = await resolveFlatChecklistRows(qcJob, req.user.companyId);
        const savedByParam = new Map((mergedEntry.process || []).map(r => [r.parameter, r]));
        mergedEntry.process = masterRows.map(r => {
          const found = savedByParam.get(r.parameter);
          return found ? { type: 'checkbox', qcStatus: 'Pending', qcRemarks: '', ...found } : r;
        });
      }
      return res.json({
        success: true,
        data: {
          checkpointIndex: cpIdx, step: proc.step, type: proc.type, isTrueLastStep,
          shape: 'unitChecks', singleStage: true, entry: mergedEntry,
        },
      });
    }

    if (order.orderKind === 'ChildPart') {
      const entry = qcJob.unitChecks.find(u => u.unitNumber === unitNumber);
      // Fixed 2026-09-24 — found live: this used to return entry.initial/
      // entry.process exactly as stored, which is empty forever for a
      // never-yet-opened unit. ensureUnitChecksStructure only seeds the bare
      // {unitNumber} skeleton on purpose ("Row-level Initial/Process
      // definitions are resolved separately, lazily, the first time
      // Production actually opens ONE unit's checklist — see
      // getChildPartUnitChecklistRows") — but Production no longer opens
      // that OLD endpoint at all now that this one (Stage 3b) replaced it,
      // so that lazy resolution never happened for the new flow. Same fix:
      // resolve both stages' real rows from R&D's QCMasterChecklist here
      // too, merged with whatever's already been saved — identical merge
      // getChildPartUnitChecklistRows itself already does.
      let mergedEntry = entry ? entry.toObject() : null;
      if (mergedEntry) {
        const mergeStage = async (stage) => {
          const masterRows = await resolveChildPartUnitChecklistRows(order.subChildPartItem, stage, req.user.companyId);
          const savedByParam = new Map((mergedEntry[stage] || []).map(r => [r.parameter, r]));
          mergedEntry[stage] = masterRows.map(r => {
            const found = savedByParam.get(r.parameter);
            return found ? { type: 'checkbox', qcStatus: 'Pending', qcRemarks: '', ...found } : r;
          });
        };
        await mergeStage('initial');
        await mergeStage('process');
      }
      return res.json({
        success: true,
        data: {
          checkpointIndex: cpIdx, step: proc.step, type: proc.type, isTrueLastStep,
          shape: 'unitChecks', entry: mergedEntry,
        },
      });
    }

    if (!qcJob.checklist?.length) await ensureFlatChecklist(qcJob, req.user.companyId);
    return res.json({
      success: true,
      data: {
        checkpointIndex: cpIdx, step: proc.step, type: proc.type, isTrueLastStep,
        shape: 'flat', rows: qcJob.checklist, filledBy: qcJob.finalCheckFilledBy, filledAt: qcJob.finalCheckFilledAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitQcCheckpoint = async (req, res) => {
  try {
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });

    const cpIdx = qcCheckpointIndex(order, procs);
    if (cpIdx === -1) return res.status(400).json({ success: false, message: 'This order has no QC checkpoint configured.' });
    const proc = procs[cpIdx];
    // Design changed 2026-09-24 (see the discussion doc's own section):
    // Production DOES self-check + submit an Out Source checkpoint now,
    // same as an In-House one — just not until Purchase has actually
    // received the hand-off back (proc.status stays 'Pending' until then,
    // see receiveOutsourceHandoffRound/markProcessComplete's own auto-
    // advance, so the `!== 'In Progress'` check below already covers most
    // of this — this explicit check is the clearer, type-aware message).
    // Cost/expense captured here is Production's own (labor, etc) — the
    // vendor's own total cost is a separate, deferred Purchase-side field
    // (OutsourceHandoffSchema.costTotal) not wired into this yet.
    if (proc.type === 'Outsourcing' && proc.outsourceStatus !== 'Received') {
      return res.status(400).json({ success: false, message: 'This checkpoint is an Out Source step — Purchase must receive the hand-off before it can be submitted for QC.' });
    }
    if (proc.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: `${proc.step} is not in progress.` });
    }

    const isTrueLastStep = cpIdx === procs.length - 1;
    const toNonNegNumber = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
    const productionCost = toNonNegNumber(req.body.productionCost);
    const productionExpense = toNonNegNumber(req.body.productionExpense);

    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);

    if (order.orderKind === 'ChildPart' || order.orderKind === 'Machine') {
      // Same staged Initial/Process shape saveChildPartUnitChecklist
      // already uses, resolved off the dynamic checkpoint position instead
      // of a hardcoded 'Assembly' — same unitChecks[] entry that function
      // seeds via ensureUnitChecksStructure. A per-unit Machine (2026-09-24)
      // shares this whole path single-stage: only 'process' exists for it
      // (see getQcCheckpoint), no Initial prerequisite — every unit is
      // submitted and decided on its own, so there's no shared checklist
      // for one unit to overwrite another's (the old flat-path guard
      // against that, new-bom-hierarchy-bug-fixes.md #10, isn't needed here).
      const singleStage = order.orderKind === 'Machine';
      const { results } = req.body;
      const stage = singleStage ? 'process' : req.body.stage;
      if (!['initial', 'process'].includes(stage)) return res.status(400).json({ success: false, message: "stage must be 'initial' or 'process'" });
      if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
      if (singleStage && results.some(r => r.status === 'Pending')) {
        return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before submitting.' });
      }
      const entry = qcJob.unitChecks.find(u => u.unitNumber === unitNumber);
      if (!entry) return res.status(404).json({ success: false, message: 'No checklist entry for this unit yet.' });
      if (!singleStage && stage === 'process' && entry.initial.some(c => c.status === 'Pending')) {
        return res.status(400).json({ success: false, message: 'Complete the Initial checklist for this unit before Process.' });
      }
      if (!['Awaiting Production', 'Rejected'].includes(entry.status)) {
        return res.status(400).json({ success: false, message: `This unit is currently ${entry.status} — it can't be edited right now.` });
      }
      if (stage === 'process' && isTrueLastStep && (productionCost === undefined || productionExpense === undefined)) {
        return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required to submit this checkpoint.' });
      }
      entry[stage] = results.map(r => ({ parameter: r.parameter, standardValue: r.standardValue || '', type: r.type === 'value' ? 'value' : 'checkbox', actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' }));
      if (stage === 'process') {
        entry.status = 'QC Pending';
        entry.producedBy = req.user.fullName || req.user.username || 'Production';
        entry.producedAt = new Date();
        entry.rejectReason = '';
        if (isTrueLastStep) {
          entry.pendingProductionCost = productionCost;
          entry.pendingProductionExpense = productionExpense;
        }
        proc.status = 'QC Pending';
        proc.endDate = today();
        proc.completedAt = new Date();
      }
      await qcJob.save();
      await order.save();
      await order.populate('processes.assignedTeam', 'name supervisor members');
      await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
      return res.json({ success: true, data: { order, entry } });
    }

    // Sub Child Part — flat one-stage checklist, mirrors
    // saveFinalChecklist/saveSubChildPartChecklist exactly. (Machine used to
    // share this too, until 2026-09-24's per-unit redesign moved it onto the
    // unitChecks path above — one shared checklist + one whole-order QC
    // decision was what sent a whole multi-unit Machine order to packing off
    // Unit 1's mid-sequence checkpoint. Sub Child Part is one build, one
    // decision, so the flat shape still fits it.)
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
    if (results.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before saving.' });
    }
    if (!qcJob.checklist?.length) await ensureFlatChecklist(qcJob, req.user.companyId);
    if (!qcJob.checklist?.length) return res.status(400).json({ success: false, message: 'No QC checklist configured for this item yet.' });

    const isFirstSubmission = !qcJob.finalCheckFilledAt;
    if (isFirstSubmission && isTrueLastStep && (productionCost === undefined || productionExpense === undefined)) {
      return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required on the first submission.' });
    }

    const byParam = new Map(results.map(r => [r.parameter, r]));
    qcJob.checklist = qcJob.checklist.map(row => {
      const r = byParam.get(row.parameter);
      return r ? { parameter: row.parameter, standardValue: row.standardValue, type: row.type, actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' } : row.toObject();
    });
    qcJob.finalCheckFilledBy = req.user.fullName || req.user.username || 'Production';
    qcJob.finalCheckFilledAt = new Date();
    if (isFirstSubmission && isTrueLastStep) {
      qcJob.finalCheckProductionCost = productionCost;
      qcJob.finalCheckProductionExpense = productionExpense;
    }
    if (['Rejected', 'Approved', 'Draft'].includes(qcJob.status)) {
      qcJob.status = 'Pending';
      qcJob.decision = '';
      qcJob.failReason = '';
    }
    await qcJob.save();

    proc.status = 'QC Pending';
    proc.endDate = today();
    proc.completedAt = new Date();
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/production-mfg/orders/:id/processes/:stepIndex/complete-final?unit=N
// Stage 3b (2026-09-23) — completes the TRUE LAST STEP of a dynamic order
// whose QC checkpoint sits earlier in the sequence (Child Part/Machine
// only — Sub Child Part's checkpoint is always the last step by its own
// fixed rule, so it never reaches this). No further QC once the checkpoint
// has already passed, per the design — Production alone finishes this step
// and reports its real cost, mirroring completeChildPartUnitPainting's
// existing pattern exactly (Child Part) or approveQC's now-shared
// finalizeMachineOrderCompletion tail (Machine), just off a derived
// position instead of the literal 'Painting'/'Final Testing' names.
export const completeFinalProcessStep = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const toNonNegNumber = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
    const productionCost = toNonNegNumber(req.body.productionCost);
    const productionExpense = toNonNegNumber(req.body.productionExpense);
    if (productionCost === undefined || productionExpense === undefined) {
      return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required to complete this step.' });
    }
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs || idx >= procs.length) return res.status(400).json({ success: false, message: 'Invalid step index for this order.' });

    const cpIdx = qcCheckpointIndex(order, procs);
    if (cpIdx === -1 || cpIdx === procs.length - 1) {
      return res.status(400).json({ success: false, message: 'This endpoint only applies when a QC checkpoint precedes the true last step.' });
    }
    if (idx !== procs.length - 1) {
      return res.status(400).json({ success: false, message: 'Only the true last step completes through this endpoint.' });
    }
    const proc = procs[idx];
    if (proc.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: `${proc.step} is not in progress.` });
    }

    proc.status = 'Completed';
    proc.qcStatus = 'Approved';
    proc.endDate = today();
    proc.completedAt = new Date();

    if (order.orderKind === 'ChildPart') {
      if (!order.subChildPartItem) return res.status(400).json({ success: false, message: 'This order has no linked Child Part Item.' });
      await recalculateChildPartCost(order.subChildPartItem, req.user.companyId, { productionCost, productionExpense });
      await Item.updateOne({ _id: order.subChildPartItem, companyId: req.user.companyId }, { $inc: { qty: 1 } });
      if (allUnitsCompleted(order)) order.status = 'Completed';
      await order.save();
      await order.populate('processes.assignedTeam', 'name supervisor members');
      await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
      return res.json({ success: true, data: order });
    }

    // Machine — always a per-unit order here (reaching this endpoint at all
    // needs a qcRequired checkpoint, see the cpIdx guard above). Its
    // checkpoint was already QC-approved (the only way it reaches
    // 'Completed' and unlocks the steps after it), so finishing this true
    // last step is what makes THIS unit done — counted as 'Approved from
    // QC' (QC already passed it), not the old whole-order 'Production
    // Completed' the packing gate never accepted (2026-09-24).
    try {
      await applyManufacturedFinalCost(order, productionCost, productionExpense);
    } catch (pricingErr) {
      console.error('❌ Error recalculating item pricing on final-step completion:', pricingErr);
    }
    await completeMachineUnit(order, null, unitNumber, { actorName: req.user.fullName || req.user.username, userId: req.user._id });
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { parentPart, childPart, assignedMember, fabricationType } = req.body;
    if (!parentPart || !childPart || !assignedMember) {
      return res.status(400).json({ success: false, message: 'parentPart, childPart, and assignedMember are required' });
    }
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    procs[idx].subEntries.push({ parentPart, childPart, assignedMember, fabricationType: fabricationType || 'Other' });
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completeSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { subEntryId } = req.params;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const subEntry = procs[idx].subEntries.id(subEntryId);
    if (!subEntry) return res.status(404).json({ success: false, message: 'Sub-entry not found' });

    subEntry.status = 'Completed';
    // Re-submitting (whether first time or after a rejection) always re-enters the QC
    // queue — mirrors markProcessComplete setting the parent step back to 'QC Pending'.
    subEntry.qcStatus = 'Pending';
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const qcSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { subEntryId } = req.params;
    const { qcStatus, qcBy, reason } = req.body;
    const unitNumber = getUnitNumber(req);

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const subEntry = procs[idx].subEntries.id(subEntryId);
    if (!subEntry) return res.status(404).json({ success: false, message: 'Sub-entry not found' });

    subEntry.qcStatus = qcStatus || 'Approved';
    if (subEntry.qcStatus === 'Rejected') {
      subEntry.status = 'Pending';
      subEntry.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy || '' });
    }
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateProcessNotes = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { notes } = req.body;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    procs[idx].notes = notes || '';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TEAMS ────────────────────────────────────────────────────────────────────

export const getTeams = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const teams = await ProductionTeam.find({ company: companyId, isActive: true }).sort({ createdAt: 1 }).lean();

    // All-time per-team assignment counts (total / completed), independent of
    // the active-orders window ManpowerTracking's main board reads `orders`
    // from — without this, a team's lifetime "Completed"/"Total" tallies
    // would incorrectly shrink to only recent activity. Counted via
    // aggregation instead of pulling every order's full documents.
    const companyObjectId = new mongoose.Types.ObjectId(companyId);
    const [mainCounts, extraCounts] = await Promise.all([
      ProductionOrder.aggregate([
        { $match: { company: companyObjectId } },
        { $unwind: '$processes' },
        { $match: { 'processes.assignedTeam': { $ne: null } } },
        { $group: { _id: { team: '$processes.assignedTeam', status: '$processes.status' }, count: { $sum: 1 } } },
      ]),
      ProductionOrder.aggregate([
        { $match: { company: companyObjectId } },
        { $unwind: '$extraUnits' },
        { $unwind: '$extraUnits.processes' },
        { $match: { 'extraUnits.processes.assignedTeam': { $ne: null } } },
        { $group: { _id: { team: '$extraUnits.processes.assignedTeam', status: '$extraUnits.processes.status' }, count: { $sum: 1 } } },
      ]),
    ]);

    const statsByTeam = {};
    for (const { _id, count } of [...mainCounts, ...extraCounts]) {
      const teamId = String(_id.team);
      if (!statsByTeam[teamId]) statsByTeam[teamId] = { total: 0, completed: 0 };
      statsByTeam[teamId].total += count;
      if (_id.status === 'Completed') statsByTeam[teamId].completed += count;
    }

    const teamsWithStats = teams.map(t => ({
      ...t,
      assignmentStats: statsByTeam[String(t._id)] || { total: 0, completed: 0 },
    }));

    res.json({ success: true, data: teamsWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, supervisor, members, skills, efficiency } = req.body;
    if (!name || !supervisor) {
      return res.status(400).json({ success: false, message: 'name and supervisor are required' });
    }
    const team = await ProductionTeam.create({
      name,
      supervisor,
      members: members || [],
      skills: skills || [],
      efficiency: efficiency || 85,
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: team });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
