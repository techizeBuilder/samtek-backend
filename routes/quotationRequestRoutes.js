import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';
import { createQuotationRequest, remindQuotationRequest } from '../controllers/quotationRequestController.js';

// One quotation email per vendor for several items (procurement-v2,
// 2026-10-08). The vendor's public page endpoints (/api/vendor-quotation/:token)
// are registered without auth in index.js, next to the old /api/vendor-bid one.
const router = express.Router();
router.use(authenticateToken);

// Same permission shape as itemQuoteGroupRoutes.js (Purchase / Accounts dept).
const purchasesAdd = checkAnyPermission([['accounts', 'purchases'], ['Store', 'purchaseOrders']], 'add');
router.post('/', purchasesAdd, createQuotationRequest);
// Point 16 (2026-10-10): re-email the same link as a reminder (once a day).
router.post('/:id/remind', purchasesAdd, remindQuotationRequest);

export default router;
