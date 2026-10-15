import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { getPurchaserScores, getPurchaserScore, isScoreAdmin } from '../controllers/purchaserScoreController.js';

// Purchaser score (2026-10-13). The Company Admin sees everyone; anyone who
// can view Purchases sees only their own (the controller narrows it).
const router = express.Router();
router.use(authenticateToken);

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const canSee = (req, res, next) => (isScoreAdmin(req.user) ? next() : purchasesView(req, res, next));

router.get('/', canSee, getPurchaserScores);
router.get('/:userId', canSee, getPurchaserScore);

export default router;
