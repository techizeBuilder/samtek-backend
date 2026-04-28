import Order from '../models/Order.js';
import Manufacturing from '../models/Manufacturing.js';
import Dispatch from '../models/Dispatch.js';
import Sale from '../models/Sale.js';
import { Item } from '../models/Inventory.js';
import { USER_ROLES } from '../shared/schema.js';

export const getDashboardMetrics = async (req, res) => {
  try {
    const { unit } = req.query;
    let query = {};

    // Apply unit filter for non-super users
    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    // Get date ranges for comparison
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Total Orders
    const totalOrders = await Order.countDocuments(query);
    const ordersThisMonth = await Order.countDocuments({
      ...query,
      createdAt: { $gte: startOfMonth }
    });
    const ordersLastMonth = await Order.countDocuments({
      ...query,
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
    });

    // Production Metrics
    const totalProduction = await Manufacturing.countDocuments(query);
    const completedProduction = await Manufacturing.countDocuments({
      ...query,
      status: 'Completed'
    });
    const productionEfficiency = totalProduction > 0 ? (completedProduction / totalProduction) * 100 : 0;

    // Dispatch Metrics
    const totalDispatches = await Dispatch.countDocuments(query);
    const pendingDispatches = await Dispatch.countDocuments({
      ...query,
      status: 'Pending'
    });

    // Revenue Metrics
    const revenueResult = await Sale.aggregate([
      { $match: { ...query, paymentStatus: 'Paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const revenueThisMonth = await Sale.aggregate([
      {
        $match: {
          ...query,
          paymentStatus: 'Paid',
          createdAt: { $gte: startOfMonth }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const revenueCurrentMonth = revenueThisMonth.length > 0 ? revenueThisMonth[0].total : 0;

    const revenueLastMonth = await Sale.aggregate([
      {
        $match: {
          ...query,
          paymentStatus: 'Paid',
          createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const revenuePreviousMonth = revenueLastMonth.length > 0 ? revenueLastMonth[0].total : 0;

    // Calculate growth rates
    const ordersGrowth = ordersLastMonth > 0 ? ((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100 : 0;
    const revenueGrowth = revenuePreviousMonth > 0 ? ((revenueCurrentMonth - revenuePreviousMonth) / revenuePreviousMonth) * 100 : 0;

    res.json({
      metrics: {
        totalOrders,
        ordersGrowth: Math.round(ordersGrowth * 10) / 10,
        production: Math.round(productionEfficiency * 10) / 10,
        productionGrowth: 3.2, // This would be calculated similarly
        dispatches: totalDispatches,
        pendingDispatches,
        dispatchesChange: Math.round((pendingDispatches / totalDispatches) * 100 * 10) / 10,
        revenue: totalRevenue,
        revenueGrowth: Math.round(revenueGrowth * 10) / 10
      }
    });
  } catch (error) {
    console.error('Get dashboard metrics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getProductionChart = async (req, res) => {
  try {
    const { unit, period = '7' } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const productionData = await Manufacturing.aggregate([
      {
        $match: {
          ...query,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          production: { $sum: '$actualQuantity' },
          planned: { $sum: '$plannedQuantity' }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Fill missing dates with zero values
    const labels = [];
    const productionValues = [];
    const plannedValues = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().split('T')[0];

      labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));

      const dayData = productionData.find(d => d._id.date === dateString);
      productionValues.push(dayData ? dayData.production : 0);
      plannedValues.push(dayData ? dayData.planned : 0);
    }

    res.json({
      labels,
      datasets: [
        {
          label: 'Actual Production',
          data: productionValues
        },
        {
          label: 'Planned Production',
          data: plannedValues
        }
      ]
    });
  } catch (error) {
    console.error('Get production chart error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getSalesChart = async (req, res) => {
  try {
    const { unit, period = '7' } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Updated sales trend data to include approved orders
    const salesData = await Order.aggregate([
      {
        $match: {
          ...query,
          createdAt: { $gte: startDate },
          status: { $in: ['Completed', 'Dispatched', 'Delivered', 'approved'] } // Include approved orders
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          sales: { $sum: '$totalAmount' }
        }
      },
      {
        $sort: { '_id.date': 1 } // Sort by date
      }
    ]);

    const salesTrendData = salesData.map(data => ({
      day: new Date(data._id.date).toLocaleDateString('en-US', { weekday: 'short' }),
      date: data._id.date,
      sales: data.sales / 100000 // Convert to lakhs
    }));

    res.json({ salesTrendData });
  } catch (error) {
    console.error('Get sales chart error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getRecentOrders = async (req, res) => {
  try {
    const { unit, limit = 5 } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const orders = await Order.find(query)
      .populate('customer', 'customerName name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('orderCode customer status totalAmount products createdAt orderDate');

    // Transform orders to match frontend expectations
    const transformedOrders = orders.map(order => ({
      _id: order._id,
      orderCode: order.orderCode,
      customer: order.customer?.customerName || order.customer?.name || 'Unknown Customer',
      status: order.status || 'Pending',
      amount: order.totalAmount || 0,
      date: order.orderDate || order.createdAt,
      items: Array.isArray(order.products) ? order.products.length : 0
    }));

    res.json({ orders: transformedOrders });
  } catch (error) {
    console.error('Get recent orders error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getAlerts = async (req, res) => {
  try {
    const { unit } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unitName = req.user.unit;
    } else if (unit) {
      query.unitName = unit;
    }

    const alerts = [];

    // Low Stock Alerts
    const lowStockItems = await Item.find({
      ...query,
      $expr: { $lte: ['$qty', '$minStock'] }
    }).limit(5);

    lowStockItems.forEach(item => {
      alerts.push({
        type: 'warning',
        icon: 'fas fa-exclamation-triangle',
        title: 'Low Stock Alert',
        message: `${item.name} below threshold`,
        timestamp: new Date()
      });
    });

    // Delayed Orders
    const delayedOrders = await Order.find({
      ...query,
      status: { $in: ['New', 'In Progress'] },
      expectedDeliveryDate: { $lt: new Date() }
    }).limit(3);

    delayedOrders.forEach(order => {
      alerts.push({
        type: 'error',
        icon: 'fas fa-clock',
        title: 'Delayed Order',
        message: `Order ${order.orderNumber} behind schedule`,
        timestamp: order.expectedDeliveryDate
      });
    });

    // Sort alerts by timestamp (newest first)
    alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ alerts: alerts.slice(0, 10) });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
