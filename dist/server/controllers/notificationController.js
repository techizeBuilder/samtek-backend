"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteNotification = exports.createTestNotification = exports.markAllAsRead = exports.markAsRead = exports.getUnreadCount = exports.getNotifications = void 0;
const notificationService_js_1 = __importDefault(require("../services/notificationService.js"));
const Notification_js_1 = __importDefault(require("../models/Notification.js"));
// Get notifications for current user
const getNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;
        const userUnit = req.user.unit;
        const userCompanyId = req.user.companyId;
        const result = yield notificationService_js_1.default.getUserNotifications(userId, userRole, userUnit, userCompanyId, { page, limit, unreadOnly: unreadOnly === 'true' });
        res.json(Object.assign({ success: true }, result));
    }
    catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
});
exports.getNotifications = getNotifications;
// Get unread count
const getUnreadCount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const userUnit = req.user.unit;
        const userCompanyId = req.user.companyId;
        const unreadCount = yield notificationService_js_1.default.getUnreadCount(userId, userRole, userUnit, userCompanyId);
        res.json({
            success: true,
            unreadCount
        });
    }
    catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unread count',
            error: error.message
        });
    }
});
exports.getUnreadCount = getUnreadCount;
// Mark notification as read
const markAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const notification = yield notificationService_js_1.default.markAsRead(id, userId);
        res.json({
            success: true,
            message: 'Notification marked as read',
            notification
        });
    }
    catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read',
            error: error.message
        });
    }
});
exports.markAsRead = markAsRead;
// Mark all notifications as read
const markAllAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const userUnit = req.user.unit;
        const userCompanyId = req.user.companyId;
        const result = yield notificationService_js_1.default.markAllAsRead(userId, userRole, userUnit, userCompanyId);
        res.json({
            success: true,
            message: `${result.markedCount} notifications marked as read`,
            markedCount: result.markedCount
        });
    }
    catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark all notifications as read',
            error: error.message
        });
    }
});
exports.markAllAsRead = markAllAsRead;
// Create test notification (for development)
const createTestNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, message, type, targetRole, targetUnit, targetCompanyId } = req.body;
        const notification = yield notificationService_js_1.default.createNotification({
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
    }
    catch (error) {
        console.error('Error creating test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create test notification',
            error: error.message
        });
    }
});
exports.createTestNotification = createTestNotification;
// Delete notification
const deleteNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;
        // Only allow deletion if user is Super User or it's their personal notification
        const notification = yield Notification_js_1.default.findById(id);
        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }
        if (userRole !== 'Superadmin' && ((_a = notification.targetUserId) === null || _a === void 0 ? void 0 : _a.toString()) !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Permission denied'
            });
        }
        yield Notification_js_1.default.findByIdAndDelete(id);
        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message
        });
    }
});
exports.deleteNotification = deleteNotification;
