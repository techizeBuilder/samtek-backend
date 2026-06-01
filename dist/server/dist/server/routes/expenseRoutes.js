"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const expenseController_js_1 = require("../controllers/expenseController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
router.get('/', expenseController_js_1.getExpenses);
router.post('/', expenseController_js_1.createExpense);
router.get('/stats', expenseController_js_1.getExpenseStats);
router.put('/:id', expenseController_js_1.updateExpense);
router.delete('/:id', expenseController_js_1.deleteExpense);
exports.default = router;
