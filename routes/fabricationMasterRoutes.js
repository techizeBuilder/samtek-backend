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

// Permission gates (module: 'rnd', feature: 'fabricationMaster') — matches
// Samtek-Frontend/client/src/lib/roleModulesConfig.js's rnd.features entry.
const fabricationMasterView = checkPermission('rnd', 'fabricationMaster', 'view');
const fabricationMasterAdd = checkPermission('rnd', 'fabricationMaster', 'add');
const fabricationMasterEdit = checkPermission('rnd', 'fabricationMaster', 'edit');

router.get('/categories', fabricationMasterView, getCategories);
router.get('/sections/:family', fabricationMasterView, getSectionTableForFamily);
router.post('/calculate-weight', fabricationMasterView, calculateWeight);
router.get('/items', fabricationMasterView, getFabricationItems);
router.get('/next-code', fabricationMasterView, suggestNextCode);
router.post('/items', fabricationMasterAdd, createFabricationItem);
router.put('/items/:id', fabricationMasterEdit, updateFabricationItem);
router.put('/items/:id/status', fabricationMasterEdit, setFabricationItemStatus);

export default router;
