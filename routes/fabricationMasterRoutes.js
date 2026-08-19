import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getCategories,
  getSectionTableForFamily,
  calculateWeight,
  getMaterials,
  createMaterial,
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

// /categories, /sections/:family, and /calculate-weight are pure reference
// data + stateless math — getCategories returns a hardcoded constant (no DB
// read, no company scoping at all) and calculateWeight is a pure function
// over the request body. No Fabrication Master catalog data is exposed by
// either. Store (BOM/Production/Purchase-receiving dimension entry — none of
// which have an 'rnd' permissions module) needs these same three, so they're
// just authenticated, not gated behind R&D's own inventory permission like
// the actual catalog CRUD below still is.
router.get('/categories', getCategories);
router.get('/sections/:family', getSectionTableForFamily);
router.post('/calculate-weight', calculateWeight);
router.get('/materials', getMaterials);
router.post('/materials', fabricationMasterAdd, createMaterial);
router.get('/items', fabricationMasterView, getFabricationItems);
router.get('/next-code', fabricationMasterView, suggestNextCode);
router.post('/items', fabricationMasterAdd, createFabricationItem);
router.put('/items/:id', fabricationMasterEdit, updateFabricationItem);
router.put('/items/:id/status', fabricationMasterEdit, setFabricationItemStatus);

export default router;
