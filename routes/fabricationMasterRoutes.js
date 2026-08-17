import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getCategories,
  getSectionTableForFamily,
  calculateWeight,
  getFabricationItems,
  suggestNextCode,
  createFabricationItem,
  updateFabricationItem,
  setFabricationItemStatus,
} from '../controllers/fabricationMasterController.js';

const router = express.Router();
router.use(authenticateToken);

// Permission gates (module: 'rnd', feature: 'inventory') — Fabrication Master
// is reached from the Inventory page and isn't its own module/feature entry
// in Samtek-Frontend/client/src/lib/roleModulesConfig.js; access rides on
// whatever Inventory permission the user already has.
const fabricationMasterView = checkPermission('rnd', 'inventory', 'view');
const fabricationMasterAdd = checkPermission('rnd', 'inventory', 'add');
const fabricationMasterEdit = checkPermission('rnd', 'inventory', 'edit');

router.get('/categories', fabricationMasterView, getCategories);
router.get('/sections/:family', fabricationMasterView, getSectionTableForFamily);
router.post('/calculate-weight', fabricationMasterView, calculateWeight);
router.get('/items', fabricationMasterView, getFabricationItems);
router.get('/next-code', fabricationMasterView, suggestNextCode);
router.post('/items', fabricationMasterAdd, createFabricationItem);
router.put('/items/:id', fabricationMasterEdit, updateFabricationItem);
router.put('/items/:id/status', fabricationMasterEdit, setFabricationItemStatus);

export default router;
