import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { verifyPassword, verifyOtp, viewCash } from '../controllers/cashAccessController.js';

const router = express.Router();
router.use(authenticateToken);

const ACCOUNTS_ROLES = ['Accounts', 'Accounts Head', 'Account Employee', 'Superadmin', 'Super Admin'];
router.use(authorizeRoles(...ACCOUNTS_ROLES));

router.post('/verify-password', verifyPassword);
router.post('/verify-otp', verifyOtp);
router.get('/:requestId/view', viewCash);

export default router;
