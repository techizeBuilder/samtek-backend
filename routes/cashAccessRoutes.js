import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { verifyPassword, verifyOtp, viewCash, markCashReceived } from '../controllers/cashAccessController.js';

const router = express.Router();
router.use(authenticateToken);

const ACCOUNTS_ROLES = ['Accounts', 'Accounts Head', 'Account Employee', 'Superadmin', 'Super Admin'];
router.use(authorizeRoles(...ACCOUNTS_ROLES));

const bankAndCashView = checkPermission('accounts', 'bankAndCash', 'view');
const bankAndCashEdit = checkPermission('accounts', 'bankAndCash', 'edit');

router.post('/verify-password',       bankAndCashView, verifyPassword);
router.post('/verify-otp',            bankAndCashView, verifyOtp);
router.get('/:requestId/view',        bankAndCashView, viewCash);
router.post('/:requestId/mark-received', bankAndCashEdit, markCashReceived);

export default router;
