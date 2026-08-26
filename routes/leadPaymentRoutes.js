import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission, checkAnyPermission } from '../middleware/permissions.js';
import {
  getLeadsForPayment,
  addLeadPayment,
  getLeadPayments,
  updateLeadPaymentStatus,
  getLeadPaymentSummary,
  getBankAccounts
} from '../controllers/leadPaymentController.js';

const router = express.Router();

router.use(authenticateToken);

// Lead payments live under Accounts' "Sales" area (same feature key as
// NOC Requests, Packed Orders, Order Forms, etc. in roleModulesConfig.js).
const salesView = checkPermission('accounts', 'sales', 'view');
const salesAdd = checkPermission('accounts', 'sales', 'add');
const salesEdit = checkPermission('accounts', 'sales', 'edit');

// Get leads sent to account for payment processing
router.get('/leads', salesView, getLeadsForPayment);

// Get bank accounts for payment selection
router.get('/bank-accounts', salesView, getBankAccounts);

// Add advanced payment for a lead
router.post('/', salesAdd, addLeadPayment);

// Get all lead payments
router.get('/', salesView, getLeadPayments);

// Get payment summary for a specific lead — also readable by Sales (Accounts'
// own accounts.sales.view stays valid too) since the Sales Order Form auto-
// fills its Payment Details from here (see OrderFormModal.jsx prefillFromLead).
router.get('/lead/:leadId', checkAnyPermission([['accounts', 'sales'], ['sales', 'leads']], 'view'), getLeadPaymentSummary);

// Update payment status (verify/reject)
router.put('/:id/status', salesEdit, updateLeadPaymentStatus);

export default router;