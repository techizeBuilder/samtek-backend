import express from 'express';
import { getFinanceSummary } from '../controllers/financeController.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateToken);

const reportsView = checkPermission('accounts', 'reports', 'view');

router.get('/summary', reportsView, getFinanceSummary);

export default router;
