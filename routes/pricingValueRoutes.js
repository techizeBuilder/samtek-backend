/** @format */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getPricingItems, updatePricingItem } from '../controllers/pricingValueController.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/items', getPricingItems);
router.put('/items/:id', updatePricingItem);

export default router;
