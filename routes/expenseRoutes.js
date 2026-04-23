import express from 'express';
import {
    getExpenses,
    createExpense,
    updateExpense,
    deleteExpense,
    getExpenseStats
} from '../controllers/expenseController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getExpenses);
router.post('/', createExpense);
router.get('/stats', getExpenseStats);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);

export default router;
