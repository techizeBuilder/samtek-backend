import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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

// Get leads sent to account for payment processing
router.get('/leads', getLeadsForPayment);

// Get bank accounts for payment selection
router.get('/bank-accounts', getBankAccounts);

// Add advanced payment for a lead
router.post('/', addLeadPayment);

// Get all lead payments
router.get('/', getLeadPayments);

// Get payment summary for a specific lead
router.get('/lead/:leadId', getLeadPaymentSummary);

// Update payment status (verify/reject)
router.put('/:id/status', updateLeadPaymentStatus);

export default router;