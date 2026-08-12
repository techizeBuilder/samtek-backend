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
  returnMaterialToStore,
  downloadMaterialListPDF,
  addSubEntry,
  completeSubEntry,
  qcSubEntry,
  decideRework,
  decideRepair,
  getRepairJobs,
  startRepair,
  completeRepair
} from '../controllers/productionMfgController.js';

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
router.put('/orders/:id/mark-material-issued', ordersEdit, receiveMaterialInProduction);

// ── QC-rejected order: Rework / Repair decision ────────────────────────────
router.put('/orders/:id/decide-rework', ordersEdit, decideRework);
router.put('/orders/:id/decide-repair', ordersEdit, decideRepair);

// ── Repair Production module ────────────────────────────────────────────────
router.get('/repair-jobs', repairView, getRepairJobs);
router.put('/orders/:id/repair/start', repairEdit, startRepair);
router.put('/orders/:id/repair/complete', repairEdit, completeRepair);

// ── Material demands ────────────────────────────────────────────────────────
router.post('/orders/:id/materials', ordersAdd, addMaterialDemand);
router.post('/orders/:id/materials/return', ordersAdd, returnMaterialToStore);
router.put('/orders/:id/materials/:materialId/status', ordersEdit, updateMaterialStatus);
router.get('/production-orders/:id/pdf', ordersView, downloadMaterialListPDF);

// ── Process steps  (stepIndex = 0–5) ───────────────────────────────────────
router.put('/orders/:id/processes/:stepIndex/assign-team', ordersEdit, assignTeam);
router.put('/orders/:id/processes/:stepIndex/start', ordersEdit, startProcess);
router.put('/orders/:id/processes/:stepIndex/complete', ordersEdit, markProcessComplete);
router.put('/orders/:id/processes/:stepIndex/approve-qc', ordersEdit, approveQC);
router.put('/orders/:id/processes/:stepIndex/reject-qc', ordersEdit, rejectQC);
router.put('/orders/:id/processes/:stepIndex/notes', ordersEdit, updateProcessNotes);

// Sub-processes / sub-entries for steps like Fabrication
router.post('/orders/:id/processes/:stepIndex/sub-entries', ordersAdd, addSubEntry);
router.put('/orders/:id/processes/:stepIndex/sub-entries/:subEntryId/complete', ordersEdit, completeSubEntry);
router.put('/orders/:id/processes/:stepIndex/sub-entries/:subEntryId/qc', ordersEdit, qcSubEntry);

// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/teams', manpowerView, getTeams);
router.get('/teams/:teamId/history', manpowerView, getTeamOrderHistory);
router.post('/teams', manpowerAdd, createTeam);

export default router;
