import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { listPOApprovals, reviewPOApproval, getPOQuoteHistory } from '../controllers/poApprovalController.js';
import { reviewPoCancellation } from '../controllers/poCancellationController.js';

// Company Admin PO approvals (procurement-v2, 2026-10-08) — POs above the
// company's PO approval threshold. Super Admin is a fallback reviewer, same
// as the vendor approvals.
const router = express.Router();
router.use(authenticateToken);

const reviewers = authorizeRoles('Company Admin', 'Super Admin');
router.get('/', reviewers, listPOApprovals);
router.put('/:id/review', reviewers, reviewPOApproval);
// Gap 13 (2026-10-09): approve / refuse Purchase's request to cancel a PO.
router.put('/:id/cancel-review', reviewers, reviewPoCancellation);
// Every quotation behind the PO, so the approver sees the competing prices.
router.get('/:id/quote-history', reviewers, getPOQuoteHistory);

export default router;
