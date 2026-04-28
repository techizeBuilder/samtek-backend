import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getSalespersonCustomers,
  getSalespersonDeliveries,
  getSalespersonInvoices,
  getSalespersonRefundReturns,
  getSalespersonReturns,
  getSalespersonDamages,
  createSalespersonReturn,
  updateSalespersonReturn,
  deleteSalespersonReturn,
  createSalespersonDamage,
  updateSalespersonDamage,
  deleteSalespersonDamage,
  getSalespersonItems,
  getSalesSummary,
  getSalesRecentOrders,
  getSalesOrders,
  getPriorityProducts,
  addPriorityProduct,
  removePriorityProduct,
  updatePriorityProductUsage,
  getSalesCutoffTimeStatus,
  downloadInvoicePDF
} from '../controllers/salesController.js';
// Import with different names to avoid conflicts
import { 
  getSalesSummary as getProductSalesSummaryHandler,
  updateSalesSummary as updateProductSalesSummaryHandler 
} from '../controllers/salesSummaryController.js';

const salesRouter = express.Router();

// Debug endpoint without auth to test route registration - MUST be before middleware
salesRouter.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Sales routes are working!',
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString(),
    availableRoutes: [
      'GET /api/sales/debug (no auth)',
      'GET /api/sales/debug-customers (no auth)',
      'GET /api/sales/test-summary (needs auth)',  
      'GET /api/sales/product-summary (needs auth)',
      'POST /api/sales/update-product-summary (needs auth)'
    ]
  });
});

// Debug customers endpoint - NO AUTH REQUIRED
salesRouter.get('/debug-customers', async (req, res) => {
  try {
    const { default: Customer } = await import('../models/Customer.js');
    
    // Get sample customers
    const sampleCustomers = await Customer.find({}).select('name category active').limit(5);
    
    // Get distinct categories
    const categories = await Customer.distinct('category');
    
    // Get distinct active values
    const activeValues = await Customer.distinct('active');
    
    // Count by category
    const categoryCounts = {};
    for (const cat of categories) {
      categoryCounts[cat] = await Customer.countDocuments({ category: cat });
    }
    
    // Count by active status
    const activeCounts = {};
    for (const active of activeValues) {
      activeCounts[active] = await Customer.countDocuments({ active });
    }
    
    res.json({
      success: true,
      message: 'Customer data debug info',
      data: {
        totalCustomers: await Customer.countDocuments(),
        categories,
        activeValues,
        categoryCounts,
        activeCounts,
        sampleCustomers
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching debug info',
      error: error.message
    });
  }
});

// Apply authentication to all other sales routes
salesRouter.use(authenticateToken);

// Test endpoint with auth to verify middleware is working
salesRouter.get('/test-summary', (req, res) => {
  res.json({
    success: true,
    message: 'Sales summary routes are authenticated and working',
    timestamp: new Date().toISOString(),
    user: req.user ? { 
      id: req.user.id, 
      username: req.user.username, 
      role: req.user.role,
      companyId: req.user.companyId 
    } : 'No user found',
    endpoints: [
      'GET /api/sales/product-summary',
      'POST /api/sales/update-product-summary'
    ]
  });
});

// Sales approval dashboard routes (product summary with calculations)
salesRouter.get('/product-summary', (req, res) => {
  console.log('🔍 GET /product-summary called');
  console.log('User:', req.user ? { id: req.user.id, role: req.user.role, companyId: req.user.companyId } : 'No user');
  console.log('Query params:', req.query);
  
  try {
    getProductSalesSummaryHandler(req, res);
  } catch (error) {
    console.error('Error in product-summary route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Alias: /products-summary (plural) — used by Unit Head Indent Summary page
salesRouter.get('/products-summary', authorizeRoles('Sales', 'Unit Manager', 'Superadmin', 'Unit Head'), (req, res) => {
  console.log('🔍 GET /products-summary (Unit Head alias) called');
  console.log('User:', req.user ? { id: req.user.id, role: req.user.role } : 'No user');
  console.log('Query params:', req.query);
  try {
    getProductSalesSummaryHandler(req, res);
  } catch (error) {
    console.error('Error in products-summary route:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

// Apply role-based authorization for other sales routes only
salesRouter.use(authorizeRoles('Sales', 'Unit Manager', 'Superadmin'));

// MOVED: Only Unit Managers and Super Admins can update product summary
salesRouter.post('/update-product-summary', authorizeRoles('Unit Manager', 'Superadmin'), (req, res) => {
  console.log('🔍 POST /update-product-summary called');
  console.log('User:', req.user ? { id: req.user.id, role: req.user.role, companyId: req.user.companyId } : 'No user');
  console.log('Body:', req.body);
  
  try {
    updateProductSalesSummaryHandler(req, res);
  } catch (error) {
    console.error('Error in update-product-summary route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});


// Sales-specific dashboard routes
salesRouter.get('/summary', getSalesSummary);
salesRouter.get('/recent-orders', getSalesRecentOrders);

// Sales-specific order routes (filtered by individual salesperson)
salesRouter.get('/orders', getSalesOrders);

// Priority Products routes
salesRouter.get('/priority-products', getPriorityProducts);
salesRouter.post('/priority-products', addPriorityProduct);
salesRouter.delete('/priority-products/:id', removePriorityProduct);
salesRouter.post('/priority-products/usage', updatePriorityProductUsage);

// Cutoff time status for sales persons
salesRouter.get('/cutoff-time-status', getSalesCutoffTimeStatus);

// Sales-specific customer routes (filtered by salesperson assignment)
salesRouter.get('/customers', getSalespersonCustomers);

// Other salesperson-specific routes
salesRouter.get('/my-customers', getSalespersonCustomers);
salesRouter.get('/my-deliveries', getSalespersonDeliveries);
salesRouter.get('/my-invoices', getSalespersonInvoices);
salesRouter.get('/refund-return', getSalespersonRefundReturns);
salesRouter.get('/returns', getSalespersonReturns);
salesRouter.get('/damages', getSalespersonDamages);
salesRouter.post('/create-return', createSalespersonReturn);
salesRouter.put('/update-return/:id', updateSalespersonReturn);
salesRouter.delete('/delete-return/:id', deleteSalespersonReturn);
salesRouter.post('/create-damage', createSalespersonDamage);
salesRouter.put('/update-damage/:id', updateSalespersonDamage);
salesRouter.delete('/delete-damage/:id', deleteSalespersonDamage);
salesRouter.get('/items', getSalespersonItems);
salesRouter.get('/invoice/:id/pdf', downloadInvoicePDF);

export default salesRouter;