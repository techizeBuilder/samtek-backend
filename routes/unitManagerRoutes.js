import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getItems,
  updateOrderStatus,
  getOrders,
  getDashboardStats,
  getSalesPersons,
  fixOrdersSalesPersonAssignment,
  getAllOrders,
  getOrderById,
  approveProductSummaries,
  getUnitManagerProductionGroups,
  getUnitManagerProductionGroupById,
  createUnitManagerProductionGroup,
  updateUnitManagerProductionGroup,
  deleteUnitManagerProductionGroup,
  getUnitManagerAvailableItems,
  getApprovedProductSummaries,
  // Unit Manager Returns & Damage functions (Consolidated)
  getUnitManagerReturns,
  createUnitManagerReturn,
  updateUnitManagerReturn,
  deleteUnitManagerReturn,
  approveUnitManagerReturn,
  getUnitManagerDamages,
  createUnitManagerDamage,
  updateUnitManagerDamage,
  deleteUnitManagerDamage,
  approveUnitManagerDamage,
  getUnitManagerSalesPersons
} from '../controllers/unitManagerController.js';
import { bulkApproveGroup } from '../controllers/bulkGroupApprovalController.js';
// Import models for debug endpoint
import User from '../models/User.js';
import Order from '../models/Order.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Test endpoint to verify API structure
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Unit Manager API is working with enhanced grouping',
    timestamp: new Date().toISOString(),
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    },
    codeVersion: 'PRODUCTDAILYSUMMARY_FIX_v2.0'
  });
});

// Debug endpoint to check users and orders
router.get('/debug', async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'Unit Manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Unit Manager role required'
      });
    }

    // Check users in same company
    const companyUsers = await User.find({
      companyId: user.companyId
    }).select('_id username role fullName companyId').lean();

    // Check orders for these users
    const userIds = companyUsers.map(u => u._id);
    const orders = await Order.find({
      salesPerson: { $in: userIds }
    }).populate('salesPerson', 'username fullName role')
      .populate('customer', 'name')
      .select('orderCode customer salesPerson status orderDate')
      .lean();

    res.json({
      success: true,
      debug: {
        currentUser: {
          id: user._id,
          username: user.username,
          role: user.role,
          companyId: user.companyId
        },
        companyUsers: companyUsers.map(u => ({
          id: u._id,
          username: u.username,
          role: u.role,
          fullName: u.fullName,
          companyId: u.companyId
        })),
        ordersCount: orders.length,
        ordersBySalesPerson: orders.reduce((acc, order) => {
          const spName = order.salesPerson?.username || 'unassigned';
          if (!acc[spName]) acc[spName] = [];
          acc[spName].push({
            orderCode: order.orderCode,
            customer: order.customer?.name,
            status: order.status
          });
          return acc;
        }, {})
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Unit Manager specific routes - Fixed to use proper items endpoint
router.get('/items', async (req, res) => {
  try {
    // Import necessary modules
    const { Item } = await import('../models/Inventory.js');

    const user = req.user;
    console.log('🔍 Unit Manager Items API:', {
      role: user.role,
      companyId: user.companyId,
      store: user.companyId
    });

    // Only allow Unit Manager role
    if (user.role !== 'Unit Manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Unit Manager role required'
      });
    }

    // Get all items for this company using correct field 'store'
    const items = await Item.find({
      store: user.companyId // Items use 'store' field, not 'companyId'
    })
      .select('name code category subCategory batch qty unit price image salePrice stdCost')
      .sort({ name: 1 })
      .lean();

    console.log(`Unit Manager items API: Found ${items.length} items for company ${user.companyId}`);

    res.json({
      success: true,
      data: items,
      items: items // Also include 'items' for backward compatibility
    });

  } catch (error) {
    console.error('Unit Manager items API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch items',
      error: error.message
    });
  }
});
// COMMENTED OUT - Using product summary API instead
// router.get('/orders', getOrders); // Main API with all data
router.get('/all-orders', getAllOrders); // New endpoint for sales order list
router.get('/sales-order-list', getAllOrders); // Alternative endpoint for sales order list
router.get('/orders/:id', getOrderById); // Get single order details
router.get('/customers', async (req, res) => {
  try {
    const { authenticateToken } = await import('../middleware/auth.js');
    const Customer = (await import('../models/Customer.js')).default;

    // Get user's company ID for filtering
    const userCompanyId = req.user.companyId;

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'User company not found'
      });
    }

    // Get customers only for the unit manager's company
    const customers = await Customer.find({
      companyId: userCompanyId
    }, 'name email phone companyId').sort({ name: 1 }).lean();

    console.log(`Unit Manager customers API: Found ${customers.length} customers for company ${userCompanyId}`);

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Unit Manager customers API error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customers', error: error.message });
  }
}); // Get customers for filter dropdown
router.get('/salespersons', async (req, res) => {
  try {
    const User = (await import('../models/User.js')).default;

    // Get all sales persons for dropdown - using multiple role variations
    const salesPersons = await User.find({
      role: { $in: ['Sales', 'sales', 'SALES', 'Sales Person', 'SalesPerson'] }
    }, 'fullName email username').sort({ fullName: 1 }).lean();

    res.json({ success: true, data: salesPersons });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch salespersons', error: error.message });
  }
}); // Get salespersons for filter dropdown
router.get('/fix-orders', fixOrdersSalesPersonAssignment); // Utility to fix existing orders
// router.get('/users', getSalesPersons); // Commented - data now included in /orders
router.put('/orders/:id/status', updateOrderStatus); // Single or bulk approve
router.patch('/orders/:id/status', updateOrderStatus); // Add PATCH support
router.get('/dashboard/stats', getDashboardStats);

// Product Summary Approval Routes (Single endpoint for both individual and bulk)
router.post('/product-summary/approve', approveProductSummaries); // Individual & Bulk approve
router.post('/approve-product-summaries', approveProductSummaries); // Alternative endpoint for frontend compatibility

// 🎯 NEW: Bulk approve entire production group (optimal batch creation)
router.post('/bulk-approve-group', (req, res) => {
  console.log('🎯 POST /unit-manager/bulk-approve-group called');
  console.log('User:', req.user ? { id: req.user.id, role: req.user.role } : 'No user');
  console.log('Body:', req.body);

  try {
    bulkApproveGroup(req, res);
  } catch (error) {
    console.error('Error in bulk-approve-group route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get approved product summaries with available batches
router.get('/product-summaries/approved', getApprovedProductSummaries);

// Production Groups routes (Unit Manager specific functions)
router.get('/production-groups', getUnitManagerProductionGroups);
router.get('/production-groups/:id', getUnitManagerProductionGroupById);
router.post('/production-groups', createUnitManagerProductionGroup);
router.put('/production-groups/:id', updateUnitManagerProductionGroup);
router.delete('/production-groups/:id', deleteUnitManagerProductionGroup);
router.get('/production-groups/items/available', getUnitManagerAvailableItems);

// Unit Manager Returns & Damage Management Routes (Consolidated)
router.get('/returns', getUnitManagerReturns);
router.post('/create-return', createUnitManagerReturn);
router.put('/update-return/:id', updateUnitManagerReturn);
router.delete('/delete-return/:id', deleteUnitManagerReturn);
router.post('/approve-return/:id', approveUnitManagerReturn);
router.post('/update-return-status/:id', async (req, res) => {
  try {
    const Return = (await import('../models/Return.js')).default;
    const { status } = req.body;
    const { id } = req.params;
    const user = req.user;

    console.log('🔄 Updating return status:', { id, status, userId: user._id });

    // Only allow Unit Manager role
    if (user.role !== 'Unit Manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Unit Manager role required'
      });
    }

    // Validate status
    const validStatuses = ['pending', 'approved', 'rejected', 'processing', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }

    // Find and update the return
    const returnRecord = await Return.findOne({
      _id: id,
      companyId: user.companyId
    });

    if (!returnRecord) {
      return res.status(404).json({
        success: false,
        message: 'Return not found'
      });
    }

    // If status is being updated to 'approved', deduct amount from customer outstanding and sync with Invoices
    if (status === 'approved' && returnRecord.status !== 'approved') {
      try {
        const Customer = (await import('../models/Customer.js')).default;
        const customer = await Customer.findById(returnRecord.customerId);
        if (customer) {
          const oldBalance = customer.outstandingAmount || 0;
          customer.outstandingAmount = oldBalance - (returnRecord.totalAmount || 0);
          await customer.save();
          console.log(`💰 Updated Customer ${customer.name} balance via inline route: ${oldBalance} -> ${customer.outstandingAmount}`);

          // SYNC INVOICE BALANCES FOR AGEING REPORT
          let remainingReturnAmount = returnRecord.totalAmount || 0;

          // 1. Try targeted invoice if order is linked
          if (returnRecord.order) {
            const Sale = (await import('../models/Sale.js')).default;
            const targetInvoice = await Sale.findOne({ order: returnRecord.order });
            if (targetInvoice && targetInvoice.balanceAmount > 0) {
              const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
              targetInvoice.balanceAmount -= reduction;
              remainingReturnAmount -= reduction;
              await targetInvoice.save();
              console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction}`);
            }
          }

          // 2. FIFO reduction
          if (remainingReturnAmount > 0) {
            const Sale = (await import('../models/Sale.js')).default;
            const unpaidInvoices = await Sale.find({
              customer: returnRecord.customerId,
              balanceAmount: { $gt: 0 }
            }).sort({ saleDate: 1 });

            for (const inv of unpaidInvoices) {
              if (remainingReturnAmount <= 0) break;
              const reduction = Math.min(inv.balanceAmount, remainingReturnAmount);
              inv.balanceAmount -= reduction;
              remainingReturnAmount -= reduction;
              await inv.save();
              console.log(`📑 Reduced invoice ${inv.invoiceNumber} balance by ${reduction} (FIFO)`);
            }
          }
        }
      } catch (err) {
        console.error('❌ Error updating customer balance in inline status update:', err);
      }
    }

    // Update status
    returnRecord.status = status;
    returnRecord.updatedAt = new Date();
    returnRecord.updatedBy = user._id;

    await returnRecord.save();

    console.log('✅ Return status updated successfully');

    res.json({
      success: true,
      message: 'Return status updated successfully',
      data: returnRecord
    });

  } catch (error) {
    console.error('❌ Error updating return status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update return status',
      error: error.message
    });
  }
});

// Unit Manager Damages Management Routes
router.get('/damages', getUnitManagerDamages);
router.post('/create-damage', createUnitManagerDamage);
router.put('/update-damage/:id', updateUnitManagerDamage);
router.delete('/delete-damage/:id', deleteUnitManagerDamage);
router.post('/approve-damage/:id', approveUnitManagerDamage);

// Get sales persons for the company (for dropdowns)
router.get('/sales-persons', getUnitManagerSalesPersons);

export default router;
