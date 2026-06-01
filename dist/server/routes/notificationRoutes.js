"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const notificationController_js_1 = require("../controllers/notificationController.js");
const router = express_1.default.Router();
// Get notifications for current user
router.get('/notifications', auth_js_1.authenticateToken, notificationController_js_1.getNotifications);
// Get unread count
router.get('/notifications/unread-count', auth_js_1.authenticateToken, notificationController_js_1.getUnreadCount);
// Mark notification as read
router.patch('/notifications/:id/read', auth_js_1.authenticateToken, notificationController_js_1.markAsRead);
// Mark all notifications as read
router.patch('/notifications/mark-all-read', auth_js_1.authenticateToken, notificationController_js_1.markAllAsRead);
// Create test notification (development only)
router.post('/notifications/test', auth_js_1.authenticateToken, notificationController_js_1.createTestNotification);
// Delete notification
router.delete('/notifications/:id', auth_js_1.authenticateToken, notificationController_js_1.deleteNotification);
exports.default = router;
