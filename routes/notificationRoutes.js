import express from 'express';
import { authenticateToken as auth } from '../middleware/auth.js';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  createTestNotification,
  deleteNotification
} from '../controllers/notificationController.js';

const router = express.Router();

// Get notifications for current user
router.get('/notifications', auth, getNotifications);

// Get unread count
router.get('/notifications/unread-count', auth, getUnreadCount);

// Mark notification as read
router.patch('/notifications/:id/read', auth, markAsRead);

// Mark all notifications as read
router.patch('/notifications/mark-all-read', auth, markAllAsRead);

// Create test notification (development only)
router.post('/notifications/test', auth, createTestNotification);

// Delete notification
router.delete('/notifications/:id', auth, deleteNotification);

export default router;