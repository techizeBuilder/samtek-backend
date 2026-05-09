import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  checkExistingOrder
} from '../controllers/orderController.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/check-existing', checkExistingOrder);
router.get('/:id', getOrderById);
router.put('/:id', updateOrder);
router.patch('/:id/status', updateOrderStatus);

router.delete('/:id', deleteOrder);

export default router;