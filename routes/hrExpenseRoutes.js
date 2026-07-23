import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getHrExpenseCategories,
  createHrExpense,
  getHrExpenses,
  getHrExpenseSummary,
  updateHrExpense,
  deleteHrExpense,
} from '../controllers/hrExpenseController.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/categories', getHrExpenseCategories);
router.get('/summary', getHrExpenseSummary);
router.get('/', getHrExpenses);
router.post('/', createHrExpense);
router.put('/:id', updateHrExpense);
router.delete('/:id', deleteHrExpense);

export default router;
