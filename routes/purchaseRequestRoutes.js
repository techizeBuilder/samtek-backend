import express from 'express';
import {
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequestStatus
} from '../controllers/purchaseRequestController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { warrantyUpload } from '../middleware/warrantyUpload.js';

const router = express.Router();

router.use(authenticateUser);

router.get('/', getPurchaseRequests);
router.post('/', createPurchaseRequest);

// Receive endpoint uses multipart/form-data so file (warrantyCard) can be uploaded
router.patch('/:id/status', warrantyUpload.single('warrantyCard'), updatePurchaseRequestStatus);

export default router;
