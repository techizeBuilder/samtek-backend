import express from 'express';
import { authenticateToken as auth, authorizeRoles } from '../middleware/auth.js';
import { checkAnyPermission, checkPermission } from '../middleware/permissions.js';
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

// Items/categories/etc are read by many modules beyond Store (Sales order
// creation, R&D, Production) with no permission entry of their own, so GET
// routes stay auth-only — narrowing them by permission would 403 those
// legitimate cross-module reads. Store and R&D both catalog inventory
// management under an 'inventory' feature (module 'Store' / module 'rnd'
// respectively — see roleModulesConfig.js), so mutating routes are gated
// against either via checkAnyPermission.
const inventoryPairs = [['Store', 'inventory'], ['rnd', 'inventory']];
const inventoryAdd = checkAnyPermission(inventoryPairs, 'add');
const inventoryEdit = checkAnyPermission(inventoryPairs, 'edit');
const inventoryDelete = checkAnyPermission(inventoryPairs, 'delete');

// Item routes
router.get('/items/by-code', auth, getItemByCode);
router.get('/items/variants-prefill', auth, getVariantsByItemCode);
router.get('/items/sellable', auth, getSellableItemsForUser);
router.get('/items', auth, getItems);
router.get('/items/:id', auth, getItemById);
router.post('/items', auth, inventoryAdd, createItem);
router.post('/items/upload-image', auth, inventoryAdd, itemUpload.single('image'), uploadItemImage);
router.post('/items/upload-brochure', auth, inventoryAdd, itemUpload.single('brochure'), uploadItemBrochure);
router.post('/items/media/delete', auth, inventoryEdit, deleteItemMedia);
router.post('/items/bulk-delete', auth, inventoryDelete, bulkDeleteItems);
router.put('/items/:id', auth, inventoryEdit, updateItem);
router.delete('/items/:id', auth, inventoryDelete, deleteItem);
router.post('/items/:id/adjust-stock', auth, inventoryEdit, adjustStock);

// Category routes
router.get('/categories', auth, getCategories);
router.post('/categories', auth, inventoryAdd, createCategory);
router.put('/categories/:id', auth, inventoryEdit, updateCategory);
router.delete('/categories/:id', auth, inventoryDelete, deleteCategory);

// Customer category routes
router.get('/customer-categories', auth, getCustomerCategories);
router.post('/customer-categories', auth, inventoryAdd, createCustomerCategory);
router.put('/customer-categories/:id', auth, inventoryEdit, updateCustomerCategory);
router.delete('/customer-categories/:id', auth, inventoryDelete, deleteCustomerCategory);

// Defective inventory routes
const defectiveView = checkPermission('Store', 'defectiveInventory', 'view');
const defectiveEdit = checkPermission('Store', 'defectiveInventory', 'edit');
const defectiveDelete = checkPermission('Store', 'defectiveInventory', 'delete');
router.get('/inventory/defective', auth, authorizeRoles('Store Head', 'Store Employee'), defectiveView, getDefectiveInventory);
router.post('/inventory/defective/repair/:id', auth, authorizeRoles('Store Head', 'Store Employee'), defectiveEdit, repairDefectiveInventory);
router.post('/inventory/defective/scrap/:id', auth, authorizeRoles('Store Head', 'Store Employee'), defectiveDelete, scrapDefectiveInventory);

// Group routes
router.get('/inventory/groups', auth, getGroups);
router.post('/inventory/groups', auth, inventoryAdd, createGroup);
router.put('/inventory/groups/:id', auth, inventoryEdit, updateGroup);
router.delete('/inventory/groups/:id', auth, inventoryDelete, deleteGroup);

// Unit type routes
router.get('/inventory/unit-types', auth, getUnitTypes);
router.post('/inventory/unit-types', auth, inventoryAdd, createUnitType);
router.put('/inventory/unit-types/:id', auth, inventoryEdit, updateUnitType);
router.delete('/inventory/unit-types/:id', auth, inventoryDelete, deleteUnitType);

// Inventory master-option routes (ItemType/ItemCategory/SourceType/ItemSourceType)
router.get('/inventory/master-options', auth, getInventoryDropdownOptions);
router.post('/inventory/master-options', auth, inventoryAdd, addInventoryDropdownOption);
router.put('/inventory/master-options/:id', auth, inventoryEdit, updateInventoryDropdownOption);
router.delete('/inventory/master-options/:id', auth, inventoryDelete, deleteInventoryDropdownOption);

// Utility routes
router.get('/inventory/low-stock', auth, getLowStockItems);
router.get('/inventory/stats', auth, getInventoryStats);

// Production - Store Material Transfer Handshake Routes
const materialTransfersView = checkPermission('Store', 'materialTransfers', 'view');
const materialTransfersEdit = checkPermission('Store', 'materialTransfers', 'edit');
router.get('/inventory/material-issues', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersView, getMaterialIssueLogs);
router.get('/inventory/pending-requests', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersView, getPendingRequests);
router.post('/inventory/transfer-material/:id', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersEdit, transferMaterialToProduction);
router.post('/inventory/transfer-fabrication-material/:id', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersEdit, transferFabricationMaterialToProduction);
router.post('/inventory/bulk-transfer/:id', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersEdit, bulkTransferOrderMaterials);
router.get('/inventory/returned-materials', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersView, getReturnedMaterials);
router.get('/inventory/pending-returns', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersView, getPendingReturns);
router.post('/inventory/confirm-return', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersEdit, confirmReturn);
router.get('/inventory/store-transfer-logs', auth, authorizeRoles("Store Head", "Store Employee"), materialTransfersView, getStoreTransferLogs);

// Excel import/export routes
router.get('/items/export', auth, exportItemsToExcel);
router.post('/inventory/items/import', auth, importItemsFromExcel);
router.get('/categories/export', auth, exportCategoriesToExcel);
router.get('/customer-categories/export', auth, exportCustomerCategoriesToExcel);

export default router;