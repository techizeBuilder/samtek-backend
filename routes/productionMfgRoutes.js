import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getOrders,
  getActiveOrders,
  getTeamOrderHistory,
  createOrder,
  verifyBOM,
  verifyDesign,
  raiseRDRequest,
  getBomDesignStatus,
  getSubChildPartMaterialList,
  requestSubChildPartMaterialController,
  getMachineMaterialList,
  requestMachineMaterialController,
  getSubChildPartJobWork,
  getStepMaterialStatusController,
  addMaterialDemand,
  updateMaterialStatus,
  assignTeam,
  startProcess,
  markProcessComplete,
  approveQC,
  rejectQC,
  updateProcessNotes,
  getTeams,
  createTeam,
  receiveMaterialInProduction,
  getMaterialList,
  issueMaterialToStore,
  returnMaterialToStore,
  downloadMaterialListPDF,
  addSubEntry,
  completeSubEntry,
  qcSubEntry,
  decideRework,
  decideRepair,
  getRepairJobs,
  startRepair,
  completeRepair,
  getPartsQC,
  getPartChecklistRows,
  savePartChecklist,
  assignPartTeam,
  startPart,
  getChildPartUnitChecklistRows,
  saveChildPartUnitChecklist,
  completeChildPartUnitPainting,
  getFinalChecklist,
  saveFinalChecklist,
  getQcCheckpoint,
  submitQcCheckpoint,
  completeFinalProcessStep,
} from '../controllers/productionMfgController.js';
import {
  assignSubChildPartOrderTeam,
  startSubChildPartOrder,
  getSubChildPartChecklist,
  saveSubChildPartChecklist,
  submitSubChildPartOrderToQC,
  requestSubChildPartOrderMaterial,
  getSubChildPartRawMaterialListController,
} from '../controllers/subChildPartOrderMfgController.js';

const router = express.Router();

router.use(authenticateToken);

// General order/production-run lifecycle (BOM/design verification, material
// issuance, QC rework/repair decisions, process-step execution & team
// assignment) maps to the 'orders' feature — the closest general fit per the
// 'production' module's grantable catalogue (orders, repairProduction,
// workPlanning, processQc, jobCards, manpower, expenses, lms). WorkPlanning /
// ProcessExecution / JobCards frontend pages all share this same
// ProductionContext and these same endpoints rather than owning dedicated
// routes of their own, so there is no more specific key to split them into.
const ordersView = checkPermission('production', 'orders', 'view');
const ordersAdd = checkPermission('production', 'orders', 'add');
const ordersEdit = checkPermission('production', 'orders', 'edit');

const repairView = checkPermission('production', 'repairProduction', 'view');
const repairEdit = checkPermission('production', 'repairProduction', 'edit');

// Teams = production manpower/workforce groups (managed from the Manpower
// Tracking page) — a clearly more specific fit than 'orders'.
const manpowerView = checkPermission('production', 'manpower', 'view');
const manpowerAdd = checkPermission('production', 'manpower', 'add');

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders', ordersView, getOrders);
router.get('/orders/active', ordersView, getActiveOrders);
router.post('/orders', ordersAdd, createOrder);
router.put('/orders/:id/verify-bom', ordersEdit, verifyBOM);
router.put('/orders/:id/verify-design', ordersEdit, verifyDesign);
router.put('/orders/:id/raise-rd-request', ordersEdit, raiseRDRequest);
router.get('/orders/:id/bom-design-status', ordersView, getBomDesignStatus);
router.get('/orders/:id/sub-child-part-material-list', ordersView, getSubChildPartMaterialList);
router.post('/orders/:id/sub-child-part-material/request', ordersAdd, requestSubChildPartMaterialController);
// Machine order Material List (2026-09-17) — new paths, the existing
// generic material-list/materials/issue routes below stay untouched (still
// serve the OLD RDBOM-based Job Work/Parts QC gates).
router.get('/orders/:id/machine-material-list', ordersView, getMachineMaterialList);
router.post('/orders/:id/machine-material/request', ordersAdd, requestMachineMaterialController);
router.get('/orders/:id/sub-child-part-job-work', ordersView, getSubChildPartJobWork);
// Stage 3d (2026-09-24) — generalized per-step twin of the above, any order
// kind, any step carrying its own materialRefs.
router.get('/orders/:id/processes/:stepIndex/material-status', ordersView, getStepMaterialStatusController);
router.put('/orders/:id/mark-material-issued', ordersEdit, receiveMaterialInProduction);

// ── QC-rejected order: Rework / Repair decision ────────────────────────────
router.put('/orders/:id/decide-rework', ordersEdit, decideRework);
router.put('/orders/:id/decide-repair', ordersEdit, decideRepair);

// ── Repair Production module ────────────────────────────────────────────────
router.get('/repair-jobs', repairView, getRepairJobs);
router.put('/orders/:id/repair/start', repairEdit, startRepair);
router.put('/orders/:id/repair/complete', repairEdit, completeRepair);

// ── Material demands ────────────────────────────────────────────────────────
router.get('/orders/:id/material-list', ordersView, getMaterialList);
router.post('/orders/:id/materials/issue', ordersAdd, issueMaterialToStore);
router.post('/orders/:id/materials', ordersAdd, addMaterialDemand);
router.post('/orders/:id/materials/return', ordersAdd, returnMaterialToStore);
router.put('/orders/:id/materials/:materialId/status', ordersEdit, updateMaterialStatus);
router.get('/production-orders/:id/pdf', ordersView, downloadMaterialListPDF);

// ── Process steps  (stepIndex = 0–5) ───────────────────────────────────────
// Sub Child Part (leaf level) orders — a single order-level Assign/Start/
// Complete cycle, not the per-step processes/:stepIndex/... routes above
// (see subChildPartOrderMfgController.js's own header comment).
router.get('/orders/:id/sub-child-part/material-list', ordersView, getSubChildPartRawMaterialListController);
router.post('/orders/:id/sub-child-part/material-request', ordersAdd, requestSubChildPartOrderMaterial);
router.put('/orders/:id/sub-child-part/assign-team', ordersEdit, assignSubChildPartOrderTeam);
router.put('/orders/:id/sub-child-part/start', ordersEdit, startSubChildPartOrder);
router.get('/orders/:id/sub-child-part/checklist', ordersView, getSubChildPartChecklist);
router.put('/orders/:id/sub-child-part/checklist', ordersEdit, saveSubChildPartChecklist);
router.put('/orders/:id/sub-child-part/submit-qc', ordersEdit, submitSubChildPartOrderToQC);

router.put('/orders/:id/processes/:stepIndex/assign-team', ordersEdit, assignTeam);
router.put('/orders/:id/processes/:stepIndex/start', ordersEdit, startProcess);
router.put('/orders/:id/processes/:stepIndex/complete', ordersEdit, markProcessComplete);
router.put('/orders/:id/processes/:stepIndex/approve-qc', ordersEdit, approveQC);
router.put('/orders/:id/processes/:stepIndex/reject-qc', ordersEdit, rejectQC);
router.put('/orders/:id/processes/:stepIndex/notes', ordersEdit, updateProcessNotes);
// Stage 3b (2026-09-23) — complete-final registered as its own literal
// segment, same ordering caveat as complete-painting below: a distinct
// fixed string after :stepIndex, so it never collides with plain /complete.
router.put('/orders/:id/processes/:stepIndex/complete-final', ordersEdit, completeFinalProcessStep);

// Sub-processes / sub-entries for steps like Fabrication
router.post('/orders/:id/processes/:stepIndex/sub-entries', ordersAdd, addSubEntry);
router.put('/orders/:id/processes/:stepIndex/sub-entries/:subEntryId/complete', ordersEdit, completeSubEntry);
router.put('/orders/:id/processes/:stepIndex/sub-entries/:subEntryId/qc', ordersEdit, qcSubEntry);

// ── Sub Child Part QC (in-house/outsource manufactured products) ──────────
// Same ONE shared QCJob as the order's eventual Final Check — see
// productionMfgController.js's ensureQCJobForOrder.
router.get('/orders/:id/parts-qc', ordersView, getPartsQC);
router.put('/orders/:id/parts-qc/:partCheckId/assign-team', ordersEdit, assignPartTeam);
router.put('/orders/:id/parts-qc/:partCheckId/start', ordersEdit, startPart);
router.get('/orders/:id/parts-qc/:partCheckId/:stage', ordersView, getPartChecklistRows);
router.put('/orders/:id/parts-qc/:partCheckId/:stage', ordersEdit, savePartChecklist);

// ── Child Part per-UNIT QC (2026-09-16) — same ONE shared QCJob as this
// order's whole build (ensureQCJobForOrder), but nested per unit
// (unitChecks[]) instead of per Sub Child Part (partChecks[] above) — see
// QCJob.js's UnitQCEntrySchema comment. complete-painting registered BEFORE
// the generic :stage route — Express matches route order, and :stage would
// otherwise swallow "complete-painting" as if it were a stage name.
router.put('/orders/:id/child-part/:unitNumber/complete-painting', ordersEdit, completeChildPartUnitPainting);
router.get('/orders/:id/child-part/:unitNumber/:stage', ordersView, getChildPartUnitChecklistRows);
router.put('/orders/:id/child-part/:unitNumber/:stage', ordersEdit, saveChildPartUnitChecklist);

// ── Final Testing checklist (every order — R&D's Final stage) ─────────────
router.get('/orders/:id/final-checklist', ordersView, getFinalChecklist);
router.put('/orders/:id/final-checklist', ordersEdit, saveFinalChecklist);

// ── QC checkpoint (Stage 3b, 2026-09-23) — the ONE real QC checkpoint on a
// dynamic Process Definition order, wherever Phase 1's qcRequired flag
// (or Sub Child Part's fixed last-step rule) puts it. Generalizes
// final-checklist/sub-child-part/checklist/child-part's :stage submission
// into one endpoint driven by position — see submitQcCheckpoint's own
// comment for exactly how it dispatches per order kind.
router.get('/orders/:id/qc-checkpoint', ordersView, getQcCheckpoint);
router.put('/orders/:id/qc-checkpoint/submit', ordersEdit, submitQcCheckpoint);

// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/teams', manpowerView, getTeams);
router.get('/teams/:teamId/history', manpowerView, getTeamOrderHistory);
router.post('/teams', manpowerAdd, createTeam);

export default router;
