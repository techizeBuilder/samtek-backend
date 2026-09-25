// Sub Child Part (leaf level, orderKind:'SubChildPart') — In-House Production
// order actions. Deliberately a separate file from productionMfgController.js:
// this flow is a single order-level Assign/Start/Complete cycle, not the
// per-step ProcessStepSchema pipeline every other order kind walks through
// (see ProductionOrder.js's orderKind comment) — so it doesn't naturally
// belong beside the step-indexed functions there. The material-availability
// gate on Start reuses the SAME generic materialDemands[]/Store issue-
// receive-return handshake every other order kind already uses (see
// server/controllers/inventoryController.js's transfer/receive endpoints —
// none of them check orderKind) — no new material-handshake code needed.
import ProductionOrder from '../models/ProductionOrder.js';
import QCJob from '../models/QCJob.js';
import { Item } from '../models/Inventory.js';
import { ensureQCJobForOrder } from './productionMfgController.js';
import { ensureFlatChecklist } from '../services/qcChecklistPullService.js';
import { captureSubChildPartActualCost } from './subChildPartMasterController.js';
import { buildSubChildPartRawMaterialList, requestSubChildPartRawMaterial } from '../services/subChildPartOrderService.js';

async function resolveOrder(req, res) {
  const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }
  if (order.orderKind !== 'SubChildPart') {
    res.status(400).json({ success: false, message: 'This action is only valid for a Sub Child Part order.' });
    return null;
  }
  return order;
}

// PUT /api/production-mfg/orders/:id/sub-child-part/assign-team
export const assignSubChildPartOrderTeam = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    const { teamId } = req.body;
    order.assignedTeam = teamId || null;
    await order.save();
    await order.populate('assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/production-mfg/orders/:id/sub-child-part/material-list —
// this order's own Material List (always exactly one row — a Sub Child
// Part's own BOM is exactly one raw material line, see
// subChildPartOrderService.js's own header comment). Mirrors Child Part's/
// Machine's own Material List endpoints one tier down — same
// {categories:[{name, materials:[...]}]} shape, same frontend table.
export const getSubChildPartRawMaterialListController = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    const data = await buildSubChildPartRawMaterialList(order, req.user.companyId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/production-mfg/orders/:id/sub-child-part/material-request —
// Production's "Issue" action on the Material List above. The order is
// created with an empty materialDemands[] (see subChildPartOrderService.js's
// runSubChildPartOrderSweep) specifically so Store's Pending Transfers stays
// empty until Production is actually ready for the material — this is when
// this order's single demand first comes into existence (or grows, on a
// later Issue click). No Purchase Request side effect here — that already
// happened at order-creation time; this just seeds/grows Store's copy of
// the need, capped at the row's real total (requestSubChildPartRawMaterial,
// subChildPartOrderService.js — direct mirror of Child Part's/Machine's own
// requestXMaterial one tier down).
export const requestSubChildPartOrderMaterial = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    const { demandKey, requestQuantity } = req.body;
    const result = await requestSubChildPartRawMaterial(order, req.user.companyId, demandKey, requestQuantity);
    if (!result.ok) return res.status(result.code).json({ success: false, message: result.message });
    res.json({ success: true, message: 'Material request sent to Store.', data: result.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/production-mfg/orders/:id/sub-child-part/start
export const startSubChildPartOrder = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    if (order.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Order is already ${order.status}.` });
    }
    if (!order.assignedTeam) {
      return res.status(400).json({ success: false, message: 'Assign a team before starting this order.' });
    }
    const demand = order.materialDemands[0];
    if (!demand || demand.status !== 'Issued') {
      return res.status(400).json({ success: false, message: 'The raw material must be fully issued by Store before starting this order.' });
    }
    order.status = 'In Progress';
    order.startedAt = new Date();
    await order.save();
    await order.populate('assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/production-mfg/orders/:id/sub-child-part/checklist — mirrors
// productionMfgController.js's getFinalChecklist field-for-field (same
// shared QCJob.checklist[] shape, same lazy-pull-via-ensureFlatChecklist
// convention), just resolved through a Sub Child Part order instead of a
// processes[]-shaped one. Ensures the QCJob exists (source:
// 'SubChildPartProduction', see productionMfgController.js's
// qcJobSourceForOrder) the first time Production opens this panel.
export const getSubChildPartChecklist = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    if (!qcJob.checklist?.length && await ensureFlatChecklist(qcJob, req.user.companyId)) await qcJob.save();
    res.json({ success: true, data: { rows: qcJob.checklist, filledBy: qcJob.finalCheckFilledBy, filledAt: qcJob.finalCheckFilledAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/production-mfg/orders/:id/sub-child-part/checklist — mirrors
// productionMfgController.js's saveFinalChecklist exactly (same lock-once-
// QC-has-started-reviewing guard, same reset-QCJob-to-Pending-on-resave-
// after-rejection convention — the automatic "resubmit", no separate manual
// action), just without any step-index/processes[] involvement.
export const saveSubChildPartChecklist = async (req, res) => {
  try {
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ success: false, message: 'results is required' });
    if (results.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before saving.' });
    }
    const order = await resolveOrder(req, res);
    if (!order) return;
    const qcJob = await QCJob.findOne({ source: 'SubChildPartProduction', sourceRefId: order.orderId, company: req.user.companyId });
    if (!qcJob) return res.status(404).json({ success: false, message: 'Open the checklist first.' });
    if (!qcJob.checklist?.length) return res.status(400).json({ success: false, message: 'No QC checklist configured for this Sub Child Part yet.' });

    const qcStartedReviewing = qcJob.checklist.some(c => c.qcStatus !== 'Pending');
    const lockedFromProduction = qcJob.status === 'Approved'
      || (qcJob.status === 'In Progress' && qcStartedReviewing);
    if (lockedFromProduction) {
      return res.status(400).json({ success: false, message: `QC has already reviewed this checklist (status: ${qcJob.status}) — it can't be changed from Production anymore.` });
    }
    const wasRejected = qcJob.status === 'Rejected';

    const byParam = new Map(results.map(r => [r.parameter, r]));
    qcJob.checklist = qcJob.checklist.map(row => {
      const r = byParam.get(row.parameter);
      return r ? { parameter: row.parameter, standardValue: row.standardValue, type: row.type, actualValue: r.actualValue || '', status: r.status, remarks: r.remarks || '' } : row.toObject();
    });
    qcJob.finalCheckFilledBy = req.user.fullName || req.user.username || 'Production';
    qcJob.finalCheckFilledAt = new Date();
    if (wasRejected) {
      qcJob.status = 'Draft';
      qcJob.decision = '';
      qcJob.failReason = '';
    }
    await qcJob.save();
    res.json({ success: true, data: { rows: qcJob.checklist, filledBy: qcJob.finalCheckFilledBy, filledAt: qcJob.finalCheckFilledAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/production-mfg/orders/:id/sub-child-part/submit-qc — replaces the
// old direct-complete-and-credit-stock action. Now sends the finished
// quantity to QC instead: requires the checklist fully filled and a real
// Job Work Cost total (captured the exact same way Purchase's own final
// receive already does — see captureSubChildPartActualCost — a fresh
// Materials Cost pull included). Stock is only credited once QC actually
// approves (qcController.js's submitDecision, source:
// 'SubChildPartProduction' branch).
export const submitSubChildPartOrderToQC = async (req, res) => {
  try {
    const order = await resolveOrder(req, res);
    if (!order) return;
    if (order.status !== 'In Progress') {
      return res.status(400).json({ success: false, message: 'Order must be In Progress to submit.' });
    }

    const qcJob = await ensureQCJobForOrder(order, req.user.fullName || req.user.username, req.user._id);
    if (!qcJob.checklist?.length || qcJob.checklist.some(c => c.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Complete the QC checklist before submitting to QC.' });
    }

    if (qcJob.status === 'Draft') {
      qcJob.status = 'Pending';
      await qcJob.save();
    }

    const totalJobWorkCost = Number(req.body.totalJobWorkCost);
    if (!(totalJobWorkCost > 0)) {
      return res.status(400).json({ success: false, message: 'Enter the total job work cost for this order before submitting to QC.' });
    }
    if (!order.subChildPartItem) {
      return res.status(400).json({ success: false, message: 'This order has no linked Sub Child Part Item.' });
    }
    const item = await Item.findById(order.subChildPartItem);
    const sourceItem = item ? await Item.findById(item.subChildPartDetails?.sourceItem) : null;
    if (!item || !sourceItem) {
      return res.status(404).json({ success: false, message: 'Sub Child Part or its source material Item no longer exists.' });
    }
    await captureSubChildPartActualCost(item, sourceItem, totalJobWorkCost, order.orderQuantity);

    order.status = 'Pending QC';
    await order.save();
    await order.populate('assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
