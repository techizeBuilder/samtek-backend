import express from 'express';
import { getFinanceSummary } from '../controllers/financeController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/summary', getFinanceSummary);

export default router;
