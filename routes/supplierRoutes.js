import express from 'express';
import { authenticateToken as auth } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierStats,
  exportSuppliersToExcel,
  importSuppliersFromExcel,
  getSupplierCatalog,
  getVendorRatingsOverview,
  getVendorItemBreakdown,
  submitForApproval,
  withdrawApproval,
  uploadVendorDocument,
  deleteVendorDocument,
  requestStatusChange
} from '../controllers/supplierController.js';
import { getBatchableQuotesForVendor } from '../controllers/purchaseQuoteController.js';
import { vendorDocumentUpload } from '../middleware/vendorDocumentUpload.js';

const router = express.Router();

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesAdd = checkPermission('accounts', 'purchases', 'add');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');
const purchasesDelete = checkPermission('accounts', 'purchases', 'delete');

// Supplier CRUD routes
router.get('/suppliers', auth, purchasesView, getSuppliers);
// Must come before '/suppliers/:id', or Express matches 'catalog'/
// 'vendor-ratings' as an id.
router.get('/suppliers/catalog', auth, purchasesView, getSupplierCatalog);
router.get('/suppliers/vendor-ratings', auth, purchasesView, getVendorRatingsOverview);
// Purchase redesign — extra path segment after :id, so route order vs.
// '/suppliers/:id' doesn't matter for these two the way it does above.
router.get('/suppliers/:id/batchable-quotes', auth, purchasesView, getBatchableQuotesForVendor);
router.get('/suppliers/:id/item-breakdown', auth, purchasesView, getVendorItemBreakdown);
// Vendor Master v2 — approval lifecycle + compliance documents
// (procurement-v2, 2026-10-08). Approving is the Company Admin's job, on
// /api/vendor-approvals (vendorApprovalRoutes.js); these are Purchase's side.
router.post('/suppliers/:id/submit', auth, purchasesEdit, submitForApproval);
router.post('/suppliers/:id/withdraw', auth, purchasesEdit, withdrawApproval);
router.post('/suppliers/:id/documents', auth, purchasesEdit, vendorDocumentUpload.single('file'), uploadVendorDocument);
router.delete('/suppliers/:id/documents/:docId', auth, purchasesEdit, deleteVendorDocument);
router.post('/suppliers/:id/status-requests', auth, purchasesEdit, vendorDocumentUpload.array('evidence', 5), requestStatusChange);
router.get('/suppliers/:id', auth, purchasesView, getSupplierById);
router.post('/suppliers', auth, purchasesAdd, createSupplier);
router.put('/suppliers/:id', auth, purchasesEdit, updateSupplier);
router.delete('/suppliers/:id', auth, purchasesDelete, deleteSupplier);

// Supplier stats
router.get('/suppliers/stats', auth, purchasesView, getSupplierStats);

// Excel import/export routes
router.get('/suppliers/export', auth, purchasesView, exportSuppliersToExcel);
router.post('/suppliers/import', auth, purchasesAdd, importSuppliersFromExcel);

export default router;