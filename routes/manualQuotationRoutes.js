import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';
import { quoteEvidenceUploadHandler } from '../middleware/quoteEvidenceUpload.js';
import { createManualQuotation } from '../controllers/manualQuotationController.js';

// Manual quotation with evidence (procurement-v2, 2026-10-09). The permission
// check runs BEFORE the upload, so a refused user never writes a file.
const router = express.Router();
router.use(authenticateToken);

// Same permission shape as quotationRequestRoutes.js / itemQuoteGroupRoutes.js.
const purchasesAdd = checkAnyPermission([['accounts', 'purchases'], ['Store', 'purchaseOrders']], 'add');
router.post('/', purchasesAdd, quoteEvidenceUploadHandler, createManualQuotation);

export default router;
