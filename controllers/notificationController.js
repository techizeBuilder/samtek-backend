import notificationService from '../services/notificationService.js';
import Notification from '../models/Notification.js';

// Get notifications for current user
export const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const userId = req.user._id;
    const userRole = req.user.role;
    const userUnit = req.user.unit;
    const userCompanyId = req.user.companyId;

    const result = await notificationService.getUserNotifications(
      userId, 
      userRole, 
      userUnit,
      userCompanyId,
      { page, limit, unreadOnly: unreadOnly === 'true' }
    );

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Get unread count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const userUnit = req.user.unit;
    const userCompanyId = req.user.companyId;

    const unreadCount = await notificationService.getUnreadCount(userId, userRole, userUnit, userCompanyId);

    res.json({
      success: true,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
      error: error.message
    });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await notificationService.markAsRead(id, userId);

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const userUnit = req.user.unit;
    const userCompanyId = req.user.companyId;

    const result = await notificationService.markAllAsRead(userId, userRole, userUnit, userCompanyId);

    res.json({
      success: true,
      message: `${result.markedCount} notifications marked as read`,
      markedCount: result.markedCount
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error.message
    });
  }
};

// Create test notification (for development)
export const createTestNotification = async (req, res) => {
  try {
    const { title, message, type, targetRole, targetUnit, targetCompanyId } = req.body;

    const notification = await notificationService.createNotification({
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      type: type || 'general',
      targetRole: targetRole || 'all',
      targetUnit: targetUnit || null,
      targetCompanyId: targetCompanyId || null,
      priority: 'medium'
    });

    res.json({
      success: true,
      message: 'Test notification created',
      notification
    });
  } catch (error) {
    console.error('Error creating test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test notification',
      error: error.message
    });
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Only allow deletion if user is Super User or it's their personal notification
    const notification = await Notification.findById(id);
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    if (userRole !== 'Super Admin' && notification.targetUserId?.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    await Notification.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};

