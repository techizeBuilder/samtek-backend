import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import { Item } from '../models/Inventory.js';
import ProductDailySummary from '../models/ProductDailySummary.js';
import CutoffTime from '../models/CutoffTime.js';
import notificationService from '../services/notificationService.js';
import Sale from '../models/Sale.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';

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

    // Company-based filtering for Unit Managers
    if (userRole === 'Unit Manager' && userCompanyId) {
      // Get sales persons from the same company
      const User = (await import('../models/User.js')).default;
      const companySalesPersons = await User.find({ 
        companyId: userCompanyId,
        role: { $in: ['Sales', 'Unit Manager', 'Unit Head'] }
      }).select('_id username fullName role').lean();
      
      const salesPersonIds = companySalesPersons.map(sp => sp._id);
      filter.salesPerson = { $in: salesPersonIds };
      
      console.log('🏢 UNIT MANAGER COMPANY FILTERING');
      console.log('Company ID:', userCompanyId);
      console.log('Company Sales Persons Found:', companySalesPersons.length);
      companySalesPersons.forEach(sp => {
        console.log(`  - ${sp.username} (${sp.fullName || 'No name'}) - ${sp.role}`);
      });
      console.log('Sales Person IDs for filtering:', salesPersonIds);
    }
    // Role-based filtering: Sales users only see their OWN orders
    else if (userRole === 'Sales') {
      filter.salesPerson = salespersonId;
      filter.companyId = userCompanyId; // Additional company isolation
      console.log('👤 SALES PERSON FILTERING - Own orders only from own company');
      console.log('Filter applied:', { salesPerson: salespersonId, companyId: userCompanyId });
    }
    // Super Admin can see all orders
    else if (userRole === 'Superadmin') {
      console.log('👑 SUPER ADMIN - No filtering applied (all orders)');
    }
    // For other roles, also filter by company if available  
    else {
      if (userCompanyId) {
        const User = (await import('../models/User.js')).default;
        const companySalesPersons = await User.find({ 
          companyId: userCompanyId,
          role: { $in: ['Sales', 'Unit Manager', 'Unit Head'] }
        }).select('_id username fullName role').lean();
        
        const salesPersonIds = companySalesPersons.map(sp => sp._id);
        filter.salesPerson = { $in: salesPersonIds };
        
        console.log(`🏢 ${userRole.toUpperCase()} COMPANY FILTERING`);
        console.log('Company ID:', userCompanyId);
        console.log('Company Sales Persons Found:', companySalesPersons.length);
        companySalesPersons.forEach(sp => {
          console.log(`  - ${sp.username} (${sp.fullName || 'No name'}) - ${sp.role}`);
        });
        console.log('Sales Person IDs for filtering:', salesPersonIds);
      } else {
        filter.salesPerson = salespersonId;
        console.log(`👤 ${userRole.toUpperCase()} - No company, filtering own orders only`);
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
      .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image');

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
    
    // Unit Manager can update any status
    if (userRole === 'Unit Manager' || userRole === 'Superadmin') {
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



export {
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  checkExistingOrder
};