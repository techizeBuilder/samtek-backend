import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { listOutsourceApprovals, reviewOutsourceApproval } from '../controllers/outsourceOrderController.js';

// Company Admin outsource order approvals (outsource-v2 slice 2, 2026-10-20,
// D4) — orders above the company's outsourceApprovalThreshold. Super Admin is
// a fallback reviewer, same as the PO approvals.
const router = express.Router();
router.use(authenticateToken);

const reviewers = authorizeRoles('Company Admin', 'Super Admin');
router.get('/', reviewers, listOutsourceApprovals);
router.put('/:id/review', reviewers, reviewOutsourceApproval);

export default router;
