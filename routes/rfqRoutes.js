import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getRFQs,
  createRFQ,
  getRFQBids,
  resendVendorBidEmail,
  selectVendor,
  getBidByToken,
  submitBidByToken,
  getRFQStats,
  getVendorsForRFQ
} from '../controllers/rfqController.js';

const router = express.Router();

// ── Public routes (no auth required — vendors use token-based links) ──────────
// These MUST be before router.use(authenticateToken)
router.get('/bid/:token', getBidByToken);
router.post('/bid/:token', submitBidByToken);

// ── Protected routes (Accounts / Admin only) ──────────────────────────────────
router.use(authenticateToken);

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesAdd = checkPermission('accounts', 'purchases', 'add');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');

router.get('/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQStats);
router.get('/vendors-for-rfq', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getVendorsForRFQ);
router.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQs);
router.post('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createRFQ);
router.get('/:id/bids', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQBids);
router.post('/:id/vendor-bid/:bidId/resend', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, resendVendorBidEmail);
router.post('/:id/select-vendor', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, selectVendor);

export default router;
