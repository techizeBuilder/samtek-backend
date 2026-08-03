import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { listEstimableItems, predictItems } from '../controllers/deliveryEstimateController.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/items', listEstimableItems);
router.post('/predict', predictItems);

export default router;
