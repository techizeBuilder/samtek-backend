import express from 'express';
import {
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequestStatus,
  storeApproveRequest,
  storeRejectRequest,
  checkInventoryForPR,
  createBulkPurchaseRequests,
  getStagedPurchaseRequests,
  previewFabricationTotal,
  editFabricationLines,
  receiveFabricationPurchase
} from '../controllers/purchaseRequestController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { warrantyUpload } from '../middleware/warrantyUpload.js';
import { checkAnyPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateUser);

// Purchase Requests are worked on by both Accounts/Purchase dept (module
// 'accounts', feature 'purchases') and Store (module 'Store', feature
// 'purchaseOrders') — either grant is enough to pass the route; which
// specific actions a role may perform is enforced inside the controllers
// (see e.g. editFabricationLines/storeApproveRequest's own role checks).
const purchaseRequestModules = [['accounts', 'purchases'], ['Store', 'purchaseOrders']];
const purchasesView = checkAnyPermission(purchaseRequestModules, 'view');
const purchasesAdd = checkAnyPermission(purchaseRequestModules, 'add');
const purchasesEdit = checkAnyPermission(purchaseRequestModules, 'edit');

router.get('/', purchasesView, getPurchaseRequests);
router.get('/staged', purchasesView, getStagedPurchaseRequests);
router.post('/', purchasesAdd, createPurchaseRequest);
router.post('/bulk-purchase', purchasesAdd, createBulkPurchaseRequests);
router.post('/preview-fabrication-total', purchasesAdd, previewFabricationTotal);

// Receive endpoint uses multipart/form-data so file (warrantyCard) can be uploaded
router.patch('/:id/status', purchasesEdit, warrantyUpload.single('warrantyCard'), updatePurchaseRequestStatus);

// Store-only: records the actual per-dimension breakdown of a fabrication
// purchase as it's received — no Serial Number/Warranty fields, see
// receiveFabricationPurchase's own comment.
router.patch('/:id/receive-fabrication', purchasesEdit, receiveFabricationPurchase);

// Purchase-dept-only: re-target which catalog dimensions/quantities make up
// a still-Pending fabrication request before it's sent as an RFQ.
router.patch('/:id/fabrication-lines', purchasesEdit, editFabricationLines);

// Store approves a Production-raised demand → forwards it to Purchase dept
router.patch('/:id/store-approve', purchasesEdit, storeApproveRequest);

// Store rejects a Production-raised demand
router.patch('/:id/store-reject', purchasesEdit, storeRejectRequest);

// Check inventory availability for a purchase request item
router.get('/:id/check-inventory', purchasesView, checkInventoryForPR);

export default router;
