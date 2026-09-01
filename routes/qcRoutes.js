import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getDashboard,
  getQCJobs,
  getQCJob,
  createQCJob,
  updateQCJob,
  startInspection,
  updateChecklistItem,
  submitDecision,
  addChecklistItem,
  removeChecklistItem,
  syncRDToQCJob,
  decidePartCheck,
} from '../controllers/qcController.js';

const router = express.Router();
router.use(authenticateToken);

const dashboardView = checkPermission('quality-control', 'dashboard', 'view');

const qcJobsView = checkPermission('quality-control', 'qcJobs', 'view');
const qcJobsEdit = checkPermission('quality-control', 'qcJobs', 'edit');

// POST /jobs (createQCJob) is deliberately gated under qcInward, not qcJobs:
// confirmed via frontend (QCInward.jsx's createJob() call) that new QC jobs
// are actually created from the QC Inward Entry page as part of goods-inward
// inspection intake, not from the QC Jobs list page. Gating it under qcJobs
// would 403 the Inward Entry page for a user who only has qcInward access.
const qcInwardAdd = checkPermission('quality-control', 'qcInward', 'add');

// GET /jobs/:id and PUT /jobs/:id/sync-rd are both called directly from
// QCInspection.jsx (confirmed in frontend) as part of loading/syncing a job
// before/while inspecting it, so they're gated under qcInspection rather than
// qcJobs.
const qcInspectionView = checkPermission('quality-control', 'qcInspection', 'view');
const qcInspectionAdd = checkPermission('quality-control', 'qcInspection', 'add');
const qcInspectionEdit = checkPermission('quality-control', 'qcInspection', 'edit');
const qcInspectionDelete = checkPermission('quality-control', 'qcInspection', 'delete');

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', dashboardView, getDashboard);
router.put('/jobs/:id/sync-rd', qcInspectionEdit, syncRDToQCJob);
// ── QC Jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', qcJobsView, getQCJobs);
router.get('/jobs/:id', qcInspectionView, getQCJob);
router.post('/jobs', qcInwardAdd, createQCJob);
router.put('/jobs/:id', qcJobsEdit, updateQCJob);

// ── Inspection workflow ───────────────────────────────────────────────────────
router.put('/jobs/:id/start', qcInspectionEdit, startInspection);
router.put('/jobs/:id/checklist/:itemId', qcInspectionEdit, updateChecklistItem);
router.post('/jobs/:id/checklist', qcInspectionAdd, addChecklistItem);
router.delete('/jobs/:id/checklist/:itemId', qcInspectionDelete, removeChecklistItem);
router.put('/jobs/:id/decision', qcInspectionEdit, submitDecision);
// Sub Child Part review, in-house/outsource manufactured products only —
// same qcInspection gate as everything else on the job detail page.
router.put('/jobs/:id/parts/:partCheckId/decision', qcInspectionEdit, decidePartCheck);

export default router;
