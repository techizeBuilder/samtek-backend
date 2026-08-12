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
  importSuppliersFromExcel
} from '../controllers/supplierController.js';

const router = express.Router();

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesAdd = checkPermission('accounts', 'purchases', 'add');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');
const purchasesDelete = checkPermission('accounts', 'purchases', 'delete');

// Supplier CRUD routes
router.get('/suppliers', auth, purchasesView, getSuppliers);
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