"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Notification_js_1 = __importDefault(require("../models/Notification.js"));
const pusher_js_1 = __importDefault(require("../config/pusher.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Settings_js_1 = __importDefault(require("../models/Settings.js"));
class NotificationService {
    // Create and broadcast notification
    createNotification(_a) {
        return __awaiter(this, arguments, void 0, function* ({ title, message, type = 'general', icon = 'bell', targetRole = 'all', targetUserId = null, targetUnit = null, targetCompanyId = null, data = {}, priority = 'medium' }) {
            try {
                // Create notification in database
                const notification = new Notification_js_1.default({
                    title,
                    message,
                    type,
                    icon,
                    targetRole,
                    targetUserId,
                    targetUnit,
                    targetCompanyId,
                    data,
                    priority
                });
                yield notification.save();
                // Prepare notification payload
                const notificationPayload = {
                    id: notification._id,
                    title: notification.title,
                    message: notification.message,
                    type: notification.type,
                    icon: notification.icon,
                    priority: notification.priority,
                    data: notification.data,
                    createdAt: notification.createdAt
                };
                // Broadcast to appropriate channels
                if (targetUserId) {
                    // Send to specific user
                    yield pusher_js_1.default.trigger(`user-${targetUserId}`, 'notification', notificationPayload);
                }
                else {
                    // Send to role-based channels with unit/company specificity
                    if (targetRole === 'all') {
                        yield pusher_js_1.default.trigger('notifications-all', 'notification', notificationPayload);
                    }
                    else {
                        const baseChannel = `notifications-${targetRole.toLowerCase().replace(' ', '-')}`;
                        // Send to role-specific channel
                        yield pusher_js_1.default.trigger(baseChannel, 'notification', notificationPayload);
                        // Send to unit-specific channel if unit is specified
                        if (targetUnit) {
                            yield pusher_js_1.default.trigger(`${baseChannel}-unit-${targetUnit}`, 'notification', notificationPayload);
                        }
                        // Send to company-specific channel if company is specified
                        if (targetCompanyId) {
                            yield pusher_js_1.default.trigger(`${baseChannel}-company-${targetCompanyId}`, 'notification', notificationPayload);
                        }
                    }
                }
                return notification;
            }
            catch (error) {
                console.error('Error creating notification:', error);
                throw error;
            }
        });
    }
    // Get notifications for a user
    getUserNotifications(userId_1, userRole_1) {
        return __awaiter(this, arguments, void 0, function* (userId, userRole, userUnit = null, userCompanyId = null, { page = 1, limit = 20, unreadOnly = false } = {}) {
            var _a, _b, _c;
            try {
                // Check if notifications are enabled for this role
                const settings = yield Settings_js_1.default.getSettings();
                // Get the role key mapping for settings
                const roleKeyMapping = {
                    'Sales': 'salesPerson',
                    'Unit Head': 'unitHead',
                    'Unit Manager': 'unitManager',
                    'Production': 'production',
                    'Accounts': 'accounts',
                    'Superadmin': 'superAdmin'
                };
                const roleKey = roleKeyMapping[userRole];
                // If role notifications are disabled, return empty result
                if (roleKey && ((_c = (_b = (_a = settings.notifications) === null || _a === void 0 ? void 0 : _a.roleSettings) === null || _b === void 0 ? void 0 : _b[roleKey]) === null || _c === void 0 ? void 0 : _c.enabled) === false) {
                    return {
                        notifications: [],
                        pagination: {
                            page: parseInt(page),
                            limit: parseInt(limit),
                            total: 0,
                            pages: 0
                        },
                        unreadCount: 0
                    };
                }
                const skip = (page - 1) * limit;
                let query = {
                    $and: [
                        {
                            $or: [
                                { targetRole: 'all' },
                                { targetRole: userRole },
                                { targetUserId: userId }
                            ]
                        }
                    ]
                };
                // Apply unit and company filtering based on role
                if (userRole === 'Superadmin') {
                    // Super Admin sees all notifications - no additional filtering
                }
                else if (userRole === 'Unit Head' || userRole === 'Unit Manager' || userRole === 'Sales' ||
                    userRole === 'Production' || userRole === 'Manufacturing' || userRole === 'Packing' ||
                    userRole === 'Dispatch' || userRole === 'Accounts') {
                    // Unit-based roles should only see notifications for their unit/company or global ones
                    const unitCompanyFilters = [];
                    // Add unit filtering if user has a unit
                    if (userUnit) {
                        unitCompanyFilters.push({ targetUnit: userUnit });
                    }
                    // Add company filtering if user has a company
                    if (userCompanyId) {
                        unitCompanyFilters.push({ targetCompanyId: userCompanyId });
                    }
                    // Add global notifications (no specific unit or company target)
                    unitCompanyFilters.push({ targetUnit: null, targetCompanyId: null });
                    if (unitCompanyFilters.length > 0) {
                        query.$and.push({ $or: unitCompanyFilters });
                    }
                }
                if (unreadOnly) {
                    query.$and.push({ 'isRead.userId': { $ne: userId } });
                }
                const notifications = yield Notification_js_1.default
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .populate('targetUserId', 'username fullName')
                    .populate('targetCompanyId', 'name unitName city state')
                    .lean();
                // Add isRead status for each notification
                const notificationsWithReadStatus = notifications.map(notification => (Object.assign(Object.assign({}, notification), { isReadByUser: notification.isRead.some(read => read.userId.toString() === userId.toString()) })));
                const total = yield Notification_js_1.default.countDocuments(query);
                const unreadCount = yield this.getUnreadCount(userId, userRole, userUnit, userCompanyId);
                return {
                    notifications: notificationsWithReadStatus,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        pages: Math.ceil(total / limit)
                    },
                    unreadCount
                };
            }
            catch (error) {
                console.error('Error fetching notifications:', error);
                throw error;
            }
        });
    }
    // Mark notification as read
    markAsRead(notificationId, userId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const notification = yield Notification_js_1.default.findById(notificationId);
                if (!notification) {
                    throw new Error('Notification not found');
                }
                // Check if already marked as read by this user
                const alreadyRead = notification.isRead.some(read => read.userId.toString() === userId.toString());
                if (!alreadyRead) {
                    notification.isRead.push({
                        userId,
                        readAt: new Date()
                    });
                    yield notification.save();
                }
                return notification;
            }
            catch (error) {
                console.error('Error marking notification as read:', error);
                throw error;
            }
        });
    }
    // Mark all notifications as read for a user
    markAllAsRead(userId_1, userRole_1) {
        return __awaiter(this, arguments, void 0, function* (userId, userRole, userUnit = null, userCompanyId = null) {
            var _a, _b, _c;
            try {
                // Check if notifications are enabled for this role
                const settings = yield Settings_js_1.default.getSettings();
                // Get the role key mapping for settings
                const roleKeyMapping = {
                    'Sales': 'salesPerson',
                    'Unit Head': 'unitHead',
                    'Unit Manager': 'unitManager',
                    'Production': 'production',
                    'Accounts': 'accounts',
                    'Superadmin': 'superAdmin'
                };
                const roleKey = roleKeyMapping[userRole];
                // If role notifications are disabled, return 0
                if (roleKey && ((_c = (_b = (_a = settings.notifications) === null || _a === void 0 ? void 0 : _a.roleSettings) === null || _b === void 0 ? void 0 : _b[roleKey]) === null || _c === void 0 ? void 0 : _c.enabled) === false) {
                    return { markedCount: 0 };
                }
                let query = {
                    $and: [
                        {
                            $or: [
                                { targetRole: 'all' },
                                { targetRole: userRole },
                                { targetUserId: userId }
                            ]
                        },
                        {
                            'isRead.userId': { $ne: userId }
                        }
                    ]
                };
                // Apply unit and company filtering based on role (same as getUserNotifications)
                if (userRole === 'Superadmin') {
                    // Super Admin sees all notifications - no additional filtering
                }
                else if (userRole === 'Unit Head' || userRole === 'Unit Manager' || userRole === 'Sales' ||
                    userRole === 'Production' || userRole === 'Manufacturing' || userRole === 'Packing' ||
                    userRole === 'Dispatch' || userRole === 'Accounts') {
                    const unitCompanyFilters = [];
                    if (userUnit) {
                        unitCompanyFilters.push({ targetUnit: userUnit });
                    }
                    if (userCompanyId) {
                        unitCompanyFilters.push({ targetCompanyId: userCompanyId });
                    }
                    // Add global notifications
                    unitCompanyFilters.push({ targetUnit: null, targetCompanyId: null });
                    if (unitCompanyFilters.length > 0) {
                        query.$and.push({ $or: unitCompanyFilters });
                    }
                }
                const notifications = yield Notification_js_1.default.find(query);
                const updatePromises = notifications.map(notification => {
                    notification.isRead.push({
                        userId,
                        readAt: new Date()
                    });
                    return notification.save();
                });
                yield Promise.all(updatePromises);
                return { markedCount: notifications.length };
            }
            catch (error) {
                console.error('Error marking all notifications as read:', error);
                throw error;
            }
        });
    }
    // Get unread count for user
    getUnreadCount(userId_1, userRole_1) {
        return __awaiter(this, arguments, void 0, function* (userId, userRole, userUnit = null, userCompanyId = null) {
            var _a, _b, _c;
            try {
                // Check if notifications are enabled for this role
                const settings = yield Settings_js_1.default.getSettings();
                // Get the role key mapping for settings
                const roleKeyMapping = {
                    'Sales': 'salesPerson',
                    'Unit Head': 'unitHead',
                    'Unit Manager': 'unitManager',
                    'Production': 'production',
                    'Accounts': 'accounts',
                    'Superadmin': 'superAdmin'
                };
                const roleKey = roleKeyMapping[userRole];
                // If role notifications are disabled, return 0
                if (roleKey && ((_c = (_b = (_a = settings.notifications) === null || _a === void 0 ? void 0 : _a.roleSettings) === null || _b === void 0 ? void 0 : _b[roleKey]) === null || _c === void 0 ? void 0 : _c.enabled) === false) {
                    return 0;
                }
                return yield Notification_js_1.default.getUnreadCount(userId, userRole, userUnit, userCompanyId);
            }
            catch (error) {
                console.error('Error getting unread count:', error);
                throw error;
            }
        });
    }
    // ========================================
    // WORKFLOW-BASED NOTIFICATION SYSTEM
    // ========================================
    // 1. SALES -> Unit Manager + Unit Head
    triggerSalesNotification(_a) {
        return __awaiter(this, arguments, void 0, function* ({ action, orderData, customerData, targetUnit, targetCompanyId, userId }) {
            const notifications = [];
            if (action === 'order_created' || action === 'order_updated' || action === 'order_deleted') {
                const actionText = action === 'order_created' ? 'created' : action === 'order_updated' ? 'updated' : 'deleted';
                // Notify Unit Manager
                notifications.push(this.createNotification({
                    title: `Order ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}`,
                    message: `Order ${orderData.orderCode} has been ${actionText} by Sales`,
                    type: 'order',
                    icon: 'shopping-cart',
                    targetRole: 'Unit Manager',
                    targetUnit,
                    targetCompanyId,
                    data: { orderId: orderData._id, orderCode: orderData.orderCode, action },
                    priority: 'high'
                }));
                // Notify Unit Head
                notifications.push(this.createNotification({
                    title: `Order ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}`,
                    message: `Order ${orderData.orderCode} has been ${actionText} by Sales`,
                    type: 'order',
                    icon: 'shopping-cart',
                    targetRole: 'Unit Head',
                    targetUnit,
                    targetCompanyId,
                    data: { orderId: orderData._id, orderCode: orderData.orderCode, action },
                    priority: 'high'
                }));
                // Always notify Super Admin
                notifications.push(this.createNotification({
                    title: `Order ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}`,
                    message: `Order ${orderData.orderCode} has been ${actionText}`,
                    type: 'order',
                    icon: 'shopping-cart',
                    targetRole: 'Superadmin',
                    data: { orderId: orderData._id, orderCode: orderData.orderCode, action },
                    priority: 'medium'
                }));
            }
            if (action === 'customer_added') {
                // Notify Unit Manager
                notifications.push(this.createNotification({
                    title: 'New Customer Added',
                    message: `${customerData.name} has been registered by Sales`,
                    type: 'customer',
                    icon: 'user-plus',
                    targetRole: 'Unit Manager',
                    targetUnit,
                    targetCompanyId,
                    data: { customerId: customerData._id, customerName: customerData.name },
                    priority: 'medium'
                }));
                // Notify Unit Head
                notifications.push(this.createNotification({
                    title: 'New Customer Added',
                    message: `${customerData.name} has been registered by Sales`,
                    type: 'customer',
                    icon: 'user-plus',
                    targetRole: 'Unit Head',
                    targetUnit,
                    targetCompanyId,
                    data: { customerId: customerData._id, customerName: customerData.name },
                    priority: 'medium'
                }));
            }
            return Promise.all(notifications);
        });
    }
    // 2. UNIT MANAGER -> Production
    triggerUnitManagerToProduction(_a) {
        return __awaiter(this, arguments, void 0, function* ({ action, orderData, productionData, targetUnit, targetCompanyId }) {
            const notifications = [];
            // Notify Production
            notifications.push(this.createNotification({
                title: 'Production Request',
                message: `Unit Manager has sent order ${(orderData === null || orderData === void 0 ? void 0 : orderData.orderCode) || 'N/A'} for production`,
                type: 'order',
                icon: 'factory',
                targetRole: 'Production',
                targetUnit,
                targetCompanyId,
                data: {
                    orderId: orderData === null || orderData === void 0 ? void 0 : orderData._id,
                    orderCode: orderData === null || orderData === void 0 ? void 0 : orderData.orderCode,
                    productionId: productionData === null || productionData === void 0 ? void 0 : productionData._id,
                    action: 'production_request'
                },
                priority: 'high'
            }));
            // Notify Super Admin
            notifications.push(this.createNotification({
                title: 'Production Request Sent',
                message: `Unit Manager sent order for production`,
                type: 'order',
                icon: 'factory',
                targetRole: 'Superadmin',
                data: { orderId: orderData === null || orderData === void 0 ? void 0 : orderData._id, action: 'production_request' },
                priority: 'low'
            }));
            return Promise.all(notifications);
        });
    }
    // 3. PRODUCTION (Approve) -> Unit Manager + Package
    triggerProductionApproval(_a) {
        return __awaiter(this, arguments, void 0, function* ({ productionData, orderData, targetUnit, targetCompanyId }) {
            const notifications = [];
            // Notify Unit Manager
            notifications.push(this.createNotification({
                title: 'Production Approved',
                message: `Production has approved batch ${productionData.batchNo || 'N/A'}`,
                type: 'order',
                icon: 'check-circle',
                targetRole: 'Unit Manager',
                targetUnit,
                targetCompanyId,
                data: {
                    productionId: productionData._id,
                    batchNo: productionData.batchNo,
                    orderId: orderData === null || orderData === void 0 ? void 0 : orderData._id,
                    action: 'production_approved'
                },
                priority: 'high'
            }));
            // Notify Package (Packing)
            notifications.push(this.createNotification({
                title: 'Ready for Packing',
                message: `Batch ${productionData.batchNo || 'N/A'} is ready for packing`,
                type: 'order',
                icon: 'package',
                targetRole: 'Packing',
                targetUnit,
                targetCompanyId,
                data: {
                    productionId: productionData._id,
                    batchNo: productionData.batchNo,
                    action: 'ready_for_packing'
                },
                priority: 'high'
            }));
            // Notify Super Admin
            notifications.push(this.createNotification({
                title: 'Production Approved',
                message: `Production approved batch ${productionData.batchNo || 'N/A'}`,
                type: 'order',
                icon: 'check-circle',
                targetRole: 'Superadmin',
                data: { productionId: productionData._id, action: 'production_approved' },
                priority: 'low'
            }));
            return Promise.all(notifications);
        });
    }
    // 4. PACKAGE -> Dispatch
    triggerPackageToDispatch(_a) {
        return __awaiter(this, arguments, void 0, function* ({ packageData, targetUnit, targetCompanyId }) {
            const notifications = [];
            // Notify Dispatch
            notifications.push(this.createNotification({
                title: 'Package Ready for Dispatch',
                message: `Packing completed for ${packageData.dcno || 'N/A'}. Ready for dispatch`,
                type: 'order',
                icon: 'truck',
                targetRole: 'Dispatch',
                targetUnit,
                targetCompanyId,
                data: {
                    packageId: packageData._id,
                    dcno: packageData.dcno,
                    action: 'ready_for_dispatch'
                },
                priority: 'high'
            }));
            // Notify Unit Manager
            notifications.push(this.createNotification({
                title: 'Package Completed',
                message: `Packing completed for ${packageData.dcno || 'N/A'}`,
                type: 'order',
                icon: 'package',
                targetRole: 'Unit Manager',
                targetUnit,
                targetCompanyId,
                data: { packageId: packageData._id, dcno: packageData.dcno, action: 'packing_completed' },
                priority: 'medium'
            }));
            // Notify Super Admin
            notifications.push(this.createNotification({
                title: 'Package Ready',
                message: `Package ${packageData.dcno || 'N/A'} ready for dispatch`,
                type: 'order',
                icon: 'truck',
                targetRole: 'Superadmin',
                data: { packageId: packageData._id, action: 'ready_for_dispatch' },
                priority: 'low'
            }));
            return Promise.all(notifications);
        });
    }
    // 5. PRODUCTION GROUP (Return/Damage) -> Unit Manager + Unit Head
    triggerProductionGroupUpdate(_a) {
        return __awaiter(this, arguments, void 0, function* ({ action, groupData, targetUnit, targetCompanyId }) {
            const notifications = [];
            const actionText = action === 'return' ? 'Return' : 'Damage';
            // Notify Unit Manager
            notifications.push(this.createNotification({
                title: `Production ${actionText} Recorded`,
                message: `${actionText} recorded for production group ${groupData.name}`,
                type: 'inventory',
                icon: 'alert-triangle',
                targetRole: 'Unit Manager',
                targetUnit,
                targetCompanyId,
                data: { groupId: groupData._id, groupName: groupData.name, action },
                priority: 'high'
            }));
            // Notify Unit Head
            notifications.push(this.createNotification({
                title: `Production ${actionText} Recorded`,
                message: `${actionText} recorded for production group ${groupData.name}`,
                type: 'inventory',
                icon: 'alert-triangle',
                targetRole: 'Unit Head',
                targetUnit,
                targetCompanyId,
                data: { groupId: groupData._id, groupName: groupData.name, action },
                priority: 'high'
            }));
            // Notify Super Admin
            notifications.push(this.createNotification({
                title: `Production ${actionText}`,
                message: `${actionText} recorded in production`,
                type: 'inventory',
                icon: 'alert-triangle',
                targetRole: 'Superadmin',
                data: { groupId: groupData._id, action },
                priority: 'medium'
            }));
            return Promise.all(notifications);
        });
    }
    // Legacy methods (kept for backward compatibility)
    triggerOrderNotification(orderData_1) {
        return __awaiter(this, arguments, void 0, function* (orderData, targetUnit = null, targetCompanyId = null) {
            return this.triggerSalesNotification({
                action: 'order_created',
                orderData,
                targetUnit,
                targetCompanyId
            });
        });
    }
    triggerInventoryNotification(itemData_1) {
        return __awaiter(this, arguments, void 0, function* (itemData, action = 'updated', targetUnit = null, targetCompanyId = null) {
            const actionText = action === 'created' ? 'added' : action === 'updated' ? 'updated' : 'modified';
            return this.createNotification({
                title: `Inventory ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                message: `Item "${itemData.name}" has been ${actionText}`,
                type: 'inventory',
                icon: 'package',
                targetRole: 'Unit Manager',
                targetUnit,
                targetCompanyId,
                data: { itemId: itemData._id, itemName: itemData.name, action },
                priority: 'medium'
            });
        });
    }
    triggerCustomerNotification(customerData_1) {
        return __awaiter(this, arguments, void 0, function* (customerData, targetUnit = null, targetCompanyId = null) {
            return this.triggerSalesNotification({
                action: 'customer_added',
                customerData,
                targetUnit,
                targetCompanyId
            });
        });
    }
    // Helper method to create unit-specific notifications
    createUnitNotification(_a) {
        return __awaiter(this, arguments, void 0, function* ({ title, message, type = 'general', icon = 'bell', targetRole = 'all', targetUnit, targetCompanyId, data = {}, priority = 'medium' }) {
            return this.createNotification({
                title,
                message,
                type,
                icon,
                targetRole,
                targetUnit,
                targetCompanyId,
                data,
                priority
            });
        });
    }
    triggerLowStockNotification(itemData) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.createNotification({
                title: 'Low Stock Alert',
                message: `${itemData.name} is running low on stock (${itemData.currentStock} remaining)`,
                type: 'inventory',
                icon: 'alert-triangle',
                targetRole: 'all',
                data: { itemId: itemData._id, itemName: itemData.name, currentStock: itemData.currentStock },
                priority: 'urgent'
            });
        });
    }
}
exports.default = new NotificationService();
