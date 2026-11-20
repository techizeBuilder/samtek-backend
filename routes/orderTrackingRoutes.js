// Order tracker (feature 12, 2026-11-14): where a customer's order is.
// docs/client-features-2026-11/12-order-tracker-logic.md
// Open to the Complaint team (complaints.orderTracking) and, by default, the Sales
// Head (sales.orderTracking, view). Always the user's own company.
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission, userHasPermission } from '../middleware/permissions.js';
import { searchOrders, orderView, addNote } from '../services/orderTracking/trackerService.js';

const router = express.Router();
const PAIRS = [['complaints', 'orderTracking'], ['sales', 'orderTracking']];
const canView = checkAnyPermission(PAIRS, 'view');
const canAdd = checkAnyPermission(PAIRS, 'add');
const fail = (res, err) => { console.error('Order tracking error:', err); res.status(500).json({ success: false, message: err.message }); };

router.use(authenticateToken);

// GET /orders?search=&show=open|delivered|all&page=&limit=
router.get('/orders', canView, async (req, res) => {
  try {
    const data = await searchOrders(req.user.companyId, req.query);
    res.json({ success: true, ...data });
  } catch (err) { fail(res, err); }
});

// GET /orders/:orderCode
router.get('/orders/:orderCode', canView, async (req, res) => {
  try {
    const data = await orderView(req.user.companyId, req.params.orderCode);
    if (!data) return res.status(404).json({ success: false, message: 'Order not found.' });
    const isSuper = ['Superadmin', 'Super Admin'].includes(req.user.role);
    const canAddNote = isSuper || PAIRS.some(([m, f]) => userHasPermission(req.user, m, f, 'add'));
    res.json({ success: true, data: { ...data, canAddNote } });
  } catch (err) { fail(res, err); }
});

// POST /orders/:orderCode/notes  { note }
router.post('/orders/:orderCode/notes', canAdd, async (req, res) => {
  try {
    const r = await addNote(req.user.companyId, req.params.orderCode, req.user, req.body?.note);
    if (r.error) return res.status(r.status).json({ success: false, message: r.error });
    res.status(201).json({ success: true, note: r.note });
  } catch (err) { fail(res, err); }
});

export default router;
