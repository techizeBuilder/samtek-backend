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
  getLedgerRecords
} from '../controllers/accountsController.js';
import {
  createSalesInvoice,
  getSalesInvoices,
  getReceivableAgeing,
  getSalesSummary,
  getSalesItems
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

import { getPurchaseItems } from '../controllers/purchaseController.js';

const accountsRouter = express.Router();

// Apply authentication to all accounts routes
accountsRouter.use(authenticateToken);

// Sales Invoices - Get all invoices for the company
// Can be used by: Unit Manager, Unit Head, Sales Person, Super Admin, Admin, Accounts
accountsRouter.get(
  '/sales/invoices',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Super Admin', 'Admin', 'Accounts'),
  getCompanySalesInvoices
);

// Get detailed invoice information
accountsRouter.get(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Super Admin', 'Admin', 'Accounts'),
  getInvoiceDetail
);

// Update invoice payment status or details
accountsRouter.put(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  updateInvoice
);

// Get sales analytics
accountsRouter.get(
  '/sales/analytics',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Super Admin', 'Admin', 'Accounts'),
  getSalesAnalytics
);

// ==================== SALES PERSONS MANAGEMENT ====================

// Get all sales persons for the company
accountsRouter.get(
  '/sales-persons',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getAllSalesPersons
);

// Get specific sales person details
accountsRouter.get(
  '/sales-persons/:salesPersonId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getSalesPersonById
);

// Get all orders for a specific sales person
accountsRouter.get(
  '/sales-persons/:salesPersonId/orders',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getSalesPersonOrders
);

// Debug endpoint - check for sales persons
accountsRouter.get(
  '/debug/check-sales-persons',
  authorizeRoles('Super Admin', 'Admin', 'Accounts', 'Unit Head'),
  debugCheckSalesPersons
);

// ==================== NEW SALESMAN MODULE ROUTES ====================

// Get daily settlement stats
accountsRouter.get(
  '/sales-persons/daily-settlement/stats',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getSalesmanDailyStats
);

// Create daily settlement
accountsRouter.post(
  '/sales-persons/daily-settlement',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  createDailySettlement
);

// Get ledger for a specific salesman
accountsRouter.get(
  '/sales-persons/:id/ledger',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getSalesmanLedger
);

// Commission calculation
accountsRouter.post(
  '/sales-persons/commission/calculate',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  calculateCommission
);

// Post commission to ledger
accountsRouter.post(
  '/sales-persons/commission/post',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  postCommissionToLedger
);

// ==================== DAMAGE & EXPIRY MANAGEMENT ====================

// Get all damage and expiry items for the company
accountsRouter.get(
  '/damage-expiry',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getDamageExpiryList
);

// Get specific damage/expiry item details
accountsRouter.get(
  '/damage-expiry/:id',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
  getDamageExpiryDetail
);

// ==================== PURCHASES MANAGEMENT ====================

// Get inventory items for purchases (only Material, Spares, Assemblies - NOT Product)
// Available for: Unit Manager, Unit Head, Super Admin, Admin, Accounts
accountsRouter.get(
  '/purchases/items',
  authorizeRoles('Unit Manager', 'Unit Head', 'Super Admin', 'Admin', 'Accounts'),
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

accountsRouter.post('/purchases/invoices', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createPurchaseInvoice);
accountsRouter.get('/purchases/invoices', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getPurchaseInvoices);
accountsRouter.post('/purchases/payments', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createVendorPayment);
accountsRouter.get('/purchases/outstanding', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getVendorOutstanding);
accountsRouter.get('/purchases/payments/stats', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getPaymentStats);

// Purchase Returns
accountsRouter.post('/purchases/returns', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createPurchaseReturn);
accountsRouter.get('/purchases/returns', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getPurchaseReturns);
accountsRouter.get('/purchases/returns/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getPurchaseReturnById);
accountsRouter.put('/purchases/returns/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), updatePurchaseReturn);
accountsRouter.get('/purchases/vendor-items', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getVendorPurchasedItems);
accountsRouter.get('/purchases/vendors', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getSuppliersForAccounts);

// Purchase Reports
accountsRouter.get('/purchases/reports/summary', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getPurchaseSummary);

// ==================== SALES ACCOUNTING (NEW MODULE) ====================
// Sales Invoices
accountsRouter.post('/sales/account/invoices', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createSalesInvoice);
accountsRouter.get('/sales/account/invoices', authorizeRoles('Accounts', 'Super Admin', 'Unit Head', 'Sales Person'), getSalesInvoices);
accountsRouter.get('/sales/account/items', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getSalesItems);

// Customer Payments (Receipts)
accountsRouter.post('/sales/payments', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createCustomerPayment);
accountsRouter.get('/sales/payments', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getCustomerPayments);
accountsRouter.get('/sales/payment/stats', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getCustomerPaymentStats);

// Receivables & Reports
accountsRouter.get('/sales/receivables/ageing', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getReceivableAgeing);
accountsRouter.get('/sales/reports/summary', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getSalesSummary);
accountsRouter.get('/sales/summary', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getSalesSummary);

// Tax Reporting
accountsRouter.get('/tax/summary', authorizeRoles('Accounts', 'Super Admin', 'Unit Head', 'Unit Manager', 'Admin'), getTaxSummary);

// ==================== BANK & CASH MANAGEMENT ====================
accountsRouter.get('/bank-cash/summary', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getBankCashSummary);
accountsRouter.put('/bank-cash/reconcile/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), reconcileTransaction);
accountsRouter.get('/transactions', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getTransactions);
accountsRouter.post('/transactions/general', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createGeneralTransaction);
accountsRouter.get('/ledger', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getLedgerRecords);

// Account Management (Chart of Accounts)
accountsRouter.get('/', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getAccounts);
accountsRouter.post('/', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), createAccount);
accountsRouter.get('/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), getAccountById);
accountsRouter.put('/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), updateAccount);
accountsRouter.delete('/:id', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), deleteAccount);


// ==================== SALES RETURNS & DAMAGES (Accounts Role) ====================
accountsRouter.get('/sales/returns', authorizeRoles('Accounts', 'Super Admin', 'Unit Head', 'Unit Manager'), getSalesReturnsList);
accountsRouter.get('/sales/damages', authorizeRoles('Accounts', 'Super Admin', 'Unit Head', 'Unit Manager'), getSalesDamagesList);

// DEBUG endpoint - remove after fixing
accountsRouter.get('/debug/returns', authorizeRoles('Accounts', 'Super Admin', 'Unit Head'), debugReturnCollection);
accountsRouter.get('/debug/user-and-returns', debugUserAndReturns);
accountsRouter.get('/debug/show-all-returns', debugShowAllReturns);

export default accountsRouter;
