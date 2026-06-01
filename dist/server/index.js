"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
// Import environment configuration
const environment_js_1 = require("./config/environment.js");
// Removed cookieParser - using JWT Bearer tokens only
// Main entry point - Trigger restart - Force picked up HR-Admin role - PurchaseInvoice async pre-save fix
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
// Utility for logging
function log(message, type = "log") {
    const timestamp = new Date().toLocaleTimeString();
    if (type === "error") {
        console.error(`[${timestamp}] ERROR: ${message}`);
    }
    else {
        console.log(`[${timestamp}] ${message}`);
    }
}
// Import ES modules
const database_js_1 = __importDefault(require("./config/database.js"));
const profileUpdate_routes_js_1 = __importDefault(require("./routes/profileUpdate.routes.js"));
const app = (0, express_1.default)();
// Basic middleware - JSON parsing will be handled by API router
app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse = undefined;
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
            let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
            if (capturedJsonResponse) {
                logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
            }
            if (logLine.length > 80) {
                logLine = logLine.slice(0, 79) + "…";
            }
            log(logLine);
        }
    });
    next();
});
// Add body parsing and static file serving
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Serve static files from uploads directory (for company logos and other uploads)
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Connect to MongoDB
        yield (0, database_js_1.default)();
        // Import all models to ensure they're registered with mongoose
        console.log('🔄 Registering models...');
        const User = (yield Promise.resolve().then(() => __importStar(require('./models/User.js')))).default;
        const { Item } = yield Promise.resolve().then(() => __importStar(require('./models/Inventory.js')));
        const ProductionGroup = (yield Promise.resolve().then(() => __importStar(require('./models/ProductionGroup.js')))).default;
        const ProductionOrder = (yield Promise.resolve().then(() => __importStar(require('./models/ProductionOrder.js')))).default;
        const ProductionTeam = (yield Promise.resolve().then(() => __importStar(require('./models/ProductionTeam.js')))).default;
        const RDMachine = (yield Promise.resolve().then(() => __importStar(require('./models/RDMachine.js')))).default;
        const RDBOM = (yield Promise.resolve().then(() => __importStar(require('./models/RDBOM.js')))).default;
        const RDPrototype = (yield Promise.resolve().then(() => __importStar(require('./models/RDPrototype.js')))).default;
        const RDChangeRequest = (yield Promise.resolve().then(() => __importStar(require('./models/RDChangeRequest.js')))).default;
        const RDToolProcess = (yield Promise.resolve().then(() => __importStar(require('./models/RDToolProcess.js')))).default;
        const RDQualityParam = (yield Promise.resolve().then(() => __importStar(require('./models/RDQualityParam.js')))).default;
        const RDDocument = (yield Promise.resolve().then(() => __importStar(require('./models/RDDocument.js')))).default;
        const PackagingJob = (yield Promise.resolve().then(() => __importStar(require('./models/PackagingJob.js')))).default;
        const DispatchOrder = (yield Promise.resolve().then(() => __importStar(require('./models/DispatchOrder.js')))).default;
        const QCJob = (yield Promise.resolve().then(() => __importStar(require('./models/QCJob.js')))).default;
        const MarketingAsset = (yield Promise.resolve().then(() => __importStar(require('./models/MarketingAsset.js')))).default;
        const MarketingCategory = (yield Promise.resolve().then(() => __importStar(require('./models/MarketingCategory.js')))).default;
        const MarketingShareLog = (yield Promise.resolve().then(() => __importStar(require('./models/MarketingShareLog.js')))).default;
        const Order = (yield Promise.resolve().then(() => __importStar(require('./models/Order.js')))).default;
        const Customer = (yield Promise.resolve().then(() => __importStar(require('./models/Customer.js')))).default;
        const Sale = (yield Promise.resolve().then(() => __importStar(require('./models/Sale.js')))).default;
        const Lead = (yield Promise.resolve().then(() => __importStar(require('./models/Lead.js')))).default;
        const LeadPayment = (yield Promise.resolve().then(() => __importStar(require('./models/LeadPayment.js')))).default;
        const BankAccount = (yield Promise.resolve().then(() => __importStar(require('./models/BankAccount.js')))).default;
        const LedgerEntry = (yield Promise.resolve().then(() => __importStar(require('./models/LedgerEntry.js')))).default;
        console.log('✅ Models registered:', {
            User: !!User,
            Item: !!Item,
            ProductionGroup: !!ProductionGroup,
            Order: !!Order,
            Customer: !!Customer,
            Sale: !!Sale,
            Lead: !!Lead
        });
        // Create seed users after database connection
        // await createSeedUsers();
        // Seed inventory data
        // await seedInventoryData();
        // Seed company data
        // const { seedCompanyData } = await import('./seed/seedCompanies.js');
        // await seedCompanyData();
        // Create HTTP server first
        const server = (0, http_1.createServer)(app);
        // STEP 1: Add middleware
        app.use((0, cors_1.default)({
            origin: environment_js_1.config.CORS_ORIGINS,
            credentials: true
        }));
        // Serve test file for debugging
        app.get('/test-profile', (req, res) => {
            res.sendFile(path_1.default.join(process.cwd(), 'test-profile.html'));
        });
        // Fix Sales permissions endpoint (development only - no auth required)
        app.get('/api/fix-sales-permissions', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const User = (yield Promise.resolve().then(() => __importStar(require('./models/User.js')))).default;
                const result = yield User.updateMany({ role: 'Sales' }, {
                    $set: {
                        'permissions.modules': [
                            {
                                name: 'sales',
                                dashboard: true,
                                features: [
                                    { key: 'salesDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                                    { key: 'orders', view: true, add: true, edit: true, delete: true, alter: true },
                                    { key: 'myCustomers', view: true, add: true, edit: true, delete: true, alter: true },
                                    { key: 'myDeliveries', view: true, add: false, edit: false, delete: false, alter: false },
                                    { key: 'myInvoices', view: true, add: false, edit: false, delete: false, alter: false },
                                    { key: 'refundReturn', view: true, add: true, edit: true, delete: true, alter: true }
                                ]
                            },
                            {
                                name: 'inventory',
                                dashboard: false,
                                features: [
                                    { key: 'items', view: true, add: false, edit: false, delete: false, alter: false }
                                ]
                            }
                        ]
                    }
                });
                res.json({
                    success: true,
                    message: 'Sales permissions updated successfully',
                    result
                });
            }
            catch (error) {
                console.error('Error fixing sales permissions:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error fixing sales permissions',
                    error: error.message
                });
            }
        }));
        // Fix Production permissions endpoint (development only - no auth required)
        app.get('/api/fix-production-permissions', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { updateUsersWithProductionPermissions, migrateOldProductionPermissions } = yield Promise.resolve().then(() => __importStar(require('./utils/updateProductionPermissions.js')));
                // First migrate old permissions
                const migrationResult = yield migrateOldProductionPermissions();
                // Then add production permissions to users who don't have them
                const updateResult = yield updateUsersWithProductionPermissions();
                res.json({
                    success: true,
                    message: 'Production permissions updated successfully',
                    migration: migrationResult,
                    update: updateResult
                });
            }
            catch (error) {
                console.error('Error fixing production permissions:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error fixing production permissions',
                    error: error.message
                });
            }
        }));
        // STEP 2: Register API routes DIRECTLY
        try {
            // Complaint and Service routes
            const complaintRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/complaintServiceRoutes.js')))).default;
            app.use('/api/complaints', complaintRoutes);
            console.log('Complaint and Service routes registered at /api/complaints');
            // training management routes
            const trainingRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/trainingManagementRoutes.js')))).default;
            app.use('/api/training', trainingRoutes);
            console.log('Training Management routes registered at /api/training');
            const authRoutes = (yield Promise.resolve().then(() => __importStar(require('./auth-routes.js')))).default;
            app.use('/api', authRoutes);
            // Seed routes MUST be registered before profileRoutes (which has global auth middleware)
            app.post('/api/seed-rd-production', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedRDProduction } = yield Promise.resolve().then(() => __importStar(require('./seed/seedRDProduction.js')));
                    const result = yield seedRDProduction();
                    res.json(result);
                }
                catch (error) {
                    console.error('Error seeding RD/Production data:', error);
                    res.status(500).json({ success: false, message: 'Error seeding data', error: error.message });
                }
            }));
            app.post('/api/seed-qc-user', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedQCUser } = yield Promise.resolve().then(() => __importStar(require('./seed/seedQCUser.js')));
                    const result = yield seedQCUser();
                    res.json(result);
                }
                catch (error) {
                    res.status(500).json({ success: false, message: error.message });
                }
            }));
            app.post('/api/seed-packaging-dispatch', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedPackagingDispatch } = yield Promise.resolve().then(() => __importStar(require('./seed/seedPackagingDispatch.js')));
                    const result = yield seedPackagingDispatch();
                    res.json(result);
                }
                catch (error) {
                    console.error('Error seeding Packaging/Dispatch data:', error);
                    res.status(500).json({ success: false, message: 'Error seeding data', error: error.message });
                }
            }));
            const profileRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/profileRoutes.js')))).default;
            app.use('/api', profileRoutes);
            const inventoryRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/inventoryRoutes.js')))).default;
            app.use('/api', inventoryRoutes);
            const customerRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/customerRoutes.js')))).default;
            app.use('/api', customerRoutes);
            const supplierRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/supplierRoutes.js')))).default;
            app.use('/api', supplierRoutes);
            const companyRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/companyRoutes.js')))).default;
            app.use('/api/companies', companyRoutes);
            console.log('Company routes registered at /api/companies');
            const { default: orderRoutes } = yield Promise.resolve().then(() => __importStar(require('./routes/orderRoutes.js')));
            const salesRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/salesRoutes.js')))).default;
            const accountsRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/accountsRoutes.js')))).default;
            const expenseRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/expenseRoutes.js')))).default;
            const financeRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/financeRoutes.js')))).default;
            app.use('/api/orders', orderRoutes);
            app.use('/api/sales', salesRouter);
            app.use('/api/accounts', accountsRouter);
            app.use('/api/expenses', expenseRouter);
            app.use('/api/finance', financeRouter);
            const leadRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/leadRoutes.js')))).default;
            app.use('/api/leads', leadRouter);
            console.log('Lead routes registered at /api/leads');
            // Lead Payment routes
            const leadPaymentRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/leadPaymentRoutes.js')))).default;
            app.use('/api/lead-payments', leadPaymentRouter);
            console.log('Lead Payment routes registered at /api/lead-payments');
            // Payment Reminder routes
            const paymentReminderRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/paymentReminder.routes.js')))).default;
            app.use('/api/accounts/payment-reminders', paymentReminderRouter);
            console.log('Payment Reminder routes registered at /api/accounts/payment-reminders');
            console.log('Order routes registered at /api/orders');
            console.log('Sales routes registered at /api/sales');
            console.log('Accounts routes registered at /api/accounts');
            console.log('Expense routes registered at /api/expenses');
            console.log('Finance routes registered at /api/finance');
            const returnRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/returnRoutes.js')))).default;
            app.use('/api/returns', returnRoutes);
            console.log('Return routes registered at /api/returns');
            const purchaseRequestRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/purchaseRequestRoutes.js')))).default;
            app.use('/api/purchase-requests', purchaseRequestRoutes);
            console.log('Purchase Request routes registered at /api/purchase-requests');
            const dashboardRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/dashboardRoutes.js')))).default;
            app.use('/api/dashboard', dashboardRoutes);
            console.log('Dashboard routes registered at /api/dashboard');
            const notificationRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/notificationRoutes.js')))).default;
            app.use('/api', notificationRoutes);
            console.log('Notification routes registered at /api');
            const unitManagerRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/unitManagerRoutes.js')))).default;
            app.use('/api/unit-manager', unitManagerRoutes);
            console.log('Unit Manager routes registered at /api/unit-manager');
            // Sales diagnostic routes for troubleshooting
            const salesDiagnosticRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/salesDiagnosticRoutes.js')))).default;
            app.use('/api/sales-diagnostic', salesDiagnosticRoutes);
            console.log('Sales Diagnostic routes registered at /api/sales-diagnostic');
            const unitHeadRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/unitHeadRoutes.js')))).default;
            app.use('/api/unit-head', unitHeadRoutes);
            console.log('Unit Head routes registered at /api/unit-head');
            const superAdminRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/superAdminRoutes.js')))).default;
            app.use('/api/super-admin', superAdminRoutes);
            console.log('Super Admin routes registered at /api/super-admin');
            const adminRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/adminRoutes.js')))).default;
            app.use('/api/admin', adminRoutes);
            console.log('Admin routes registered at /api/admin');
            // Production routes (batch/shift - existing)
            const productionRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/productionRoutes.js')))).default;
            app.use('/api/production', productionRoutes);
            console.log('Production routes registered at /api/production');
            // Production Manufacturing routes (machine mfg orders, teams, job cards)
            const productionMfgRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/productionMfgRoutes.js')))).default;
            app.use('/api/production-mfg', productionMfgRoutes);
            console.log('Production Mfg routes registered at /api/production-mfg');
            // R&D routes
            const rdRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/rdRoutes.js')))).default;
            app.use('/api/rd', rdRoutes);
            console.log('R&D routes registered at /api/rd');
            // Packaging & Dispatch routes
            const packagingDispatchRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/packagingDispatchRoutes.js')))).default;
            app.use('/api/packaging-dispatch', packagingDispatchRoutes);
            console.log('Packaging & Dispatch routes registered at /api/packaging-dispatch');
            // Quality Control routes
            const qcRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/qcRoutes.js')))).default;
            app.use('/api/qc', qcRoutes);
            console.log('Quality Control routes registered at /api/qc');
            // Marketing routes
            const marketingRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/marketingRoutes.js')))).default;
            app.use('/api/marketing', marketingRoutes);
            console.log('Marketing routes registered at /api/marketing');
            // Packing routes
            const packingRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/packingRoutes.js')))).default;
            app.use('/api/packing', packingRoutes);
            console.log('Packing routes registered at /api/packing');
            // HRMS Routes
            const attendanceRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/attendance.routes.js')))).default;
            const holidayRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/holiday.routes.js')))).default;
            const payrollRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/payroll.routes.js')))).default;
            const payslipRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/payslip.routes.js')))).default;
            const jobOpeningRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/jobOpening.routes.js')))).default;
            const candidateRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/candidate.routes.js')))).default;
            const salaryStructureRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/salaryStrctureRoute.js')))).default;
            const hrPolicyRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/hrPolicy.routes.js')))).default;
            const leaveRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/leave.routes.js')))).default;
            const leaveTypeRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/leaveTypesRoutes.js')))).default;
            const branchRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/branch.routes.js')))).default;
            const departmentRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/department.routes.js')))).default;
            const designationRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/designation.routes.js')))).default;
            const statutoryReportRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/statutoryReport.routes.js')))).default;
            const hrmsDashboardRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/hrmsDashboard.routes.js')))).default;
            const leaveBalanceAdjustmentRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/leaveBalanceAdjustment.routes.js')))).default;
            const performanceRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/performance.routes.js')))).default;
            app.use('/api/attendance', attendanceRouter);
            app.use('/api/holidays', holidayRouter);
            app.use('/api/payroll', payrollRouter);
            app.use('/api/payslips', payslipRouter);
            app.use('/api/job-openings', jobOpeningRouter);
            app.use('/api/candidates', candidateRouter);
            app.use('/api/salary-structures', salaryStructureRouter);
            app.use('/api/hr-policies', hrPolicyRouter);
            app.use('/api/leaves', leaveRouter);
            app.use('/api/leave-types', leaveTypeRouter);
            app.use('/api/branches', branchRouter);
            app.use('/api/departments', departmentRouter);
            app.use('/api/designations', designationRouter);
            app.use('/api/statutory-reports', statutoryReportRouter);
            app.use('/api/hrms-dashboard', hrmsDashboardRouter);
            app.use('/api/leave-balance-adjustments', leaveBalanceAdjustmentRouter);
            app.use('/api/performance', performanceRouter);
            const travelRequestRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/travelRequest.routes.js')))).default;
            const attendanceRequestRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/attendanceRequest.routes.js')))).default;
            const expenseRequestRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/expenseRequest.routes.js')))).default;
            const overtimeRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/overtime.routes.js')))).default;
            const resignationRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/resignation.routes.js')))).default;
            const documentRouter = (yield Promise.resolve().then(() => __importStar(require('./routes/document.routes.js')))).default;
            app.use('/api/travel-requests', travelRequestRouter);
            app.use('/api/attendance-requests', attendanceRequestRouter);
            app.use('/api/expense-requests', expenseRequestRouter);
            app.use('/api/profile-updates', profileUpdate_routes_js_1.default);
            app.use('/api/overtime', overtimeRouter);
            app.use('/api/resignation', resignationRouter);
            app.use('/api/documents', documentRouter);
            console.log('HRMS routes registered (including documents)');
            // Dispatch routes
            const dispatchRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/dispatchRoutes.js')))).default;
            app.use('/api/dispatches', dispatchRoutes);
            console.log('Dispatch routes registered at /api/dispatches');
            // Hrms routes
            const hrmsTaskManagementRoutes = (yield Promise.resolve().then(() => __importStar(require('./routes/hrmsTaskManagementRoutes.js')))).default;
            app.use('/api/hrms/tasks', hrmsTaskManagementRoutes);
            console.log('HRMS Task Management routes registered at /api/hrms/tasks');
            // Add direct routes for specific endpoints
            const { authenticateToken } = yield Promise.resolve().then(() => __importStar(require('./middleware/auth.js')));
            const { getAllOrders } = yield Promise.resolve().then(() => __importStar(require('./controllers/unitManagerController.js')));
            const { getUnitHeadOrders } = yield Promise.resolve().then(() => __importStar(require('./controllers/unitHeadController.js')));
            // Direct route for sales-order-list (bypasses /api/unit-manager prefix)
            app.get('/sales-order-list', authenticateToken, getAllOrders);
            console.log('Direct sales-order-list route registered');
            // Direct route for unit-head/orders (bypasses /api/unit-head prefix)
            app.get('/unit-head/orders', authenticateToken, getUnitHeadOrders);
            console.log('Direct unit-head/orders route registered');
            // Customer seeding available via endpoint only
            // Seed routes without authentication (development only)
            app.get('/api/seed-customers-now', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedCustomersDirectly } = yield Promise.resolve().then(() => __importStar(require('./utils/seedCustomersDirect.js')));
                    const result = yield seedCustomersDirectly();
                    res.json(result);
                }
                catch (error) {
                    console.error('Error seeding customers:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Error seeding customers',
                        error: error.message
                    });
                }
            }));
            app.post('/api/seed/seed-customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedCustomersDirectly } = yield Promise.resolve().then(() => __importStar(require('./utils/seedCustomersDirect.js')));
                    const result = yield seedCustomersDirectly();
                    res.json(result);
                }
                catch (error) {
                    console.error('Error seeding customers:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Error seeding customers',
                        error: error.message
                    });
                }
            }));
            // Seed bank accounts endpoint (development only)
            app.post('/api/seed-bank-accounts', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const BankAccount = (yield Promise.resolve().then(() => __importStar(require('./models/BankAccount.js')))).default;
                    const User = (yield Promise.resolve().then(() => __importStar(require('./models/User.js')))).default;
                    // Get first admin user for createdBy field
                    const adminUser = yield User.findOne({ role: { $in: ['Super Admin', 'Accounts', 'Manager'] } });
                    if (!adminUser) {
                        return res.status(400).json({ success: false, message: 'No admin user found' });
                    }
                    // Clear existing bank accounts
                    yield BankAccount.deleteMany({});
                    console.log('Cleared existing bank accounts');
                    // Sample bank accounts
                    const sampleBankAccounts = [
                        {
                            accountName: 'Samtek Business Current Account',
                            accountNumber: '1234567890123456',
                            bankName: 'State Bank of India',
                            branchName: 'Commercial Street Branch',
                            ifscCode: 'SBIN0001234',
                            accountType: 'Current',
                            openingBalance: 500000,
                            currentBalance: 750000,
                            companyId: adminUser.companyId,
                            createdBy: adminUser._id
                        },
                        {
                            accountName: 'Samtek Savings Account',
                            accountNumber: '9876543210987654',
                            bankName: 'HDFC Bank',
                            branchName: 'Business Park Branch',
                            ifscCode: 'HDFC0001234',
                            accountType: 'Savings',
                            openingBalance: 200000,
                            currentBalance: 350000,
                            companyId: adminUser.companyId,
                            createdBy: adminUser._id
                        },
                        {
                            accountName: 'Cash in Hand',
                            accountNumber: 'CASH001',
                            bankName: 'Cash Account',
                            branchName: 'Office',
                            ifscCode: 'CASH001',
                            accountType: 'Cash',
                            openingBalance: 50000,
                            currentBalance: 75000,
                            companyId: adminUser.companyId,
                            createdBy: adminUser._id
                        },
                        {
                            accountName: 'ICICI Business Account',
                            accountNumber: '5555666677778888',
                            bankName: 'ICICI Bank',
                            branchName: 'Industrial Area Branch',
                            ifscCode: 'ICIC0001234',
                            accountType: 'Current',
                            openingBalance: 300000,
                            currentBalance: 450000,
                            companyId: adminUser.companyId,
                            createdBy: adminUser._id
                        }
                    ];
                    const insertedAccounts = yield BankAccount.insertMany(sampleBankAccounts);
                    console.log(`Successfully seeded ${insertedAccounts.length} bank accounts`);
                    res.json({
                        success: true,
                        message: `Successfully seeded ${insertedAccounts.length} bank accounts`,
                        accounts: insertedAccounts
                    });
                }
                catch (error) {
                    console.error('Error seeding bank accounts:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Error seeding bank accounts',
                        error: error.message
                    });
                }
            }));
            // Seed orders route (no auth required for development)
            app.post('/api/seed-orders', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const { seedOrdersData } = yield Promise.resolve().then(() => __importStar(require('./seed/seedOrders.js')));
                    const result = yield seedOrdersData();
                    res.json(result);
                }
                catch (error) {
                    console.error('Error seeding orders:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Error seeding orders',
                        error: error.message
                    });
                }
            }));
            // Alternative direct seeding route
            app.post('/api/direct-seed-customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const Customer = (yield Promise.resolve().then(() => __importStar(require('./models/Customer.js')))).default;
                    // Clear existing customers
                    yield Customer.deleteMany({});
                    console.log('Cleared existing customers');
                    // Complete 15 dummy customers
                    const sampleCustomers = [
                        { name: 'Kolkata Retail Ltd', contactPerson: 'Subrata Chatterjee', designation: 'Purchase Manager', category: 'Distributor', categoryNote: 'Main distributor for eastern region', active: 'Yes', mobile: '9876789012', email: 'subrata@kolkataretail.com', gstin: '19ABCDE1234F1Z5', address1: '123 Park Street, Central Kolkata', googlePin: 'https://goo.gl/maps/abc123', city: 'Kolkata', state: 'West Bengal', country: 'India', pin: '700001', salesContact: 'sales1' },
                        { name: 'Chennai Manufacturing Co', contactPerson: 'Ravi Kumar', designation: 'Operations Head', category: 'Retailer', categoryNote: 'Large scale retailer in Tamil Nadu', active: 'Yes', mobile: '9876512345', email: 'ravi@chennaimanuf.com', gstin: '33FGHIJ5678G2A6', address1: '456 Anna Salai, T Nagar', googlePin: 'https://goo.gl/maps/def456', city: 'Chennai', state: 'Tamil Nadu', country: 'India', pin: '600017', salesContact: 'sales2' },
                        { name: 'Technovision Systems', contactPerson: 'Amit Sharma', designation: 'Technical Director', category: 'End User', categoryNote: 'Technology solutions provider', active: 'Yes', mobile: '9988776655', email: 'amit@technovision.in', gstin: '06KLMNO9012H3B7', address1: '789 Cyber City, Sector 21', googlePin: 'https://goo.gl/maps/ghi789', city: 'Gurgaon', state: 'Haryana', country: 'India', pin: '122001', salesContact: 'sales3' },
                        { name: 'Global Export House', contactPerson: 'Sunita Patel', designation: 'Export Manager', category: 'Wholesaler', categoryNote: 'International export specialist', active: 'Yes', mobile: '9445566778', email: 'sunita@globalexport.com', gstin: '36PQRST3456I4C8', address1: '321 Export Plaza, HITEC City', googlePin: 'https://goo.gl/maps/jkl012', city: 'Hyderabad', state: 'Telangana', country: 'India', pin: '500081', salesContact: 'sales1' },
                        { name: 'Mumbai Traders Corp', contactPerson: 'Priya Mehta', designation: 'Business Head', category: 'Distributor', categoryNote: 'Leading trader in Maharashtra', active: 'Yes', mobile: '9123456789', email: 'priya@mumbaitraders.com', gstin: '27UVWXY7890J5D9', address1: '654 Commercial Street, Andheri', googlePin: 'https://goo.gl/maps/mno345', city: 'Mumbai', state: 'Maharashtra', country: 'India', pin: '400053', salesContact: 'sales2' },
                        { name: 'Delhi Electronics Hub', contactPerson: 'Rajesh Gupta', designation: 'Store Manager', category: 'Retailer', categoryNote: 'Electronics retail chain', active: 'Yes', mobile: '9876543210', email: 'rajesh@delhielectronics.com', gstin: '07ABCDE2345K6E0', address1: '987 Nehru Place, Central Delhi', googlePin: 'https://goo.gl/maps/pqr678', city: 'New Delhi', state: 'Delhi', country: 'India', pin: '110019', salesContact: 'sales3' },
                        { name: 'Bangalore Software Solutions', contactPerson: 'Meera Iyer', designation: 'Project Manager', category: 'End User', categoryNote: 'Software development company', active: 'Yes', mobile: '9988554433', email: 'meera@bangaloresoftware.com', gstin: '29FGHIJ6789L7F1', address1: '147 Brigade Road, Commercial Street', googlePin: 'https://goo.gl/maps/stu901', city: 'Bangalore', state: 'Karnataka', country: 'India', pin: '560025', salesContact: 'sales1' },
                        { name: 'Pune Auto Parts', contactPerson: 'Vikram Singh', designation: 'Purchase Officer', category: 'Wholesaler', categoryNote: 'Automotive parts wholesaler', active: 'Yes', mobile: '9876123456', email: 'vikram@puneautoparts.com', gstin: '27KLMNO4567M8G2', address1: '258 Shivaji Road, Pimpri', googlePin: 'https://goo.gl/maps/vwx234', city: 'Pune', state: 'Maharashtra', country: 'India', pin: '411018', salesContact: 'sales2' },
                        { name: 'Ahmedabad Textiles', contactPerson: 'Kiran Shah', designation: 'Production Head', category: 'Distributor', categoryNote: 'Textile manufacturing and distribution', active: 'Yes', mobile: '9445123789', email: 'kiran@ahmedabadtextiles.com', gstin: '24PQRST8901N9H3', address1: '369 Textile Market, Ashram Road', googlePin: 'https://goo.gl/maps/yzx567', city: 'Ahmedabad', state: 'Gujarat', country: 'India', pin: '380009', salesContact: 'sales3' },
                        { name: 'Jaipur Handicrafts', contactPerson: 'Pooja Agarwal', designation: 'Creative Director', category: 'Retailer', categoryNote: 'Traditional handicrafts retailer', active: 'Yes', mobile: '9887654321', email: 'pooja@jaipurhandicrafts.com', gstin: '08UVWXY5432O0I4', address1: '741 Johari Bazaar, Pink City', googlePin: 'https://goo.gl/maps/abc890', city: 'Jaipur', state: 'Rajasthan', country: 'India', pin: '302003', salesContact: 'sales1' },
                        { name: 'Cochin Spices Export', contactPerson: 'Suresh Nair', designation: 'Quality Manager', category: 'End User', categoryNote: 'Spices export business', active: 'Yes', mobile: '9876789123', email: 'suresh@cochinspices.com', gstin: '32ABCDE7890P1J5', address1: '852 Spice Market, Mattancherry', googlePin: 'https://goo.gl/maps/def123', city: 'Kochi', state: 'Kerala', country: 'India', pin: '682002', salesContact: 'sales2' },
                        { name: 'Lucknow Food Products', contactPerson: 'Anita Verma', designation: 'Operations Manager', category: 'Wholesaler', categoryNote: 'Food products wholesaler', active: 'Yes', mobile: '9123789456', email: 'anita@lucknowfood.com', gstin: '09FGHIJ3456Q2K6', address1: '963 Chowk Area, Aminabad', googlePin: 'https://goo.gl/maps/ghi456', city: 'Lucknow', state: 'Uttar Pradesh', country: 'India', pin: '226018', salesContact: 'sales3' },
                        { name: 'Chandigarh Electronics', contactPerson: 'Manpreet Kaur', designation: 'Store Owner', category: 'Distributor', categoryNote: 'Electronics distribution chain', active: 'Yes', mobile: '9988112233', email: 'manpreet@chandigarhelectronics.com', gstin: '04KLMNO6789R3L7', address1: '174 Sector 22, Industrial Area', googlePin: 'https://goo.gl/maps/jkl789', city: 'Chandigarh', state: 'Chandigarh', country: 'India', pin: '160022', salesContact: 'sales1' },
                        { name: 'Bhopal Chemical Works', contactPerson: 'Rahul Tiwari', designation: 'Plant Manager', category: 'Retailer', categoryNote: 'Chemical manufacturing unit', active: 'No', mobile: '9876543987', email: 'rahul@bhopalchemical.com', gstin: '23PQRST2345S4M8', address1: '285 Industrial Estate, Mandideep', googlePin: 'https://goo.gl/maps/mno012', city: 'Bhopal', state: 'Madhya Pradesh', country: 'India', pin: '462046', salesContact: 'sales2' },
                        { name: 'Indore Pharma Ltd', contactPerson: 'Dr. Kavita Jain', designation: 'Research Head', category: 'End User', categoryNote: 'Pharmaceutical research company', active: 'Yes', mobile: '9445667788', email: 'kavita@indorepharma.com', gstin: '23UVWXY9012T5N9', address1: '396 Pharma Park, Pithampur', googlePin: 'https://goo.gl/maps/pqr345', city: 'Indore', state: 'Madhya Pradesh', country: 'India', pin: '453661', salesContact: 'sales3' }
                    ];
                    // Insert new sample customers
                    const insertedCustomers = yield Customer.insertMany(sampleCustomers);
                    console.log(`Successfully seeded ${insertedCustomers.length} customers`);
                    res.json({
                        success: true,
                        message: `Successfully seeded ${insertedCustomers.length} customers`,
                        customers: insertedCustomers
                    });
                }
                catch (error) {
                    console.error('Error seeding customers:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Error seeding customers',
                        error: error.message
                    });
                }
            }));
            log("API routes registered successfully");
            // ─── Daily Cron Job — Payment Reminders & Overdue Detection ──────────────
            try {
                const cron = (yield Promise.resolve().then(() => __importStar(require('node-cron')))).default;
                const { runDailyReminderCron } = yield Promise.resolve().then(() => __importStar(require('./controllers/paymentReminderController.js')));
                // Runs every day at 9:00 AM
                cron.schedule('0 9 * * *', () => __awaiter(void 0, void 0, void 0, function* () {
                    console.log('⏰ [CRON] Starting daily payment reminder job...');
                    yield runDailyReminderCron();
                }));
                console.log('✅ Payment reminder cron job scheduled (daily at 9 AM)');
            }
            catch (cronError) {
                console.warn('⚠️  Cron job setup warning:', cronError.message);
            }
            try {
                const { startSLAMonitor } = yield Promise.resolve().then(() => __importStar(require('./utils/serviceSlaMonitor')));
                startSLAMonitor();
                console.log('✅ SLA monitor cron job scheduled (runs every hour)');
            }
            catch (cronError) {
                console.warn('⚠️ SLA Monitor cron job setup warning:', cronError.message);
            }
        }
        catch (error) {
            log(`Error importing routes: ${error.message}`);
            throw error;
        }
        // Setup static serving for production if needed
        // if (process.env.NODE_ENV === "production") {
        //   app.use(express.static(path.join(process.cwd(), 'dist/public')));
        // }
        log("Backend server setup complete");
        // Add catch-all for unmatched API routes
        app.use('/api', (req, res) => {
            res.status(404).json({ error: 'API endpoint not found', method: req.method, path: req.originalUrl });
        });
        // Error handling middleware (should be last)
        app.use((err, _req, res, _next) => {
            const status = err.status || err.statusCode || 500;
            const message = err.message || "Internal Server Error";
            log(`Error ${status}: ${message}`, "error");
            res.status(status).json({ message });
        });
        // ALWAYS serve the app on port from env or default 5000
        // this serves both the API and the client.
        // It is the only port that is not firewalled.
        const port = environment_js_1.config.PORT;
        server.listen(port, '0.0.0.0', () => {
            log(`Server running on port ${port} in ${environment_js_1.config.NODE_ENV} environment`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}))();
