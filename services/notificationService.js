import Notification from '../models/Notification.js';
import pusher from '../config/pusher.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';

// ============================================================
// ROLE CHANNEL MAPPING - har role ka Pusher channel name
// ============================================================
const getRoleChannel = (role) => {
  const map = {
    'Superadmin': 'notifications-superadmin',
    'Super Admin': 'notifications-superadmin',
    'Sales': 'notifications-sales',
    'Sales Head': 'notifications-sales-head',
    'Sales Employee': 'notifications-sales-employee',
    'Accounts': 'notifications-accounts',
    'Accounts Head': 'notifications-accounts-head',
    'Account Employee': 'notifications-account-employee',
    'Production': 'notifications-production',
    'Production Head': 'notifications-production-head',
    'Production Employee': 'notifications-production-employee',
    'Packing': 'notifications-packing',
    'Packing Head': 'notifications-packing-head',
    'Packing Employee': 'notifications-packing-employee',
    'Dispatch': 'notifications-dispatch',
    'Dispatch Head': 'notifications-dispatch-head',
    'Dispatch Employee': 'notifications-dispatch-employee',
    'Store': 'notifications-store',
    'Store Head': 'notifications-store-head',
    'Store Employee': 'notifications-store-employee',
    'QC': 'notifications-qc',
    'QC Head': 'notifications-qc-head',
    'QC Employee': 'notifications-qc-employee',
    'Complaint Management Head': 'notifications-complaint-head',
    'Complaint Management Employee': 'notifications-complaint-employee',
    'HR-Admin': 'notifications-hr-admin',
    'Manager': 'notifications-manager',
    'Employee': 'notifications-employee',
    'Company Admin': 'notifications-company-admin',
    'Research & Development Head': 'notifications-rd-head',
    'Research Development Employee': 'notifications-rd-employee',
    'MIS Admin': 'notifications-mis-admin',
    'Marketing': 'notifications-marketing',
    'Unit Head': 'notifications-unit-head',
    'Unit Manager': 'notifications-unit-manager',
    'Manufacturing': 'notifications-manufacturing',
    'all': 'notifications-all',
  };
  return map[role] || `notifications-${(role || 'all').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
};

class NotificationService {

  // ============================================================
  // CORE: Notification create + Pusher broadcast
  // ============================================================
  async createNotification({
    title, message, type = 'general', icon = 'bell',
    targetRole = 'all', targetUserId = null,
    targetUnit = null, targetCompanyId = null,
    data = {}, priority = 'medium'
  }) {
    try {
      const notification = new Notification({
        title, message, type, icon,
        targetRole, targetUserId, targetUnit, targetCompanyId,
        data, priority
      });
      await notification.save();

      const payload = {
        id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        icon: notification.icon,
        priority: notification.priority,
        data: notification.data,
        createdAt: notification.createdAt
      };

      if (targetUserId) {
        await pusher.trigger(`user-${targetUserId}`, 'notification', payload);
      } else if (targetRole === 'all') {
        await pusher.trigger('notifications-all', 'notification', payload);
      } else {
        const channel = getRoleChannel(targetRole);
        await pusher.trigger(channel, 'notification', payload);
        await pusher.trigger('notifications-all', 'notification', payload);
      }

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  // Notify multiple roles at once
  async notifyRoles(roles = [], notifData) {
    return Promise.all(
      roles.map(role => this.createNotification({ ...notifData, targetRole: role }))
    );
  }

  // ============================================================
  // GET NOTIFICATIONS FOR USER
  // ============================================================
  async getUserNotifications(userId, userRole, userUnit = null, userCompanyId = null, { page = 1, limit = 20, unreadOnly = false } = {}) {
    try {
      const settings = await Settings.getSettings();
      const roleKeyMapping = {
        'Sales': 'salesPerson', 'Sales Head': 'salesPerson', 'Sales Employee': 'salesPerson',
        'Unit Head': 'unitHead', 'Unit Manager': 'unitManager',
        'Production': 'production', 'Production Head': 'production', 'Production Employee': 'production',
        'Packing': 'packing', 'Packing Head': 'packing', 'Packing Employee': 'packing',
        'Dispatch': 'dispatch', 'Dispatch Head': 'dispatch', 'Dispatch Employee': 'dispatch',
        'Accounts': 'accounts', 'Accounts Head': 'accounts', 'Account Employee': 'accounts',
        'Store': 'store', 'Store Head': 'store', 'Store Employee': 'store',
        'QC': 'qc', 'QC Head': 'qc', 'QC Employee': 'qc',
        'Complaint Management Head': 'complaint', 'Complaint Management Employee': 'complaint',
        'HR-Admin': 'hrAdmin', 'Manager': 'manager', 'Employee': 'employee',
        'Company Admin': 'companyAdmin',
        'Research & Development Head': 'rd', 'Research Development Employee': 'rd',
        'MIS Admin': 'misAdmin', 'Marketing': 'marketing',
        'Superadmin': 'superAdmin', 'Super Admin': 'superAdmin',
      };
      const roleKey = roleKeyMapping[userRole];
      // Only skip if EXPLICITLY disabled - default is enabled
      if (roleKey && settings.notifications?.roleSettings?.[roleKey]?.enabled === false) {
        return { notifications: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }, unreadCount: 0 };
      }

      const skip = (page - 1) * limit;
      let query = {
        $and: [{
          $or: [
            { targetRole: 'all' },
            { targetRole: userRole },
            { targetUserId: userId }
          ]
        }]
      };

      const globalRoles = ['Superadmin', 'Super Admin', 'MIS Admin'];
      if (!globalRoles.includes(userRole)) {
        const filters = [];
        if (userUnit) filters.push({ targetUnit: userUnit });
        if (userCompanyId) filters.push({ targetCompanyId: userCompanyId });
        filters.push({ targetUnit: null, targetCompanyId: null });
        query.$and.push({ $or: filters });
      }

      if (unreadOnly) query.$and.push({ 'isRead.userId': { $ne: userId } });
      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
        .populate('targetUserId', 'username fullName')
        .populate('targetCompanyId', 'name unitName city state').lean();

      const notificationsWithReadStatus = notifications.map(n => ({
        ...n,
        isReadByUser: n.isRead.some(r => r.userId.toString() === userId.toString())
      }));

      const total = await Notification.countDocuments(query);
      const unreadCount = await this.getUnreadCount(userId, userRole, userUnit, userCompanyId);

      return {
        notifications: notificationsWithReadStatus,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
        unreadCount
      };
    } catch (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }
  }

  // Mark as read
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findById(notificationId);
    if (!notification) throw new Error('Notification not found');
    const alreadyRead = notification.isRead.some(r => r.userId.toString() === userId.toString());
    if (!alreadyRead) {
      notification.isRead.push({ userId, readAt: new Date() });
      await notification.save();
    }
    return notification;
  }

  // Mark all as read
  async markAllAsRead(userId, userRole, userUnit = null, userCompanyId = null) {
    let query = {
      $and: [
        { $or: [{ targetRole: 'all' }, { targetRole: userRole }, { targetUserId: userId }] },
        { 'isRead.userId': { $ne: userId } }
      ]
    };
    const globalRoles = ['Superadmin', 'Super Admin', 'MIS Admin'];
    if (!globalRoles.includes(userRole)) {
      const filters = [];
      if (userUnit) filters.push({ targetUnit: userUnit });
      if (userCompanyId) filters.push({ targetCompanyId: userCompanyId });
      filters.push({ targetUnit: null, targetCompanyId: null });
      query.$and.push({ $or: filters });
    }
    const notifications = await Notification.find(query);
    await Promise.all(notifications.map(n => {
      n.isRead.push({ userId, readAt: new Date() });
      return n.save();
    }));
    return { markedCount: notifications.length };
  }

  // Get unread count
  async getUnreadCount(userId, userRole, userUnit = null, userCompanyId = null) {
    return await Notification.getUnreadCount(userId, userRole, userUnit, userCompanyId);
  }

  // ============================================================
  // SALES MODULE NOTIFICATIONS
  // ============================================================
  async triggerSalesNotification({ action, orderData, customerData, targetUnit, targetCompanyId, userId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'order_created') {
      return this.notifyRoles(['Sales Head', 'Accounts Head', 'Account Employee', 'Superadmin'], {
        title: 'New Order Created',
        message: `Order ${orderData.orderCode} placed for ${orderData.customerName || 'customer'}`,
        type: 'order', icon: 'shopping-cart', priority: 'high',
        data: { orderId: orderData._id, orderCode: orderData.orderCode, action }, ...common
      });
    }

    if (action === 'lead_assigned') {
      // Notify the assigned Sales Employee
      return this.createNotification({
        title: 'New Lead Assigned',
        message: `Lead ${orderData?.leadCode || ''} has been assigned to you`,
        type: 'lead', icon: 'target', priority: 'high',
        targetUserId: orderData?.assignedTo,
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode, action }
      });
    }

    if (action === 'lead_created') {
      return this.notifyRoles(['Sales Head', 'Superadmin'], {
        title: 'New Lead Created',
        message: `Lead ${orderData?.leadCode} created for ${orderData?.companyName || ''}`,
        type: 'lead', icon: 'target', priority: 'medium',
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode }, ...common
      });
    }

    if (action === 'lead_won') {
      return this.notifyRoles(['Sales Head', 'Accounts Head', 'Account Employee', 'Superadmin'], {
        title: 'Lead Won - Deal Closed',
        message: `Lead ${orderData?.leadCode} has been won. Order created.`,
        type: 'lead', icon: 'check-circle', priority: 'high',
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode, orderId: orderData?.orderId }, ...common
      });
    }

    if (action === 'payment_check_requested') {
      // Sales ne Account ko request kiya
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Payment Check Requested',
        message: `Sales has requested payment verification for Lead ${orderData?.leadCode}`,
        type: 'payment', icon: 'credit-card', priority: 'high',
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode }, ...common
      });
    }

    if (action === 'payment_verified') {
      // Account ne verify kiya, Sales ko batao
      return this.notifyRoles(['Sales Head', 'Sales Employee'], {
        title: 'Payment Verified',
        message: `Payment for Lead ${orderData?.leadCode} has been verified by Accounts`,
        type: 'payment', icon: 'check-circle', priority: 'high',
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode }, ...common
      });
    }

    if (action === 'lead_sent_to_account') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Lead Sent for Payment Processing',
        message: `Lead ${orderData?.leadCode} sent to Accounts for advanced payment`,
        type: 'payment', icon: 'credit-card', priority: 'high',
        data: { leadId: orderData?._id, leadCode: orderData?.leadCode }, ...common
      });
    }

    if (action === 'customer_added') {
      return this.notifyRoles(['Sales Head', 'Superadmin'], {
        title: 'New Customer Added',
        message: `${customerData?.name} has been registered`,
        type: 'customer', icon: 'user-plus', priority: 'medium',
        data: { customerId: customerData?._id, customerName: customerData?.name }, ...common
      });
    }

    if (action === 'payment_request_submitted') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Payment Request Submitted',
        message: `Sales submitted a payment request for Order ${orderData?.orderCode || ''}`,
        type: 'payment', icon: 'credit-card', priority: 'high',
        data: { orderId: orderData?._id, orderCode: orderData?.orderCode }, ...common
      });
    }
  }

  // ============================================================
  // ACCOUNTS MODULE NOTIFICATIONS
  // ============================================================
  async triggerAccountsNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'payment_verification_pending') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'New Payment Pending Verification',
        message: `Payment of ₹${data?.amount || ''} needs verification for ${data?.customerName || 'customer'}`,
        type: 'payment', icon: 'credit-card', priority: 'high',
        data, ...common
      });
    }

    if (action === 'lead_payment_added') {
      return this.notifyRoles(['Sales Head', 'Sales Employee'], {
        title: 'Lead Payment Recorded',
        message: `Payment of ₹${data?.amount} added for Lead ${data?.leadCode}`,
        type: 'payment', icon: 'credit-card', priority: 'high',
        data, ...common
      });
    }

    if (action === 'packed_order_payment_pending') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Packed Order Awaiting Payment',
        message: `Order ${data?.orderCode} is packed and awaiting payment confirmation`,
        type: 'account', icon: 'package', priority: 'high',
        data, ...common
      });
    }

    if (action === 'purchase_request_for_approval') {
      return this.notifyRoles(['Accounts Head'], {
        title: 'Purchase Request for Approval',
        message: `New purchase request ${data?.requestId} submitted for approval`,
        type: 'purchase', icon: 'shopping-cart', priority: 'high',
        data, ...common
      });
    }

    if (action === 'rfq_vendor_bid_received') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Vendor Bid Received',
        message: `Vendor submitted a bid for RFQ ${data?.rfqNumber || ''}`,
        type: 'purchase', icon: 'file-text', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'noc_request') {
      return this.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'NOC Request Received',
        message: `NOC requested for Order ${data?.orderCode || ''}`,
        type: 'account', icon: 'file-text', priority: 'high',
        data, ...common
      });
    }
  }

  // ============================================================
  // STORE MODULE NOTIFICATIONS
  // ============================================================
  async triggerStoreNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'new_order_for_store') {
      return this.notifyRoles(['Store Head', 'Store Employee'], {
        title: 'New Order Received',
        message: `Order ${data?.orderCode} received and requires store processing`,
        type: 'store', icon: 'package', priority: 'high',
        data, ...common
      });
    }

    if (action === 'purchase_request_approved') {
      return this.notifyRoles(['Store Head', 'Store Employee'], {
        title: 'Purchase Request Approved',
        message: `Purchase request ${data?.requestId} has been approved`,
        type: 'purchase', icon: 'check-circle', priority: 'high',
        data, ...common
      });
    }

    if (action === 'low_stock') {
      return this.notifyRoles(['Store Head', 'Store Employee', 'Accounts Head'], {
        title: 'Low Stock Alert',
        message: `${data?.itemName} is running low (${data?.currentStock} remaining)`,
        type: 'inventory', icon: 'alert-triangle', priority: 'urgent',
        data, ...common
      });
    }

    if (action === 'stock_received') {
      return this.notifyRoles(['Store Head', 'Production Head', 'Superadmin'], {
        title: 'Stock Received',
        message: `${data?.itemName} stock updated. Quantity: ${data?.quantity}`,
        type: 'store', icon: 'package', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'purchase_request_created') {
      return this.notifyRoles(['Accounts Head', 'Superadmin'], {
        title: 'New Purchase Request',
        message: `Purchase request ${data?.requestId} created by Store`,
        type: 'purchase', icon: 'shopping-cart', priority: 'high',
        data, ...common
      });
    }
  }

  // ============================================================
  // PRODUCTION MODULE NOTIFICATIONS
  // ============================================================
  async triggerProductionNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'order_for_production') {
      return this.notifyRoles(['Production Head', 'Production Employee'], {
        title: 'New Production Order',
        message: `Order ${data?.orderCode} sent for production`,
        type: 'production', icon: 'factory', priority: 'high',
        data, ...common
      });
    }

    if (action === 'production_started') {
      return this.notifyRoles(['Sales Head', 'Superadmin'], {
        title: 'Production Started',
        message: `Production started for Order ${data?.orderCode || ''}`,
        type: 'production', icon: 'play', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'production_completed') {
      return this.notifyRoles(['Packing Head', 'Packing Employee', 'QC Head', 'Superadmin'], {
        title: 'Production Completed',
        message: `Production completed for ${data?.orderCode || data?.batchNo || ''}. Ready for QC/Packing.`,
        type: 'production', icon: 'check-circle', priority: 'high',
        data, ...common
      });
    }

    if (action === 'production_task_assigned') {
      return this.createNotification({
        title: 'Task Assigned',
        message: `You have a new production task: ${data?.taskTitle || ''}`,
        type: 'task', icon: 'clipboard', priority: 'high',
        targetUserId: data?.assignedTo,
        data
      });
    }

    if (action === 'material_required') {
      return this.notifyRoles(['Store Head', 'Store Employee'], {
        title: 'Material Request from Production',
        message: `Production requires ${data?.itemName || 'materials'} for Order ${data?.orderCode || ''}`,
        type: 'store', icon: 'package', priority: 'high',
        data, ...common
      });
    }
  }

  // ============================================================
  // QC MODULE NOTIFICATIONS
  // ============================================================
  async triggerQCNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'qc_job_created') {
      return this.notifyRoles(['QC Head', 'QC Employee'], {
        title: 'New QC Inspection Job',
        message: `New QC job ${data?.qcJobId} created for ${data?.itemName || 'item'}`,
        type: 'qc', icon: 'shield', priority: 'high',
        data, ...common
      });
    }

    if (action === 'qc_passed') {
      return this.notifyRoles(['Dispatch Head', 'Dispatch Employee', 'Packing Head', 'Superadmin'], {
        title: 'QC Passed',
        message: `QC Job ${data?.qcJobId} passed. Ready for dispatch.`,
        type: 'qc', icon: 'check-circle', priority: 'high',
        data, ...common
      });
    }

    if (action === 'qc_failed') {
      return this.notifyRoles(['Production Head', 'Store Head', 'Superadmin'], {
        title: 'QC Failed',
        message: `QC Job ${data?.qcJobId} failed. Item returned for review.`,
        type: 'qc', icon: 'alert-triangle', priority: 'urgent',
        data, ...common
      });
    }

    if (action === 'qc_inward_received') {
      return this.notifyRoles(['QC Head', 'QC Employee'], {
        title: 'Inward Item for QC',
        message: `New inward item ${data?.itemName || ''} received for inspection`,
        type: 'qc', icon: 'clipboard', priority: 'high',
        data, ...common
      });
    }
  }

  // ============================================================
  // DISPATCH MODULE NOTIFICATIONS
  // ============================================================
  async triggerDispatchNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'ready_for_dispatch') {
      return this.notifyRoles(['Dispatch Head', 'Dispatch Employee'], {
        title: 'Item Ready for Dispatch',
        message: `${data?.dcno || data?.orderCode || 'Item'} is packed and ready for dispatch`,
        type: 'dispatch', icon: 'truck', priority: 'high',
        data, ...common
      });
    }

    if (action === 'dispatched') {
      return this.notifyRoles(['Sales Head', 'Sales Employee', 'Accounts Head', 'Superadmin'], {
        title: 'Order Dispatched',
        message: `Order ${data?.orderCode || ''} has been dispatched to customer`,
        type: 'dispatch', icon: 'truck', priority: 'high',
        data, ...common
      });
    }

    if (action === 'delivery_confirmed') {
      return this.notifyRoles(['Sales Head', 'Accounts Head', 'Superadmin'], {
        title: 'Delivery Confirmed',
        message: `Order ${data?.orderCode || ''} delivered successfully`,
        type: 'dispatch', icon: 'check-circle', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'dispatch_task_assigned') {
      return this.createNotification({
        title: 'Dispatch Task Assigned',
        message: `New dispatch task assigned: ${data?.taskTitle || ''}`,
        type: 'task', icon: 'truck', priority: 'high',
        targetUserId: data?.assignedTo,
        data
      });
    }
  }

  // ============================================================
  // COMPLAINT & SERVICE MODULE NOTIFICATIONS
  // ============================================================
  async triggerComplaintNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'ticket_created') {
      return this.notifyRoles(['Complaint Management Head'], {
        title: 'New Support Ticket',
        message: `Ticket ${data?.ticketId} created for ${data?.customerName || 'customer'}`,
        type: 'complaint', icon: 'message-square', priority: 'high',
        data, ...common
      });
    }

    if (action === 'ticket_assigned') {
      // Notify the assigned technician
      const promises = [
        this.notifyRoles(['Complaint Management Head'], {
          title: 'Ticket Assigned to Technician',
          message: `Ticket ${data?.ticketId} assigned to ${data?.technicianName || 'technician'}`,
          type: 'complaint', icon: 'user-check', priority: 'medium',
          data, ...common
        })
      ];
      if (data?.technicianUserId) {
        promises.push(this.createNotification({
          title: 'New Service Ticket Assigned',
          message: `Ticket ${data?.ticketId} - Customer: ${data?.customerName}. Visit: ${data?.visitDate || 'TBD'}`,
          type: 'complaint', icon: 'clipboard', priority: 'urgent',
          targetUserId: data.technicianUserId,
          data
        }));
      }
      return Promise.all(promises);
    }

    if (action === 'ticket_resolved') {
      return this.notifyRoles(['Complaint Management Head', 'Superadmin'], {
        title: 'Ticket Resolved',
        message: `Ticket ${data?.ticketId} has been resolved by technician`,
        type: 'complaint', icon: 'check-circle', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'deal_verification_required') {
      return this.notifyRoles(['Complaint Management Head', 'Complaint Management Employee'], {
        title: 'Deal Verification Required',
        message: `Deal verification pending for customer ${data?.customerName || ''}`,
        type: 'complaint', icon: 'shield', priority: 'high',
        data, ...common
      });
    }

    if (action === 'installation_scheduled') {
      return this.notifyRoles(['Complaint Management Head', 'Complaint Management Employee'], {
        title: 'Installation Scheduled',
        message: `Installation scheduled for ${data?.customerName || ''} on ${data?.scheduledDate || ''}`,
        type: 'complaint', icon: 'calendar', priority: 'high',
        data, ...common
      });
    }

    if (action === 'feedback_received') {
      return this.notifyRoles(['Complaint Management Head', 'Superadmin'], {
        title: 'Customer Feedback Received',
        message: `${data?.customerName || 'Customer'} rated service: ${data?.rating || ''} stars`,
        type: 'complaint', icon: 'star', priority: 'low',
        data, ...common
      });
    }
  }

  // ============================================================
  // HRMS MODULE NOTIFICATIONS
  // ============================================================
  async triggerHRMSNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'leave_requested') {
      const notifies = [
        this.notifyRoles(['HR-Admin', 'Manager'], {
          title: 'Leave Request Submitted',
          message: `${data?.employeeName || 'Employee'} requested leave from ${data?.fromDate || ''} to ${data?.toDate || ''}`,
          type: 'leave', icon: 'calendar', priority: 'medium',
          data, ...common
        })
      ];
      return Promise.all(notifies);
    }

    if (action === 'leave_approved') {
      return this.createNotification({
        title: 'Leave Request Approved',
        message: `Your leave request for ${data?.fromDate || ''} - ${data?.toDate || ''} has been approved`,
        type: 'leave', icon: 'check-circle', priority: 'high',
        targetUserId: data?.employeeUserId,
        data
      });
    }

    if (action === 'leave_rejected') {
      return this.createNotification({
        title: 'Leave Request Rejected',
        message: `Your leave request has been rejected. Reason: ${data?.reason || ''}`,
        type: 'leave', icon: 'x-circle', priority: 'high',
        targetUserId: data?.employeeUserId,
        data
      });
    }

    if (action === 'attendance_correction_requested') {
      return this.notifyRoles(['HR-Admin', 'Manager'], {
        title: 'Attendance Correction Request',
        message: `${data?.employeeName || 'Employee'} requested attendance correction for ${data?.date || ''}`,
        type: 'attendance', icon: 'clock', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'attendance_approved') {
      return this.createNotification({
        title: 'Attendance Correction Approved',
        message: `Your attendance correction for ${data?.date || ''} has been approved`,
        type: 'attendance', icon: 'check-circle', priority: 'medium',
        targetUserId: data?.employeeUserId,
        data
      });
    }

    if (action === 'payslip_generated') {
      return this.createNotification({
        title: 'Payslip Generated',
        message: `Your payslip for ${data?.month || ''} is ready`,
        type: 'payroll', icon: 'file-text', priority: 'medium',
        targetUserId: data?.employeeUserId,
        data
      });
    }

    if (action === 'payroll_processed') {
      return this.notifyRoles(['HR-Admin', 'Company Admin', 'Superadmin'], {
        title: 'Payroll Processed',
        message: `Payroll for ${data?.month || ''} has been processed for ${data?.employeeCount || ''} employees`,
        type: 'payroll', icon: 'calculator', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'expense_submitted') {
      return this.notifyRoles(['HR-Admin', 'Manager'], {
        title: 'Expense Claim Submitted',
        message: `${data?.employeeName || 'Employee'} submitted expense of ₹${data?.amount || ''}`,
        type: 'hrms', icon: 'receipt', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'expense_approved') {
      return this.createNotification({
        title: 'Expense Claim Approved',
        message: `Your expense claim of ₹${data?.amount || ''} has been approved`,
        type: 'hrms', icon: 'check-circle', priority: 'medium',
        targetUserId: data?.employeeUserId,
        data
      });
    }

    if (action === 'new_employee_added') {
      return this.notifyRoles(['HR-Admin', 'Company Admin', 'Superadmin'], {
        title: 'New Employee Added',
        message: `${data?.employeeName || 'New employee'} has been added to the system`,
        type: 'hrms', icon: 'user-plus', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'task_assigned') {
      return this.createNotification({
        title: 'New Task Assigned',
        message: `Task "${data?.taskTitle || ''}" has been assigned to you`,
        type: 'task', icon: 'clipboard', priority: 'high',
        targetUserId: data?.assignedTo,
        data
      });
    }

    if (action === 'overtime_requested') {
      return this.notifyRoles(['HR-Admin', 'Manager'], {
        title: 'Overtime Request',
        message: `${data?.employeeName || 'Employee'} requested overtime for ${data?.date || ''}`,
        type: 'hrms', icon: 'clock', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'resignation_submitted') {
      return this.notifyRoles(['HR-Admin', 'Manager', 'Superadmin'], {
        title: 'Resignation Submitted',
        message: `${data?.employeeName || 'Employee'} has submitted a resignation`,
        type: 'hrms', icon: 'log-out', priority: 'urgent',
        data, ...common
      });
    }

    if (action === 'interview_scheduled') {
      return this.notifyRoles(['HR-Admin', 'Manager'], {
        title: 'Interview Scheduled',
        message: `Interview scheduled for ${data?.candidateName || 'candidate'} on ${data?.date || ''}`,
        type: 'hrms', icon: 'briefcase', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'job_opening_created') {
      return this.notifyRoles(['HR-Admin', 'Manager'], {
        title: 'New Job Opening',
        message: `Job opening for "${data?.position || ''}" has been created`,
        type: 'hrms', icon: 'briefcase', priority: 'low',
        data, ...common
      });
    }
  }

  // ============================================================
  // R&D MODULE NOTIFICATIONS
  // ============================================================
  async triggerRDNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'design_approval_requested') {
      return this.notifyRoles(['Research & Development Head', 'Superadmin'], {
        title: 'Design Approval Requested',
        message: `Design approval requested for ${data?.productName || ''}`,
        type: 'rd', icon: 'check-square', priority: 'high',
        data, ...common
      });
    }

    if (action === 'bom_updated') {
      return this.notifyRoles(['Production Head', 'Store Head'], {
        title: 'BOM Updated',
        message: `Bill of Materials updated for ${data?.productName || ''}`,
        type: 'rd', icon: 'clipboard', priority: 'medium',
        data, ...common
      });
    }

    if (action === 'change_request') {
      return this.notifyRoles(['Production Head', 'Superadmin'], {
        title: 'R&D Change Request',
        message: `Change request raised for ${data?.productName || ''}`,
        type: 'rd', icon: 'alert-triangle', priority: 'high',
        data, ...common
      });
    }

    if (action === 'task_assigned') {
      return this.createNotification({
        title: 'R&D Task Assigned',
        message: `Task "${data?.taskTitle || ''}" assigned to you`,
        type: 'task', icon: 'clipboard', priority: 'high',
        targetUserId: data?.assignedTo,
        data
      });
    }
  }

  // ============================================================
  // PACKING MODULE NOTIFICATIONS
  // ============================================================
  async triggerPackingNotification({ action, data, targetUnit, targetCompanyId }) {
    const common = { targetUnit, targetCompanyId };

    if (action === 'ready_for_packing') {
      return this.notifyRoles(['Packing Head', 'Packing Employee'], {
        title: 'Item Ready for Packing',
        message: `${data?.batchNo || data?.orderCode || 'Item'} is ready to be packed`,
        type: 'production', icon: 'package', priority: 'high',
        data, ...common
      });
    }

    if (action === 'packing_completed') {
      return this.notifyRoles(['Dispatch Head', 'Dispatch Employee', 'Accounts Head', 'Superadmin'], {
        title: 'Packing Completed',
        message: `Packing done for ${data?.dcno || data?.orderCode || ''}. Ready for dispatch.`,
        type: 'dispatch', icon: 'package', priority: 'high',
        data, ...common
      });
    }
  }

  // ============================================================
  // LEGACY COMPATIBILITY METHODS
  // ============================================================
  async triggerUnitManagerToProduction({ action, orderData, productionData, targetUnit, targetCompanyId }) {
    return this.triggerProductionNotification({
      action: 'order_for_production',
      data: { orderCode: orderData?.orderCode, orderId: orderData?._id, ...productionData },
      targetUnit, targetCompanyId
    });
  }

  async triggerProductionApproval({ productionData, orderData, targetUnit, targetCompanyId }) {
    return this.triggerProductionNotification({
      action: 'production_completed',
      data: { batchNo: productionData?.batchNo, productionId: productionData?._id, orderCode: orderData?.orderCode },
      targetUnit, targetCompanyId
    });
  }

  async triggerPackageToDispatch({ packageData, targetUnit, targetCompanyId }) {
    return this.triggerPackingNotification({
      action: 'packing_completed',
      data: { dcno: packageData?.dcno, packageId: packageData?._id },
      targetUnit, targetCompanyId
    });
  }

  async triggerProductionGroupUpdate({ action, groupData, targetUnit, targetCompanyId }) {
    return this.triggerProductionNotification({
      action: 'production_started',
      data: { groupId: groupData?._id, groupName: groupData?.name, action },
      targetUnit, targetCompanyId
    });
  }

  async triggerOrderNotification(orderData, targetUnit = null, targetCompanyId = null) {
    return this.triggerSalesNotification({ action: 'order_created', orderData, targetUnit, targetCompanyId });
  }

  async triggerInventoryNotification(itemData, action = 'updated', targetUnit = null, targetCompanyId = null) {
    return this.triggerStoreNotification({
      action: action === 'low_stock' ? 'low_stock' : 'stock_received',
      data: { itemName: itemData?.name, itemId: itemData?._id, currentStock: itemData?.currentStock, quantity: itemData?.quantity },
      targetUnit, targetCompanyId
    });
  }

  async triggerCustomerNotification(customerData, targetUnit = null, targetCompanyId = null) {
    return this.triggerSalesNotification({ action: 'customer_added', customerData, targetUnit, targetCompanyId });
  }

  async triggerLowStockNotification(itemData) {
    return this.createNotification({
      title: 'Low Stock Alert',
      message: `${itemData.name} is running low (${itemData.currentStock} remaining)`,
      type: 'inventory', icon: 'alert-triangle',
      targetRole: 'all',
      data: { itemId: itemData._id, itemName: itemData.name, currentStock: itemData.currentStock },
      priority: 'urgent'
    });
  }

  async createUnitNotification({ title, message, type = 'general', icon = 'bell', targetRole = 'all', targetUnit, targetCompanyId, data = {}, priority = 'medium' }) {
    return this.createNotification({ title, message, type, icon, targetRole, targetUnit, targetCompanyId, data, priority });
  }
}

export default new NotificationService();
