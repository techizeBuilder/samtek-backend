import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getCompanySalesInvoices,
  getInvoiceDetail,
  updateInvoice,
  getSalesAnalytics,
  getAllSalesPersons,
  getSalesPersonById,
  getSalesPersonOrders,
  debugReturnCollection,
  debugUserAndReturns,
  debugShowAllReturns,
  getBankCashSummary,
  reconcileTransaction,
  getTransactions,
  createGeneralTransaction,
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  getSalesReturnsList,
  getSalesDamagesList,
  debugCheckSalesPersons,
  getDamageExpiryList,
  getDamageExpiryDetail,
  getLedgerRecords,
  getAccountsDashboardData
} from '../controllers/accountsController.js';
import {
  getPartners as getPartnersList,
  createPartner as createPartnerEntry,
  updatePartner as updatePartnerEntry,
  deletePartner as deletePartnerEntry
} from '../controllers/partnerController.js';
import {
  createSalesInvoice,
  getSalesInvoices,
  getReceivableAgeing,
  getSalesSummary,
  getSalesItems,
  getPendingAccountOrders,
  approveOrderAccount,
  rejectOrderAccount,
  downloadInvoicePDF
} from '../controllers/salesAccountController.js';

import {
  getSalesmanDailyStats,
  createDailySettlement,
  getSalesmanLedger,
  calculateCommission,
  postCommissionToLedger
} from '../controllers/salesmanModuleController.js';
import { getTaxSummary } from '../controllers/taxController.js';


import {
  createCustomerPayment,
  getCustomerPayments,
  getCustomerPaymentStats
} from '../controllers/customerPaymentController.js';

import {
  getPurchaseItems,
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  receivePurchase,
  sendPOToVendor
} from '../controllers/purchaseController.js';

const accountsRouter = express.Router();

// Apply authentication to all accounts routes
accountsRouter.use(authenticateToken);

// ==================== ACCOUNTS DASHBOARD ====================
// GET /api/accounts/dashboard - Dynamic dashboard data for logged-in user's company
accountsRouter.get(
  '/dashboard',
  authorizeRoles(
    'Accounts', 'Accounts Head', 'Accounts Employee', 'Account Employee',
    'Superadmin', 'Super Admin',
    'Unit Head', 'Unit Manager', 'Admin',
    'Manager', 'Director', 'CFO', 'Finance', 'Finance Head',
    'Sales', 'Sales Person', 'Salesman'
  ),
  getAccountsDashboardData
);

// Sales Invoices - Get all invoices for the company
// Can be used by: Unit Manager, Unit Head, Sales Person, Super Admin, Admin, Accounts
accountsRouter.get(
  '/sales/invoices',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getCompanySalesInvoices
);

// Get detailed invoice information
accountsRouter.get(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getInvoiceDetail
);

// Update invoice payment status or details
accountsRouter.put(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  updateInvoice
);

// Get sales analytics
accountsRouter.get(
  '/sales/analytics',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getSalesAnalytics
);

// ==================== SALES PERSONS MANAGEMENT ====================

// Get all sales persons for the company
accountsRouter.get(
  '/sales-persons',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getAllSalesPersons
);

// Get specific sales person details
accountsRouter.get(
  '/sales-persons/:salesPersonId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getSalesPersonById
);

// Get all orders for a specific sales person
accountsRouter.get(
  '/sales-persons/:salesPersonId/orders',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getSalesPersonOrders
);

// Debug endpoint - check for sales persons
accountsRouter.get(
  '/debug/check-sales-persons',
  authorizeRoles('Superadmin', 'Admin', 'Accounts', 'Unit Head'),
  debugCheckSalesPersons
);

// ==================== NEW SALESMAN MODULE ROUTES ====================

// Get daily settlement stats
accountsRouter.get(
  '/sales-persons/daily-settlement/stats',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getSalesmanDailyStats
);

// Create daily settlement
accountsRouter.post(
  '/sales-persons/daily-settlement',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  createDailySettlement
);

// Get ledger for a specific salesman
accountsRouter.get(
  '/sales-persons/:id/ledger',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getSalesmanLedger
);

// Commission calculation
accountsRouter.post(
  '/sales-persons/commission/calculate',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  calculateCommission
);

// Post commission to ledger
accountsRouter.post(
  '/sales-persons/commission/post',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  postCommissionToLedger
);

// ==================== DAMAGE & EXPIRY MANAGEMENT ====================

// Get all damage and expiry items for the company
accountsRouter.get(
  '/damage-expiry',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getDamageExpiryList
);

// Get specific damage/expiry item details
accountsRouter.get(
  '/damage-expiry/:id',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getDamageExpiryDetail
);

// ==================== PURCHASES MANAGEMENT ====================

// Get inventory items for purchases (only Material, Spares, Assemblies - NOT Product)
// Available for: Unit Manager, Unit Head, Super Admin, Admin, Accounts
accountsRouter.get(
  '/purchases/items',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  getPurchaseItems
);

import {
  createPurchaseInvoice,
  getPurchaseInvoices,
  createVendorPayment,
  getVendorOutstanding,
  createPurchaseReturn,
  getPurchaseReturns,
  getPurchaseReturnById,
  updatePurchaseReturn,
  getPurchaseSummary,
  getPaymentStats,
  getVendorPurchasedItems,
  getSuppliersForAccounts
} from '../controllers/purchaseInvoiceController.js';

accountsRouter.post('/purchases/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createPurchaseInvoice);
accountsRouter.get('/purchases/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchaseInvoices);
accountsRouter.post('/purchases/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createVendorPayment);
accountsRouter.get('/purchases/outstanding', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getVendorOutstanding);
accountsRouter.get('/purchases/payments/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPaymentStats);

// Purchase Orders
accountsRouter.post('/purchases/orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createPurchase);
accountsRouter.get('/purchases/orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchases);
accountsRouter.get('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchaseById);
accountsRouter.put('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), updatePurchase);
accountsRouter.delete('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), deletePurchase);
accountsRouter.post('/purchases/orders/:id/receive', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), receivePurchase);
accountsRouter.post('/purchases/orders/:id/send-email', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), sendPOToVendor);

// Purchase Returns
accountsRouter.post('/purchases/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createPurchaseReturn);
accountsRouter.get('/purchases/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchaseReturns);
accountsRouter.get('/purchases/returns/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchaseReturnById);
accountsRouter.put('/purchases/returns/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), updatePurchaseReturn);
accountsRouter.get('/purchases/vendor-items', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getVendorPurchasedItems);
accountsRouter.get('/purchases/vendors', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getSuppliersForAccounts);

// Purchase Reports
accountsRouter.get('/purchases/reports/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPurchaseSummary);

// ==================== SALES ACCOUNTING (NEW MODULE) ====================
// Sales Invoices
accountsRouter.post('/sales/account/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createSalesInvoice);
accountsRouter.get('/sales/account/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), getSalesInvoices);
accountsRouter.get('/sales/account/items', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getSalesItems);
accountsRouter.get('/sales/account/pending-orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPendingAccountOrders);
accountsRouter.post('/sales/account/approve-order', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), approveOrderAccount);
accountsRouter.post('/sales/account/reject-order', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), rejectOrderAccount);
accountsRouter.get('/sales/account/invoices/:id/pdf', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), downloadInvoicePDF);

// Customer Payments (Receipts)
accountsRouter.post('/sales/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createCustomerPayment);
accountsRouter.get('/sales/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getCustomerPayments);
accountsRouter.get('/sales/payment/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getCustomerPaymentStats);

// Receivables & Reports
accountsRouter.get('/sales/receivables/ageing', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getReceivableAgeing);
accountsRouter.get('/sales/reports/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getSalesSummary);
accountsRouter.get('/sales/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getSalesSummary);

// Tax Reporting
accountsRouter.get('/tax/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager', 'Admin'), getTaxSummary);

// ==================== BANK & CASH MANAGEMENT ====================
accountsRouter.get('/bank-cash/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getBankCashSummary);
accountsRouter.put('/bank-cash/reconcile/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), reconcileTransaction);
accountsRouter.get('/transactions', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getTransactions);
accountsRouter.post('/transactions/general', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createGeneralTransaction);
accountsRouter.get('/ledger', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getLedgerRecords);

// Account Management (Chart of Accounts)
accountsRouter.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getAccounts);
accountsRouter.post('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createAccount);
accountsRouter.get('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getAccountById);
accountsRouter.put('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), updateAccount);
accountsRouter.delete('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), deleteAccount);


// ==================== SALES RETURNS & DAMAGES (Accounts Role) ====================
accountsRouter.get('/sales/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), getSalesReturnsList);
accountsRouter.get('/sales/damages', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), getSalesDamagesList);

// DEBUG endpoint - remove after fixing
accountsRouter.get('/debug/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), debugReturnCollection);
accountsRouter.get('/debug/user-and-returns', debugUserAndReturns);
accountsRouter.get('/debug/show-all-returns', debugShowAllReturns);

// Partner Management
accountsRouter.get('/partners', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), getPartnersList);
accountsRouter.post('/partners', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), createPartnerEntry);
accountsRouter.put('/partners/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), updatePartnerEntry);
accountsRouter.delete('/partners/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), deletePartnerEntry);

export default accountsRouter;
