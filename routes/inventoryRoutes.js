import express from 'express';
import { authenticateToken as auth, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { itemUpload } from '../middleware/itemUpload.js';
import {
  // Item routes
  getItems,
  getItemById,
  getItemByCode,
  createItem,
  updateItem,
  deleteItem,
  bulkDeleteItems,
  adjustStock,
  uploadItemImage,
  uploadItemBrochure,
  deleteItemMedia,

  // Category routes
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,

  // Unit Type routes
  getUnitTypes,
  createUnitType,
  updateUnitType,
  deleteUnitType,

  // Customer category routes
  getCustomerCategories,
  createCustomerCategory,
  updateCustomerCategory,
  deleteCustomerCategory,

  // Group routes
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,

  // Utility routes
  getLowStockItems,
  getInventoryStats,

  // Excel import/export routes
  exportItemsToExcel,
  importItemsFromExcel,
  exportCategoriesToExcel,
  exportCustomerCategoriesToExcel,
  getMaterialIssueLogs,
  getPendingRequests,
  transferMaterialToProduction,
  transferFabricationMaterialToProduction,
  getReturnedMaterials,
  getPendingReturns,
  confirmReturn,
  getStoreTransferLogs,
  bulkTransferOrderMaterials,
  getDefectiveInventory,
  repairDefectiveInventory,
  scrapDefectiveInventory,
  getVariantsByItemCode,
  getSellableItemsForUser,

  // Inventory master-option routes (ItemType/ItemCategory/SourceType/ItemSourceType)
  getInventoryDropdownOptions,
  addInventoryDropdownOption,
  updateInventoryDropdownOption,
  deleteInventoryDropdownOption,
} from '../controllers/inventoryController.js';

const router = express.Router();

// Item routes (temporarily remove permission check for Sales order creation)
router.get('/items/by-code', auth, getItemByCode);
router.get('/items/variants-prefill', auth, getVariantsByItemCode);
router.get('/items/sellable', auth, getSellableItemsForUser);
router.get('/items', auth, getItems);
router.get('/items/:id', auth, getItemById);
router.post('/items', auth, createItem);
router.post('/items/upload-image', auth, itemUpload.single('image'), uploadItemImage);
router.post('/items/upload-brochure', auth, itemUpload.single('brochure'), uploadItemBrochure);
router.post('/items/media/delete', auth, deleteItemMedia);
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

// Defective inventory routes
router.get('/inventory/defective', auth, authorizeRoles('Store Head', 'Store Employee'), getDefectiveInventory);
router.post('/inventory/defective/repair/:id', auth, authorizeRoles('Store Head', 'Store Employee'), repairDefectiveInventory);
router.post('/inventory/defective/scrap/:id', auth, authorizeRoles('Store Head', 'Store Employee'), scrapDefectiveInventory);

// Group routes
router.get('/inventory/groups', auth, getGroups);
router.post('/inventory/groups', auth, createGroup);
router.put('/inventory/groups/:id', auth, updateGroup);
router.delete('/inventory/groups/:id', auth, deleteGroup);

// Unit type routes
router.get('/inventory/unit-types', auth, getUnitTypes);
router.post('/inventory/unit-types', auth, createUnitType);
router.put('/inventory/unit-types/:id', auth, updateUnitType);
router.delete('/inventory/unit-types/:id', auth, deleteUnitType);

// Inventory master-option routes (ItemType/ItemCategory/SourceType/ItemSourceType)
router.get('/inventory/master-options', auth, getInventoryDropdownOptions);
router.post('/inventory/master-options', auth, addInventoryDropdownOption);
router.put('/inventory/master-options/:id', auth, updateInventoryDropdownOption);
router.delete('/inventory/master-options/:id', auth, deleteInventoryDropdownOption);

// Utility routes
router.get('/inventory/low-stock', auth, getLowStockItems);
router.get('/inventory/stats', auth, getInventoryStats);

// Production - Store Material Transfer Handshake Routes
router.get('/inventory/material-issues', auth, authorizeRoles("Store Head", "Store Employee"), getMaterialIssueLogs);
router.get('/inventory/pending-requests', auth, authorizeRoles("Store Head", "Store Employee"), getPendingRequests);
router.post('/inventory/transfer-material/:id', auth, authorizeRoles("Store Head", "Store Employee"), transferMaterialToProduction);
router.post('/inventory/transfer-fabrication-material/:id', auth, authorizeRoles("Store Head", "Store Employee"), transferFabricationMaterialToProduction);
router.post('/inventory/bulk-transfer/:id', auth, authorizeRoles("Store Head", "Store Employee"), bulkTransferOrderMaterials);
router.get('/inventory/returned-materials', auth, authorizeRoles("Store Head", "Store Employee"), getReturnedMaterials);
router.get('/inventory/pending-returns', auth, authorizeRoles("Store Head", "Store Employee"), getPendingReturns);
router.post('/inventory/confirm-return', auth, authorizeRoles("Store Head", "Store Employee"), confirmReturn);
router.get('/inventory/store-transfer-logs', auth, authorizeRoles("Store Head", "Store Employee"), getStoreTransferLogs);

// Excel import/export routes
router.get('/items/export', auth, exportItemsToExcel);
router.post('/inventory/items/import', auth, importItemsFromExcel);
router.get('/categories/export', auth, exportCategoriesToExcel);
router.get('/customer-categories/export', auth, exportCustomerCategoriesToExcel);

export default router;