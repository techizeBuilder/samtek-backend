import express from 'express';
import { body } from 'express-validator';
import {
  getAllReturns,
  getReturnById,
  createReturn,
  updateReturn,
  updateReturnStatus,
  deleteReturn,
  getReturnStats
} from '../controllers/returnController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation rules for return creation
const createReturnValidation = [
  body('customerId')
    .notEmpty()
    .withMessage('Customer ID is required')
    .isMongoId()
    .withMessage('Invalid customer ID'),
  
  body('returnDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid return date format'),
  
  body('reason')
    .notEmpty()
    .withMessage('Reason is required')
    .isLength({ min: 5 })
    .withMessage('Reason must be at least 5 characters long'),
  
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  
  body('items.*.productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .isMongoId()
    .withMessage('Invalid product ID'),
  
  body('items.*.brandId')
    .optional()
    .isMongoId()
    .withMessage('Invalid brand ID'),
  
  body('items.*.productName')
    .notEmpty()
    .withMessage('Product name is required'),
  
  body('items.*.pricePerUnit')
    .isNumeric()
    .withMessage('Price per unit must be numeric')
    .isFloat({ min: 0 })
    .withMessage('Price per unit must be positive'),
  
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  
  body('type')
    .optional()
    .isIn(['refund', 'damage'])
    .withMessage('Type must be either refund or damage')
];

// Validation rules for return update
const updateReturnValidation = [
  body('customerId')
    .optional()
    .isMongoId()
    .withMessage('Invalid customer ID'),
  
  body('returnDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid return date format'),
  
  body('reason')
    .optional()
    .isLength({ min: 5 })
    .withMessage('Reason must be at least 5 characters long'),
  
  body('items')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  
  body('items.*.productId')
    .optional()
    .isMongoId()
    .withMessage('Invalid product ID'),
  
  body('items.*.brandId')
    .optional()
    .isMongoId()
    .withMessage('Invalid brand ID'),
  
  body('items.*.pricePerUnit')
    .optional()
    .isNumeric()
    .withMessage('Price per unit must be numeric')
    .isFloat({ min: 0 })
    .withMessage('Price per unit must be positive'),
  
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  
  body('status')
    .optional()
    .isIn(['pending', 'approved', 'completed', 'rejected'])
    .withMessage('Invalid status'),
  
  body('type')
    .optional()
    .isIn(['refund', 'damage'])
    .withMessage('Type must be either refund or damage')
];

// Routes
router.get('/stats', authenticateToken, getReturnStats);
router.get('/', authenticateToken, getAllReturns);
router.get('/:id', authenticateToken, getReturnById);
router.post('/', authenticateToken, createReturnValidation, createReturn);
router.put('/:id', authenticateToken, updateReturnValidation, updateReturn);
router.patch('/:id/status', authenticateToken, updateReturnStatus);
router.delete('/:id', authenticateToken, deleteReturn);

export default router;