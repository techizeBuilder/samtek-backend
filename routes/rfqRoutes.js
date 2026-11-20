import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
// Purchase separated from Accounts (2026-11-16): docs/purchase-separation/01-logic.md.
import { purchaseGate, buyOrPayView, purchaseOrStorePairs, purchaseSettingsGate, purchaseAuditGate } from '../middleware/purchaseGates.js';
import {
  getRFQs,
  createRFQ,
  getRFQBids,
  resendVendorBidEmail,
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

const purchasesView = purchaseGate('view');
const purchasesAdd = purchaseGate('add');
const purchasesEdit = purchaseGate('edit');

router.get('/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQStats);
router.get('/vendors-for-rfq', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getVendorsForRFQ);
router.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQs);
router.post('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createRFQ);
router.get('/:id/bids', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getRFQBids);
router.post('/:id/vendor-bid/:bidId/resend', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, resendVendorBidEmail);
// Retired (bug report B4, 2026-10-19): it created POs the pre-v2 way. POs are made
// from RFQ/PO → PO review.
router.post('/:id/select-vendor', (req, res) => res.status(410).json({ success: false, message: 'Purchase orders are made from Purchase → RFQ/PO (PO review), not from an RFQ.' }));

export default router;
