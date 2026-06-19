import express from 'express';
import {
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequestStatus,
  storeApproveRequest,
  storeRejectRequest,
  checkInventoryForPR
} from '../controllers/purchaseRequestController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { warrantyUpload } from '../middleware/warrantyUpload.js';

const router = express.Router();

router.use(authenticateUser);

router.get('/', getPurchaseRequests);
router.post('/', createPurchaseRequest);

// Receive endpoint uses multipart/form-data so file (warrantyCard) can be uploaded
router.patch('/:id/status', warrantyUpload.single('warrantyCard'), updatePurchaseRequestStatus);

// Store approves a Production-raised demand → forwards it to Purchase dept
router.patch('/:id/store-approve', storeApproveRequest);

// Store rejects a Production-raised demand
router.patch('/:id/store-reject', storeRejectRequest);

// Check inventory availability for a purchase request item
router.get('/:id/check-inventory', checkInventoryForPR);

export default router;
