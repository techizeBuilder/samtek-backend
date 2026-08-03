import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import { Item } from '../models/Inventory.js';
import ProductDailySummary from '../models/ProductDailySummary.js';
import CutoffTime from '../models/CutoffTime.js';
import notificationService from '../services/notificationService.js';
import Sale from '../models/Sale.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import QCJob from '../models/QCJob.js';
import ProductionOrder from '../models/ProductionOrder.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import { computeOrderFinancials } from '../utils/orderFinancials.js';
import {
  ensureSaleForOrder,
  applyStoreDecisionToItem,
  getOrderItemsReadiness
} from '../services/storeFlowService.js';

// Generate a unique requestId safely (avoids E11000 duplicate key errors)
async function generateUniqueRequestId() {
  let attempts = 0;
  while (attempts < 20) {
    const count = await PurchaseRequest.countDocuments({});
    const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  return `PR-${Date.now().toString().slice(-6)}`;
}

const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId() {
  const year = new Date().getFullYear();
  // Find the job with the highest sequence number for the current year
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Create new order
const createOrder = async (req, res) => {
  try {
    const { customerId, orderDate, products, notes } = req.body;

    // Validation
    const errors = {};

    if (!customerId) {
      errors.customerId = 'Customer ID is required';
    } else {
      // Check if customer exists
      const customerExists = await Customer.findById(customerId);
      if (!customerExists) {
        errors.customerId = 'Customer not found';
      }
    }

    if (!orderDate) {
      errors.orderDate = 'Order date is required';
    } else if (new Date(orderDate).toString() === 'Invalid Date') {
      errors.orderDate = 'Order date must be a valid date';
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      errors.products = 'At least one product is required';
    } else {
      // Validate each product
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        if (!product.productId) {
          errors[`products[${i}].productId`] = 'Product ID is required';
        } else {
          // Check if product exists in inventory
          const productExists = await Item.findById(product.productId);
          if (!productExists) {
            errors[`products[${i}].productId`] = 'Product not found';
          }
        }

        if (!product.quantity || product.quantity <= 0) {
          errors[`products[${i}].quantity`] = 'Quantity must be greater than 0';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        status: false,
        message: 'Validation failed.',
        errors
      });
    }

    // ============ CUTOFF TIME VALIDATION ============
    // Check if order creation is allowed based on cutoff time (only for Sales role)
    if (req.user.role === 'Sales' || req.user.role === 'sales') {
      console.log('🕐 Checking cutoff time for Sales user:', req.user.username, 'Company:', req.user.companyId);

      if (req.user.companyId) {
        try {
          const orderPermission = await CutoffTime.canPlaceOrder(req.user.companyId);

          if (!orderPermission.allowed) {
            console.log('❌ Order blocked by cutoff time:', orderPermission.message);
            return res.status(403).json({
              status: false,
              message: orderPermission.message,
              cutoffTime: orderPermission.cutoffTime,
              isPastCutoff: true
            });
          }

          console.log('✅ Order allowed by cutoff time check:', orderPermission.message);
        } catch (cutoffError) {
          console.error('Error checking cutoff time:', cutoffError);
          // If cutoff time check fails, allow order creation (fail-safe approach)
          console.log('⚠️ Cutoff time check failed, allowing order creation');
        }
      }
    }

    // Calculate total amount
    let totalAmount = 0;
    const orderProducts = [];

    for (const productItem of products) {
      const product = await Item.findById(productItem.productId);
      const itemTotal = product.salePrice * productItem.quantity;
      totalAmount += itemTotal;

      orderProducts.push({
        product: productItem.productId,
        quantity: productItem.quantity,
        price: product.salePrice,
        total: itemTotal
      });
    }

    // Generate unique order code
    let orderCode;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const orderCount = await Order.countDocuments();
      orderCode = `ORD-${String(orderCount + 1 + attempts).padStart(4, '0')}`;

      // Check if this code already exists
      const existingOrder = await Order.findOne({ orderCode });
      if (!existingOrder) {
        isUnique = true;
      } else {
        attempts++;
      }
    }

    if (!isUnique) {
      // Fallback to timestamp-based code if still not unique
      orderCode = `ORD-${Date.now().toString().slice(-6)}`;
    }

    // Create order
    const order = new Order({
      orderCode,
      customer: customerId,
      salesPerson: req.user._id || req.user.id, // Use _id or id from authenticated user
      companyId: req.user.companyId, // Auto-assign company from logged-in user
      unit: req.user.unit, // Auto-assign unit from logged-in user
      orderDate: new Date(orderDate),
      products: orderProducts,
      totalAmount,
      status: 'pending',
      notes
    });

    console.log('Creating order with salesPerson:', req.user._id || req.user.id, 'User:', req.user.username);

    await order.save();

    // Populate order with customer details for notification
    await order.populate('customer', 'name email');

    // Trigger notification for new order - Sales to Unit Manager + Unit Head
    try {
      await notificationService.triggerSalesNotification({
        action: 'order_created',
        orderData: {
          _id: order._id,
          orderCode: order.orderCode,
          customerName: order.customer.name
        },
        targetUnit: req.user.unit || null,
        targetCompanyId: req.user.companyId || null,
        userId: req.user._id || req.user.id
      });
    } catch (notificationError) {
      console.error('Failed to send order notification:', notificationError);
      // Don't fail the order creation if notification fails
    }

    res.status(201).json({
      status: true,
      message: 'Order created successfully.',
      orderId: order._id
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all orders with filtering and pagination
const getOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      date = '',
      startDate = '',
      endDate = '',
      customerId = '',
      leadId = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('=== ORDER FILTERING ===');
    console.log('User details:', {
      id: salespersonId,
      role: userRole,
      companyId: userCompanyId,
      username: req.user.username
    });

    // Build filter query with role-based filtering
    const filter = {};

    // 1. Super Admin role sees all orders (no company or sales person restriction)
    if (userRole === 'Superadmin' || userRole === 'Super Admin') {
      console.log('👑 SUPER ADMIN FILTERING - Showing all orders');
    }
    // 2. Sales roles see only their own orders
    else if (userRole === 'Sales' || userRole === 'Sales Employee' || userRole === 'Sales Head') {
      filter.salesPerson = new mongoose.Types.ObjectId(salespersonId);
      if (userCompanyId) {
        filter.companyId = new mongoose.Types.ObjectId(userCompanyId);
      }
      console.log('👤 SALES ROLE FILTERING - Showing own orders only');
    }
    // 3. Other company-scoped roles (Managers, Heads, Employees of Service/Accounts/Store/QC) see all orders in their company
    else {
      if (userCompanyId) {
        filter.companyId = new mongoose.Types.ObjectId(userCompanyId);
        console.log(`🏢 COMPANY SCOPED FILTERING FOR ROLE '${userRole}' - Showing all orders for company: ${userCompanyId}`);
      } else {
        // Fallback: If no company assigned, show all orders since they are not a Sales role and don't create orders
        console.log(`🏢 UNRESTRICTED ROLE '${userRole}' WITH NO COMPANY - Showing all orders`);
      }
    }

    if (search) {
      filter.$or = [
        { orderCode: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (customerId) {
      filter.customer = customerId;
    }

    if (leadId) {
      filter.leadId = leadId;
    }

    // Date filtering - support both single date and date range
    if (date) {
      // Single date filter
      const filterDate = new Date(date);
      filterDate.setUTCHours(0, 0, 0, 0);
      const nextDay = new Date(filterDate.getTime() + 24 * 60 * 60 * 1000);
      filter.orderDate = {
        $gte: filterDate,
        $lt: nextDay
      };
    } else if (startDate || endDate) {
      // Date range filter
      filter.orderDate = {};
      if (startDate) {
        filter.orderDate.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.orderDate.$lte = new Date(endDate);
      }
    }

    // Build sort query
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    console.log('Sort query:', sort, 'sortBy:', sortBy, 'sortOrder:', sortOrder);

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('=== FINAL FILTER APPLIED ===');
    console.log('Filter object:', JSON.stringify(filter, null, 2));
    console.log('Pagination:', { page, limit, skip });

    // Get orders with population
    const orders = await Order.find(filter)
      .populate('customer', 'name email mobile')
      .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image')
      .populate('salesPerson', 'username fullName email role companyId')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalOrders = await Order.countDocuments(filter);
    const totalPages = Math.ceil(totalOrders / parseInt(limit));

    console.log('=== QUERY RESULTS ===');
    console.log('Orders found:', orders.length);
    console.log('Total orders matching filter:', totalOrders);

    if (orders.length > 0) {
      console.log('Sample orders:');
      orders.slice(0, 3).forEach(order => {
        console.log(`  Order ${order.orderCode}: Sales Person: ${order.salesPerson?.username || 'Unknown'} (ID: ${order.salesPerson?._id})`);
      });
    }

    res.json({
      success: true,
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalOrders,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get single order by ID
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('customer', 'name email mobile address city state')
      .populate('products.product', 'name specifications salePrice purchaseCost mrp brand category subCategory image');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update order
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, orderDate, products, notes, status } = req.body;

    console.log('Update order request:', { id, body: req.body });

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // ============ CUTOFF TIME VALIDATION ============
    // Check if order editing is allowed based on cutoff time (only for Sales role)
    if (req.user.role === 'Sales' || req.user.role === 'sales') {
      console.log('🕐 Checking cutoff time for order edit by Sales user:', req.user.username, 'Company:', req.user.companyId);

      if (req.user.companyId) {
        try {
          const orderPermission = await CutoffTime.canPlaceOrder(req.user.companyId);

          if (!orderPermission.allowed) {
            console.log('❌ Order edit blocked by cutoff time:', orderPermission.message);
            return res.status(403).json({
              success: false,
              message: `Order editing ${orderPermission.message.toLowerCase()}`,
              cutoffTime: orderPermission.cutoffTime,
              isPastCutoff: true
            });
          }

          console.log('✅ Order edit allowed by cutoff time check:', orderPermission.message);
        } catch (cutoffError) {
          console.error('Error checking cutoff time for order edit:', cutoffError);
          // If cutoff time check fails, allow order editing (fail-safe approach)
          console.log('⚠️ Cutoff time check failed, allowing order editing');
        }
      }
    }

    // Update basic fields
    if (customerId) order.customer = customerId;
    if (orderDate) order.orderDate = new Date(orderDate);
    if (notes !== undefined) order.notes = notes;
    if (status) order.status = status;

    // Update salesChecklist if provided (used by Service Team auto-save during verification)
    if (req.body.salesChecklist) {
      order.salesChecklist = req.body.salesChecklist;
      order.markModified('salesChecklist');
    }

    // Update priority if provided
    if (req.body.priority) order.priority = req.body.priority;

    // Update products if provided
    if (products && products.length > 0) {
      console.log('🔄 Updating products:', products);
      let totalAmount = 0;
      const orderProducts = [];

      for (const productItem of products) {
        console.log('🔍 Processing product:', productItem);
        const product = await Item.findById(productItem.productId);
        console.log('📦 Found product:', product ? { id: product._id, name: product.name, salePrice: product.salePrice } : 'Not found');

        if (product) {
          const itemTotal = (product.salePrice || 0) * productItem.quantity;
          totalAmount += itemTotal;

          orderProducts.push({
            product: productItem.productId,
            quantity: productItem.quantity,
            price: product.salePrice || 0,
            total: itemTotal
          });

          console.log('✅ Added product to order:', {
            productId: productItem.productId,
            quantity: productItem.quantity,
            price: product.salePrice || 0,
            total: itemTotal
          });
        } else {
          console.log('⚠️ Product not found:', productItem.productId);
        }
      }

      console.log('💰 Total amount calculated:', totalAmount);
      console.log('📋 Order products array:', orderProducts);

      order.products = orderProducts;
      order.totalAmount = totalAmount;

      console.log('🔄 Updated order products count:', order.products.length);
    }

    console.log('💾 Saving updated order...');
    await order.save();
    console.log('✅ Order saved successfully');

    // Populate the updated order
    console.log('🔍 Fetching updated order with populated data...');
    const updatedOrder = await Order.findById(id)
      .populate('customer', 'name email mobile address city state')
      .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image');

    console.log('📊 Final order data:', {
      id: updatedOrder._id,
      productsCount: updatedOrder.products?.length || 0,
      totalAmount: updatedOrder.totalAmount
    });

    res.json({
      success: true,
      message: 'Order updated successfully',
      order: updatedOrder
    });

  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete order
const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Store order details before deletion for summary updates
    const orderProducts = order.products;
    const orderDate = order.orderDate;
    const companyId = order.companyId;

    // Delete the order
    await Order.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update order status only
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    // Enhanced validation for Unit Manager workflow
    const validStatuses = ['pending', 'approved', 'rejected', 'in_production', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Valid statuses are: ' + validStatuses.join(', ')
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Role-based permissions for status updates
    const userRole = req.user.role;

    // Unit Manager and Superadmin can update any status
    if (userRole === 'Unit Manager' || userRole === 'Superadmin' || userRole === 'Super Admin' || userRole === 'Sale Head' || userRole === 'Sales Employee') {
      // Allow all status updates
    }
    // Sales can only update to Cancelled if pending
    // Sales can approve their own orders or cancel them if pending
    else if (userRole === 'Sales' || userRole === 'sales') {
      if (order.salesPerson?.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own orders'
        });
      }
      const allowedSalesStatuses = ['cancelled', 'approved'];
      if (!allowedSalesStatuses.includes(status)) {
        return res.status(403).json({
          success: false,
          message: 'Sales can only approve or cancel orders'
        });
      }

      if (order.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot change status from ${order.status} to ${status}`
        });
      }
    }
    // Other roles have limited permissions
    else {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to update order status'
      });
    }

    // Set context for status history (if schema supports it)
    if (order.statusHistory) {
      order._updatedBy = req.user._id;
      order._statusRemarks = remarks || '';
    }

    // Update fields based on status
    const oldStatus = order.status;
    order.status = status;

    if (status === 'approved') {
      order.approvedBy = req.user._id;
      order.approvedAt = new Date();

      // If approved by Sales, mark as approved (Manual Invoice Generation will happen in Accounts)
      if (userRole === 'Sales' || userRole === 'sales') {
        order.status = 'approved';
        order.statusHistory.push({
          status: 'approved',
          updatedBy: req.user._id,
          updatedAt: new Date(),
          remarks: 'Order approved by Sales person. Pending invoice generation.'
        });
        await order.save();
        console.log(`✅ Order ${order.orderCode} approved by Sales. Pending manual invoicing.`);
      }
    } else if (status === 'rejected') {
      order.rejectionReason = remarks;
    } else if (status === 'in_production') {
      order.productionStartDate = new Date();
    } else if (status === 'completed') {
      order.productionEndDate = new Date();
      if (!order.actualDeliveryDate) {
        order.actualDeliveryDate = new Date();
      }
    }

    await order.save();

    // 🔔 Role-based notifications on status change
    try {
      if (status === 'approved') {
        // ✅ Only Store gets notified on approval — they check inventory & route further
        await notificationService.triggerStoreNotification({
          action: 'new_order_for_store',
          data: { orderCode: order.orderCode, orderId: order._id },
          targetUnit: order.unit,
          targetCompanyId: order.companyId,
        });
      } else if (status === 'in_production') {
        await notificationService.triggerProductionNotification({
          action: 'production_started',
          data: { orderCode: order.orderCode, orderId: order._id },
          targetUnit: order.unit,
          targetCompanyId: order.companyId,
        });
      } else if (status === 'completed') {
        await notificationService.triggerDispatchNotification({
          action: 'ready_for_dispatch',
          data: { orderCode: order.orderCode, orderId: order._id },
          targetUnit: order.unit,
          targetCompanyId: order.companyId,
        });
      }
    } catch (notifErr) {
      console.error('Order status notification error:', notifErr);
    }

    // Populate the updated order
    const updatedOrder = await Order.findById(id)
      .populate('customer', 'name email mobile address city state')
      .populate('products.product', 'name price brand image')
      .populate('salesPerson', 'username fullName email')
      .populate('approvedBy', 'username fullName');

    res.json({
      success: true,
      message: `Order status updated from ${oldStatus} to ${status}`,
      order: updatedOrder
    });

  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Check if order exists for sales person + customer + date
const checkExistingOrder = async (req, res) => {
  try {
    const { salesPersonId, customerId, orderDate } = req.query;

    console.log('🔍 Checking for existing order:', { salesPersonId, customerId, orderDate });

    if (!salesPersonId || !customerId || !orderDate) {
      return res.status(400).json({
        success: false,
        message: 'Sales person, customer, and order date are required'
      });
    }

    // Parse the order date
    const targetDate = new Date(orderDate);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Check if an order exists
    const existingOrder = await Order.findOne({
      salesPerson: salesPersonId,
      customer: customerId,
      orderDate: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      companyId: req.user.companyId
    }).lean();

    console.log('🔍 Existing order found:', existingOrder ? 'YES' : 'NO');

    res.json({
      success: true,
      data: {
        exists: !!existingOrder,
        orderId: existingOrder?._id,
        orderCode: existingOrder?.orderCode
      }
    });

  } catch (error) {
    console.error('Error checking existing order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check existing order',
      error: error.message
    });
  }
};

// 🔄 NEW: Service Team Verification for Lead-to-Order Flow
const verifyServiceOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, callRecordingUrl, isFakeCommitmentChecked, salesChecklist } = req.body;

    console.log(`🔍 Service Verification - Order: ${id}, Status: ${status}, Checklist:`, salesChecklist);

    const order = await Order.findById(id).populate('customer').populate('leadId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update service verification
    order.serviceVerification = {
      status: status || 'verified',
      verifiedBy: req.user._id,
      verifiedAt: new Date(),
      callRecordingUrl,
      isFakeCommitmentChecked: isFakeCommitmentChecked || false,
      remarks
    };

    if (salesChecklist) {
      order.salesChecklist = salesChecklist;
      order.markModified('salesChecklist');
    }

    // Update status history
    order.statusHistory.push({
      status: `service_${status || 'verified'}`,
      updatedBy: req.user._id,
      updatedAt: new Date(),
      remarks: `Service Verification: ${remarks || 'No remarks'}`
    });

    if (status === 'verified' || status === 'Confirm') {
      // ✅ VERIFIED: Auto-approve and move directly to Accounts > Sales Orders
      order.status = 'approved';
      order.approvedBy = req.user._id;
      order.approvedAt = new Date();
      console.log(`✅ Order ${order.orderCode} verified by Service - Auto-approved for Accounts Sales Orders`);
    } else {
      // ❌ REJECTED: Mark as rejected by service
      order.status = 'rejected_by_service';
      console.log(`❌ Order ${order.orderCode} rejected by Service`);
    }

    await order.save();

    // 🔔 Notifications after verification
    try {
      if (status === 'verified' || status === 'Confirm') {
        // ✅ Store is NOT notified here — it gets notified when the Order Form is
        // submitted (see orderFormController.upsertOrderForm), because the item
        // reaches Store only after the form is filled.
        // Notify the salesperson to fill the Order Form now.
        if (order.salesPerson) {
          await notificationService.createNotification({
            title: 'Deal Verified - Fill Order Form',
            message: `Order ${order.orderCode} has been verified. Please fill the Sales Order Form to send it to Store.`,
            type: 'lead', icon: 'check-circle', priority: 'high',
            targetUserId: order.salesPerson,
            data: { leadId: order.leadId?._id || order.leadId, orderCode: order.orderCode },
          });
        }
      } else {
        // ❌ Notify Sales Head that deal was rejected by service
        await notificationService.triggerSalesNotification({
          action: 'order_created',
          orderData: {
            _id: order._id,
            orderCode: order.orderCode,
            customerName: order.customer?.name || '',
            note: '❌ Deal rejected by Complaint Management/Service team.',
          },
          targetUnit: order.unit,
          targetCompanyId: order.companyId,
        });
      }
    } catch (notifErr) { console.error('Service verification notification error:', notifErr); }

    // 📋 Update Lead stage if this order came from a lead (keep status as-is)
    if (order.leadId) {
      const Lead = (await import('../models/Lead.js')).default;
      const lead = await Lead.findById(order.leadId);
      if (lead) {
        if (status === 'verified' || status === 'Confirm') {
          lead.stage = 'Service Verified';
        } else {
          lead.stage = 'Service Rejected';
        }
        lead.history.push({
          action: 'Service Verification',
          notes: `Order ${order.orderCode} ${status === 'verified' ? 'verified' : 'rejected'} by Service Team. ${remarks || ''}`,
          performedBy: req.user._id
        });
        await lead.save();
        console.log(`📋 Lead ${lead.leadCode} stage updated to: ${lead.stage}`);
      }
    }

    res.json({
      success: true,
      message: `Order ${status === 'verified' ? 'verified' : 'rejected'} successfully`,
      order
    });
  } catch (error) {
    console.error('❌ Service verification error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Accounts Approval & Payment Confirmation
const approveAccountOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, paymentMode, referenceNo, amount } = req.body;

    const order = await Order.findById(id).populate('customer');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.serviceVerification.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Order must be verified by Service Team before Account Approval'
      });
    }

    order.accountApproval = {
      status: status || 'approved',
      approvedBy: req.user._id,
      approvedAt: new Date(),
      remarks
    };

    if (status === 'approved') {
      order.paymentStatus = 'Paid';
      order.status = 'approved'; // Final approval for production

      // Automatically create a CustomerPayment entry
      const CustomerPayment = (await import('../models/CustomerPayment.js')).default;
      const payment = new CustomerPayment({
        customer: order.customer._id,
        amount: amount || order.totalAmount,
        paymentMode: paymentMode || 'Bank Transfer',
        referenceNo: referenceNo || 'DIRECT-ORDER-APPV',
        unit: order.unit,
        companyId: order.companyId,
        createdBy: req.user._id,
        notes: `Auto-generated from Order Approval: ${order.orderCode}. ${remarks || ''}`
      });
      await payment.save();
    }

    order.statusHistory.push({
      status: `account_${status || 'approved'}`,
      updatedBy: req.user._id,
      updatedAt: new Date(),
      remarks: `Accounts Approval: ${remarks || 'No remarks'}`
    });

    await order.save();

    res.json({
      success: true,
      message: 'Accounts approval updated successfully',
      order
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add Payment Evidence (Slip/Cheque)
const addPaymentEvidence = async (req, res) => {
  try {
    const { id } = req.params;
    const { fileUrl, fileType } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.paymentEvidence.push({
      fileUrl,
      fileType,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    });

    await order.save();

    res.json({
      success: true,
      message: 'Payment evidence added successfully',
      order
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get orders with tracking info (Orders that have invoices)
const getOrderTracking = async (req, res) => {
  try {
    const userCompanyId = req.user.companyId;
    const userRole = req.user.role;

    let query = {};

    // Only Superadmin/Super Admin sees all companies.
    if (userRole !== 'Superadmin' && userRole !== 'Super Admin') {
      if (!userCompanyId) {
        return res.status(400).json({ success: false, message: 'User company not configured.' });
      }
      query.companyId = userCompanyId;
    }

    console.log(`🔍 Order Tracking: Fetching for role ${userRole}, Company: ${userCompanyId}`);

    // 1. Fetch Sale-based records (approved/invoiced orders)
    const sales = await Sale.find(query)
      .populate({
        path: 'order',
        populate: {
          path: 'products.product',
          select: 'name specifications'
        }
      })
      .populate('customer', 'name mobile outstandingAmount')
      .lean();

    const saleOrderIds = new Set(
      sales.map(s => s.order?._id?.toString()).filter(Boolean)
    );

    const saleTrackingData = sales.map(sale => {
      const order = sale.order || {};
      return {
        _id: sale._id,
        orderId: order._id || null,
        orderCode: order.orderCode || 'Direct Invoice',
        orderDate: order.orderDate || sale.saleDate || new Date(),
        customerName: sale.customer?.name || 'Unknown Customer',
        customerMobile: sale.customer?.mobile || 'N/A',
        customerOutstanding: sale.customer?.outstandingAmount || 0,
        invoiceNumber: sale.invoiceNumber || 'N/A',
        invoiceType: sale.invoiceType || 'Pakka',
        totalAmount: sale.totalAmount || 0,
        products: order.products || [],
        requestedDeliveryDate: order.requestedDeliveryDate || null,
        paidAmount: sale.paidAmount || 0,
        balanceAmount: sale.balanceAmount || 0,
        paymentStatus: sale.paymentStatus || 'Pending',
        saleDate: sale.saleDate || new Date(),
        gatePass: sale.gatePass || { status: 'Pending' },
        productType: sale.productType || null,
        isAvailableInInventory: sale.isAvailableInInventory || null,
        storeQCStatus: sale.storeQCStatus || null,
        // Per-item scoreboard (multi-item flow) — each entry carries its own
        // productType / isAvailableInInventory / storeQCStatus / itemRef
        saleId: sale._id,
        saleItems: sale.items || [],
        orderStatus: order.status || 'pending',
        source: 'sale'
      };
    });

    // 🔄 NEW: Also fetch Orders with status='pending_service_approval' (from Lead-to-Order flow),
    // 'pending', and 'approved' (service-verified orders that have NO Sale/Invoice yet)
    // 📝 GATE: Store cannot see an order until its Sales Order Form has been submitted
    // (see OrderForm model / orderFormController.js) — orderFormCompleted flips back to
    // false if Accounts returns the form to the salesperson for correction.
    const orderQuery = {
      ...query,
      status: { $in: ['pending_service_approval', 'pending', 'approved'] },
      orderFormCompleted: true
    };
    const pendingOrders = await Order.find(orderQuery)
      .populate('customer', 'name mobile outstandingAmount')
      .populate('leadId', 'leadCode dealValue')
      .populate('products.product', 'name specifications')
      .lean();

    // Batch-resolve Sale records for uncovered orders in one query instead of
    // one Sale.findOne() per row (was an N+1 inside this loop).
    const uncoveredOrders = pendingOrders.filter(order => !saleOrderIds.has(order._id.toString()));
    const uncoveredOrderIds = uncoveredOrders.map(order => order._id);
    const relatedSales = uncoveredOrderIds.length
      ? await Sale.find({ order: { $in: uncoveredOrderIds } }).lean()
      : [];
    const saleByOrderId = new Map(relatedSales.map(s => [s.order?.toString(), s]));

    const pendingOrderTrackingData = [];

    for (const order of uncoveredOrders) {
      const orderSale = saleByOrderId.get(order._id.toString()) || null;

      const trackingItem = {
        _id: order._id,
        orderId: order._id,
        orderCode: order.orderCode || 'N/A',
        orderDate: order.orderDate || order.createdAt || new Date(),
        customerName: order.customer?.name || 'Unknown Customer',
        customerMobile: order.customer?.mobile || 'N/A',
        customerOutstanding: order.customer?.outstandingAmount || 0,
        invoiceNumber: orderSale?.invoiceNumber || 'Pending',
        invoiceType: orderSale?.invoiceType || 'N/A',
        totalAmount: order.totalAmount || 0,
        products: order.products || [],
        requestedDeliveryDate: order.requestedDeliveryDate || null,
        paidAmount: 0,
        balanceAmount: order.totalAmount || 0,
        paymentStatus: order.paymentStatus || 'Pending',
        saleDate: order.createdAt || new Date(),
        gatePass: { status: 'Pending' },
        productType: orderSale?.productType || null,
        isAvailableInInventory: orderSale?.isAvailableInInventory || null,
        storeQCStatus: orderSale?.storeQCStatus || null,
        // Per-item scoreboard (empty until Store first touches the order —
        // the frontend then falls back to order.products for the item list)
        saleId: orderSale?._id || null,
        saleItems: orderSale?.items || [],
        orderStatus: order.status, // 🔄 NEW: Include actual status (pending_service_approval/pending)
        serviceVerification: order.serviceVerification || { status: 'pending' }, // 🔄 NEW: Service verification info
        leadId: order.leadId?._id || null, // 📋 NEW: Lead reference
        leadCode: order.leadId?.leadCode || null, // 📋 NEW: Lead code
        dealValue: order.leadId?.dealValue || order.totalAmount, // 📋 NEW: Deal value from lead
        source: 'order'
      };
      
      pendingOrderTrackingData.push(trackingItem);
    }

    const trackingData = [...saleTrackingData, ...pendingOrderTrackingData];

    // Calculate "Completed Today" - Gate Pass generated today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const completedToday = trackingData.filter(item => {
      if (item.gatePass?.status === 'Generated' && item.gatePass?.generatedAt) {
        const generatedAt = new Date(item.gatePass.generatedAt);
        return generatedAt >= todayStart && generatedAt <= todayEnd;
      }
      return false;
    }).length;

    // Summary counts for dashboard
    const storeOrdersCount = trackingData.filter(item => item.gatePass?.status === 'Generated').length;
    const pendingDispatchCount = trackingData.filter(item =>
      (item.orderStatus === 'approved' || item.orderStatus === 'pending' || item.paymentStatus === 'Paid') &&
      item.gatePass?.status !== 'Generated'
    ).length;

    console.log(`📊 Order Tracking: Found ${trackingData.length} records (${saleTrackingData.length} from Sales, ${pendingOrderTrackingData.length} pending orders) for company ${userCompanyId}`);

    // Opt-in pagination/search/sort — only applied when the caller explicitly
    // sends page/limit. The Store Dashboard's "recent orders" call sends
    // neither and keeps getting the full unfiltered array exactly as before
    // (it needs the complete set to slice its own top-5 + summary stats).
    // Store Orders' browse view opts in and gets the same "visible orders"
    // rule + sort it already applied client-side, now applied here instead —
    // copied verbatim, not changed — so pagination totals stay accurate.
    const { page, limit, search } = req.query;
    let responseData = trackingData;
    let pagination;
    if (page || limit) {
      let visibleData = trackingData.filter(item =>
        item.orderStatus === 'approved' || item.orderStatus === 'pending' || item.paymentStatus === 'Paid'
      );
      if (search) {
        const s = search.toLowerCase();
        visibleData = visibleData.filter(item =>
          (item.orderCode || '').toLowerCase().includes(s) ||
          (item.customerName || '').toLowerCase().includes(s)
        );
      }
      visibleData = visibleData.slice().sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const total = visibleData.length;
      responseData = visibleData.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      pagination = { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) };
    }

    res.json({
      success: true,
      data: responseData,
      summary: {
        total: trackingData.length,
        storeOrders: storeOrdersCount,
        pendingDispatch: pendingDispatchCount,
        completedToday
      },
      ...(pagination ? { pagination } : {}),
    });
  } catch (error) {
    console.error('❌ Error in getOrderTracking:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching order tracking data',
      error: error.message
    });
  }
};

// Generate Gate Pass for a Sale
const generateGatePass = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { vehicleNumber, driverName, contactNumber } = req.body;

    const sale = await Sale.findById(saleId).populate('order').populate('customer');
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale record not found' });
    }

    // Only enforce NOC check for new orders (old orders won't have nocStatus set)
    if (sale.gatePass?.nocStatus === 'Pending') {
      return res.status(400).json({ success: false, message: 'NOC must be approved by Accounts before generating a Gate Pass.' });
    }

    // Generate Gate Pass Number
    const count = await Sale.countDocuments({ 'gatePass.status': 'Generated' });
    const gatePassNumber = `GP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    sale.gatePass = {
      ...sale.gatePass,
      gatePassNumber,
      generatedAt: new Date(),
      generatedBy: req.user._id,
      status: 'Generated',
      vehicleNumber: vehicleNumber || 'N/A',
      driverName: driverName || 'N/A',
      contactNumber: contactNumber || 'N/A'
    };

    await sale.save();

    res.json({
      success: true,
      message: 'Gate Pass generated successfully',
      gatePass: sale.gatePass
    });
  } catch (error) {
    console.error('Error generating gate pass:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Store Info for an Order — multi-item: routes each order item
// independently through the per-item automation (QC / Production / Purchase).
// Accepted bodies:
//   { items: [{ saleItemId? | itemRefId? | productName?,
//               productType?, isAvailableInInventory?, autoCheck? }] }
//   { autoCheck: true }                       → auto-check & route ALL items
//   { productType, isAvailableInInventory }   → legacy: apply to ALL items
const updateOrderStoreInfo = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { productType, isAvailableInInventory, items: itemDecisions, autoCheck } = req.body;

    console.log(`🏪 Store Info Update - Order ID: ${orderId}, body:`, JSON.stringify(req.body));

    const order = await Order.findById(orderId).populate('customer').populate('products.product');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 📝 GATE: defense-in-depth against stale frontend cache / direct API calls —
    // getOrderTracking already excludes these from the list, this blocks the action too.
    if (!order.orderFormCompleted) {
      return res.status(400).json({
        success: false,
        message: 'This order cannot be processed by Store until the Sales Order Form has been submitted.'
      });
    }

    const { sale, isNewSale } = await ensureSaleForOrder(order, req.user);

    const validTypes = ['In-house Manufactured', 'Purchased (Trading Product)'];
    const validAvailability = ['Available', 'Not Available'];
    if (productType && !validTypes.includes(productType)) {
      return res.status(400).json({ success: false, message: 'Invalid product type' });
    }
    if (isAvailableInInventory && !validAvailability.includes(isAvailableInInventory)) {
      return res.status(400).json({ success: false, message: 'Invalid inventory status' });
    }

    // Build the per-item decision list
    const saleItems = (sale.items || []).filter(it => (it.quantity || 0) > 0);
    if (!saleItems.length) {
      return res.status(400).json({ success: false, message: 'This order has no items to process.' });
    }
    const decisions = []; // [{ saleItem, decision }]

    if (Array.isArray(itemDecisions) && itemDecisions.length > 0) {
      for (const d of itemDecisions) {
        if (d.productType && !validTypes.includes(d.productType)) {
          return res.status(400).json({ success: false, message: 'Invalid product type for item' });
        }
        if (d.isAvailableInInventory && !validAvailability.includes(d.isAvailableInInventory)) {
          return res.status(400).json({ success: false, message: 'Invalid inventory status for item' });
        }
        let target = null;
        if (d.saleItemId) target = sale.items.id(d.saleItemId);
        if (!target && d.itemRefId) {
          target = saleItems.find(it => it.itemRef && it.itemRef.toString() === String(d.itemRefId));
        }
        if (!target && d.productName) {
          target = saleItems.find(it =>
            (it.productName || '').trim().toLowerCase() === String(d.productName).trim().toLowerCase());
        }
        if (!target) {
          return res.status(400).json({
            success: false,
            message: `Item not found on this order: ${d.productName || d.saleItemId || d.itemRefId}`
          });
        }
        decisions.push({
          saleItem: target,
          decision: d.autoCheck
            ? { autoCheck: true }
            : { productType: d.productType, isAvailableInInventory: d.isAvailableInInventory }
        });
      }
    } else {
      // Whole-order call: auto-check every item, or apply the single legacy
      // decision to every item (keeps the old frontend working unchanged)
      const LOCKED_STATUSES = ['Goes to QC', 'Approved from QC', 'Goes to Production', 'Production Completed', 'Goes to Purchase'];
      const wholeDecision = autoCheck ? { autoCheck: true } : { productType, isAvailableInInventory };
      for (const it of saleItems) {
        // Auto-check must never disturb an item already routed or QC-approved
        if (autoCheck && LOCKED_STATUSES.includes(it.storeQCStatus)) continue;
        decisions.push({ saleItem: it, decision: wholeDecision });
      }
    }

    // 🚀 Route every decided item through the per-item automation
    const results = [];
    for (const { saleItem, decision } of decisions) {
      try {
        const { routed, splitSibling } = await applyStoreDecisionToItem({ sale, order, saleItem, decision, user: req.user });
        results.push({
          saleItemId: saleItem._id,
          productName: saleItem.productName,
          quantity: saleItem.quantity,
          productType: saleItem.productType,
          isAvailableInInventory: saleItem.isAvailableInInventory,
          storeQCStatus: saleItem.storeQCStatus,
          routed,
          split: !!splitSibling
        });
        // Auto-split: report the shortfall line too, so the frontend shows
        // "N from stock → QC, M → Purchase/Production" in one response
        if (splitSibling) {
          results.push({
            saleItemId: splitSibling._id,
            productName: splitSibling.productName,
            quantity: splitSibling.quantity,
            productType: splitSibling.productType,
            isAvailableInInventory: splitSibling.isAvailableInInventory,
            storeQCStatus: splitSibling.storeQCStatus,
            routed: splitSibling.storeQCStatus === 'Goes to Purchase' ? 'purchase' : 'production',
            split: true
          });
        }
      } catch (itemErr) {
        console.error(`❌ Error routing item "${saleItem.productName}":`, itemErr);
        results.push({ saleItemId: saleItem._id, productName: saleItem.productName, error: itemErr.message });
      }
    }

    sale.recomputeAggregateStoreStatus();
    await sale.save();

    console.log(`✅ Store Info Updated - Order: ${order.orderCode}, Sale: ${sale.invoiceNumber}, ${results.length} item(s) processed`);

    res.json({
      success: true,
      message: 'Store information updated successfully',
      data: {
        orderId: order._id,
        orderCode: order.orderCode,
        saleId: sale._id,
        invoiceNumber: sale.invoiceNumber,
        // Aggregates (legacy consumers)
        productType: sale.productType,
        isAvailableInInventory: sale.isAvailableInInventory,
        storeQCStatus: sale.storeQCStatus,
        // Per-item outcome (new consumers)
        items: results,
        isNewSale,
        flowStatus: 'store_completed'
      }
    });
  } catch (error) {
    console.error('Error updating order store info:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Store Info for a Sale — multi-item aware. Accepts the same bodies as
// updateOrderStoreInfo (items[] / autoCheck / legacy single decision) and
// routes each sale item through the per-item automation.
const updateSaleStoreInfo = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { productType, isAvailableInInventory, items: itemDecisions, autoCheck } = req.body;

    const sale = await Sale.findById(saleId).populate('order');
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }
    const order = sale.order || null;

    const validTypes = ['In-house Manufactured', 'Purchased (Trading Product)'];
    const validAvailability = ['Available', 'Not Available'];
    if (productType && !validTypes.includes(productType)) {
      return res.status(400).json({ success: false, message: 'Invalid product type' });
    }
    if (isAvailableInInventory && !validAvailability.includes(isAvailableInInventory)) {
      return res.status(400).json({ success: false, message: 'Invalid inventory status' });
    }

    const saleItems = (sale.items || []).filter(it => (it.quantity || 0) > 0);
    if (!saleItems.length) {
      return res.status(400).json({ success: false, message: 'This sale has no items to process.' });
    }
    const decisions = [];

    if (Array.isArray(itemDecisions) && itemDecisions.length > 0) {
      for (const d of itemDecisions) {
        if (d.productType && !validTypes.includes(d.productType)) {
          return res.status(400).json({ success: false, message: 'Invalid product type for item' });
        }
        if (d.isAvailableInInventory && !validAvailability.includes(d.isAvailableInInventory)) {
          return res.status(400).json({ success: false, message: 'Invalid inventory status for item' });
        }
        let target = null;
        if (d.saleItemId) target = sale.items.id(d.saleItemId);
        if (!target && d.itemRefId) {
          target = saleItems.find(it => it.itemRef && it.itemRef.toString() === String(d.itemRefId));
        }
        if (!target && d.productName) {
          target = saleItems.find(it =>
            (it.productName || '').trim().toLowerCase() === String(d.productName).trim().toLowerCase());
        }
        if (!target) {
          return res.status(400).json({
            success: false,
            message: `Item not found on this sale: ${d.productName || d.saleItemId || d.itemRefId}`
          });
        }
        decisions.push({
          saleItem: target,
          decision: d.autoCheck
            ? { autoCheck: true }
            : { productType: d.productType, isAvailableInInventory: d.isAvailableInInventory }
        });
      }
    } else {
      const LOCKED_STATUSES = ['Goes to QC', 'Approved from QC', 'Goes to Production', 'Production Completed', 'Goes to Purchase'];
      const wholeDecision = autoCheck ? { autoCheck: true } : { productType, isAvailableInInventory };
      for (const it of saleItems) {
        // Auto-check must never disturb an item already routed or QC-approved
        if (autoCheck && LOCKED_STATUSES.includes(it.storeQCStatus)) continue;
        decisions.push({ saleItem: it, decision: wholeDecision });
      }
    }

    const results = [];
    for (const { saleItem, decision } of decisions) {
      try {
        const { routed, splitSibling } = await applyStoreDecisionToItem({ sale, order, saleItem, decision, user: req.user });
        results.push({
          saleItemId: saleItem._id,
          productName: saleItem.productName,
          quantity: saleItem.quantity,
          productType: saleItem.productType,
          isAvailableInInventory: saleItem.isAvailableInInventory,
          storeQCStatus: saleItem.storeQCStatus,
          routed,
          split: !!splitSibling
        });
        // Auto-split: report the shortfall line too, so the frontend shows
        // "N from stock → QC, M → Purchase/Production" in one response
        if (splitSibling) {
          results.push({
            saleItemId: splitSibling._id,
            productName: splitSibling.productName,
            quantity: splitSibling.quantity,
            productType: splitSibling.productType,
            isAvailableInInventory: splitSibling.isAvailableInInventory,
            storeQCStatus: splitSibling.storeQCStatus,
            routed: splitSibling.storeQCStatus === 'Goes to Purchase' ? 'purchase' : 'production',
            split: true
          });
        }
      } catch (itemErr) {
        console.error(`❌ Error routing item "${saleItem.productName}":`, itemErr);
        results.push({ saleItemId: saleItem._id, productName: saleItem.productName, error: itemErr.message });
      }
    }

    sale.recomputeAggregateStoreStatus();
    await sale.save();

    res.json({
      success: true,
      message: 'Store information updated successfully',
      data: {
        productType: sale.productType,
        isAvailableInInventory: sale.isAvailableInInventory,
        storeQCStatus: sale.storeQCStatus,
        items: results
      },
      productType: sale.productType,
      isAvailableInInventory: sale.isAvailableInInventory,
      storeQCStatus: sale.storeQCStatus
    });
  } catch (error) {
    console.error('Error updating store info:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Approve Sale Order from Accounts Sales Tracking
const approveSaleOrder = async (req, res) => {
  try {
    const { saleId } = req.params;
    const sale = await Sale.findById(saleId).populate('order');

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    if (sale.order) {
      const order = await Order.findById(sale.order._id);
      if (order) {
        order.status = 'approved';
        if (order.statusHistory) {
          order.statusHistory.push({
            status: 'approved',
            updatedBy: req.user._id,
            updatedAt: new Date(),
            remarks: 'Approved from Sales Tracking'
          });
        }
        await order.save();
      }
    }

    res.json({ success: true, message: 'Order approved successfully and sent to Store' });
  } catch (error) {
    console.error('Error in approveSaleOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get NOC Requests
const getNOCRequests = async (req, res) => {
  try {
    const Sale = (await import('../models/Sale.js')).default;
    const PackagingJob = (await import('../models/PackagingJob.js')).default;
    const LeadPayment = (await import('../models/LeadPayment.js')).default;
    const Customer = (await import('../models/Customer.js')).default;
    const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
    const OrderForm = (await import('../models/OrderForm.js')).default;
    const CustomerPayment = (await import('../models/CustomerPayment.js')).default;

    // Find all sales with populated orders
    // Sort: 'Pakka' invoices first (so Pakka is preferred over Kachha for same order),
    // then by createdAt descending for recency within same type
    const sales = await Sale.find({ companyId: req.user.companyId })
      .populate({
        path: 'order',
        select: '-quotation', // excludes a base64-embedded PDF — was making this query take 50+ seconds
        populate: { path: 'customer' }
      })
      .sort({ invoiceType: 1, createdAt: -1 }); // 'Kachha' < 'Pakka' alphabetically, so Pakka comes last - we reverse below

    // Re-sort: Pakka first, then Kachha (so dedup keeps Pakka for a given order)
    sales.sort((a, b) => {
      if (a.invoiceType === 'Pakka' && b.invoiceType !== 'Pakka') return -1;
      if (a.invoiceType !== 'Pakka' && b.invoiceType === 'Pakka') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // ── Batch pre-fetch everything the loop below needs, instead of issuing
    // several sequential queries PER sale (N+1). Same data, same lookups —
    // just fetched once up front and read from in-memory maps in the loop.
    const companyId = req.user.companyId;

    // Tab filter: which packaging lifecycle stage to show.
    // pending = still packed, awaiting NOC/gate pass/dispatch (previous default/only view)
    // completed = already dispatched
    // all = both
    const tab = (req.query.status || 'pending').toLowerCase();
    const jobStatuses = tab === 'completed' ? ['Dispatched'] : tab === 'all' ? ['Packed', 'Dispatched'] : ['Packed'];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));

    const orderCodes = [...new Set(sales.map(s => s.order?.orderCode).filter(Boolean))];
    const saleIds = sales.map(s => s._id);

    const [directJobs, linkedProdOrders] = await Promise.all([
      PackagingJob.find({
        company: companyId,
        status: { $in: jobStatuses },
        $or: [{ orderId: { $in: orderCodes } }, { saleId: { $in: saleIds } }]
      }).lean(),
      ProductionOrder.find({ saleId: { $in: saleIds }, company: companyId }).select('_id saleId').lean()
    ]);

    const jobByOrderCode = new Map();
    const jobBySaleId = new Map();
    directJobs.forEach(j => {
      if (j.orderId && !jobByOrderCode.has(j.orderId)) jobByOrderCode.set(j.orderId, j);
      if (j.saleId) {
        const key = j.saleId.toString();
        if (!jobBySaleId.has(key)) jobBySaleId.set(key, j);
      }
    });

    const prodOrderIdsBySaleId = new Map();
    linkedProdOrders.forEach(po => {
      const key = po.saleId.toString();
      if (!prodOrderIdsBySaleId.has(key)) prodOrderIdsBySaleId.set(key, []);
      prodOrderIdsBySaleId.get(key).push(po._id);
    });

    const allProdOrderIds = linkedProdOrders.map(po => po._id);
    const jobsByProdOrder = allProdOrderIds.length
      ? await PackagingJob.find({ productionOrderId: { $in: allProdOrderIds }, status: { $in: jobStatuses }, company: companyId }).lean()
      : [];
    const jobByProdOrderId = new Map();
    jobsByProdOrder.forEach(j => {
      const key = j.productionOrderId?.toString();
      if (key && !jobByProdOrderId.has(key)) jobByProdOrderId.set(key, j);
    });

    const leadIds = [...new Set(sales.map(s => s.order?.leadId?.toString()).filter(Boolean))];
    const customerIds = [...new Set(sales.map(s => s.order?.customer?._id?.toString()).filter(Boolean))];
    const orderIds = [...new Set(sales.map(s => s.order?._id?.toString()).filter(Boolean))];

    const [allLeadPayments, allCustomerMasters, allOrderForms, allOrderPayments] = await Promise.all([
      leadIds.length
        ? LeadPayment.find({ leadId: { $in: leadIds }, status: 'Verified', companyId }).select('leadId amount').lean()
        : [],
      customerIds.length
        ? Customer.find({ _id: { $in: customerIds } }).select('outstandingAmount advancePayment').lean()
        : [],
      // ORDER-WISE financials — same source of truth as Customer Master's
      // order-financials breakdown and the NOC PDF (computeOrderFinancials),
      // so this list never disagrees with what Accounts sees elsewhere — a
      // payment recorded after the invoice was generated must still show
      // as Paid here instead of the stale Sale.totalAmount/paidAmount snapshot.
      orderIds.length
        ? OrderForm.find({ orderId: { $in: orderIds }, status: 'Submitted' })
          .select('orderId items totals receivedAmount paymentType').lean()
        : [],
      orderIds.length
        ? CustomerPayment.find({ order: { $in: orderIds }, companyId }).select('order amount').lean()
        : []
    ]);

    const leadPaymentSumByLeadId = new Map();
    const leadPaymentsByLeadId = new Map();
    allLeadPayments.forEach(p => {
      const key = p.leadId.toString();
      leadPaymentSumByLeadId.set(key, (leadPaymentSumByLeadId.get(key) || 0) + (p.amount || 0));
      if (!leadPaymentsByLeadId.has(key)) leadPaymentsByLeadId.set(key, []);
      leadPaymentsByLeadId.get(key).push(p);
    });
    const customerMasterById = new Map(allCustomerMasters.map(c => [c._id.toString(), c]));
    const orderFormByOrderId = new Map(allOrderForms.map(f => [f.orderId.toString(), f]));
    const orderPaymentsByOrderId = new Map();
    allOrderPayments.forEach(p => {
      const key = p.order.toString();
      if (!orderPaymentsByOrderId.has(key)) orderPaymentsByOrderId.set(key, []);
      orderPaymentsByOrderId.get(key).push(p);
    });

    const nocRequests = [];
    // Track processed orderIds to prevent duplicate NOC entries
    // Same order can have multiple Sale docs (Pakka + Kachha dual billing)
    // We only want ONE NOC entry per order - prefer 'Pakka' bill, fallback to first found
    const processedOrderIds = new Set();

    // Check if there is a Packed job for the sale's order
    for (const sale of sales) {
      if (!sale.order) continue;

      const orderIdStr = sale.order._id?.toString();
      if (!orderIdStr) continue;

      // Skip if this order was already added to NOC list (duplicate from dual billing)
      if (processedOrderIds.has(orderIdStr)) continue;

      // Check for packaging job via orderCode or saleId/sale ref
      // Also try matching via the productionOrder that links to this sale
      let job = jobByOrderCode.get(sale.order.orderCode) || jobBySaleId.get(sale._id.toString()) || null;

      // Fallback: find via productionOrderId → if that prodOrder links to this sale
      if (!job) {
        const prodOrderIds = prodOrderIdsBySaleId.get(sale._id.toString()) || [];
        for (const poId of prodOrderIds) {
          const j = jobByProdOrderId.get(poId.toString());
          if (j) { job = j; break; }
        }
      }

      if (job) {
        let advancedPaymentAmount = sale.advancedPaymentAmount || 0;
        if (!advancedPaymentAmount && sale.order.leadId) {
          advancedPaymentAmount = leadPaymentSumByLeadId.get(sale.order.leadId.toString()) || 0;
        }

        let effectiveTotalAmount, effectivePaidAmount, effectiveBalance, effectivePaymentStatus;

        const form = orderFormByOrderId.get(orderIdStr);
        if (form) {
          const orderPayments = orderPaymentsByOrderId.get(orderIdStr) || [];
          const leadPayments = sale.order.leadId
            ? (leadPaymentsByLeadId.get(sale.order.leadId.toString()) || [])
            : [];
          const fin = computeOrderFinancials({ form, sale, orderPayments, leadPayments });
          effectiveTotalAmount = fin.total;
          effectivePaidAmount = fin.advance + fin.paid;
          effectiveBalance = fin.due;
          effectivePaymentStatus = fin.paymentStatus;
          advancedPaymentAmount = fin.advance;
        } else {
          // Legacy fallback for orders with no Order Form on file
          effectivePaidAmount = (sale.paidAmount || 0) + advancedPaymentAmount;

          // Use sale.totalAmount if invoice is generated (> 0), else fallback to order value + 18% GST
          const orderBaseAmount = sale.order?.totalAmount || 0;
          effectiveTotalAmount = (sale.totalAmount && sale.totalAmount > 0)
            ? sale.totalAmount
            : Math.round(orderBaseAmount * 1.18);

          effectiveBalance = Math.max(0, effectiveTotalAmount - effectivePaidAmount);
          effectivePaymentStatus = sale.paymentStatus;
          if (advancedPaymentAmount > 0 && effectiveBalance <= 0) {
            effectivePaymentStatus = 'Paid';
          } else if (advancedPaymentAmount > 0 && effectivePaidAmount > 0) {
            effectivePaymentStatus = 'Partially Paid';
          }
        }

        // Fetch customer master financial fields
        let customerOutstanding = 0;
        let customerAdvance = 0;
        if (sale.order.customer?._id) {
          const custMaster = customerMasterById.get(sale.order.customer._id.toString());
          customerOutstanding = custMaster?.outstandingAmount || 0;
          customerAdvance = custMaster?.advancePayment || 0;
        }

        nocRequests.push({
          saleId: sale._id,
          orderId: sale.order._id,
          orderCode: sale.order.orderCode,
          customerName: sale.order.customer?.name || 'N/A',
          customerMobile: sale.order.customer?.mobile || 'N/A',
          totalAmount: effectiveTotalAmount,
          paidAmount: effectivePaidAmount,
          advancedPaymentAmount,
          balanceAmount: effectiveBalance,
          paymentStatus: effectivePaymentStatus,
          nocStatus: sale.gatePass?.nocStatus || 'Pending',
          gatePassStatus: sale.gatePass?.status || 'Pending',
          gatePassNumber: sale.gatePass?.gatePassNumber || '',
          vehicleNumber: sale.gatePass?.vehicleNumber || '',
          driverName: sale.gatePass?.driverName || '',
          contactNumber: sale.gatePass?.contactNumber || '',
          gatePassGeneratedAt: sale.gatePass?.generatedAt || null,
          machineName: job.machineName,
          machineCode: job.machineCode,
          serialNumber: job.serialNumber,
          invoiceType: sale.invoiceType || 'Pakka',
          // Customer master reference fields (kept for info display)
          customerOutstanding,
          customerAdvance,
          // ORDER-WISE display values — this NOC row belongs to ONE order, so
          // Total/Paid/Due are that order's own figures (not customer-level):
          // Total = order invoice total, Paid = advance + receipts against this
          // order, Due = what's left on this order
          displayTotal: effectiveTotalAmount,
          displayPaid: effectivePaidAmount,
          displayDue: effectiveBalance,
          _packedDate: job.packingCompleteTime || job.updatedAt
        });

        // Mark this orderId as processed so duplicate Sale docs are skipped
        processedOrderIds.add(orderIdStr);
      }
    }

    // The dedup above needs to see every sale to correctly keep just one NOC
    // row per order (preferring Pakka over Kachha), so it can't be paginated
    // at the DB query level — but the final response IS paginated + search-
    // filtered here, instead of shipping every NOC row the company has ever
    // had to the browser on every load. page/limit are already parsed above
    // (line ~1600) for the tab/jobStatuses filter — reused here rather than
    // redeclared.
    //
    // Most recently packed/dispatched order first — also gives pagination a
    // stable, deterministic order to slice against.
    nocRequests.sort((a, b) => new Date(b._packedDate || 0) - new Date(a._packedDate || 0));

    const search = (req.query.search || '').trim().toLowerCase();
    const filtered = search
      ? nocRequests.filter(r =>
          (r.orderCode || '').toLowerCase().includes(search) ||
          (r.customerName || '').toLowerCase().includes(search) ||
          (r.machineName || '').toLowerCase().includes(search)
        )
      : nocRequests;

    const total = filtered.length;
    const paged = filtered
      .slice((page - 1) * limit, page * limit)
      .map(({ _packedDate, ...rest }) => rest);

    res.json({
      success: true,
      data: paged,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error in getNOCRequests:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve NOC
const approveNOC = async (req, res) => {
  try {
    const { saleId } = req.params;
    const Sale = (await import('../models/Sale.js')).default;
    const sale = await Sale.findById(saleId);

    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });

    sale.gatePass = sale.gatePass || {};
    sale.gatePass.nocStatus = 'Approved';
    sale.gatePass.nocApprovedAt = new Date();
    await sale.save();

    res.json({ success: true, message: 'NOC Approved successfully' });
  } catch (error) {
    console.error('Error in approveNOC:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get full NOC details for the NOC Certificate PDF — order → store → production →
// QC → packing flow timeline + customer-master financials. Fetched on-demand
// only when the PDF is generated (no extra load on the NOC list API).
const getNOCDetails = async (req, res) => {
  try {
    const { saleId } = req.params;
    const Sale = (await import('../models/Sale.js')).default;
    const PackagingJob = (await import('../models/PackagingJob.js')).default;
    const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
    const QCJob = (await import('../models/QCJob.js')).default;
    const Customer = (await import('../models/Customer.js')).default;

    const sale = await Sale.findOne({ _id: saleId, companyId: req.user.companyId })
      .populate({ path: 'order', select: '-quotation', populate: { path: 'customer' } });
    if (!sale || !sale.order) return res.status(404).json({ success: false, message: 'Sale/Order not found' });

    const order = sale.order;

    // Packaging job (same matching logic as the NOC list)
    let job = await PackagingJob.findOne({
      $or: [{ orderId: order.orderCode }, { saleId: sale._id }],
      status: { $in: ['Packed', 'Dispatched'] },
      company: req.user.companyId
    }).populate('qcJobId').populate('productionOrderId');

    // Production order — via packaging job link or direct sale link
    let prodOrder = job?.productionOrderId || null;
    if (!prodOrder) {
      prodOrder = await ProductionOrder.findOne({ saleId: sale._id, company: req.user.companyId })
        .sort({ createdAt: -1 }).lean();
      if (!job && prodOrder) {
        job = await PackagingJob.findOne({
          productionOrderId: prodOrder._id,
          status: { $in: ['Packed', 'Dispatched'] },
          company: req.user.companyId
        }).populate('qcJobId');
      }
    }

    // QC job — via packaging job link, sale link, or production order ref
    let qcJob = job?.qcJobId || null;
    if (!qcJob) {
      const qcFilters = [{ saleId: sale._id }];
      if (prodOrder?.orderId) qcFilters.push({ source: 'Production', sourceRefId: prodOrder.orderId });
      qcJob = await QCJob.findOne({ $or: qcFilters, company: req.user.companyId })
        .sort({ createdAt: -1 }).lean();
    }

    // Order approval date from statusHistory (fallback: sale createdAt = store received)
    const approvedHist = (order.statusHistory || []).find(h =>
      String(h.status || '').toLowerCase().includes('approve'));

    // Some legacy fields hold non-date strings (e.g. "14:30") — pick the first parseable date
    const validDate = (...cands) => cands.find(d => d && !isNaN(new Date(d).getTime())) || null;

    // ── Item flow timeline (order → store → production → QC → packing → NOC) ──
    const timeline = [
      {
        step: 'Order Received',
        date: order.createdAt,
        detail: `Order ${order.orderCode} placed${order.customer?.name ? ` by ${order.customer.name}` : ''}`
      },
      {
        step: 'Approved & Sent to Store',
        date: approvedHist?.updatedAt || sale.createdAt,
        detail: 'Order approved and forwarded to Store for processing'
      },
      prodOrder && {
        step: 'Production Started',
        date: prodOrder.createdAt,
        detail: `Production order ${prodOrder.orderId || ''} created${prodOrder.machineName ? ` for ${prodOrder.machineName}` : ''}`
      },
      prodOrder && prodOrder.status === 'Completed' && {
        step: 'Production Completed',
        date: prodOrder.updatedAt,
        detail: 'All production processes completed'
      },
      qcJob && {
        step: 'QC Approved',
        date: qcJob.status === 'Approved' ? validDate(qcJob.inspectionEndDate, qcJob.updatedAt) : null,
        detail: qcJob.status === 'Approved'
          ? `Quality check passed${qcJob.inspector ? ` (Inspector: ${qcJob.inspector})` : ''} — ${qcJob.qcJobId || ''}`
          : `QC status: ${qcJob.status}`
      },
      job && {
        step: 'Packed / Ready for Dispatch',
        date: validDate(job.packingCompleteTime, job.updatedAt),
        detail: `Packing completed (${job.packingType || 'Standard'})${job.serialNumber ? ` — SN: ${job.serialNumber}` : ''}`
      },
      sale.gatePass?.nocStatus === 'Approved' && {
        step: 'NOC Approved by Accounts',
        date: sale.gatePass?.nocApprovedAt || null,
        detail: 'Accounts team issued No Objection for dispatch'
      },
      sale.gatePass?.status === 'Generated' && {
        step: 'Gate Pass Generated',
        date: sale.gatePass?.generatedAt || null,
        detail: `Vehicle: ${sale.gatePass?.vehicleNumber || 'N/A'}, Driver: ${sale.gatePass?.driverName || 'N/A'}`
      }
    ].filter(Boolean);

    // Customer master reference fields (info only)
    const custMaster = order.customer?._id
      ? await Customer.findById(order.customer._id).select('outstandingAmount advancePayment address city state').lean()
      : null;
    const customerOutstanding = custMaster?.outstandingAmount || 0;
    const customerAdvance = custMaster?.advancePayment || 0;

    // ORDER-WISE financials — same source of truth as Customer Master's
    // order-financials breakdown, Packed Orders and the Due Bill PDF
    // (computeOrderFinancials), so the NOC never disagrees with what
    // Accounts already sees elsewhere — a payment recorded after the
    // invoice was generated (the common case) must still show as Paid here.
    const OrderForm = (await import('../models/OrderForm.js')).default;
    const CustomerPayment = (await import('../models/CustomerPayment.js')).default;
    const LeadPayment = (await import('../models/LeadPayment.js')).default;

    let leadPayments = [];
    if (order.leadId) {
      leadPayments = await LeadPayment.find({ leadId: order.leadId, status: 'Verified', companyId: req.user.companyId })
        .select('amount').lean();
    }

    let orderTotal, orderPaid, orderDue;
    const form = await OrderForm.findOne({ orderId: order._id, status: 'Submitted' })
      .select('items totals receivedAmount paymentType').lean();
    if (form) {
      const orderPayments = await CustomerPayment.find({ order: order._id, companyId: req.user.companyId })
        .select('amount').lean();
      const fin = computeOrderFinancials({ form, sale, orderPayments, leadPayments });
      orderTotal = fin.total;
      orderPaid = fin.advance + fin.paid;
      orderDue = fin.due;
    } else {
      // Legacy fallback for orders with no Order Form on file
      let orderAdvance = sale.advancedPaymentAmount || 0;
      if (!orderAdvance && leadPayments.length) {
        orderAdvance = leadPayments.reduce((s, p) => s + (p.amount || 0), 0);
      }
      orderTotal = (sale.totalAmount && sale.totalAmount > 0)
        ? sale.totalAmount
        : Math.round((order.totalAmount || 0) * 1.18);
      orderPaid = (sale.paidAmount || 0) + orderAdvance;
      orderDue = Math.max(0, orderTotal - orderPaid);
    }

    res.json({
      success: true,
      data: {
        orderCode: order.orderCode,
        orderDate: order.createdAt,
        customerName: order.customer?.name || 'N/A',
        customerMobile: order.customer?.mobile || 'N/A',
        customerEmail: order.customer?.email || '',
        customerAddress: [custMaster?.address, custMaster?.city, custMaster?.state].filter(Boolean).join(', '),
        machineName: job?.machineName || prodOrder?.machineName || 'N/A',
        machineCode: job?.machineCode || prodOrder?.machineCode || 'N/A',
        serialNumber: job?.serialNumber || 'N/A',
        invoiceType: sale.invoiceType || 'Pakka',
        nocStatus: sale.gatePass?.nocStatus || 'Pending',
        nocApprovedAt: sale.gatePass?.nocApprovedAt || null,
        timeline,
        customerOutstanding,
        customerAdvance,
        // Order-wise: this order's own Total / Paid (advance + receipts) / Due
        displayTotal: orderTotal,
        displayPaid: orderPaid,
        displayDue: orderDue
      }
    });
  } catch (error) {
    console.error('Error in getNOCDetails:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Get order by leadId — no salesPerson restriction, scoped to companyId only
const getOrderByLeadId = async (req, res) => {
  try {
    const { leadId } = req.params;
    if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    }

    const filter = { leadId: new mongoose.Types.ObjectId(leadId) };
    // Scope to company (except Super Admin)
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Super Admin') {
      if (req.user.companyId) {
        filter.companyId = new mongoose.Types.ObjectId(req.user.companyId);
      }
    }

    const order = await Order.findOne(filter)
      .populate('customer', 'name email mobile')
      .populate('salesPerson', 'username fullName')
      .sort({ createdAt: -1 });

    if (!order) {
      return res.status(404).json({ success: false, message: 'No order associated with this lead.' });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error('Error fetching order by leadId:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔍 Auto-check inventory for a product in an order row
// GET /api/orders/check-inventory?itemId=xxx&requiredQty=2
// or  /api/orders/check-inventory?name=Cutting%20Machine&requiredQty=2 (multi-item
// rows that came from the Order Form and may not carry an inventory ref yet)
const checkInventoryForItem = async (req, res) => {
  try {
    const { itemId, requiredQty, name, code } = req.query;

    if (!itemId && !name && !code) {
      return res.status(400).json({ success: false, message: 'itemId, code or name is required' });
    }

    let item = null;
    if (itemId && mongoose.Types.ObjectId.isValid(itemId)) {
      item = await Item.findById(itemId).lean();
    }
    if (!item && (name || code)) {
      const { resolveInventoryItem } = await import('../services/storeFlowService.js');
      const resolved = await resolveInventoryItem(req.user.companyId, { code, name });
      item = resolved ? resolved.toObject() : null;
    }
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found in inventory' });
    }

    const neededQty = parseFloat(requiredQty) || 1;
    const availableQty = item.qty || 0;

    // Map item category -> productType label
    // Category 'Purchase Machine' -> 'Purchased (Trading Product)', others -> 'In-house Manufactured'
    const productType = item.category === 'Purchase Machine'
      ? 'Purchased (Trading Product)'
      : 'In-house Manufactured';

    // Check if enough stock exists
    const isAvailableInInventory = availableQty >= neededQty ? 'Available' : 'Not Available';

    return res.json({
      success: true,
      data: {
        itemId: item._id,
        itemName: item.name,
        itemCode: item.code,
        availableQty,
        requiredQty: neededQty,
        internalManufacturing: item.internalManufacturing,
        productType,
        isAvailableInInventory
      }
    });
  } catch (error) {
    console.error('Error checking inventory for item:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// =============================================================================
// GET DEAL VERIFICATIONS (Service Team Pagination)
// Supports tab filtering: pending / verified / rejected / all
// =============================================================================
const getDealVerifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      serviceStatus = '',   // 'pending' | 'verified' | 'rejected' | '' (all)
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const userCompanyId = req.user.companyId;
    const userRole = req.user.role;

    // Base filter: company-scoped unless Superadmin
    const filter = {};
    if (userRole !== 'Superadmin' && userRole !== 'Super Admin' && userCompanyId) {
      filter.companyId = new mongoose.Types.ObjectId(userCompanyId);
    }

    // Service status filter
    if (serviceStatus === 'pending') {
      filter.$and = [
        { 'serviceVerification.status': { $ne: 'verified' } },
        { 'statusHistory.status': { $nin: ['service_verified', 'service_Confirm'] } },
        { status: { $ne: 'rejected_by_service' } },
        { 'serviceVerification.status': { $ne: 'rejected' } }
      ];
    } else if (serviceStatus === 'rejected') {
      filter.$or = [
        { status: 'rejected_by_service' },
        { 'serviceVerification.status': 'rejected' }
      ];
    } else if (serviceStatus === 'verified') {
      filter.$or = [
        { 'serviceVerification.status': 'verified' },
        { 'statusHistory.status': 'service_verified' },
        { 'statusHistory.status': 'service_Confirm' }
      ];
    }

    // Optional search
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const searchFilter = {
        $or: [
          { orderCode: searchRegex },
          { notes: searchRegex },
        ]
      };
      if (filter.$and) {
        filter.$and.push(searchFilter);
      } else if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, searchFilter];
        delete filter.$or;
      } else {
        filter.$or = searchFilter.$or;
      }
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [dealOrders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email mobile address city state contactPerson category')
        .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image warranty')
        .populate('salesPerson', 'username fullName email role companyId')
        .populate('leadId', 'leadCode dealValue')
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limitNum);

    // 📝 Stamp Order Form status (Not Filled / Submitted / Returned) onto each order,
    // same batched-lookup pattern used for Lead.hasQuotation in leadController.getLeads.
    const OrderForm = (await import('../models/OrderForm.js')).default;
    const forms = await OrderForm.find({ orderId: { $in: dealOrders.map(o => o._id) } })
      .select('orderId status')
      .lean();
    const formStatusMap = new Map(forms.map(f => [f.orderId.toString(), f.status]));
    const ordersWithFormStatus = dealOrders.map(o => ({
      ...o.toObject(),
      orderFormStatus: formStatusMap.get(o._id.toString()) || null
    }));

    return res.json({
      success: true,
      orders: ordersWithFormStatus,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalOrders,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Error fetching deal verifications:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/repair-store-status
// One-time repair: fixes Sale records whose storeQCStatus is stuck at
// 'Goes to Purchase' because QC was approved before the purchaseRequestId fix.
// Safe to call multiple times — only touches Sales with the stuck status.
// ─────────────────────────────────────────────────────────────────────────────
const repairStoreQCStatus = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // Find all Sales stuck at 'Goes to Purchase' for this company
    const stuckSales = await Sale.find({
      companyId,
      storeQCStatus: 'Goes to Purchase'
    }).lean();

    if (stuckSales.length === 0) {
      return res.json({ success: true, message: 'No stuck records found.', repaired: 0 });
    }

    const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;
    const QCJob = (await import('../models/QCJob.js')).default;

    let repaired = 0;
    const details = [];

    for (const sale of stuckSales) {
      const saleRef = sale.invoiceNumber || sale._id.toString();

      // Find the PurchaseRequest linked to this Sale
      const pr = await PurchaseRequest.findOne({
        $or: [
          { storeOrderId: sale.order || sale._id },
          { itemId: saleRef }
        ],
        companyId
      });

      if (!pr) {
        details.push({ saleId: sale._id, invoiceNumber: sale.invoiceNumber, result: 'No PR found — skipped' });
        continue;
      }

      // Check if there's a QC job for this PR that was approved
      const approvedQCJob = await QCJob.findOne({
        $or: [
          { purchaseRequestId: pr._id },
          { sourceRefId: pr.purchaseOrder?.toString() || pr.requestId },
          { itemCode: pr.itemId || pr.requestId }
        ],
        source: 'Purchase',
        status: 'Approved',
        company: companyId
      });

      if (approvedQCJob) {
        // QC was approved — update Sale to Purchase Completed
        await Sale.findByIdAndUpdate(sale._id, { storeQCStatus: 'Purchase Completed' });
        repaired++;
        details.push({ saleId: sale._id, invoiceNumber: sale.invoiceNumber, result: 'Repaired → Purchase Completed' });

        // Also patch the QC job with purchaseRequestId and saleId for future reliability
        await QCJob.findByIdAndUpdate(approvedQCJob._id, {
          purchaseRequestId: pr._id,
          saleId: sale._id
        });
      } else {
        // PR exists but QC not yet approved — check PR status
        if (pr.status === 'Received') {
          details.push({ saleId: sale._id, invoiceNumber: sale.invoiceNumber, result: `PR Received but QC not found (PR: ${pr.requestId})` });
        } else {
          details.push({ saleId: sale._id, invoiceNumber: sale.invoiceNumber, result: `PR status: ${pr.status} — still in progress` });
        }
      }
    }

    return res.json({
      success: true,
      message: `Repair complete. ${repaired} record(s) updated.`,
      repaired,
      total: stuckSales.length,
      details
    });
  } catch (error) {
    console.error('repairStoreQCStatus error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export {
  createOrder,
  getOrders,
  getOrderByLeadId,
  getOrderById,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  checkExistingOrder,
  verifyServiceOrder,
  approveAccountOrder,
  addPaymentEvidence,
  getOrderTracking,
  generateGatePass,
  updateSaleStoreInfo,
  updateOrderStoreInfo,
  approveSaleOrder,
  getNOCRequests,
  approveNOC,
  getNOCDetails,
  checkInventoryForItem,
  getDealVerifications,
  repairStoreQCStatus,
};