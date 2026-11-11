import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { listPartLabels, listPartLabelGroups, getWaitingForItem, postPartLabelsBulk, getLabelCandidates, putPartLabel } from '../controllers/partLabelController.js';

// Store → Label carriers (serial number work step 2, 2026-10-31). Store labels;
// the Company Admin can look.
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const isStore = (req) => /store/i.test(String(req.user?.role || ''));
const canView = (req, res, next) => (isStore(req) || ADMIN_ROLES.includes(req.user?.role) ? next() : res.status(403).json({ success: false, message: 'Store only.' }));
const canLabel = (req, res, next) => (isStore(req) ? next() : res.status(403).json({ success: false, message: 'Only Store labels parts.' }));

router.get('/', canView, listPartLabels);
router.get('/groups', canView, listPartLabelGroups);
router.get('/waiting/:itemId', canView, getWaitingForItem);
router.post('/bulk', canLabel, postPartLabelsBulk);
router.get('/:id/candidates', canView, getLabelCandidates);
router.put('/:id', canLabel, putPartLabel);

export default router;
