import express from 'express';
import {
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequestStatus
} from '../controllers/purchaseRequestController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateUser);

router.get('/', getPurchaseRequests);
router.post('/', createPurchaseRequest);
router.patch('/:id/status', updatePurchaseRequestStatus);

export default router;
