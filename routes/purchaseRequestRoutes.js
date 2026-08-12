import express from 'express';
import {
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequestStatus,
  storeApproveRequest,
  storeRejectRequest,
  checkInventoryForPR,
  createBulkPurchaseRequests,
  getStagedPurchaseRequests
} from '../controllers/purchaseRequestController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { warrantyUpload } from '../middleware/warrantyUpload.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateUser);

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesAdd = checkPermission('accounts', 'purchases', 'add');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');

router.get('/', purchasesView, getPurchaseRequests);
router.get('/staged', purchasesView, getStagedPurchaseRequests);
router.post('/', purchasesAdd, createPurchaseRequest);
router.post('/bulk-purchase', purchasesAdd, createBulkPurchaseRequests);

// Receive endpoint uses multipart/form-data so file (warrantyCard) can be uploaded
router.patch('/:id/status', purchasesEdit, warrantyUpload.single('warrantyCard'), updatePurchaseRequestStatus);

// Store approves a Production-raised demand → forwards it to Purchase dept
router.patch('/:id/store-approve', purchasesEdit, storeApproveRequest);

// Store rejects a Production-raised demand
router.patch('/:id/store-reject', purchasesEdit, storeRejectRequest);

// Check inventory availability for a purchase request item
router.get('/:id/check-inventory', purchasesView, checkInventoryForPR);

export default router;
