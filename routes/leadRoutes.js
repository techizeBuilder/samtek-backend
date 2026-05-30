import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  checkExistingLead,
  getAssignableUsers,
  markLeadAsWon,
  requestPaymentCheck,
  updatePaymentCheckStatus,
  sendLeadToAccount
} from '../controllers/leadController.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createLead);
router.get('/', getLeads);
router.get('/check', checkExistingLead);
router.get('/users', getAssignableUsers);
router.get('/:id', getLeadById);
router.put('/:id', updateLead);
router.put('/:id/payment-check', updatePaymentCheckStatus);
router.post('/:id/request-payment-check', requestPaymentCheck);
router.post('/:id/send-to-account', sendLeadToAccount);
router.post('/:id/won', markLeadAsWon);

router.delete('/:id', deleteLead);

export default router;
