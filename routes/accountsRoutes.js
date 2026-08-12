import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
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
  getNextInvoiceNumber,
  getReceivableAgeing,
  getSalesSummary,
  getSalesItems,
  getPendingAccountOrders,
  approveOrderAccount,
  rejectOrderAccount,
  downloadInvoicePDF,
  getPackedOrders,
  uploadPaymentProof,
  getDueBillData
} from '../controllers/salesAccountController.js';
import { paymentProofUpload } from '../middleware/paymentProofUpload.js';

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
  getPurchaseInventoryItems,
  updatePurchaseItemCost,
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  receivePurchase,
  sendPOToVendor
} from '../controllers/purchaseController.js';
import {
  getPurchaseExpenseCategories,
  createPurchaseExpense,
  getPurchaseExpenses,
  getPurchaseExpenseSummary,
  updatePurchaseExpense,
  deletePurchaseExpense
} from '../controllers/purchaseExpenseController.js';
import {
  getTenderExpenseCategories,
  createTenderExpense,
  getTenderExpenses,
  getTenderExpenseSummary,
  updateTenderExpense,
  deleteTenderExpense
} from '../controllers/tenderExpenseController.js';

const accountsRouter = express.Router();

// Apply authentication to all accounts routes
accountsRouter.use(authenticateToken);

// ==================== PERMISSION GATES (module: 'accounts') ====================
// Mapped from URL path / controller behaviour to the closest feature key in
// the authoritative catalogue (client/src/lib/roleModulesConfig.js MODULES).
const dashboardView = checkPermission('accounts', 'dashboard', 'view');

const salesView = checkPermission('accounts', 'sales', 'view');
const salesAdd = checkPermission('accounts', 'sales', 'add');
const salesEdit = checkPermission('accounts', 'sales', 'edit');

const salesmanSettlementView = checkPermission('accounts', 'salesmanSettlement', 'view');
const salesmanSettlementAdd = checkPermission('accounts', 'salesmanSettlement', 'add');
const salesmanSettlementEdit = checkPermission('accounts', 'salesmanSettlement', 'edit');

const damageAndExpiryView = checkPermission('accounts', 'damageAndExpiry', 'view');

const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesAdd = checkPermission('accounts', 'purchases', 'add');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');
const purchasesDelete = checkPermission('accounts', 'purchases', 'delete');

const gstAndTdsView = checkPermission('accounts', 'gstAndTds', 'view');

const bankAndCashView = checkPermission('accounts', 'bankAndCash', 'view');
const bankAndCashAdd = checkPermission('accounts', 'bankAndCash', 'add');
const bankAndCashEdit = checkPermission('accounts', 'bankAndCash', 'edit');

const chartOfAccountsView = checkPermission('accounts', 'chartOfAccounts', 'view');
const chartOfAccountsAdd = checkPermission('accounts', 'chartOfAccounts', 'add');
const chartOfAccountsEdit = checkPermission('accounts', 'chartOfAccounts', 'edit');
const chartOfAccountsDelete = checkPermission('accounts', 'chartOfAccounts', 'delete');

// Partner = company revenue-sharing partner (name + %), a company-config
// entity (see models/Partner.js) — not a vendor/customer — so it maps to
// the 'settings' feature rather than 'purchases'/'sales'.
const settingsView = checkPermission('accounts', 'settings', 'view');
const settingsAdd = checkPermission('accounts', 'settings', 'add');
const settingsEdit = checkPermission('accounts', 'settings', 'edit');
const settingsDelete = checkPermission('accounts', 'settings', 'delete');

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
  dashboardView,
  getAccountsDashboardData
);

// Sales Invoices - Get all invoices for the company
// Can be used by: Unit Manager, Unit Head, Sales Person, Super Admin, Admin, Accounts
accountsRouter.get(
  '/sales/invoices',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getCompanySalesInvoices
);

// Get detailed invoice information
accountsRouter.get(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getInvoiceDetail
);

// Update invoice payment status or details
accountsRouter.put(
  '/sales/invoices/:invoiceId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesEdit,
  updateInvoice
);

// Get sales analytics
accountsRouter.get(
  '/sales/analytics',
  authorizeRoles('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getSalesAnalytics
);

// ==================== SALES PERSONS MANAGEMENT ====================

// Get all sales persons for the company
accountsRouter.get(
  '/sales-persons',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getAllSalesPersons
);

// Get specific sales person details
accountsRouter.get(
  '/sales-persons/:salesPersonId',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getSalesPersonById
);

// Get all orders for a specific sales person
accountsRouter.get(
  '/sales-persons/:salesPersonId/orders',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesView,
  getSalesPersonOrders
);

// Debug endpoint - check for sales persons
accountsRouter.get(
  '/debug/check-sales-persons',
  authorizeRoles('Superadmin', 'Admin', 'Accounts', 'Unit Head'),
  salesView,
  debugCheckSalesPersons
);

// ==================== NEW SALESMAN MODULE ROUTES ====================

// Get daily settlement stats
accountsRouter.get(
  '/sales-persons/daily-settlement/stats',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesmanSettlementView,
  getSalesmanDailyStats
);

// Create daily settlement
accountsRouter.post(
  '/sales-persons/daily-settlement',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesmanSettlementAdd,
  createDailySettlement
);

// Get ledger for a specific salesman
accountsRouter.get(
  '/sales-persons/:id/ledger',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesmanSettlementView,
  getSalesmanLedger
);

// Commission calculation
accountsRouter.post(
  '/sales-persons/commission/calculate',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesmanSettlementEdit,
  calculateCommission
);

// Post commission to ledger
accountsRouter.post(
  '/sales-persons/commission/post',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  salesmanSettlementEdit,
  postCommissionToLedger
);

// ==================== DAMAGE & EXPIRY MANAGEMENT ====================

// Get all damage and expiry items for the company
accountsRouter.get(
  '/damage-expiry',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  damageAndExpiryView,
  getDamageExpiryList
);

// Get specific damage/expiry item details
accountsRouter.get(
  '/damage-expiry/:id',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  damageAndExpiryView,
  getDamageExpiryDetail
);

// ==================== PURCHASES MANAGEMENT ====================

// Get inventory items for purchases (only Material, Spares, Assemblies - NOT Product)
// Available for: Unit Manager, Unit Head, Super Admin, Admin, Accounts
accountsRouter.get(
  '/purchases/items',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  purchasesView,
  getPurchaseItems
);

// Purchase > Inventory tabs (Tools & Raw Material / Product Master / Motor Master)
// — set/update purchaseCost per item, scoped by productKind + purchase:true
accountsRouter.get(
  '/purchases/inventory',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  purchasesView,
  getPurchaseInventoryItems
);
accountsRouter.put(
  '/purchases/inventory/:id/purchase-cost',
  authorizeRoles('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'),
  purchasesEdit,
  updatePurchaseItemCost
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

accountsRouter.post('/purchases/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createPurchaseInvoice);
accountsRouter.get('/purchases/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseInvoices);
accountsRouter.post('/purchases/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createVendorPayment);
accountsRouter.get('/purchases/outstanding', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getVendorOutstanding);
accountsRouter.get('/purchases/payments/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPaymentStats);

// Purchase Orders
accountsRouter.post('/purchases/orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createPurchase);
accountsRouter.get('/purchases/orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchases);
accountsRouter.get('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseById);
accountsRouter.put('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, updatePurchase);
accountsRouter.delete('/purchases/orders/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesDelete, deletePurchase);
accountsRouter.post('/purchases/orders/:id/receive', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, receivePurchase);
accountsRouter.post('/purchases/orders/:id/send-email', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, sendPOToVendor);

// Purchase Returns
accountsRouter.post('/purchases/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createPurchaseReturn);
accountsRouter.get('/purchases/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseReturns);
accountsRouter.get('/purchases/returns/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseReturnById);
accountsRouter.put('/purchases/returns/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, updatePurchaseReturn);
accountsRouter.get('/purchases/vendor-items', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getVendorPurchasedItems);
accountsRouter.get('/purchases/vendors', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getSuppliersForAccounts);

// Purchase Reports
accountsRouter.get('/purchases/reports/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseSummary);

// Purchase Expenses (job material, tools, machines, assets, etc.)
accountsRouter.get('/purchases/expenses/categories', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseExpenseCategories);
accountsRouter.get('/purchases/expenses/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseExpenseSummary);
accountsRouter.get('/purchases/expenses', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getPurchaseExpenses);
accountsRouter.post('/purchases/expenses', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createPurchaseExpense);
accountsRouter.put('/purchases/expenses/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, updatePurchaseExpense);
accountsRouter.delete('/purchases/expenses/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesDelete, deletePurchaseExpense);

// Tender Expenses (EMD, Bank Guarantee, Tender Fee Processing) — procurement/
// tender-bidding cost tracking; no dedicated feature key exists, closest fit
// is 'purchases' (same domain as the Purchase Expenses block directly above).
accountsRouter.get('/tender-expenses/categories', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getTenderExpenseCategories);
accountsRouter.get('/tender-expenses/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getTenderExpenseSummary);
accountsRouter.get('/tender-expenses', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesView, getTenderExpenses);
accountsRouter.post('/tender-expenses', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesAdd, createTenderExpense);
accountsRouter.put('/tender-expenses/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesEdit, updateTenderExpense);
accountsRouter.delete('/tender-expenses/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchasesDelete, deleteTenderExpense);

// ==================== SALES ACCOUNTING (NEW MODULE) ====================
// Sales Invoices
accountsRouter.post('/sales/account/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAdd, createSalesInvoice);
accountsRouter.get('/sales/account/invoices', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), salesView, getSalesInvoices);
accountsRouter.get('/sales/account/invoices/next-number', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getNextInvoiceNumber);
accountsRouter.get('/sales/account/items', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getSalesItems);
accountsRouter.get('/sales/account/pending-orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getPendingAccountOrders);
accountsRouter.post('/sales/account/approve-order', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesEdit, approveOrderAccount);
accountsRouter.post('/sales/account/reject-order', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesEdit, rejectOrderAccount);
accountsRouter.get('/sales/account/invoices/:id/pdf', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), salesView, downloadInvoicePDF);

// Customer Payments (Receipts)
accountsRouter.post('/sales/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAdd, createCustomerPayment);
accountsRouter.get('/sales/payments', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getCustomerPayments);
accountsRouter.get('/sales/payment/stats', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getCustomerPaymentStats);

// Packed Orders & Payment Proof Upload
accountsRouter.get('/packed-orders', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getPackedOrders);
accountsRouter.get('/packed-orders/:jobId/due-bill', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getDueBillData);
accountsRouter.post('/sales/invoices/:saleId/payment-proof', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesEdit, paymentProofUpload.single('paymentProof'), uploadPaymentProof);

// Receivables & Reports
accountsRouter.get('/sales/receivables/ageing', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getReceivableAgeing);
accountsRouter.get('/sales/reports/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getSalesSummary);
accountsRouter.get('/sales/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, getSalesSummary);

// Tax Reporting
accountsRouter.get('/tax/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager', 'Admin'), gstAndTdsView, getTaxSummary);

// ==================== BANK & CASH MANAGEMENT ====================
accountsRouter.get('/bank-cash/summary', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), bankAndCashView, getBankCashSummary);
accountsRouter.put('/bank-cash/reconcile/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), bankAndCashEdit, reconcileTransaction);
accountsRouter.get('/transactions', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), bankAndCashView, getTransactions);
accountsRouter.post('/transactions/general', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), bankAndCashAdd, createGeneralTransaction);
accountsRouter.get('/ledger', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), bankAndCashView, getLedgerRecords);

// Account Management (Chart of Accounts)
accountsRouter.get('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), chartOfAccountsView, getAccounts);
accountsRouter.post('/', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), chartOfAccountsAdd, createAccount);
accountsRouter.get('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), chartOfAccountsView, getAccountById);
accountsRouter.put('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), chartOfAccountsEdit, updateAccount);
accountsRouter.delete('/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), chartOfAccountsDelete, deleteAccount);


// ==================== SALES RETURNS & DAMAGES (Accounts Role) ====================
accountsRouter.get('/sales/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), salesView, getSalesReturnsList);
accountsRouter.get('/sales/damages', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), damageAndExpiryView, getSalesDamagesList);

// DEBUG endpoint - remove after fixing
accountsRouter.get('/debug/returns', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesView, debugReturnCollection);
accountsRouter.get('/debug/user-and-returns', salesView, debugUserAndReturns);
accountsRouter.get('/debug/show-all-returns', salesView, debugShowAllReturns);

// Partner Management (company revenue-share partners — see note above)
accountsRouter.get('/partners', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), settingsView, getPartnersList);
accountsRouter.post('/partners', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), settingsAdd, createPartnerEntry);
accountsRouter.put('/partners/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), settingsEdit, updatePartnerEntry);
accountsRouter.delete('/partners/:id', authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), settingsDelete, deletePartnerEntry);

export default accountsRouter;
