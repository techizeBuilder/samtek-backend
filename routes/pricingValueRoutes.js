/** @format */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { getPricingItems, updatePricingItem } from '../controllers/pricingValueController.js';

const router = express.Router();
router.use(authenticateToken);

const pricingValueView = checkPermission('hrms', 'pricingValue', 'view');
const pricingValueEdit = checkPermission('hrms', 'pricingValue', 'edit');

router.get('/items', pricingValueView, getPricingItems);
router.put('/items/:id', pricingValueEdit, updatePricingItem);

export default router;
