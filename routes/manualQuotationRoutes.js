import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';
// Purchase separated from Accounts (2026-11-16): docs/purchase-separation/01-logic.md.
import { purchaseGate, buyOrPayView, purchaseOrStorePairs, purchaseSettingsGate, purchaseAuditGate } from '../middleware/purchaseGates.js';
import { quoteEvidenceUploadHandler } from '../middleware/quoteEvidenceUpload.js';
import { createManualQuotation, getCarryOver } from '../controllers/manualQuotationController.js';

// Manual quotation with evidence (procurement-v2, 2026-10-09). The permission
// check runs BEFORE the upload, so a refused user never writes a file.
const router = express.Router();
router.use(authenticateToken);

// Same permission shape as quotationRequestRoutes.js / itemQuoteGroupRoutes.js.
const purchasesAdd = checkAnyPermission(purchaseOrStorePairs, 'add');
router.get('/carry-over', purchasesAdd, getCarryOver);
router.post('/', purchasesAdd, quoteEvidenceUploadHandler, createManualQuotation);

export default router;
