import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';
import { getSerialNumbers, getQcJobSerials, getStockPicks, getIssuedPicks, getInsidePicks, getDefectivePicks, getScpPiecePicks, getSerialSkips } from '../controllers/purchasedUnitController.js';

// Serial numbers of what Store received from vendors (2026-10-13) — read
// only. For Store (its Serial Numbers tab), QC (ticking rejected serials),
// Purchase, and the Company Admin (checkAnyPermission alone doesn't let that
// role through — same as the price history routes).
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const modules = [['Store', 'purchaseOrders'], ['accounts', 'purchases'], ['quality-control', 'qcInspection']];
const anyView = checkAnyPermission(modules, 'view');
const canView = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : anyView(req, res, next));

router.get('/', canView, getSerialNumbers);
router.get('/skips', canView, getSerialSkips);
router.get('/qc-job/:id', canView, getQcJobSerials);

// Serial number work step 2 (2026-10-31): the pickers — Store (transfer,
// Dispatch handover), Production (return), QC (a from-stock sale), Dispatch,
// Purchase (a piece lost at a vendor), technicians (spare parts on a visit).
const PICK_ROLES = /store|production|quality|qc|dispatch|purchase|complaint/i;
const canPick = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) || PICK_ROLES.test(String(req.user?.role || '')) ? next() : anyView(req, res, next));
router.get('/stock', canPick, getStockPicks);
router.get('/issued', canPick, getIssuedPicks);
router.get('/inside', canPick, getInsidePicks);
router.get('/defective', canPick, getDefectivePicks);
router.get('/scp-pieces', canPick, getScpPiecePicks);

export default router;
