import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import User from '../models/User.js';
import Return from '../models/Return.js';
import mongoose from 'mongoose';
import { Account, Transaction } from '../models/Account.js';
import CustomerPayment from '../models/CustomerPayment.js';
import VendorPayment from '../models/VendorPayment.js';
import Supplier from '../models/Supplier.js';
import SalesmanDailySettlement from '../models/SalesmanDailySettlement.js';
import LeadPayment from '../models/LeadPayment.js';
import { USER_ROLES } from '../shared/schema.js';

/**
 * Get all sales invoices for the company
 * Shows all orders from all sales persons in the company
 */
export const getCompanySalesInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'All', search = '', sortBy = 'date', sortOrder = 'desc' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('📊 getCompanySalesInvoices called:', {
      companyId: userCompanyId,
      page,
      limit,
      status,
      search
    });

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID not found. User not assigned to a company.'
      });
    }

    // Build query to get ALL orders for this company (all sales persons)
    let orderQuery = {
      $or: [
        { companyId: userCompanyId },
        { company: userCompanyId }
      ]
    };

    // Get all orders for the company
    const allOrders = await Order.find(orderQuery)
      .populate('customer', 'name email mobile gstin address1 city state pin contactPerson')
      .populate('companyId', 'name unitName address city state locationPin mobile email gst')
      .populate('salesPerson', 'fullName username email')
      .sort({ createdAt: sortOrder === 'asc' ? 1 : -1 });

    console.log(`Found ${allOrders.length} orders for company`);

    // Format orders as invoices with calculated data
    let invoices = allOrders.map((order, index) => {
      const invoice = {
        _id: order._id,
        invoiceNo: order.orderCode || `INV-${order._id.toString().slice(-6).toUpperCase()}`,
        customerName: order.customer?.name || 'Unknown Customer',
        customerId: order.customer?._id,
        customer: order.customer, // Full customer object
        customerEmail: order.customer?.email,
        customerPhone: order.customer?.mobile || order.customer?.phone,
        company: order.companyId, // Full company object
        date: order.createdAt,
        amount: order.totalAmount || 0,
        discount: order.discountAmount || 0,
        gst: order.gst || 0,
        finalAmount: (order.totalAmount || 0) - (order.discountAmount || 0) + (order.gst || 0),
        status: order.paymentStatus || 'Pending',
        paymentMethod: order.paymentMethod || 'Not Specified',
        items: order.products?.length || 0,
        salesPerson: order.salesPerson?.fullName || order.salesPerson?.username || 'Unknown',
        salesPersonId: order.salesPerson?._id,
        orderCode: order.orderCode,
        itemsCount: order.itemsCount || 0,
        notes: order.notes || ''
      };
      return invoice;
    });

    // Apply search filter
    if (search && search.trim()) {
      invoices = invoices.filter(inv =>
        inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerName.toLowerCase().includes(search.toLowerCase()) ||
        inv.salesPerson.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Apply status filter
    if (status && status !== 'All') {
      invoices = invoices.filter(inv => inv.status === status);
    }

    // Calculate pagination
    const totalInvoices = invoices.length;
    const totalPages = Math.ceil(totalInvoices / parseInt(limit));
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedInvoices = invoices.slice(startIndex, endIndex);

    // Calculate summary statistics
    const summary = {
      totalInvoices: totalInvoices,
      totalAmount: invoices.reduce((sum, inv) => sum + inv.amount, 0),
      totalDiscount: invoices.reduce((sum, inv) => sum + inv.discount, 0),
      totalFinalAmount: invoices.reduce((sum, inv) => sum + inv.finalAmount, 0),
      paidCount: invoices.filter(inv => inv.status === 'Paid').length,
      pendingCount: invoices.filter(inv => inv.status === 'Pending').length,
      overdueCount: invoices.filter(inv => inv.status === 'Overdue').length,
      byStatus: {
        paid: invoices.filter(inv => inv.status === 'Paid').length,
        pending: invoices.filter(inv => inv.status === 'Pending').length,
        overdue: invoices.filter(inv => inv.status === 'Overdue').length
      }
    };

    console.log(`📋 Returning ${paginatedInvoices.length} invoices (page ${page})`);

    res.json({
      success: true,
      data: {
        invoices: paginatedInvoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalInvoices,
          pages: totalPages,
          hasMore: endIndex < totalInvoices
        },
        summary,
        filters: {
          status,
          search
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in getCompanySalesInvoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company sales invoices',
      error: error.message
    });
  }
};

/**
 * Get detailed invoice information
 */
export const getInvoiceDetail = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userCompanyId = req.user.companyId;

    console.log('📄 getInvoiceDetail called:', { invoiceId, companyId: userCompanyId });

    const order = await Order.findById(invoiceId)
      .populate('customer')
      .populate('salesPerson', 'fullName username email phone')
      .populate('products.product', 'name code price');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Verify company access
    if (order.companyId?.toString() !== userCompanyId?.toString() &&
      order.company?.toString() !== userCompanyId?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const invoice = {
      _id: order._id,
      invoiceNo: order.orderCode,
      customer: order.customer,
      salesPerson: {
        _id: order.salesPerson?._id,
        name: order.salesPerson?.fullName || order.salesPerson?.username || 'Unknown',
        username: order.salesPerson?.username,
        email: order.salesPerson?.email,
        phone: order.salesPerson?.phone
      },
      date: order.createdAt,
      amount: order.totalAmount,
      discount: order.discountAmount,
      gst: order.gst || 0,
      finalAmount: (order.totalAmount || 0) - (order.discountAmount || 0) + (order.gst || 0),
      status: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      products: order.products,
      notes: order.notes
    };

    res.json({
      success: true,
      data: invoice
    });

  } catch (error) {
    console.error('❌ Error in getInvoiceDetail:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice details',
      error: error.message
    });
  }
};

/**
 * Update invoice payment status or details
 */
export const updateInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { status, paymentMethod, paymentDate, notes, amount, discount, gst } = req.body;
    const userCompanyId = req.user.companyId;

    console.log('✏️ updateInvoice called:', { invoiceId, amount, discount, gst, status, paymentMethod });

    const order = await Order.findById(invoiceId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Verify company access
    if (order.companyId?.toString() !== userCompanyId?.toString() &&
      order.company?.toString() !== userCompanyId?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update amount, discount, and gst if provided
    if (amount !== undefined && amount > 0) {
      order.totalAmount = amount;
    }
    if (discount !== undefined && discount >= 0) {
      order.discountAmount = discount;
    }
    if (gst !== undefined && gst >= 0) {
      order.gst = gst;
    }

    // Update other fields if provided
    if (status) order.paymentStatus = status;
    if (paymentMethod) order.paymentMethod = paymentMethod;
    if (paymentDate) order.paymentDate = paymentDate;
    if (notes !== undefined) order.notes = notes;

    await order.save();

    console.log('✅ Invoice updated successfully');

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: order
    });

  } catch (error) {
    console.error('❌ Error in updateInvoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update invoice',
      error: error.message
    });
  }
};

/**
 * Get sales summary by various metrics
 */
export const getSalesAnalytics = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('📈 getSalesAnalytics called:', { companyId: userCompanyId, period });

    let dateFilter = {};
    const now = new Date();

    if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = { createdAt: { $gte: weekAgo, $lte: now } };
    } else if (period === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { createdAt: { $gte: monthStart, $lte: now } };
    } else if (period === 'year') {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      dateFilter = { createdAt: { $gte: yearStart, $lte: now } };
    }

    const orders = await Order.find({
      $or: [
        { companyId: userCompanyId },
        { company: userCompanyId }
      ],
      ...dateFilter
    }).populate('salesPerson', 'username');

    // Group by sales person
    const bySalesPerson = {};
    orders.forEach(order => {
      const salesPersonName = order.salesPerson?.username || 'Unknown';
      if (!bySalesPerson[salesPersonName]) {
        bySalesPerson[salesPersonName] = {
          name: salesPersonName,
          ordersCount: 0,
          totalSales: 0,
          totalDiscount: 0
        };
      }
      bySalesPerson[salesPersonName].ordersCount += 1;
      bySalesPerson[salesPersonName].totalSales += order.totalAmount || 0;
      bySalesPerson[salesPersonName].totalDiscount += order.discountAmount || 0;
    });

    // Group by payment status
    const byStatus = {
      paid: orders.filter(o => o.paymentStatus === 'Paid').reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      pending: orders.filter(o => o.paymentStatus === 'Pending').reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      overdue: orders.filter(o => o.paymentStatus === 'Overdue').reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    };

    const analytics = {
      period,
      totalOrders: orders.length,
      totalSales: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      totalDiscount: orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0),
      averageOrderValue: orders.length > 0 ? orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0) / orders.length : 0,
      byStatus,
      topSalesPeople: Object.values(bySalesPerson)
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, 10)
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('❌ Error in getSalesAnalytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales analytics',
      error: error.message
    });
  }
};

/**
 * Get all sales persons for the company
 */
export const getAllSalesPersons = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('👥 getAllSalesPersons called:', {
      companyId: userCompanyId,
      page,
      limit,
      search,
      sortBy,
      sortOrder
    });

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID not found. User not assigned to a company.'
      });
    }

    // Build search query
    let searchQuery = {};
    if (search && search.trim()) {
      searchQuery = {
        $or: [
          { username: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Get all sales persons for this company
    // Build query with proper MongoDB structure
    let query = {
      companyId: userCompanyId,
      role: { $in: ['Sales', 'Sales Person', 'Salesman', 'Agent'] }
    };

    // Add search conditions if provided
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { username: searchRegex },
        { fullName: searchRegex },
        { email: searchRegex }
      ];
    }

    console.log('🔍 Query:', JSON.stringify(query, null, 2));

    const totalSalesPersons = await User.countDocuments(query);

    console.log('📊 Found total sales persons:', totalSalesPersons);

    // Build sort object
    let sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const salesPersons = await User.find(query)
      .select('_id username email fullName companyId totalOrders totalRevenue averageOrderValue successRate lastOrderDate isActive createdAt')
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    console.log('👥 Fetched sales persons count:', salesPersons.length, 'on page', page);

    // Get statistics for each sales person
    const salesPersonsWithStats = await Promise.all(
      salesPersons.map(async (salesPerson) => {
        // Get all orders for this sales person
        const orders = await Order.find({
          salesPerson: salesPerson._id,
          companyId: userCompanyId
        });

        const orderIds = orders.map(o => o._id);

        // Get all returns for this sales person OR for customers assigned to this sales person
        const customersAssigned = await Customer.find({ salesContact: salesPerson._id, companyId: userCompanyId });
        const assignedCustomerIds = customersAssigned.map(c => c._id);

        const returns = await Return.find({
          $or: [
            { salesPerson: salesPerson._id },
            { customerId: { $in: assignedCustomerIds } }
          ],
          companyId: userCompanyId,
          status: 'approved'
        });

        // Get all sales (invoices) and their collections for these orders OR these customers
        const sales = await Sale.find({
          companyId: userCompanyId,
          $or: [
            { order: { $in: orderIds } },
            { customer: { $in: assignedCustomerIds } }
          ]
        });

        const totalOrders = orders.length;
        const totalGrossSales = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
        const totalReturns = returns.reduce((sum, ret) => sum + (ret.totalAmount || 0), 0);
        const netReceivable = totalGrossSales - totalReturns;

        // Summing paidAmount from Sale records instead of Order
        const totalCollected = sales.reduce((sum, sale) => sum + (sale.paidAmount || 0), 0);
        const pendingAmount = netReceivable - totalCollected;

        const averageOrderValue = totalOrders > 0 ? totalGrossSales / totalOrders : 0;

        // Calculate success rate (approved/completed orders)
        const successfulOrders = orders.filter(order =>
          ['approved', 'completed', 'in_production', 'shipped', 'delivered'].includes(order.status?.toLowerCase())
        ).length;
        const successRate = totalOrders > 0 ? Math.round((successfulOrders / totalOrders) * 100) : 0;

        // Calculate settlement status
        let settlementStatus = 'Unpaid';
        if (totalCollected >= netReceivable && netReceivable > 0) {
          settlementStatus = 'Paid';
        } else if (totalCollected > 0) {
          settlementStatus = 'Partially Paid';
        }

        // Get latest order date
        const latestOrder = orders.length > 0
          ? orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
          : null;

        return {
          _id: salesPerson._id,
          username: salesPerson.username,
          fullName: salesPerson.fullName || salesPerson.username,
          email: salesPerson.email,
          totalOrders,
          totalRevenue: totalGrossSales, // Keeping for backward compatibility
          totalGrossSales,
          totalReturns,
          netReceivable,
          totalCollected,
          pendingAmount,
          settlementStatus,
          averageOrderValue,
          successRate,
          lastOrderDate: latestOrder?.createdAt || null,
          isActive: salesPerson.isActive,
          createdAt: salesPerson.createdAt
        };
      })
    );

    // Calculate summary
    const summary = {
      totalSalesPersons,
      activeSalesPersons: salesPersonsWithStats.filter(sp => sp.isActive).length,
      inactiveSalesPersons: salesPersonsWithStats.filter(sp => !sp.isActive).length,
      totalOrders: salesPersonsWithStats.reduce((sum, sp) => sum + sp.totalOrders, 0),
      totalGrossSales: salesPersonsWithStats.reduce((sum, sp) => sum + sp.totalGrossSales, 0),
      totalReturns: salesPersonsWithStats.reduce((sum, sp) => sum + sp.totalReturns, 0),
      totalRevenue: salesPersonsWithStats.reduce((sum, sp) => sum + sp.totalGrossSales, 0), // Gross
      netReceivable: salesPersonsWithStats.reduce((sum, sp) => sum + sp.netReceivable, 0),
      totalCollected: salesPersonsWithStats.reduce((sum, sp) => sum + sp.totalCollected, 0),
      averageOrderValue: salesPersonsWithStats.length > 0
        ? salesPersonsWithStats.reduce((sum, sp) => sum + sp.averageOrderValue, 0) / salesPersonsWithStats.length
        : 0
    };

    const totalPages = Math.ceil(totalSalesPersons / parseInt(limit));

    res.json({
      success: true,
      data: {
        salesPersons: salesPersonsWithStats,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          total: totalSalesPersons,
          pages: totalPages,
          hasMore: parseInt(page) < totalPages
        },
        summary
      }
    });

  } catch (error) {
    console.error('❌ Error in getAllSalesPersons:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales persons',
      error: error.message
    });
  }
};

/**
 * Get specific sales person details
 */
export const getSalesPersonById = async (req, res) => {
  try {
    const { salesPersonId } = req.params;
    const userCompanyId = req.user.companyId;

    console.log('👤 getSalesPersonById called:', { salesPersonId, companyId: userCompanyId });

    const salesPerson = await User.findById(salesPersonId)
      .select('_id username email fullName phone companyId role totalOrders totalRevenue averageOrderValue successRate lastOrderDate isActive createdAt')
      .lean();

    if (!salesPerson) {
      return res.status(404).json({
        success: false,
        message: 'Sales person not found'
      });
    }

    // Verify company access
    if (salesPerson.companyId?.toString() !== userCompanyId?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get all orders for this sales person
    const orders = await Order.find({
      salesPerson: salesPersonId,
      companyId: userCompanyId
    }).populate('customer', 'name email phone').sort({ createdAt: -1 });

    const orderIds = orders.map(o => o._id);

    // Get all returns for this sales person OR for customers assigned to this sales person
    const customersAssigned = await Customer.find({ salesContact: salesPersonId, companyId: userCompanyId });
    const assignedCustomerIds = customersAssigned.map(c => c._id);

    const returns = await Return.find({
      $or: [
        { salesPerson: salesPersonId },
        { customerId: { $in: assignedCustomerIds } }
      ],
      companyId: userCompanyId,
      status: 'approved'
    });

    // Get all sales (invoices) and their collections for these orders OR these customers
    const sales = await Sale.find({
      companyId: userCompanyId,
      $or: [
        { order: { $in: orderIds } },
        { customer: { $in: assignedCustomerIds } }
      ]
    });

    const totalOrders = orders.length;
    const totalGrossSales = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const totalReturns = returns.reduce((sum, ret) => sum + (ret.totalAmount || 0), 0);
    const netReceivable = totalGrossSales - totalReturns;

    // Summing paidAmount from Sale records
    const totalCollected = sales.reduce((sum, sale) => sum + (sale.paidAmount || 0), 0);
    const pendingAmount = netReceivable - totalCollected;

    const averageOrderValue = totalOrders > 0 ? totalGrossSales / totalOrders : 0;

    const successfulOrders = orders.filter(order =>
      ['approved', 'completed', 'in_production', 'shipped', 'delivered'].includes(order.status?.toLowerCase())
    ).length;
    const successRate = totalOrders > 0 ? Math.round((successfulOrders / totalOrders) * 100) : 0;

    // Calculate settlement status
    let settlementStatus = 'Unpaid';
    if (totalCollected >= netReceivable && netReceivable > 0) {
      settlementStatus = 'Paid';
    } else if (totalCollected > 0) {
      settlementStatus = 'Partially Paid';
    }

    // Group orders by status
    const ordersByStatus = {
      pending: orders.filter(o => o.status?.toLowerCase() === 'pending').length,
      approved: orders.filter(o => o.status?.toLowerCase() === 'approved').length,
      inProduction: orders.filter(o => o.status?.toLowerCase() === 'in_production').length,
      shipped: orders.filter(o => o.status?.toLowerCase() === 'shipped').length,
      delivered: orders.filter(o => o.status?.toLowerCase() === 'delivered').length,
      cancelled: orders.filter(o => o.status?.toLowerCase() === 'cancelled').length
    };

    const response = {
      ...salesPerson,
      totalOrders,
      totalRevenue: totalGrossSales,
      totalGrossSales,
      totalReturns,
      netReceivable,
      totalCollected,
      pendingAmount,
      settlementStatus,
      averageOrderValue,
      successRate,
      ordersByStatus,
      recentOrders: orders.slice(0, 10),
      recentReturns: returns.slice(0, 10)
    };

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('❌ Error in getSalesPersonById:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales person details',
      error: error.message
    });
  }
};

/**
 * Get all orders for a specific sales person
 */
export const getSalesPersonOrders = async (req, res) => {
  try {
    const { salesPersonId } = req.params;
    const { page = 1, limit = 10, status = 'All', search = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('📦 getSalesPersonOrders called:', {
      salesPersonId,
      companyId: userCompanyId,
      page,
      limit,
      status,
      search,
      sortBy,
      sortOrder
    });

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID not found'
      });
    }

    // Verify sales person exists and belongs to company
    const salesPerson = await User.findById(salesPersonId);
    if (!salesPerson) {
      return res.status(404).json({
        success: false,
        message: 'Sales person not found'
      });
    }

    if (salesPerson.companyId?.toString() !== userCompanyId?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Build query
    let orderQuery = {
      salesPerson: salesPersonId,
      $or: [
        { companyId: userCompanyId },
        { company: userCompanyId }
      ]
    };

    // Add status filter
    if (status && status !== 'All') {
      orderQuery.status = status;
    }

    // Add search filter
    if (search && search.trim()) {
      orderQuery.$or = [
        ...(orderQuery.$or || []),
        { orderCode: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } }
      ];
    }

    const totalOrders = await Order.countDocuments(orderQuery);

    // Build sort object
    let sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const orders = await Order.find(orderQuery)
      .populate('customer', 'name email phone')
      .populate('salesPerson', 'username email')
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Format orders for response
    const formattedOrders = orders.map(order => ({
      _id: order._id,
      orderCode: order.orderCode,
      customerName: order.customer?.name || 'Unknown',
      customerId: order.customer?._id,
      date: order.createdAt,
      amount: order.totalAmount || 0,
      discount: order.discountAmount || 0,
      gst: order.gst || 0,
      finalAmount: (order.totalAmount || 0) - (order.discountAmount || 0) + (order.gst || 0),
      status: order.status || 'Pending',
      paymentStatus: order.paymentStatus || 'Pending',
      itemsCount: order.itemsCount || order.products?.length || 0,
      notes: order.notes || ''
    }));

    // Calculate statistics
    const statistics = {
      totalOrders,
      totalAmount: formattedOrders.reduce((sum, order) => sum + order.amount, 0),
      totalDiscount: formattedOrders.reduce((sum, order) => sum + order.discount, 0),
      totalGst: formattedOrders.reduce((sum, order) => sum + order.gst, 0),
      totalFinal: formattedOrders.reduce((sum, order) => sum + order.finalAmount, 0),
      averageOrderValue: totalOrders > 0
        ? formattedOrders.reduce((sum, order) => sum + order.amount, 0) / totalOrders
        : 0,
      byStatus: {
        pending: formattedOrders.filter(o => o.status?.toLowerCase() === 'pending').length,
        approved: formattedOrders.filter(o => o.status?.toLowerCase() === 'approved').length,
        inProduction: formattedOrders.filter(o => o.status?.toLowerCase() === 'in_production').length,
        shipped: formattedOrders.filter(o => o.status?.toLowerCase() === 'shipped').length,
        delivered: formattedOrders.filter(o => o.status?.toLowerCase() === 'delivered').length,
        cancelled: formattedOrders.filter(o => o.status?.toLowerCase() === 'cancelled').length
      }
    };

    const totalPages = Math.ceil(totalOrders / parseInt(limit));

    res.json({
      success: true,
      data: {
        salesPerson: {
          _id: salesPerson._id,
          username: salesPerson.username,
          fullName: salesPerson.fullName,
          email: salesPerson.email
        },
        orders: formattedOrders,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          total: totalOrders,
          pages: totalPages,
          hasMore: parseInt(page) < totalPages
        },
        statistics,
        filters: {
          status,
          search
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in getSalesPersonOrders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales person orders',
      error: error.message
    });
  }
};

/**
 * Debug endpoint - check database for sales persons
 */
export const debugCheckSalesPersons = async (req, res) => {
  try {
    const userCompanyId = req.user.companyId;

    console.log('🔍 DEBUG: Checking sales persons for company:', userCompanyId);

    // Check all users with their roles
    const allUsersInCompany = await User.find({ companyId: userCompanyId })
      .select('username email role companyId isActive')
      .lean();

    console.log('📊 All users in company:', allUsersInCompany);

    // Check users with 'Sales' in role
    const salesUsers = await User.find({
      companyId: userCompanyId,
      role: { $regex: 'Sales', $options: 'i' }
    })
      .select('username email role companyId isActive')
      .lean();

    console.log('💼 Users with Sales role:', salesUsers);

    // Check for exact role matches
    const exactMatches = await User.find({
      companyId: userCompanyId,
      $or: [
        { role: 'Sales' },
        { role: 'Sales Person' },
        { role: 'Salesman' }
      ]
    })
      .select('username email role companyId isActive')
      .lean();

    console.log('🎯 Exact role matches:', exactMatches);

    res.json({
      success: true,
      data: {
        userCompanyId,
        allUsersInCompany,
        salesUsers,
        exactMatches,
        stats: {
          totalInCompany: allUsersInCompany.length,
          totalWithSalesRole: salesUsers.length,
          totalExactMatches: exactMatches.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in debugCheckSalesPersons:', error);
    res.status(500).json({
      success: false,
      message: 'Debug check failed',
      error: error.message
    });
  }
};

/**
 * Get all damage and expiry items for the company
 * Lists all returns with type 'damage' or 'expired' for the logged-in user's company
 */
export const getDamageExpiryList = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', sortBy = 'returnDate', sortOrder = 'desc', type = 'all' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('📦 getDamageExpiryList called:', {
      companyId: userCompanyId,
      page,
      limit,
      search,
      type
    });

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID not found. User not assigned to a company.'
      });
    }

    // Build query - filter by damage/expiry types
    // Handle both new records (with companyId) and legacy records (without companyId)
    let query = {
      $or: [
        { companyId: userCompanyId, type: type === 'all' ? { $in: ['damage', 'expired'] } : type },
        { companyId: { $exists: false }, type: type === 'all' ? { $in: ['damage', 'expired'] } : type }
      ]
    };

    // Simplify for now - just get all damage/expired items
    query = {
      type: type === 'all' ? { $in: ['damage', 'expired'] } : type
    };

    // Add search filter if provided (search in customer name or notes)
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$and = [
        { type: type === 'all' ? { $in: ['damage', 'expired'] } : type },
        {
          $or: [
            { customerName: searchRegex },
            { notes: searchRegex },
            { 'items.productName': searchRegex }
          ]
        }
      ];
    }

    console.log('🔍 Damage/Expiry Query:', JSON.stringify(query, null, 2));

    const Return = (await import('../models/Return.js')).default;

    // Get total count
    const totalCount = await Return.countDocuments(query);
    console.log(`📊 Total damage/expiry count: ${totalCount}`);

    // Build sort object
    let sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch damage/expiry items with pagination
    const damageExpiryItems = await Return.find(query)
      .populate('customerId', 'name email phone')
      .populate('salesPerson', 'username fullName email')
      .select('_id customerName returnDate reason items status type totalAmount totalQuantity notes createdBy createdAt')
      .sort(sortObj)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    console.log(`📊 Found ${damageExpiryItems.length} damage/expiry items on page ${page}`);

    // Calculate summary statistics
    const summary = {
      totalDamageExpiry: totalCount,
      totalQuantity: damageExpiryItems.reduce((sum, item) => sum + (item.totalQuantity || 0), 0),
      totalAmount: damageExpiryItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0),
      damageCount: damageExpiryItems.filter(item => item.type === 'damage').length,
      expiredCount: damageExpiryItems.filter(item => item.type === 'expired').length,
      pendingCount: damageExpiryItems.filter(item => item.status === 'pending').length,
      approvedCount: damageExpiryItems.filter(item => item.status === 'approved').length
    };

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        items: damageExpiryItems,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: totalPages,
          hasMore: parseInt(page) < totalPages
        },
        summary
      }
    });

  } catch (error) {
    console.error('❌ Error in getDamageExpiryList:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch damage/expiry items',
      error: error.message
    });
  }
};

/**
 * Get damage/expiry item details
 */
export const getDamageExpiryDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userCompanyId = req.user.companyId;

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID not found.'
      });
    }

    const Return = (await import('../models/Return.js')).default;

    // Look for damage/expiry item - handle both with and without companyId
    const damageExpiryItem = await Return.findOne({
      _id: id,
      type: { $in: ['damage', 'expired'] }
    })
      .populate('customerId')
      .populate('salesPerson', 'username fullName email')
      .populate('items.productId');

    if (!damageExpiryItem) {
      return res.status(404).json({
        success: false,
        message: 'Damage/Expiry item not found'
      });
    }

    res.json({
      success: true,
      data: damageExpiryItem
    });

  } catch (error) {
    console.error('❌ Error in getDamageExpiryDetail:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch damage/expiry item details',
      error: error.message
    });
  }
};

// ==================== SALES RETURNS (for Accounts role) ====================

/**
 * Get all sales returns (type: 'refund') for the company
 * Uses static Return import (already imported at top of file)
 */


export const getSalesReturnsList = async (req, res) => {
  try {
    // 🔎 DB Debug Logs
    console.log("🌐 Connected Host:", mongoose.connection.host);
    console.log("📂 Connected Database:", mongoose.connection.name);
    console.log("📁 Return Model Collection:", Return.collection.collectionName);

    const totalDocs = await Return.countDocuments({});
    console.log("📊 Total Documents in Return Collection:", totalDocs);

    const sample = await Return.find().limit(2).lean();
    console.log("📝 Sample Data:", sample);

    // 🔥 Simple Fetch (No Filter)
    const returns = await Return.find().populate('order', 'orderCode orderDate').sort({ createdAt: -1 });

    res.json({
      success: true,
      returns
    });

  } catch (error) {
    console.error("❌ Error in getSalesReturnsList:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all sales damages (type: 'damage') for the company
 * Uses static Return import (already imported at top of file)
 */
export const getSalesDamagesList = async (req, res) => {
  try {
    const { page = 1, limit = 100, search = '', status = '' } = req.query;
    const userCompanyId = req.user.companyId;

    console.log('⚠️ getSalesDamagesList called for company:', userCompanyId);

    // Filter by company and type (handle legacy data)
    const query = {
      type: 'damage',
      $or: [
        { companyId: userCompanyId },
        { companyId: { $exists: false } },
        { companyId: null }
      ]
    };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const damages = await Return.find(query)
      .populate('order', 'orderCode orderDate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Return.countDocuments(query);

    console.log(`✅ getSalesDamagesList: found ${damages.length} damages (total=${total})`);

    res.json({
      success: true,
      damages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error in getSalesDamagesList:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sales damages', error: error.message });
  }
};

// DEBUG: Check what's in the Return collection
export const debugReturnCollection = async (req, res) => {
  try {
    const mongoose = (await import('mongoose')).default;
    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    // Count all Return documents (no filter)
    const allCount = await Return.countDocuments({});
    const refundCount = await Return.countDocuments({ type: 'refund' });
    const damageCount = await Return.countDocuments({ type: 'damage' });
    const sample = await Return.find({}).limit(2).lean();

    res.json({
      success: true,
      collections: collectionNames,
      returnModelCollection: Return.collection.collectionName,
      counts: { all: allCount, refund: refundCount, damage: damageCount },
      sample
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DEBUG: Check user info and returns by company
export const debugUserAndReturns = async (req, res) => {
  try {
    const userCompanyId = req.user?.companyId;
    const userCompanyIdString = userCompanyId?.toString();

    console.log('🔍 DEBUG: Detailed Info:', {
      companyId: userCompanyId,
      companyIdString: userCompanyIdString,
      companyIdType: userCompanyId?.constructor?.name
    });

    if (!userCompanyId) {
      return res.json({
        success: false,
        message: 'No company ID found in req.user',
        userInfo: req.user
      });
    }

    // Check all returns in database - show first one completely
    const allReturns = await Return.find({}).limit(1).lean();
    const firstReturn = allReturns[0];

    console.log('🔍 First return in DB:', {
      _id: firstReturn?._id,
      companyId: firstReturn?.companyId,
      companyIdType: firstReturn?.companyId?.constructor?.name,
      type: firstReturn?.type
    });

    // Try multiple query methods
    const query1 = await Return.find({ companyId: userCompanyId }).lean();
    const query2 = await Return.find({ companyId: userCompanyIdString }).lean();
    const query3 = await Return.find({ type: 'refund' }).lean();
    const query4 = await Return.find({ type: 'damage' }).lean();

    res.json({
      success: true,
      userInfo: {
        companyId: userCompanyId,
        companyIdString: userCompanyIdString
      },
      databaseInfo: {
        firstReturnCompanyId: firstReturn?.companyId,
        firstReturnCompanyIdString: firstReturn?.companyId?.toString(),
        firstReturnType: firstReturn?.companyId?.constructor?.name
      },
      queryResults: {
        'Query with ObjectId': query1.length,
        'Query with String': query2.length,
        'All refunds (no filter)': query3.length,
        'All damages (no filter)': query4.length
      },
      sample: {
        firstReturn: firstReturn ? {
          _id: firstReturn._id,
          customerName: firstReturn.customerName,
          type: firstReturn.type,
          companyId: firstReturn.companyId
        } : null
      }
    });
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DEBUG: Simple - Just show ALL returns
export const debugShowAllReturns = async (req, res) => {
  try {
    const allReturns = await Return.find({}).lean();

    res.json({
      success: true,
      totalReturnsInDB: allReturns.length,
      returns: allReturns.map(r => ({
        _id: r._id,
        customerName: r.customerName,
        type: r.type,
        companyId: r.companyId,
        status: r.status,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// ==================== BANK & CASH MANAGEMENT FUNCTIONS ====================

export const getAccounts = async (req, res) => {
  try {
    const { page = 1, limit = 10, accountType, unit, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    if (accountType) {
      query.accountType = accountType;
    }

    if (search) {
      query.$or = [
        { accountName: { $regex: search, $options: 'i' } },
        { accountNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const accounts = await Account.find(query)
      .populate('parentAccount', 'accountName')
      .sort({ accountNumber: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Account.countDocuments(query);

    res.json({
      success: true,
      accounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get accounts error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAccountById = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await Account.findById(id).populate('parentAccount', 'accountName');

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && account.unit !== req.user.unit) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, account });
  } catch (error) {
    console.error('Get account by ID error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createAccount = async (req, res) => {
  try {
    const { accountName, accountType, parentAccount, description, balance, type, bankDetails, isBankOrCash } = req.body;

    if (!accountName || !accountType) {
      return res.status(400).json({ success: false, message: 'Account name and type are required' });
    }

    // Generate account number
    const accountNumber = `ACC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const accountData = {
      accountNumber,
      accountName,
      accountType: accountType === 'Bank/Cash' ? 'Asset' : accountType,
      type,
      balance: balance || 0,
      isBankOrCash: isBankOrCash || false,
      bankDetails,
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      companyId: req.user.companyId,
      parentAccount,
      description
    };

    const account = new Account(accountData);
    await account.save();
    await account.populate('parentAccount', 'accountName');

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      account
    });
  } catch (error) {
    console.error('Create account error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountName, accountType, parentAccount, description, isActive, balance, isBankOrCash, bankDetails } = req.body;

    const account = await Account.findById(id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && account.unit !== req.user.unit) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const updateData = {};
    if (accountName) updateData.accountName = accountName;
    if (accountType) updateData.accountType = accountType === 'Bank/Cash' ? 'Asset' : accountType;
    if (parentAccount) updateData.parentAccount = parentAccount;
    if (description !== undefined) updateData.description = description;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (balance !== undefined) updateData.balance = balance;
    if (typeof isBankOrCash === 'boolean') updateData.isBankOrCash = isBankOrCash;
    if (bankDetails) updateData.bankDetails = bankDetails;

    const updatedAccount = await Account.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('parentAccount', 'accountName');

    res.json({
      success: true,
      message: 'Account updated successfully',
      account: updatedAccount
    });
  } catch (error) {
    console.error('Update account error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await Account.findById(id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && account.unit !== req.user.unit) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Check if account has transactions
    const hasTransactions = await Transaction.findOne({
      'entries.account': id
    });

    if (hasTransactions) {
      return res.status(400).json({ success: false, message: 'Cannot delete account with existing transactions' });
    }

    await Account.findByIdAndDelete(id);

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createTransaction = async (req, res) => {
  try {
    const { description, reference, entries, relatedDocument, relatedDocumentId, mode } = req.body;

    if (!description || !entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: 'Description and entries are required' });
    }

    // Validate entries and calculate total
    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      if (!entry.account || (entry.debit === 0 && entry.credit === 0)) {
        return res.status(400).json({ success: false, message: 'Invalid entry data' });
      }
      totalDebit += entry.debit || 0;
      totalCredit += entry.credit || 0;
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ success: false, message: 'Debits and credits must balance' });
    }

    const transactionData = {
      transactionNumber: `TXN-GEN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      description,
      reference,
      entries,
      totalAmount: totalDebit,
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      relatedDocument,
      relatedDocumentId,
      mode,
      createdBy: req.user._id
    };

    const transaction = await Transaction.create(transactionData);
    await transaction.populate([
      { path: 'entries.account', select: 'accountName accountNumber' },
      { path: 'createdBy', select: 'fullName' }
    ]);

    // Update account balances
    for (const entry of entries) {
      const account = await Account.findById(entry.account);
      if (account) {
        if (['Asset', 'Expense'].includes(account.accountType)) {
          account.balance += (entry.debit || 0) - (entry.credit || 0);
        } else {
          account.balance += (entry.credit || 0) - (entry.debit || 0);
        }
        await account.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      transaction
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const approveTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && transaction.unit !== req.user.unit) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (transaction.isApproved) {
      return res.status(400).json({ success: false, message: 'Transaction already approved' });
    }

    transaction.isApproved = true;
    transaction.approvedBy = req.user._id;
    await transaction.save();

    await transaction.populate([
      { path: 'entries.account', select: 'accountName accountNumber' },
      { path: 'createdBy', select: 'fullName' },
      { path: 'approvedBy', select: 'fullName' }
    ]);

    res.json({
      success: true,
      message: 'Transaction approved successfully',
      transaction
    });
  } catch (error) {
    console.error('Approve transaction error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createGeneralTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { type, accountId, amount, mode, reference, description } = req.body;
    const unit = req.user.unit;
    const companyId = req.user.companyId;

    const bankAccount = await Account.findById(accountId).session(session);
    if (!bankAccount) throw new Error('Bank/Cash account not found');

    // Negative Balance Check for Payments
    if (type === 'Payment' && bankAccount.balance < amount) {
      throw new Error(`Insufficient funds in ${bankAccount.accountName}. Available: ₹${bankAccount.balance}`);
    }

    const miscAccountName = type === 'Receipt' ? 'Miscellaneous Income' : 'General Expenses';
    let miscAccount = await Account.findOne({ accountName: miscAccountName, unit }).session(session);

    if (!miscAccount) {
      miscAccount = new Account({
        accountNumber: `MISC-${unit.replace(/\s+/g, '-')}-${Date.now()}`,
        accountName: miscAccountName,
        accountType: type === 'Receipt' ? 'Revenue' : 'Expense',
        balance: 0,
        unit,
        companyId
      });
      await miscAccount.save({ session });
    }

    const entries = type === 'Receipt'
      ? [{ account: bankAccount._id, debit: amount, credit: 0 }, { account: miscAccount._id, debit: 0, credit: amount }]
      : [{ account: miscAccount._id, debit: amount, credit: 0 }, { account: bankAccount._id, debit: 0, credit: amount }];

    const txn = new Transaction({
      transactionNumber: `TXN-BNK-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      description: description || `${type} recorded via Bank & Cash`,
      reference: reference,
      totalAmount: amount,
      unit,
      mode,
      createdBy: req.user._id,
      entries
    });
    await txn.save({ session });

    if (type === 'Receipt') {
      bankAccount.balance += amount;
      miscAccount.balance += amount;
    } else {
      bankAccount.balance -= amount;
      miscAccount.balance += amount;
    }

    await bankAccount.save({ session });
    await miscAccount.save({ session });

    await session.commitTransaction();
    res.json({ success: true, message: 'Transaction posted successfully' });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, accountId, type, startDate, endDate } = req.query;
    const query = { unit: req.user.unit };

    if (accountId) query['entries.account'] = accountId;
    if (type) query.relatedDocument = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('entries.account', 'accountName accountType balance');

    const total = await Transaction.countDocuments(query);

    res.json({
      success: true,
      transactions,
      pagination: { total, page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getBankCashSummary = async (req, res) => {
  try {
    const unit = req.user.unit;
    const accounts = await Account.find({
      unit,
      isBankOrCash: true,
      isActive: true
    });

    const summary = {
      totalBalance: accounts.reduce((sum, acc) => sum + acc.balance, 0),
      bankBalance: accounts.filter(acc => acc.accountName.toLowerCase().includes('bank') || acc.bankDetails?.bankName).reduce((sum, acc) => sum + acc.balance, 0),
      cashBalance: accounts.filter(acc => acc.accountName.toLowerCase().includes('cash')).reduce((sum, acc) => sum + acc.balance, 0),
      accounts: accounts.map(acc => ({
        id: acc._id,
        name: acc.accountName,
        type: acc.accountName.toLowerCase().includes('cash') ? 'Cash' : 'Bank',
        balance: acc.balance,
        bankDetails: acc.bankDetails
      }))
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Get Bank/Cash summary error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const reconcileTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { isReconciled, reconciliationDate, clearedAmount } = req.body;

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    transaction.isReconciled = isReconciled;
    transaction.reconciliationDate = reconciliationDate || new Date();
    transaction.clearedAmount = clearedAmount !== undefined ? clearedAmount : transaction.totalAmount;

    await transaction.save();

    res.json({ success: true, message: 'Transaction reconciliation status updated', transaction });
  } catch (error) {
    console.error('Reconcile transaction error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== LEDGER RECORDS ====================

export const getLedgerRecords = async (req, res) => {
  try {
    const { accountId, startDate, endDate, page = 1, limit = 15 } = req.query;
    const unit = req.user.unit;

    if (!accountId) {
      return res.status(400).json({ success: false, message: 'Account ID is required' });
    }

    const account = await Account.findById(accountId);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Base query for transactions involving this account
    let query = {
      'entries.account': accountId,
      unit
    };

    // Date filters
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start || end) {
      query.date = {};
      if (start) {
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (end) {
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // 1. Calculate Opening Balance before startDate
    let openingBalance = 0;
    if (start) {
      const prevTransactions = await Transaction.find({
        'entries.account': accountId,
        unit,
        date: { $lt: start }
      });

      prevTransactions.forEach(txn => {
        const entry = txn.entries.find(e =>
          e.account.toString() === accountId ||
          (e.account._id && e.account._id.toString() === accountId)
        );
        if (entry) {
          const effect = (entry.debit || 0) - (entry.credit || 0);
          openingBalance += (['Asset', 'Expense'].includes(account.accountType)) ? effect : -effect;
        }
      });
    }

    // 2. Calculate Total Effect of transactions in the range to determine range-end balance
    const allInRangeTransactions = await Transaction.find(query);
    let totalRangeEffect = 0;
    allInRangeTransactions.forEach(txn => {
      const entry = txn.entries.find(e =>
        e.account.toString() === accountId ||
        (e.account._id && e.account._id.toString() === accountId)
      );
      if (entry) {
        const effect = (entry.debit || 0) - (entry.credit || 0);
        totalRangeEffect += (['Asset', 'Expense'].includes(account.accountType)) ? effect : -effect;
      }
    });

    const rangeClosingBalance = openingBalance + totalRangeEffect;

    // 3. Fetch transactions for the current page in DESCENDING order
    const totalTransactions = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('entries.account', 'accountName');

    // 4. Calculate starting balance for this page
    // Sum of transactions that are NEWER than the current page
    let newerTransactionsEffect = 0;
    if (parseInt(page) > 1) {
      const skipCount = (parseInt(page) - 1) * parseInt(limit);
      const newerTransactions = await Transaction.find(query)
        .sort({ date: -1, createdAt: -1 })
        .limit(skipCount);

      newerTransactions.forEach(txn => {
        const entry = txn.entries.find(e =>
          e.account.toString() === accountId ||
          (e.account._id && e.account._id.toString() === accountId)
        );
        if (entry) {
          const effect = (entry.debit || 0) - (entry.credit || 0);
          newerTransactionsEffect += (['Asset', 'Expense'].includes(account.accountType)) ? effect : -effect;
        }
      });
    }

    let currentRunningBalanceForMapping = rangeClosingBalance - newerTransactionsEffect;

    // First pass: Calculate running balances sequentially
    const recordsWithBalances = transactions.map(txn => {
      const myEntry = txn.entries.find(e =>
        e.account.toString() === accountId ||
        (e.account._id && e.account._id.toString() === accountId)
      );

      const rowBalance = currentRunningBalanceForMapping;
      const effect = (myEntry.debit || 0) - (myEntry.credit || 0);
      currentRunningBalanceForMapping -= (['Asset', 'Expense'].includes(account.accountType)) ? effect : -effect;

      return { txn, rowBalance, myEntry };
    });

    // Second pass: Resolve entity names in parallel
    const records = await Promise.all(recordsWithBalances.map(async ({ txn, rowBalance, myEntry }) => {
      // Find contra accounts
      const otherEntries = txn.entries.filter(e =>
        (e.account.toString() !== accountId) &&
        (!e.account._id || e.account._id.toString() !== accountId)
      );

      let contraLedgerLabel = otherEntries.length > 0
        ? otherEntries.map(e => e.account.accountName).join(', ')
        : txn.description;

      let entityName = '';
      let entityType = '';

      try {
        if (txn.relatedDocumentId || txn.description.includes('Salesman Settlement')) {
          // 1. Try to find by settlement ID (if exists)
          let sds = null;
          if (txn.relatedDocumentId) {
            try {
              sds = await SalesmanDailySettlement.findById(txn.relatedDocumentId).populate('salesmanId', 'fullName name username');
            } catch (sdsErr) {
              console.error('Error finding SDS:', sdsErr);
            }
          }

          // 2. Fallback: Extract salesman ID from description if sds is null
          let salesmanIdFromDesc = null;
          if (!sds || !sds.salesmanId) {
            const idMatch = txn.description.match(/([a-f\d]{24})/i);
            if (idMatch) {
              salesmanIdFromDesc = idMatch[1];
            }
          }

          if (sds && sds.salesmanId) {
            entityType = 'Salesman';
            entityName = sds.salesmanId.fullName || sds.salesmanId.name || sds.salesmanId.username || 'Unknown Salesman';
          } else if (salesmanIdFromDesc || txn.description.includes('Salesman Settlement')) {
            // Even if sds is null, if the description says it's a salesman settlement, we try to find the salesman
            entityType = 'Salesman';
            if (salesmanIdFromDesc) {
              const user = await User.findById(salesmanIdFromDesc).select('fullName name username');
              if (user) {
                entityName = user.fullName || user.name || user.username || 'Unknown Salesman';
              }
            }
          }

          // If found salesman, skip further checks. If not, follow other types.
          if (entityType === 'Salesman') {
            // continue
          } else if (txn.relatedDocument === 'Receipt') {
            // Check if this is a Lead Payment transaction
            if (txn.transactionNumber && txn.transactionNumber.startsWith('TXN-LDP-')) {
              const lp = await LeadPayment.findById(txn.relatedDocumentId).select('companyName contactPerson');
              if (lp) {
                entityType = 'Customer';
                entityName = lp.companyName || lp.contactPerson || '';
              }
            } else {
              entityType = 'Customer';
              const cp = await CustomerPayment.findById(txn.relatedDocumentId).populate('customer', 'name');
              if (cp && cp.customer) entityName = cp.customer.name;
            }
          } else if (txn.relatedDocument === 'Payment') {
            entityType = 'Vendor';
            const vp = await VendorPayment.findById(txn.relatedDocumentId).populate('vendor', 'supplierName name');
            if (vp && vp.vendor) {
              entityName = vp.vendor.supplierName || vp.vendor.name || 'Unknown Vendor';
            }
          } else if (txn.relatedDocument === 'Sale') {
            entityType = 'Customer';
            const sl = await Sale.findById(txn.relatedDocumentId).populate('customer', 'name');
            if (sl && sl.customer) entityName = sl.customer.name;
          }
        }
      } catch (err) {
        console.error('Error resolving entity name:', err);
      }

      // Main Ledger column shows category label as per user request
      if (entityType) {
        contraLedgerLabel = entityType;
      }

      // Clean up description
      let displayDescription = txn.description;
      if (displayDescription) {
        displayDescription = displayDescription.replace(/Customer Receipt - Ref: /i, '');
        displayDescription = displayDescription.replace(/Salesman Settlement \(.*?\): /i, 'Salesman: ');
      }

      return {
        _id: txn._id,
        date: txn.date,
        transactionNumber: txn.transactionNumber,
        voucherNo: txn.reference || txn.transactionNumber,
        ledger: contraLedgerLabel,
        description: displayDescription,
        debit: myEntry.debit,
        credit: myEntry.credit,
        balance: rowBalance,
        relatedDocument: txn.relatedDocument,
        relatedDocumentId: txn.relatedDocumentId,
        paymentMode: txn.mode,
        entityName, // For detailed receipt
        entityType
      };
    }));

    res.json({
      success: true,
      account: {
        id: account._id,
        name: account.accountName,
        type: account.accountType,
        accountNumber: account.accountNumber
      },
      openingBalance,
      records,
      pagination: {
        total: totalTransactions,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalTransactions / limit)
      }
    });

  } catch (error) {
    console.error('Get Ledger Records error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};
