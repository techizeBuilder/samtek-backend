import express from 'express';
import {
  createItemQuoteGroup,
  updateGroupSelection,
  updateGroupQuantity,
  listOpenGroups,
  getEligibleVendorsForGroup,
  createQuoteForGroup,
  syncBidToGroupQuantity,
  autoSelectGroups,
  getRfqBoard,
  getQuoteHistory,
  getGroupStockDetail,
  getSelectionCheck,
} from '../controllers/itemQuoteGroupController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateUser);

// Item-wise PR consolidation (2026-10) — same permission shape as
// purchaseRequestRoutes.js's own quote endpoints (Purchase/Accounts dept).
const purchaseRequestModules = [['accounts', 'purchases'], ['Store', 'purchaseOrders']];
const purchasesView = checkAnyPermission(purchaseRequestModules, 'view');
const purchasesAdd = checkAnyPermission(purchaseRequestModules, 'add');
const purchasesEdit = checkAnyPermission(purchaseRequestModules, 'edit');

// RFQ/PO page (procurement-v2) — select-everything-by-default + one-call board
router.post('/auto-select', purchasesAdd, autoSelectGroups);
router.get('/board', purchasesView, getRfqBoard);
router.get('/quote-history', purchasesView, getQuoteHistory);
// Gap 12 (2026-10-09): the PO review's vendor selection check (read-only).
router.post('/selection-check', purchasesView, getSelectionCheck);
router.get('/', purchasesView, listOpenGroups);
router.post('/', purchasesAdd, createItemQuoteGroup);
router.put('/:id/selection', purchasesEdit, updateGroupSelection);
router.patch('/:id', purchasesEdit, updateGroupQuantity);
router.get('/:id/eligible-vendors', purchasesView, getEligibleVendorsForGroup);
// Gap 9 (2026-10-09): the card's stock pop-up.
router.get('/:id/stock-detail', purchasesView, getGroupStockDetail);
router.post('/:id/quotes', purchasesAdd, createQuoteForGroup);
router.patch('/quotes/:id/sync', purchasesEdit, syncBidToGroupQuantity);

export default router;
