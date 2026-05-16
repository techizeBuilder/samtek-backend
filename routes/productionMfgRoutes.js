import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getOrders,
  createOrder,
  verifyBOM,
  verifyDesign,
  raiseRDRequest,
  markMaterialIssued,
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
} from '../controllers/productionMfgController.js';

const router = express.Router();

router.use(authenticateToken);

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders', getOrders);
router.post('/orders', createOrder);
router.put('/orders/:id/verify-bom', verifyBOM);
router.put('/orders/:id/verify-design', verifyDesign);
router.put('/orders/:id/raise-rd-request', raiseRDRequest);
router.put('/orders/:id/mark-material-issued', markMaterialIssued);

// ── Material demands ────────────────────────────────────────────────────────
router.post('/orders/:id/materials', addMaterialDemand);
router.put('/orders/:id/materials/:materialId/status', updateMaterialStatus);

// ── Process steps  (stepIndex = 0–5) ───────────────────────────────────────
router.put('/orders/:id/processes/:stepIndex/assign-team', assignTeam);
router.put('/orders/:id/processes/:stepIndex/start', startProcess);
router.put('/orders/:id/processes/:stepIndex/complete', markProcessComplete);
router.put('/orders/:id/processes/:stepIndex/approve-qc', approveQC);
router.put('/orders/:id/processes/:stepIndex/reject-qc', rejectQC);
router.put('/orders/:id/processes/:stepIndex/notes', updateProcessNotes);

// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/teams', getTeams);
router.post('/teams', createTeam);

export default router;
