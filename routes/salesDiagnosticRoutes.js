import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';
import Order from '../models/Order.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Utility endpoint to diagnose and fix sales person order issues
router.get('/diagnose-sales-issue', async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== 'Unit Manager' && user.role !== 'Super Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Unit Manager or Super Admin role required'
      });
    }

    console.log('🔍 DIAGNOSING SALES PERSON ORDER ISSUE...');
    
    // Step 1: Check the specific sales users
    const targetUsers = await User.find({
      username: { $in: ['sales_jeet', 'sales_jeet01'] }
    }).lean();
    
    console.log('Target sales users found:', targetUsers.length);
    targetUsers.forEach(u => {
      console.log(`  ${u.username}: role=${u.role}, company=${u.companyId}, id=${u._id}`);
    });
    
    // Step 2: Check if they're in the same company
    const companyIds = [...new Set(targetUsers.map(u => u.companyId?.toString()))];
    console.log('Unique company IDs:', companyIds);
    
    // Step 3: Check orders for each user
    const userOrders = {};
    for (const targetUser of targetUsers) {
      const orders = await Order.find({ 
        salesPerson: targetUser._id 
      }).populate('customer', 'name').lean();
      
      userOrders[targetUser.username] = {
        userId: targetUser._id,
        orderCount: orders.length,
        orders: orders.map(o => ({
          orderCode: o.orderCode,
          customer: o.customer?.name,
          status: o.status
        }))
      };
      
      console.log(`${targetUser.username} has ${orders.length} orders`);
    }
    
    // Step 4: Check what the unit manager sees
    let unitManagerFilter = {};
    if (user.companyId) {
      const companySalesPersons = await User.find({ 
        companyId: user.companyId,
        $or: [
          { role: 'Sales' },
          { role: 'sales' },
          { role: 'Unit Manager' },
          { role: 'Unit Head' },
          { role: { $regex: /sales/i } }
        ]
      }).lean();
      
      const salesPersonIds = companySalesPersons.map(sp => sp._id);
      unitManagerFilter.salesPerson = { $in: salesPersonIds };
      
      console.log(`Unit Manager ${user.username} company filter includes ${salesPersonIds.length} users`);
      companySalesPersons.forEach(sp => {
        console.log(`  Included: ${sp.username} (${sp.role})`);
      });
    }
    
    const filteredOrders = await Order.find(unitManagerFilter).lean();
    console.log(`Unit Manager filter returns ${filteredOrders.length} orders`);
    
    // Step 5: Provide diagnostic results and recommendations
    const diagnosis = {
      targetUsers: targetUsers.map(u => ({
        username: u.username,
        role: u.role,
        companyId: u.companyId,
        id: u._id
      })),
      companyIssue: companyIds.length > 1,
      orderCounts: userOrders,
      unitManagerFilter: {
        companyId: user.companyId,
        filteredOrdersCount: filteredOrders.length
      },
      recommendations: []
    };
    
    // Generate recommendations
    if (companyIds.length > 1) {
      diagnosis.recommendations.push({
        issue: 'Users are in different companies',
        solution: 'Assign both sales_jeet and sales_jeet01 to the same company',
        action: 'Update companyId in user records'
      });
    }
    
    if (targetUsers.some(u => !u.role || !u.role.toLowerCase().includes('sales'))) {
      diagnosis.recommendations.push({
        issue: 'Incorrect role assignment',
        solution: 'Ensure both users have role "Sales"',
        action: 'Update role field in user records'
      });
    }
    
    const totalOrders = Object.values(userOrders).reduce((sum, u) => sum + u.orderCount, 0);
    if (totalOrders === 0) {
      diagnosis.recommendations.push({
        issue: 'No orders assigned to either sales person',
        solution: 'Create test orders or assign existing orders to sales persons',
        action: 'Use order creation API or run fix-orders endpoint'
      });
    }
    
    res.json({
      success: true,
      diagnosis,
      message: diagnosis.recommendations.length > 0 ? 'Issues found - see recommendations' : 'No issues detected'
    });
    
  } catch (error) {
    console.error('Error diagnosing sales issue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to diagnose issue',
      error: error.message
    });
  }
});

// Utility endpoint to fix common sales person issues
router.post('/fix-sales-issue', async (req, res) => {
  try {
    const user = req.user;
    const { action, targetCompanyId } = req.body;
    
    if (user.role !== 'Super Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Super Admin role required for fixes'
      });
    }

    const fixes = [];
    
    if (action === 'unify-company' && targetCompanyId) {
      // Fix 1: Assign both users to same company
      const result = await User.updateMany(
        { username: { $in: ['sales_jeet', 'sales_jeet01'] } },
        { $set: { companyId: targetCompanyId } }
      );
      
      fixes.push({
        action: 'Unified company assignment',
        affected: result.modifiedCount,
        details: `Assigned both users to company ${targetCompanyId}`
      });
    }
    
    if (action === 'fix-roles') {
      // Fix 2: Ensure correct role
      const result = await User.updateMany(
        { username: { $in: ['sales_jeet', 'sales_jeet01'] } },
        { $set: { role: 'Sales' } }
      );
      
      fixes.push({
        action: 'Fixed role assignment',
        affected: result.modifiedCount,
        details: 'Set role to "Sales" for both users'
      });
    }
    
    res.json({
      success: true,
      fixes,
      message: 'Fixes applied successfully'
    });
    
  } catch (error) {
    console.error('Error applying fixes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply fixes',
      error: error.message
    });
  }
});

export default router;