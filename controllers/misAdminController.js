import Order from '../models/Order.js';
import ProductionOrder from '../models/ProductionOrder.js';
import QCJob from '../models/QCJob.js';
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

// ProductionOrder's own company field is literally named `company`, not
// `companyId` like every other model getCompanyFilter above targets — a
// separate helper, since reusing getCompanyFilter here would silently
// match zero documents instead of erroring.
const getProductionCompanyFilter = (user) => {
  if (user.role === 'Super Admin' || user.role === 'Superadmin') return {};
  if (user.companyId) return { company: new mongoose.Types.ObjectId(user.companyId) };
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
    const { from, to, productCode } = req.query;

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

    // ── Product Sales lookup by code (2026-09-29) ──────────────────────────
    // MIS previously had no way to see one specific product's sales — only
    // the top-10 "Top Products by Revenue" table. Product Master / Motor
    // Master items only, searched by code (partial, case-insensitive), per
    // the request. Computed from each matching SALE ITEM's own qty/
    // totalPrice, never the invoice's totalAmount — an invoice can carry
    // other products too, and there's no per-item payment split to
    // attribute paid/balance to a single line, so those numbers deliberately
    // stay out of this block rather than being approximated.
    let productSales = null;
    if (productCode && productCode.trim()) {
      const safeCode = productCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchedItems = await Item.find({
        ...companyFilter,
        code: { $regex: safeCode, $options: 'i' },
        productKind: { $in: ['Machine', 'Motor'] }
      }).select('_id code name productKind').lean();

      const matchedItemIds = matchedItems.map(it => it._id);
      const matchedItemSummaries = matchedItems.map(it => ({ code: it.code, name: it.name, productKind: it.productKind }));

      if (matchedItemIds.length === 0) {
        productSales = { matchedItems: [], totalQty: 0, totalRevenue: 0, monthlyTrend: [], topCustomers: [] };
      } else {
        const itemMatch = { 'items.itemRef': { $in: matchedItemIds } };
        const [productTotals, productMonthlyTrend, productTopCustomers] = await Promise.all([
          Sale.aggregate([
            { $match: salesMatchFilter },
            { $unwind: '$items' },
            { $match: itemMatch },
            { $group: { _id: null, totalQty: { $sum: '$items.quantity' }, totalRevenue: { $sum: '$items.totalPrice' } } }
          ]),
          Sale.aggregate([
            { $match: salesMatchFilter },
            { $unwind: '$items' },
            { $match: itemMatch },
            { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.totalPrice' } } },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
          ]),
          Sale.aggregate([
            { $match: salesMatchFilter },
            { $unwind: '$items' },
            { $match: itemMatch },
            { $group: { _id: '$customer', qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.totalPrice' } } },
            { $sort: { revenue: -1 } },
            { $limit: 10 },
            { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customerInfo' } },
            { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
            { $project: { customerName: { $ifNull: ['$customerInfo.name', 'Unknown'] }, qty: 1, revenue: 1 } }
          ])
        ]);
        productSales = {
          matchedItems: matchedItemSummaries,
          totalQty: productTotals[0]?.totalQty || 0,
          totalRevenue: productTotals[0]?.totalRevenue || 0,
          monthlyTrend: productMonthlyTrend,
          topCustomers: productTopCustomers
        };
      }
    }

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
        leadStats,
        productSales
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
    // Switched from the old sales-side Order model to ProductionOrder
    // (2026-09-29) — Order predates the BOM hierarchy / QC multi-checkpoint
    // redesign and no longer reflects real shop-floor production; every
    // Sub Child Part, Child Part and Machine build since has gone through
    // ProductionOrder instead. Order's own status vocabulary (pending,
    // in_production, completed, cancelled, ...) doesn't exist on
    // ProductionOrder at all, so this is a full rewrite, not a rename.
    const companyFilter = getProductionCompanyFilter(req.user);
    const { from, to, productCode } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    // ProductionOrder.status (models/ProductionOrder.js): 'Pending',
    // 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC', 'Completed'.
    // No cancelled/rejected state exists at this level — a QC reject routes
    // to reworkDecision/repair instead of ending the order.
    const COMPLETED_STATUSES = ['Completed'];
    const ACTIVE_STATUSES = ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC'];

    const [orderSummary, ordersByStatus, ordersByKind, orderTrend, recentOrders] = await Promise.all([
      // Order summary
      ProductionOrder.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ACTIVE_STATUSES] }, 1, 0] } },
            totalQty: { $sum: '$orderQuantity' },
            completedQty: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, '$orderQuantity', 0] } }
          }
        }
      ]).option({ maxTimeMS: 15000 }),

      // Orders by status
      ProductionOrder.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).option({ maxTimeMS: 15000 }),

      // Orders by kind (2026-09-29, new) — Sub Child Part / Child Part /
      // Machine, so it's visible at a glance how many of each are actually
      // running, not just a flat "Total Orders" number. $ifNull folds in
      // orders from before orderKind existed as a field at all (84 real
      // orders checked: 69 have no orderKind set, all pre-dating the BOM
      // hierarchy redesign) — the schema's own comment on orderKind
      // documents these as implicitly Machine ("'Machine' (default, every
      // existing order)"), so grouping them there is correct, not a guess.
      ProductionOrder.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { $ifNull: ['$orderKind', 'Machine'] },
            count: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, 1, 0] } },
            totalQty: { $sum: '$orderQuantity' }
          }
        }
      ]).option({ maxTimeMS: 15000 }),

      // Monthly order trend
      ProductionOrder.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]).option({ maxTimeMS: 15000 }),

      // Recent orders — lean, no populate. machineCode/machineName hold the
      // produced item's own code/name regardless of orderKind (see the
      // field's own comment in ProductionOrder.js) — there's no separate
      // "customer" on this model the way the old Order had; orderKind is
      // more useful here anyway.
      ProductionOrder.find(matchFilter)
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderId machineCode machineName orderKind status orderQuantity createdAt')
        .maxTimeMS(15000)
        .lean()
    ]);

    // ── Production by product code (2026-09-29) — mirrors the Sales
    // Report's own product-code lookup. machineCode is a plain string
    // already on every ProductionOrder (no Item join needed), and covers
    // Machine/Child Part/Sub Child Part alike — Motor Master items are
    // never produced via ProductionOrder (they're Purchasable, bought from
    // a vendor, not built off a BOM), so they never show up here, correctly.
    let productionByCode = null;
    if (productCode && productCode.trim()) {
      const safeCode = productCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const codeMatch = { ...matchFilter, machineCode: { $regex: safeCode, $options: 'i' } };

      const [matchedProductsAgg, totals, byStatus, byKind, monthlyTrend, orders] = await Promise.all([
        ProductionOrder.aggregate([
          { $match: codeMatch },
          { $group: { _id: { machineCode: '$machineCode', machineName: '$machineName', orderKind: { $ifNull: ['$orderKind', 'Machine'] } }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]).option({ maxTimeMS: 15000 }),
        ProductionOrder.aggregate([
          { $match: codeMatch },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalQty: { $sum: '$orderQuantity' },
              completedOrders: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, 1, 0] } },
              completedQty: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, '$orderQuantity', 0] } }
            }
          }
        ]).option({ maxTimeMS: 15000 }),
        ProductionOrder.aggregate([
          { $match: codeMatch },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).option({ maxTimeMS: 15000 }),
        ProductionOrder.aggregate([
          { $match: codeMatch },
          { $group: { _id: { $ifNull: ['$orderKind', 'Machine'] }, count: { $sum: 1 }, qty: { $sum: '$orderQuantity' } } }
        ]).option({ maxTimeMS: 15000 }),
        ProductionOrder.aggregate([
          { $match: codeMatch },
          { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, qty: { $sum: '$orderQuantity' } } },
          { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]).option({ maxTimeMS: 15000 }),
        ProductionOrder.find(codeMatch)
          .sort({ createdAt: -1 })
          .limit(10)
          .select('orderId machineCode machineName orderKind status orderQuantity createdAt')
          .maxTimeMS(15000)
          .lean()
      ]);

      productionByCode = {
        matchedProducts: matchedProductsAgg.map(m => ({ code: m._id.machineCode, name: m._id.machineName, orderKind: m._id.orderKind, orderCount: m.count })),
        totalOrders: totals[0]?.totalOrders || 0,
        totalQty: totals[0]?.totalQty || 0,
        completedOrders: totals[0]?.completedOrders || 0,
        completedQty: totals[0]?.completedQty || 0,
        byStatus,
        byKind,
        monthlyTrend,
        orders
      };
    }

    res.json({
      success: true,
      data: {
        summary: orderSummary[0] || { total: 0, completed: 0, pending: 0, totalQty: 0, completedQty: 0 },
        ordersByStatus,
        ordersByKind,
        orderTrend,
        recentOrders,
        productionByCode
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
    const { productCode } = req.query;
    // Exclude discontinued items — the previous version of this report
    // didn't, silently counting retired stock. Matches the convention every
    // other controller in this codebase already applies (e.g.
    // supplierController.js's catalog builder, the low-stock reorder cron).
    const baseFilter = { ...companyFilter, isDiscontinued: { $ne: true } };

    // A fabrication item (fabricationRef set) keeps its top-level `qty` at
    // 0 always — real stock lives per catalog size in dimensionVariants[]
    // .subStock/minStock (Item.js's own comments on qty/minStock/
    // dimensionVariants say so explicitly). The previous version of this
    // report read `qty` directly everywhere, so every fabrication item
    // silently reported zero stock — confirmed live: "Angle" showed qty=0
    // here despite 18 real units across its sizes. Every aggregate below
    // uses this instead.
    // Wrapped in $ifNull before comparing — in an aggregation EXPRESSION
    // (unlike a $match query filter), $ne/$eq do NOT treat a missing field
    // the same as an explicit null, so the bare form wrongly flagged every
    // item that predates this field (93 of 126 real items checked) as
    // "fabrication", zeroing their real qty via the dimensionVariants
    // branch — caught before shipping by re-verifying against real data.
    const isFabricationExpr = { $ne: [{ $ifNull: ['$fabricationRef', null] }, null] };
    const effectiveQtyExpr = {
      $cond: [isFabricationExpr, { $sum: '$dimensionVariants.subStock' }, '$qty']
    };
    // Non-leftover, at-or-below-its-own-minStock variants — leftover
    // variants are real stock but Purchase never reorders them (Item.js's
    // own comment), so they don't count as "needs reordering" either, same
    // rule server/jobs/lowStockReorderCron.js already follows.
    const lowVariantsExpr = {
      $filter: {
        input: { $ifNull: ['$dimensionVariants', []] },
        as: 'dv',
        cond: { $and: [{ $ne: ['$$dv.isLeftover', true] }, { $lte: ['$$dv.subStock', '$$dv.minStock'] }] }
      }
    };
    const isLowStockExpr = {
      $cond: [
        isFabricationExpr,
        { $gt: [{ $size: lowVariantsExpr }, 0] },
        { $lte: ['$qty', '$minStock'] }
      ]
    };
    // Same classification axis Vendor Master / Sales Report / Production
    // Report already use — replaces the old `category` grouping, which is
    // blank on 57% of real items (superseded by itemType for plain
    // Inventory items, per the Vendor Batching work).
    const sourceExpr = {
      $switch: {
        branches: [
          { case: { $eq: ['$productKind', 'Machine'] }, then: 'Product Master' },
          { case: { $eq: ['$productKind', 'Motor'] }, then: 'Motor Master' },
          { case: { $eq: ['$productKind', 'ChildPart'] }, then: 'Child Part' },
          { case: { $eq: ['$productKind', 'SubChildPart'] }, then: 'Sub Child Part' }
        ],
        default: 'Inventory'
      }
    };

    const [
      totalItems,
      sourceBreakdown,
      typeBreakdown,
      lowStockCountAgg,
      lowStockItems,
      highValueItems,
      criticalCount,
      totalValueAgg,
      costGapCount
    ] = await Promise.all([
      Item.countDocuments(baseFilter),

      Item.aggregate([
        { $match: baseFilter },
        { $addFields: { effectiveQty: effectiveQtyExpr, source: sourceExpr } },
        { $group: { _id: '$source', count: { $sum: 1 }, totalQty: { $sum: '$effectiveQty' }, totalValue: { $sum: { $multiply: ['$effectiveQty', '$stdCost'] } } } }
      ]),

      Item.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]),

      // Real total count — the display list below is capped at 20, so the
      // summary card can't be derived from its length (the previous
      // version of this report did exactly that, silently capping the
      // count at 20 too whenever more than 20 items were actually low).
      Item.aggregate([
        { $match: baseFilter },
        { $addFields: { isLow: isLowStockExpr } },
        { $match: { isLow: true } },
        { $count: 'count' }
      ]),

      Item.aggregate([
        { $match: baseFilter },
        {
          $addFields: {
            effectiveQty: effectiveQtyExpr,
            isLow: isLowStockExpr,
            isFabrication: isFabricationExpr,
            lowVariantCount: { $size: lowVariantsExpr },
            variantCount: { $size: { $ifNull: ['$dimensionVariants', []] } },
            source: sourceExpr
          }
        },
        { $match: { isLow: true } },
        { $sort: { effectiveQty: 1 } },
        { $limit: 20 },
        { $project: { name: 1, code: 1, source: 1, qty: 1, minStock: 1, effectiveQty: 1, isFabrication: 1, lowVariantCount: 1, variantCount: 1, importance: 1 } }
      ]),

      // "High value" = most ₹ actually held in stock (qty × cost), not the
      // highest per-unit price — the previous version sorted by raw
      // stdCost, which ranks a ₹5000 item with 1 unit above a ₹10 item
      // with 10,000 units, backwards for an inventory valuation list.
      Item.aggregate([
        { $match: { ...baseFilter, stdCost: { $gt: 0 } } },
        { $addFields: { effectiveQty: effectiveQtyExpr, source: sourceExpr } },
        { $addFields: { value: { $multiply: ['$effectiveQty', '$stdCost'] } } },
        { $sort: { value: -1 } },
        { $limit: 10 },
        { $project: { name: 1, code: 1, source: 1, effectiveQty: 1, stdCost: 1, value: 1 } }
      ]),

      // Only the count is ever used (summary.criticalCount) — no consumer
      // renders the full list, so this no longer fetches every critical item.
      Item.countDocuments({ ...baseFilter, importance: 'Critical' }),

      Item.aggregate([
        { $match: baseFilter },
        { $addFields: { effectiveQty: effectiveQtyExpr } },
        { $match: { effectiveQty: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$effectiveQty', '$stdCost'] } } } }
      ]),

      // How many items with real stock have never had a cost set at all —
      // makes Total Value's own limitation visible instead of silently
      // understating it (116 of 126 real items checked had stdCost unset).
      Item.countDocuments({ ...baseFilter, $or: [{ stdCost: { $exists: false } }, { stdCost: null }, { stdCost: 0 }] })
    ]);

    // Product-code lookup (2026-09-29) — same pattern as Sales/Production
    // Report, but simpler: a direct Item lookup, no join needed. Covers
    // every kind (Inventory/Product Master/Motor Master/Child Part/Sub
    // Child Part) since it's just searching the Item collection itself.
    let inventoryByCode = null;
    if (productCode && productCode.trim()) {
      const safeCode = productCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matched = await Item.aggregate([
        { $match: { ...baseFilter, code: { $regex: safeCode, $options: 'i' } } },
        {
          $addFields: {
            effectiveQty: effectiveQtyExpr,
            isLow: isLowStockExpr,
            isFabrication: isFabricationExpr,
            lowVariantCount: { $size: lowVariantsExpr },
            variantCount: { $size: { $ifNull: ['$dimensionVariants', []] } },
            source: sourceExpr
          }
        },
        { $project: { name: 1, code: 1, source: 1, qty: 1, minStock: 1, effectiveQty: 1, isFabrication: 1, lowVariantCount: 1, variantCount: 1, isLow: 1, stdCost: 1, importance: 1 } },
        { $limit: 20 }
      ]);
      inventoryByCode = { matched };
    }

    res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          totalValue: totalValueAgg[0]?.total || 0,
          costGapCount,
          lowStockCount: lowStockCountAgg[0]?.count || 0,
          criticalCount
        },
        sourceBreakdown,
        typeBreakdown,
        lowStockItems,
        highValueItems,
        inventoryByCode
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

      // Same matchFilter (company + date range) as the aggregates above, so
      // this honors the page's date filter instead of always showing the
      // last 10 ever regardless of the selected range.
      ComplaintService.find(matchFilter)
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
// ── Quality Report helpers (2026-09-29) ─────────────────────────────────────
// QCJob.status ('Draft'/'Pending'/'In Progress'/'Approved'/'Rejected') is
// reliably recalculated for every source and every mechanism (flat
// checklist, Sub Child Part batchSteps, Child Part/Machine unitChecks) —
// confirmed against the QC multi-checkpoint redesign's own build notes — so
// job-level counts can use it directly. The quantity-level detail
// (Passed/Rework/Scrap, per-unit Pass/Reject) genuinely differs in shape
// per source, so it's summarized here in JS from the fetched documents
// rather than forced into one Mongo aggregation pipeline.
function jobStatusCounts(jobs) {
  const counts = { Draft: 0, Pending: 0, 'In Progress': 0, Approved: 0, Rejected: 0 };
  jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
  return counts;
}

function bySourceBreakdown(jobs) {
  const map = new Map();
  jobs.forEach(j => {
    if (!map.has(j.source)) map.set(j.source, { source: j.source, total: 0, approved: 0, rejected: 0, pending: 0 });
    const row = map.get(j.source);
    row.total++;
    if (j.status === 'Approved') row.approved++;
    else if (j.status === 'Rejected') row.rejected++;
    else row.pending++;
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// Sub Child Part (source:'SubChildPartProduction') — every DECIDED attempt
// across every batch step, summed. A unit reworked then passed on
// resubmission counts toward both, an honest picture of what QC actually
// did over the period, not just the latest state.
function batchStepQuality(jobs) {
  let submitted = 0, passed = 0, rework = 0, scrap = 0;
  const byStep = new Map();
  jobs.forEach(j => {
    (j.batchSteps || []).forEach(step => {
      const key = `${step.category} > ${step.stepName}`;
      if (!byStep.has(key)) byStep.set(key, { step: key, submitted: 0, passed: 0, rework: 0, scrap: 0 });
      const row = byStep.get(key);
      (step.attempts || []).forEach(a => {
        if (!a.decidedAt) return;
        submitted += a.qtySubmitted || 0;
        passed += a.passedQty || 0;
        rework += a.reworkQty || 0;
        scrap += a.scrapQty || 0;
        row.submitted += a.qtySubmitted || 0;
        row.passed += a.passedQty || 0;
        row.rework += a.reworkQty || 0;
        row.scrap += a.scrapQty || 0;
      });
    });
  });
  return { totals: { submitted, passed, rework, scrap }, bySteps: [...byStep.values()].sort((a, b) => b.submitted - a.submitted) };
}

// Child Part (source:'ChildPartProduction') + a dynamic Machine order
// (source:'Production'/'Stock'/'QC_Rejected' with unitChecks populated —
// the old partChecks/flat-checklist Machine jobs are a separate, frozen
// system, deliberately excluded here the same way slice 4 of the QC
// redesign left them alone) — every DECIDED Pass/Reject across every
// unit's every step, counted per decision, not per unit, for the same
// "captures rework cycles honestly" reason as batchStepQuality above.
function unitStepQuality(jobs) {
  let pass = 0, reject = 0;
  const byStep = new Map();
  jobs.forEach(j => {
    (j.unitChecks || []).forEach(unit => {
      (unit.steps || []).forEach(step => {
        const key = `${step.category} > ${step.stepName}`;
        if (!byStep.has(key)) byStep.set(key, { step: key, pass: 0, reject: 0 });
        const row = byStep.get(key);
        (step.attempts || []).forEach(a => {
          if (a.decision === 'Pass') { pass++; row.pass++; }
          else if (a.decision === 'Reject') { reject++; row.reject++; }
        });
      });
    });
  });
  return { totals: { pass, reject }, bySteps: [...byStep.values()].sort((a, b) => (b.pass + b.reject) - (a.pass + a.reject)) };
}

function monthlyDecisionTrend(jobs) {
  const map = new Map();
  jobs.forEach(j => {
    if (j.status !== 'Approved' && j.status !== 'Rejected') return;
    const d = new Date(j.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!map.has(key)) map.set(key, { year: d.getFullYear(), month: d.getMonth() + 1, approved: 0, rejected: 0 });
    const row = map.get(key);
    if (j.status === 'Approved') row.approved++; else row.rejected++;
  });
  return [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

const isDynamicMachineSource = (j) => ['Production', 'Stock', 'QC_Rejected'].includes(j.source) && (j.unitChecks || []).length > 0;

// ────────────────────────────────────────────────────────────
// GET /api/mis/quality-report
// ────────────────────────────────────────────────────────────
export const getQualityReport = async (req, res) => {
  try {
    // Full rewrite (2026-09-29) — the previous version never touched real
    // QC data at all: it queried the sales-side Order model and called a
    // completed order "delivered", a cancelled one "returned" (its own
    // comment admitted it: "Use Order model as proxy for quality stats via
    // order status"). Real QC outcomes live on QCJob, built across this
    // session's whole Multi-Checkpoint redesign.
    const companyFilter = getProductionCompanyFilter(req.user); // QCJob's company field, same as ProductionOrder
    const { from, to, productCode } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    const dateMatch = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const matchFilter = { ...companyFilter, ...dateMatch };

    const jobs = await QCJob.find(matchFilter)
      .select('qcJobId source itemName itemCode status decision failReason inspector createdAt batchSteps unitChecks')
      .maxTimeMS(15000)
      .lean();

    const statusCounts = jobStatusCounts(jobs);
    const decided = statusCounts.Approved + statusCounts.Rejected;
    const passRate = decided > 0 ? ((statusCounts.Approved / decided) * 100).toFixed(1) : 0;

    const scpQuality = batchStepQuality(jobs.filter(j => j.source === 'SubChildPartProduction'));
    const unitQuality = unitStepQuality(jobs.filter(j => j.source === 'ChildPartProduction' || isDynamicMachineSource(j)));

    // Product-code lookup (2026-09-29) — same pattern as Sales/Production/
    // Inventory Report. QCJob already carries itemCode directly.
    let qualityByCode = null;
    if (productCode && productCode.trim()) {
      const safeCode = productCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const codeRegex = new RegExp(safeCode, 'i');
      const codeJobs = jobs.filter(j => codeRegex.test(j.itemCode || ''));
      qualityByCode = {
        matchedItems: [...new Map(codeJobs.map(j => [j.itemCode, { code: j.itemCode, name: j.itemName }])).values()],
        statusCounts: jobStatusCounts(codeJobs),
        scpQuality: batchStepQuality(codeJobs.filter(j => j.source === 'SubChildPartProduction')),
        unitQuality: unitStepQuality(codeJobs.filter(j => j.source === 'ChildPartProduction' || isDynamicMachineSource(j))),
        jobs: codeJobs
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 10)
          .map(j => ({ qcJobId: j.qcJobId, source: j.source, status: j.status, inspector: j.inspector, failReason: j.failReason, createdAt: j.createdAt }))
      };
    }

    res.json({
      success: true,
      data: {
        summary: {
          totalJobs: jobs.length,
          approved: statusCounts.Approved,
          rejected: statusCounts.Rejected,
          pending: statusCounts.Pending + statusCounts['In Progress'] + statusCounts.Draft,
          passRate
        },
        sourceBreakdown: bySourceBreakdown(jobs),
        monthlyTrend: monthlyDecisionTrend(jobs),
        subChildPartQuality: scpQuality,
        unitQuality,
        qualityByCode
      }
    });
  } catch (error) {
    console.error('MIS Quality Report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
