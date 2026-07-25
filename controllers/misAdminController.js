import Order from '../models/Order.js';
import Sale from '../models/Sale.js';
import Lead from '../models/Lead.js';
import { Item } from '../models/Inventory.js';
import User from '../models/User.js';
import ComplaintService from '../models/ComplaintServiceModel.js';
import mongoose from 'mongoose';

// Helper: get companyId filter for MIS Admin
const getCompanyFilter = (user) => {
  if (user.role === 'Super Admin' || user.role === 'Superadmin') return {};
  if (user.companyId) return { companyId: new mongoose.Types.ObjectId(user.companyId) };
  return {};
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/dashboard
// ────────────────────────────────────────────────────────────
export const getMISDashboard = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    // Pakka (formal/GST) invoices only — Kachha bills and Store's
    // auto-created isPlaceholder sales aren't real invoices, so every
    // Sale-derived KPI/chart below must exclude them. Same convention as
    // financeController.js / taxController.js / getSalespersonInvoices.
    const salesFilter = { ...companyFilter, invoiceType: 'Pakka', isPlaceholder: { $ne: true } };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // ── Sales KPIs ──
    const [totalRevenue, revenueThisMonth, pendingPayments] = await Promise.all([
      Sale.aggregate([
        { $match: { ...salesFilter } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, paid: { $sum: '$paidAmount' } } }
      ]),
      Sale.aggregate([
        { $match: { ...salesFilter, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Sale.aggregate([
        { $match: { ...salesFilter, paymentStatus: { $in: ['Pending', 'Overdue', 'Partially Paid'] } } },
        { $group: { _id: null, total: { $sum: '$balanceAmount' } } }
      ])
    ]);

    // ── Order KPIs ──
    const [totalOrders, ordersThisMonth, pendingOrders] = await Promise.all([
      Order.countDocuments(companyFilter),
      Order.countDocuments({ ...companyFilter, createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ ...companyFilter, status: { $in: ['Pending', 'Processing'] } })
    ]);

    // ── Lead KPIs ──
    const [totalLeads, convertedLeads] = await Promise.all([
      Lead.countDocuments(companyFilter),
      Lead.countDocuments({ ...companyFilter, status: 'Converted' })
    ]);
    const leadConversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

    // ── Complaint KPIs ──
    const [totalComplaints, openComplaints, resolvedComplaints] = await Promise.all([
      ComplaintService.countDocuments(companyFilter),
      ComplaintService.countDocuments({ ...companyFilter, status: { $in: ['Unassigned', 'Pending', 'In Progress', 'Reopened'] } }),
      ComplaintService.countDocuments({ ...companyFilter, status: { $in: ['Resolved', 'Closed'] } })
    ]);

    // ── Monthly Revenue Trend (last 6 months) ──
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthlyRevenue = await Sale.aggregate([
      { $match: { ...salesFilter, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // ── Lead Status Breakdown ──
    const leadStatusBreakdown = await Lead.aggregate([
      { $match: companyFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // ── Payment Status Breakdown ──
    const paymentBreakdown = await Sale.aggregate([
      { $match: salesFilter },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }
    ]);

    res.json({
      success: true,
      data: {
        kpis: {
          totalRevenue: totalRevenue[0]?.total || 0,
          revenueThisMonth: revenueThisMonth[0]?.total || 0,
          pendingPayments: pendingPayments[0]?.total || 0,
          totalOrders,
          ordersThisMonth,
          pendingOrders,
          totalLeads,
          convertedLeads,
          leadConversionRate,
          totalComplaints,
          openComplaints,
          resolvedComplaints
        },
        monthlyRevenue,
        leadStatusBreakdown,
        paymentBreakdown
      }
    });
  } catch (error) {
    console.error('MIS Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/sales-report
// ────────────────────────────────────────────────────────────
export const getSalesReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const { from, to } = req.query;

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

    const matchFilter = { ...companyFilter, ...dateMatch };
    // Pakka (formal/GST) invoices only for every Sale-derived aggregate
    // below — returnsCount keeps using matchFilter as-is since it queries
    // Order, which has no invoiceType field.
    const salesMatchFilter = { ...matchFilter, invoiceType: 'Pakka', isPlaceholder: { $ne: true } };

    const [
      salesSummary,
      monthlyTrend,
      paymentStatusBreakdown,
      topCustomers,
      salesByProduct,
      returnsCount,
      overdueInvoices
    ] = await Promise.all([
      // Overall summary
      Sale.aggregate([
        { $match: salesMatchFilter },
        {
          $group: {
            _id: null,
            totalInvoices: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            totalPaid: { $sum: '$paidAmount' },
            totalAdvance: { $sum: '$advancedPaymentAmount' },
            totalBalance: { $sum: '$balanceAmount' }
          }
        }
      ]),

      // Monthly revenue trend
      Sale.aggregate([
        { $match: salesMatchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$totalAmount' },
            paid: { $sum: '$paidAmount' },
            invoiceCount: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      // Payment status
      Sale.aggregate([
        { $match: salesMatchFilter },
        { $group: { _id: '$paymentStatus', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }
      ]),

      // Top customers by revenue
      Sale.aggregate([
        { $match: salesMatchFilter },
        { $group: { _id: '$customer', totalAmount: { $sum: '$totalAmount' }, invoices: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'customers',
            localField: '_id',
            foreignField: '_id',
            as: 'customerInfo'
          }
        },
        { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            customerName: { $ifNull: ['$customerInfo.name', 'Unknown'] },
            totalAmount: 1,
            invoices: 1
          }
        }
      ]),

      // Sales by product
      Sale.aggregate([
        { $match: salesMatchFilter },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productName',
            totalQty: { $sum: '$items.quantity' },
            totalRevenue: { $sum: '$items.totalPrice' },
            count: { $sum: 1 }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 }
      ]),

      // Returns count (orders with status returned)
      Order.countDocuments({ ...matchFilter, status: 'Returned' }),

      // Overdue invoices
      Sale.aggregate([
        { $match: { ...companyFilter, invoiceType: 'Pakka', isPlaceholder: { $ne: true }, paymentStatus: 'Overdue' } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$balanceAmount' } } }
      ])
    ]);

    // Lead conversion from leads
    const leadStats = await Lead.aggregate([
      { $match: companyFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        summary: salesSummary[0] || { totalInvoices: 0, totalAmount: 0, totalPaid: 0, totalBalance: 0 },
        monthlyTrend,
        paymentStatusBreakdown,
        topCustomers,
        salesByProduct,
        returnsCount,
        overdueInvoices: {
          count: overdueInvoices[0]?.count || 0,
          total: overdueInvoices[0]?.total || 0
        },
        leadStats
      }
    });
  } catch (error) {
    console.error('MIS Sales Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/finance-report
// ────────────────────────────────────────────────────────────
export const getFinanceReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    const [revenueByMonth, paymentMethodBreakdown, invoiceTypeSplit, ageingReport, gstSummary] = await Promise.all([
      // Revenue by month
      Sale.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            totalAmount: { $sum: '$totalAmount' },
            paidAmount: { $sum: '$paidAmount' },
            balance: { $sum: '$balanceAmount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      // Payment method breakdown
      Sale.aggregate([
        { $match: { ...matchFilter, paymentMethod: { $exists: true, $ne: null } } },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$paidAmount' } } }
      ]),

      // Invoice type (Pakka/Kachha)
      Sale.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$invoiceType', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }
      ]),

      // Ageing report: 0-30, 31-60, 61-90, 90+ days overdue
      Sale.aggregate([
        {
          $match: {
            ...companyFilter,
            paymentStatus: { $in: ['Pending', 'Overdue', 'Partially Paid'] }
          }
        },
        {
          $addFields: {
            daysPending: {
              $divide: [
                { $subtract: [new Date(), '$dueDate'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        },
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $lte: ['$daysPending', 30] }, then: '0-30 days' },
                  { case: { $lte: ['$daysPending', 60] }, then: '31-60 days' },
                  { case: { $lte: ['$daysPending', 90] }, then: '61-90 days' }
                ],
                default: '90+ days'
              }
            },
            count: { $sum: 1 },
            amount: { $sum: '$balanceAmount' }
          }
        }
      ]),

      // GST summary
      Sale.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$gstType',
            totalTax: { $sum: '$taxAmount' },
            totalTds: { $sum: '$tdsAmount' },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const overall = await Sale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalCollected: { $sum: '$paidAmount' },
          totalPending: { $sum: '$balanceAmount' },
          totalTax: { $sum: '$taxAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overall: overall[0] || { totalRevenue: 0, totalCollected: 0, totalPending: 0, totalTax: 0 },
        revenueByMonth,
        paymentMethodBreakdown,
        invoiceTypeSplit,
        ageingReport,
        gstSummary
      }
    });
  } catch (error) {
    console.error('MIS Finance Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/production-report
// ────────────────────────────────────────────────────────────
export const getProductionReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    // Order schema statuses (lowercase): pending, pending_service_approval,
    // rejected_by_service, approved, rejected, in_production, completed, cancelled
    const COMPLETED_STATUSES  = ['completed'];
    const ACTIVE_STATUSES     = ['pending', 'approved', 'in_production', 'pending_service_approval'];
    const CANCELLED_STATUSES  = ['cancelled', 'rejected', 'rejected_by_service'];

    const [orderSummary, ordersByStatus, orderTrend, recentOrders] = await Promise.all([
      // Order summary
      Order.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, 1, 0] } },
            pending:   { $sum: { $cond: [{ $in: ['$status', ACTIVE_STATUSES] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $in: ['$status', CANCELLED_STATUSES] }, 1, 0] } }
          }
        }
      ]).option({ maxTimeMS: 15000 }),

      // Orders by status
      Order.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).option({ maxTimeMS: 15000 }),

      // Monthly order trend
      Order.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]).option({ maxTimeMS: 15000 }),

      // Recent orders — lean + no deep populate to avoid hanging
      Order.find(companyFilter)
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('customer', 'name')
        .maxTimeMS(15000)
        .lean()
    ]);

    res.json({
      success: true,
      data: {
        summary: orderSummary[0] || { total: 0, completed: 0, pending: 0, cancelled: 0 },
        ordersByStatus,
        orderTrend,
        recentOrders
      }
    });
  } catch (error) {
    console.error('MIS Production Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/inventory-report
// ────────────────────────────────────────────────────────────
export const getInventoryReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);

    const [
      totalItems,
      categoryBreakdown,
      lowStockItems,
      highValueItems,
      criticalItems
    ] = await Promise.all([
      Item.countDocuments(companyFilter),

      Item.aggregate([
        { $match: companyFilter },
        { $group: { _id: '$category', count: { $sum: 1 }, totalQty: { $sum: '$qty' }, totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } } } }
      ]),

      Item.find({ ...companyFilter, $expr: { $lte: ['$qty', '$minStock'] } })
        .select('name code qty minStock category importance')
        .sort({ qty: 1 })
        .limit(20)
        .lean(),

      Item.find({ ...companyFilter, stdCost: { $gt: 0 } })
        .sort({ stdCost: -1 })
        .limit(10)
        .select('name code qty stdCost category')
        .lean(),

      Item.find({ ...companyFilter, importance: 'Critical' })
        .select('name code qty minStock importance')
        .lean()
    ]);

    const totalValue = await Item.aggregate([
      { $match: { ...companyFilter, qty: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: { $multiply: ['$qty', '$stdCost'] } } } }
    ]);

    const typeBreakdown = await Item.aggregate([
      { $match: companyFilter },
      { $group: { _id: '$type', count: { $sum: 1 }, totalQty: { $sum: '$qty' } } }
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          totalValue: totalValue[0]?.total || 0,
          lowStockCount: lowStockItems.length,
          criticalCount: criticalItems.length
        },
        categoryBreakdown,
        typeBreakdown,
        lowStockItems,
        highValueItems,
        criticalItems
      }
    });
  } catch (error) {
    console.error('MIS Inventory Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/complaint-report
// ────────────────────────────────────────────────────────────
export const getComplaintReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    const [statusBreakdown, monthlyTrend, typeBreakdown, recentComplaints] = await Promise.all([
      ComplaintService.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),

      ComplaintService.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      ComplaintService.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$issue.issueType', count: { $sum: 1 } } }
      ]),

      ComplaintService.find(companyFilter)
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    ]);

    const overall = await ComplaintService.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$status', ['Unassigned', 'Pending', 'In Progress', 'Reopened']] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        summary: overall[0] || { total: 0, open: 0, resolved: 0, closed: 0 },
        statusBreakdown,
        monthlyTrend,
        typeBreakdown,
        recentComplaints
      }
    });
  } catch (error) {
    console.error('MIS Complaint Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/hrms-report
// ────────────────────────────────────────────────────────────
export const getHRMSReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const companyIdStr = req.user.companyId ? req.user.companyId.toString() : null;

    // We filter by companyId in the User model
    const userFilter = companyIdStr
      ? { companyId: new mongoose.Types.ObjectId(companyIdStr), isActive: true }
      : { isActive: true };

    const [
      totalEmployees,
      roleBreakdown,
      genderBreakdown,
      recentJoiners
    ] = await Promise.all([
      User.countDocuments({ ...userFilter, role: { $nin: ['Super Admin', 'Superadmin', 'MIS Admin'] } }),

      User.aggregate([
        { $match: { ...userFilter, role: { $nin: ['Super Admin', 'Superadmin', 'MIS Admin'] } } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),

      User.aggregate([
        { $match: { ...userFilter, gender: { $exists: true, $ne: null } } },
        { $group: { _id: '$gender', count: { $sum: 1 } } }
      ]),

      User.find(userFilter)
        .sort({ createdAt: -1 })
        .limit(10)
        .select('fullName role email createdAt')
        .lean()
    ]);

    res.json({
      success: true,
      data: {
        summary: { totalEmployees },
        roleBreakdown,
        genderBreakdown,
        recentJoiners
      }
    });
  } catch (error) {
    console.error('MIS HRMS Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/mis/quality-report
// ────────────────────────────────────────────────────────────
export const getQualityReport = async (req, res) => {
  try {
    const companyFilter = getCompanyFilter(req.user);
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    // Use Order model as proxy for quality stats via order status
    // Order statuses (lowercase): pending, approved, in_production, completed, cancelled, rejected
    const [orderStatusBreakdown, qualityTrend, returnsData] = await Promise.all([
      Order.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).option({ maxTimeMS: 15000 }),

      Order.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            total: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            returned:  { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]).option({ maxTimeMS: 15000 }),

      Order.aggregate([
        { $match: { ...companyFilter, status: 'cancelled' } },
        { $group: { _id: null, count: { $sum: 1 } } }
      ]).option({ maxTimeMS: 15000 })
    ]);

    const totalOrders = await Order.countDocuments(companyFilter);
    const deliveredOrders = await Order.countDocuments({ ...companyFilter, status: 'completed' });
    const returnedOrders = returnsData[0]?.count || 0;
    const fulfillmentRate = totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(1) : 0;
    const returnRate = totalOrders > 0 ? ((returnedOrders / totalOrders) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalOrders,
          deliveredOrders,
          returnedOrders,
          fulfillmentRate,
          returnRate
        },
        orderStatusBreakdown,
        qualityTrend
      }
    });
  } catch (error) {
    console.error('MIS Quality Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
