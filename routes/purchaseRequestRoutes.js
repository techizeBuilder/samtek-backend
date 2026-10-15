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
  receiveFabricationPurchase,
  getBatchSiblings,
  getPurchaseOrdersForStore,
  receiveLineItems,
  receiveLineFabrication
} from '../controllers/purchaseRequestController.js';
import { getQuotesForPR, createQuote, getEligibleVendorsForPR } from '../controllers/purchaseQuoteController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { warrantyUpload } from '../middleware/warrantyUpload.js';
import { receiveUpload } from '../middleware/receiveUpload.js';
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

// Store's own way to list POs, grouped the same way Active POs/Order
// History already are (2026-10) — see getPurchaseOrdersForStore's own
// comment for why this isn't just GET /api/accounts/purchases/orders.
router.get('/orders', purchasesView, getPurchaseOrdersForStore);

// One receive action per PO line (2026-10), not per PurchaseRequest — see
// receiveLineItems/receiveLineFabrication's own comments. Registered before
// the legacy per-PR routes below only for readability; the literal `orders`
// prefix makes these unambiguous from `/:id/...` regardless of order.
// receiveUpload: the warranty card + (2026-10-12) an optional scan of the vendor's invoice.
router.patch('/orders/:purchaseId/lines/:lineId/receive', purchasesEdit, receiveUpload, receiveLineItems);
router.patch('/orders/:purchaseId/lines/:lineId/receive-fabrication', purchasesEdit, receiveUpload, receiveLineFabrication);

// Per-PR receive — superseded by the per-line routes above for Store's own
// UI (2026-10), left registered (not deleted) since applyReceiveSideEffects/
// applyFabricationReceiveSideEffects are now shared by both, and this is
// safe to remove later once the new flow is confirmed live, same pattern as
// RFQ Management/Vendor Bids' own removal once their replacement was
// verified. Receive endpoint uses multipart/form-data so file (warrantyCard)
// can be uploaded.
router.patch('/:id/status', purchasesEdit, warrantyUpload.single('warrantyCard'), updatePurchaseRequestStatus);
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

// Read-only batch context for the receive modal — see getBatchSiblings.
router.get('/:id/batch-siblings', purchasesView, getBatchSiblings);

// Quote history + creation (Purchase redesign) — Email or Manual, see
// purchaseQuoteController.js.
router.get('/:id/quotes', purchasesView, getQuotesForPR);
router.post('/:id/quotes', purchasesAdd, createQuote);
router.get('/:id/eligible-vendors', purchasesView, getEligibleVendorsForPR);

export default router;
