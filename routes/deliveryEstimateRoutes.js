import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { listEstimableItems, predictItems } from '../controllers/deliveryEstimateController.js';

const router = express.Router();

router.use(authenticateToken);

const ordersView = checkPermission('sales', 'orders', 'view');

router.get('/items', ordersView, listEstimableItems);
router.post('/predict', ordersView, predictItems);

export default router;
