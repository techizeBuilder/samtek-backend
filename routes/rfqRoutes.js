import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getRFQs,
  createRFQ,
  getRFQBids,
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

router.get('/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getRFQStats);
router.get('/vendors-for-rfq', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getVendorsForRFQ);
router.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getRFQs);
router.post('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createRFQ);
router.get('/:id/bids', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getRFQBids);
router.post('/:id/select-vendor', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), selectVendor);

export default router;
