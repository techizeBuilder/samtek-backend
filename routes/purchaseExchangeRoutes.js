import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getExchangeByToken,
  acceptExchangeByToken,
  getPurchaseExchanges,
  assignExchangeVendor,
} from '../controllers/purchaseExchangeController.js';

const router = express.Router();

// ── Public routes (no auth required — vendor uses the emailed token link) ──
// These MUST be before router.use(authenticateToken)
router.get('/token/:token', getExchangeByToken);
router.post('/token/:token/accept', acceptExchangeByToken);

// ── Protected routes (Accounts / Purchase / Admin only) ─────────────────────
router.use(authenticateToken);

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');

router.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseExchanges);
router.put('/:id/assign-vendor', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, assignExchangeVendor);

export default router;
