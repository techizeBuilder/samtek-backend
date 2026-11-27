import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { hrRoleSwitch } from '../middleware/permissions.js'; // security re-check M5 (27 Nov 2026): HR needs the HR Expenses switch
import {
  getHrExpenseCategories,
  createHrExpense,
  getHrExpenses,
  getHrExpenseSummary,
  updateHrExpense,
  deleteHrExpense,
} from '../controllers/hrExpenseController.js';

const router = express.Router();
// Security check day 3 (26 Nov 2026, finding 3): any login could list, add, edit or delete their company's
// HR expenses. Now HR / the Company Admin (the Super Admin too), the roles HR's Expenses page is for.
router.use(authenticateToken, authorizeRoles('HR-Admin', 'Hr Admin', 'Company Admin', 'Super Admin', 'Superadmin'));

router.get('/categories', hrRoleSwitch('hrExpenses', 'view'), getHrExpenseCategories);
router.get('/summary', hrRoleSwitch('hrExpenses', 'view'), getHrExpenseSummary);
router.get('/', hrRoleSwitch('hrExpenses', 'view'), getHrExpenses);
router.post('/', hrRoleSwitch('hrExpenses', 'add'), createHrExpense);
router.put('/:id', hrRoleSwitch('hrExpenses', 'edit'), updateHrExpense);
router.delete('/:id', hrRoleSwitch('hrExpenses', 'delete'), deleteHrExpense);

export default router;
