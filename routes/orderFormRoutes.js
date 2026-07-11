import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getByOrderId,
  upsertOrderForm,
  returnOrderForm,
  listOrderFormsForAccounts,
  getFormById,
} from '../controllers/orderFormController.js';

const router = express.Router();
router.use(authenticateToken);

const ACCOUNTS_ROLES = ['Accounts', 'Accounts Head', 'Account Employee', 'Superadmin', 'Super Admin'];

// Sales-side lookup / submit — ownership + verified-status checked inside the controller
router.get('/by-order/:orderId', getByOrderId);
router.put('/by-order/:orderId', upsertOrderForm);

// Accounts-only
router.get('/', authorizeRoles(...ACCOUNTS_ROLES), listOrderFormsForAccounts);
router.get('/:id', authorizeRoles(...ACCOUNTS_ROLES), getFormById);
router.patch('/:id/return', authorizeRoles(...ACCOUNTS_ROLES), returnOrderForm);

export default router;
