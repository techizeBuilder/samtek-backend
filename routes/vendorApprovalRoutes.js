import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  listRequests, reviewRequest, cancelRequest, getWatchlist, suspendFromWatchlist,
} from '../controllers/vendorApprovalController.js';

// Company Admin's "Purchase & Vendor Approval" page (procurement-v2,
// 2026-10-08). Purchase raises these requests from Vendor Master
// (supplierRoutes.js); reviewing is Company Admin only, with Super Admin as a
// fallback — same as leadSettingRequestRoutes.js.
const router = express.Router();

router.use(authenticateToken);

const reviewers = authorizeRoles('Company Admin', 'Super Admin');

// Company-scoped list — the Company Admin's inbox, and Purchase (Accounts
// roles) seeing what they've sent.
router.get('/', authorizeRoles('Company Admin', 'Super Admin', 'Accounts', 'Accounts Head'), listRequests);
router.get('/watchlist', reviewers, getWatchlist);
router.post('/watchlist/:vendorId/suspend', reviewers, suspendFromWatchlist);
router.put('/:id/review', reviewers, reviewRequest);
// Ownership (the original requester) is checked in the controller.
router.delete('/:id', cancelRequest);

export default router;
