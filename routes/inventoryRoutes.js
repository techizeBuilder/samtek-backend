import express from 'express';
import { authenticateToken as auth } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  // Item routes
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  bulkDeleteItems,
  adjustStock,
  
  // Category routes
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  
  // Customer category routes
  getCustomerCategories,
  createCustomerCategory,
  updateCustomerCategory,
  deleteCustomerCategory,
  
  // Utility routes
  getLowStockItems,
  getInventoryStats,
  
  // Excel import/export routes
  exportItemsToExcel,
  importItemsFromExcel,
  exportCategoriesToExcel,
  exportCustomerCategoriesToExcel
} from '../controllers/inventoryController.js';

const router = express.Router();

// Item routes (temporarily remove permission check for Sales order creation)
router.get('/items', auth, getItems);
router.get('/items/:id', auth, getItemById);
router.post('/items', auth, createItem);
router.post('/items/bulk-delete', auth, bulkDeleteItems);
router.put('/items/:id', auth, updateItem);
router.delete('/items/:id', auth, deleteItem);
router.post('/items/:id/adjust-stock', auth, adjustStock);

// Category routes
router.get('/categories', auth, getCategories);
router.post('/categories', auth, createCategory);
router.put('/categories/:id', auth, updateCategory);
router.delete('/categories/:id', auth, deleteCategory);

// Customer category routes
router.get('/customer-categories', auth, getCustomerCategories);
router.post('/customer-categories', auth, createCustomerCategory);
router.put('/customer-categories/:id', auth, updateCustomerCategory);
router.delete('/customer-categories/:id', auth, deleteCustomerCategory);

// Utility routes
router.get('/inventory/low-stock', auth, getLowStockItems);
router.get('/inventory/stats', auth, getInventoryStats);

// Excel import/export routes
router.get('/items/export', auth, exportItemsToExcel);
router.post('/inventory/items/import', auth, importItemsFromExcel);
router.get('/categories/export', auth, exportCategoriesToExcel);
router.get('/customer-categories/export', auth, exportCustomerCategoriesToExcel);

export default router;