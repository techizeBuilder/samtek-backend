import express from 'express';
import { authenticateToken as auth } from '../middleware/auth.js';
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

// Supplier CRUD routes
router.get('/suppliers', auth, getSuppliers);
router.get('/suppliers/:id', auth, getSupplierById);
router.post('/suppliers', auth, createSupplier);
router.put('/suppliers/:id', auth, updateSupplier);
router.delete('/suppliers/:id', auth, deleteSupplier);

// Supplier stats
router.get('/suppliers/stats', auth, getSupplierStats);

// Excel import/export routes
router.get('/suppliers/export', auth, exportSuppliersToExcel);
router.post('/suppliers/import', auth, importSuppliersFromExcel);

export default router;