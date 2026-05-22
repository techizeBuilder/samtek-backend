import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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
} from '../controllers/qcController.js';

const router = express.Router();
router.use(authenticateToken);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ── QC Jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', getQCJobs);
router.get('/jobs/:id', getQCJob);
router.post('/jobs', createQCJob);
router.put('/jobs/:id', updateQCJob);

// ── Inspection workflow ───────────────────────────────────────────────────────
router.put('/jobs/:id/start', startInspection);
router.put('/jobs/:id/checklist/:itemId', updateChecklistItem);
router.post('/jobs/:id/checklist', addChecklistItem);
router.delete('/jobs/:id/checklist/:itemId', removeChecklistItem);
router.put('/jobs/:id/decision', submitDecision);

export default router;
