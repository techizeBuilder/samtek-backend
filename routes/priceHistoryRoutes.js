import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { listPricedItems, getPriceHistory } from '../controllers/priceHistoryController.js';

// Price history (2026-10-12) — read only. For Purchase (anyone who can see
// purchases) and the Company Admin (checkPermission alone doesn't let the
// Company Admin role through, hence the role check first — same as the audit log).
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const purchasesView = checkPermission('accounts', 'purchases', 'view');
const canSeePrices = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : purchasesView(req, res, next));

router.get('/items', canSeePrices, listPricedItems);
router.get('/', canSeePrices, getPriceHistory);

export default router;
