"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const returnController_js_1 = require("../controllers/returnController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = express_1.default.Router();
// Validation rules for return creation
const createReturnValidation = [
    (0, express_validator_1.body)('customerId')
        .notEmpty()
        .withMessage('Customer ID is required')
        .isMongoId()
        .withMessage('Invalid customer ID'),
    (0, express_validator_1.body)('returnDate')
        .optional()
        .isISO8601()
        .withMessage('Invalid return date format'),
    (0, express_validator_1.body)('reason')
        .notEmpty()
        .withMessage('Reason is required')
        .isLength({ min: 5 })
        .withMessage('Reason must be at least 5 characters long'),
    (0, express_validator_1.body)('items')
        .isArray({ min: 1 })
        .withMessage('At least one item is required'),
    (0, express_validator_1.body)('items.*.productId')
        .notEmpty()
        .withMessage('Product ID is required')
        .isMongoId()
        .withMessage('Invalid product ID'),
    (0, express_validator_1.body)('items.*.brandId')
        .optional()
        .isMongoId()
        .withMessage('Invalid brand ID'),
    (0, express_validator_1.body)('items.*.productName')
        .notEmpty()
        .withMessage('Product name is required'),
    (0, express_validator_1.body)('items.*.pricePerUnit')
        .isNumeric()
        .withMessage('Price per unit must be numeric')
        .isFloat({ min: 0 })
        .withMessage('Price per unit must be positive'),
    (0, express_validator_1.body)('items.*.quantity')
        .isInt({ min: 1 })
        .withMessage('Quantity must be at least 1'),
    (0, express_validator_1.body)('type')
        .optional()
        .isIn(['refund', 'damage'])
        .withMessage('Type must be either refund or damage')
];
// Validation rules for return update
const updateReturnValidation = [
    (0, express_validator_1.body)('customerId')
        .optional()
        .isMongoId()
        .withMessage('Invalid customer ID'),
    (0, express_validator_1.body)('returnDate')
        .optional()
        .isISO8601()
        .withMessage('Invalid return date format'),
    (0, express_validator_1.body)('reason')
        .optional()
        .isLength({ min: 5 })
        .withMessage('Reason must be at least 5 characters long'),
    (0, express_validator_1.body)('items')
        .optional()
        .isArray({ min: 1 })
        .withMessage('At least one item is required'),
    (0, express_validator_1.body)('items.*.productId')
        .optional()
        .isMongoId()
        .withMessage('Invalid product ID'),
    (0, express_validator_1.body)('items.*.brandId')
        .optional()
        .isMongoId()
        .withMessage('Invalid brand ID'),
    (0, express_validator_1.body)('items.*.pricePerUnit')
        .optional()
        .isNumeric()
        .withMessage('Price per unit must be numeric')
        .isFloat({ min: 0 })
        .withMessage('Price per unit must be positive'),
    (0, express_validator_1.body)('items.*.quantity')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Quantity must be at least 1'),
    (0, express_validator_1.body)('status')
        .optional()
        .isIn(['pending', 'approved', 'completed', 'rejected'])
        .withMessage('Invalid status'),
    (0, express_validator_1.body)('type')
        .optional()
        .isIn(['refund', 'damage'])
        .withMessage('Type must be either refund or damage')
];
// Routes
router.get('/stats', auth_js_1.authenticateToken, returnController_js_1.getReturnStats);
router.get('/', auth_js_1.authenticateToken, returnController_js_1.getAllReturns);
router.get('/:id', auth_js_1.authenticateToken, returnController_js_1.getReturnById);
router.post('/', auth_js_1.authenticateToken, createReturnValidation, returnController_js_1.createReturn);
router.put('/:id', auth_js_1.authenticateToken, updateReturnValidation, returnController_js_1.updateReturn);
router.patch('/:id/status', auth_js_1.authenticateToken, returnController_js_1.updateReturnStatus);
router.delete('/:id', auth_js_1.authenticateToken, returnController_js_1.deleteReturn);
exports.default = router;
