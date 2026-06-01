"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const accountsController_js_1 = require("../controllers/accountsController.js");
const partnerController_js_1 = require("../controllers/partnerController.js");
const salesAccountController_js_1 = require("../controllers/salesAccountController.js");
const salesmanModuleController_js_1 = require("../controllers/salesmanModuleController.js");
const taxController_js_1 = require("../controllers/taxController.js");
const customerPaymentController_js_1 = require("../controllers/customerPaymentController.js");
const purchaseController_js_1 = require("../controllers/purchaseController.js");
const accountsRouter = express_1.default.Router();
// Apply authentication to all accounts routes
accountsRouter.use(auth_js_1.authenticateToken);
// Sales Invoices - Get all invoices for the company
// Can be used by: Unit Manager, Unit Head, Sales Person, Super Admin, Admin, Accounts
accountsRouter.get('/sales/invoices', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getCompanySalesInvoices);
// Get detailed invoice information
accountsRouter.get('/sales/invoices/:invoiceId', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getInvoiceDetail);
// Update invoice payment status or details
accountsRouter.put('/sales/invoices/:invoiceId', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.updateInvoice);
// Get sales analytics
accountsRouter.get('/sales/analytics', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Sales Person', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getSalesAnalytics);
// ==================== SALES PERSONS MANAGEMENT ====================
// Get all sales persons for the company
accountsRouter.get('/sales-persons', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getAllSalesPersons);
// Get specific sales person details
accountsRouter.get('/sales-persons/:salesPersonId', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getSalesPersonById);
// Get all orders for a specific sales person
accountsRouter.get('/sales-persons/:salesPersonId/orders', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getSalesPersonOrders);
// Debug endpoint - check for sales persons
accountsRouter.get('/debug/check-sales-persons', (0, auth_js_1.authorizeRoles)('Superadmin', 'Admin', 'Accounts', 'Unit Head'), accountsController_js_1.debugCheckSalesPersons);
// ==================== NEW SALESMAN MODULE ROUTES ====================
// Get daily settlement stats
accountsRouter.get('/sales-persons/daily-settlement/stats', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), salesmanModuleController_js_1.getSalesmanDailyStats);
// Create daily settlement
accountsRouter.post('/sales-persons/daily-settlement', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), salesmanModuleController_js_1.createDailySettlement);
// Get ledger for a specific salesman
accountsRouter.get('/sales-persons/:id/ledger', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), salesmanModuleController_js_1.getSalesmanLedger);
// Commission calculation
accountsRouter.post('/sales-persons/commission/calculate', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), salesmanModuleController_js_1.calculateCommission);
// Post commission to ledger
accountsRouter.post('/sales-persons/commission/post', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), salesmanModuleController_js_1.postCommissionToLedger);
// ==================== DAMAGE & EXPIRY MANAGEMENT ====================
// Get all damage and expiry items for the company
accountsRouter.get('/damage-expiry', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getDamageExpiryList);
// Get specific damage/expiry item details
accountsRouter.get('/damage-expiry/:id', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), accountsController_js_1.getDamageExpiryDetail);
// ==================== PURCHASES MANAGEMENT ====================
// Get inventory items for purchases (only Material, Spares, Assemblies - NOT Product)
// Available for: Unit Manager, Unit Head, Super Admin, Admin, Accounts
accountsRouter.get('/purchases/items', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Unit Head', 'Superadmin', 'Admin', 'Accounts', 'Accounts Head'), purchaseController_js_1.getPurchaseItems);
const purchaseInvoiceController_js_1 = require("../controllers/purchaseInvoiceController.js");
accountsRouter.post('/purchases/invoices', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.createPurchaseInvoice);
accountsRouter.get('/purchases/invoices', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getPurchaseInvoices);
accountsRouter.post('/purchases/payments', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.createVendorPayment);
accountsRouter.get('/purchases/outstanding', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getVendorOutstanding);
accountsRouter.get('/purchases/payments/stats', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getPaymentStats);
// Purchase Orders
accountsRouter.post('/purchases/orders', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.createPurchase);
accountsRouter.get('/purchases/orders', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.getPurchases);
accountsRouter.get('/purchases/orders/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.getPurchaseById);
accountsRouter.put('/purchases/orders/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.updatePurchase);
accountsRouter.delete('/purchases/orders/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.deletePurchase);
accountsRouter.post('/purchases/orders/:id/receive', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.receivePurchase);
accountsRouter.post('/purchases/orders/:id/send-email', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseController_js_1.sendPOToVendor);
// Purchase Returns
accountsRouter.post('/purchases/returns', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.createPurchaseReturn);
accountsRouter.get('/purchases/returns', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getPurchaseReturns);
accountsRouter.get('/purchases/returns/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getPurchaseReturnById);
accountsRouter.put('/purchases/returns/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.updatePurchaseReturn);
accountsRouter.get('/purchases/vendor-items', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getVendorPurchasedItems);
accountsRouter.get('/purchases/vendors', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getSuppliersForAccounts);
// Purchase Reports
accountsRouter.get('/purchases/reports/summary', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), purchaseInvoiceController_js_1.getPurchaseSummary);
// ==================== SALES ACCOUNTING (NEW MODULE) ====================
// Sales Invoices
accountsRouter.post('/sales/account/invoices', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.createSalesInvoice);
accountsRouter.get('/sales/account/invoices', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), salesAccountController_js_1.getSalesInvoices);
accountsRouter.get('/sales/account/items', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.getSalesItems);
accountsRouter.get('/sales/account/pending-orders', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.getPendingAccountOrders);
accountsRouter.post('/sales/account/approve-order', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.approveOrderAccount);
accountsRouter.post('/sales/account/reject-order', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.rejectOrderAccount);
accountsRouter.get('/sales/account/invoices/:id/pdf', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Sales Person'), salesAccountController_js_1.downloadInvoicePDF);
// Customer Payments (Receipts)
accountsRouter.post('/sales/payments', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), customerPaymentController_js_1.createCustomerPayment);
accountsRouter.get('/sales/payments', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), customerPaymentController_js_1.getCustomerPayments);
accountsRouter.get('/sales/payment/stats', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), customerPaymentController_js_1.getCustomerPaymentStats);
// Receivables & Reports
accountsRouter.get('/sales/receivables/ageing', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.getReceivableAgeing);
accountsRouter.get('/sales/reports/summary', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.getSalesSummary);
accountsRouter.get('/sales/summary', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), salesAccountController_js_1.getSalesSummary);
// Tax Reporting
accountsRouter.get('/tax/summary', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager', 'Admin'), taxController_js_1.getTaxSummary);
// ==================== BANK & CASH MANAGEMENT ====================
accountsRouter.get('/bank-cash/summary', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.getBankCashSummary);
accountsRouter.put('/bank-cash/reconcile/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.reconcileTransaction);
accountsRouter.get('/transactions', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.getTransactions);
accountsRouter.post('/transactions/general', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.createGeneralTransaction);
accountsRouter.get('/ledger', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.getLedgerRecords);
// Account Management (Chart of Accounts)
accountsRouter.get('/', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.getAccounts);
accountsRouter.post('/', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.createAccount);
accountsRouter.get('/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.getAccountById);
accountsRouter.put('/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.updateAccount);
accountsRouter.delete('/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.deleteAccount);
// ==================== SALES RETURNS & DAMAGES (Accounts Role) ====================
accountsRouter.get('/sales/returns', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), accountsController_js_1.getSalesReturnsList);
accountsRouter.get('/sales/damages', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head', 'Unit Manager'), accountsController_js_1.getSalesDamagesList);
// DEBUG endpoint - remove after fixing
accountsRouter.get('/debug/returns', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), accountsController_js_1.debugReturnCollection);
accountsRouter.get('/debug/user-and-returns', accountsController_js_1.debugUserAndReturns);
accountsRouter.get('/debug/show-all-returns', accountsController_js_1.debugShowAllReturns);
// Partner Management
accountsRouter.get('/partners', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), partnerController_js_1.getPartners);
accountsRouter.post('/partners', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), partnerController_js_1.createPartner);
accountsRouter.put('/partners/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), partnerController_js_1.updatePartner);
accountsRouter.delete('/partners/:id', (0, auth_js_1.authorizeRoles)('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head'), partnerController_js_1.deletePartner);
exports.default = accountsRouter;
