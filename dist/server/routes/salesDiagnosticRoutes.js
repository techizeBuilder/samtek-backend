"use strict";
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
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const User_js_1 = __importDefault(require("../models/User.js"));
const Order_js_1 = __importDefault(require("../models/Order.js"));
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Utility endpoint to diagnose and fix sales person order issues
router.get('/diagnose-sales-issue', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Unit Manager' && user.role !== 'Superadmin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager or Super Admin role required'
            });
        }
        console.log('🔍 DIAGNOSING SALES PERSON ORDER ISSUE...');
        // Step 1: Check the specific sales users
        const targetUsers = yield User_js_1.default.find({
            username: { $in: ['sales_jeet', 'sales_jeet01'] }
        }).lean();
        console.log('Target sales users found:', targetUsers.length);
        targetUsers.forEach(u => {
            console.log(`  ${u.username}: role=${u.role}, company=${u.companyId}, id=${u._id}`);
        });
        // Step 2: Check if they're in the same company
        const companyIds = [...new Set(targetUsers.map(u => { var _a; return (_a = u.companyId) === null || _a === void 0 ? void 0 : _a.toString(); }))];
        console.log('Unique company IDs:', companyIds);
        // Step 3: Check orders for each user
        const userOrders = {};
        for (const targetUser of targetUsers) {
            const orders = yield Order_js_1.default.find({
                salesPerson: targetUser._id
            }).populate('customer', 'name').lean();
            userOrders[targetUser.username] = {
                userId: targetUser._id,
                orderCount: orders.length,
                orders: orders.map(o => {
                    var _a;
                    return ({
                        orderCode: o.orderCode,
                        customer: (_a = o.customer) === null || _a === void 0 ? void 0 : _a.name,
                        status: o.status
                    });
                })
            };
            console.log(`${targetUser.username} has ${orders.length} orders`);
        }
        // Step 4: Check what the unit manager sees
        let unitManagerFilter = {};
        if (user.companyId) {
            const companySalesPersons = yield User_js_1.default.find({
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
        const filteredOrders = yield Order_js_1.default.find(unitManagerFilter).lean();
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
    }
    catch (error) {
        console.error('Error diagnosing sales issue:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to diagnose issue',
            error: error.message
        });
    }
}));
// Utility endpoint to fix common sales person issues
router.post('/fix-sales-issue', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { action, targetCompanyId } = req.body;
        if (user.role !== 'Superadmin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required for fixes'
            });
        }
        const fixes = [];
        if (action === 'unify-company' && targetCompanyId) {
            // Fix 1: Assign both users to same company
            const result = yield User_js_1.default.updateMany({ username: { $in: ['sales_jeet', 'sales_jeet01'] } }, { $set: { companyId: targetCompanyId } });
            fixes.push({
                action: 'Unified company assignment',
                affected: result.modifiedCount,
                details: `Assigned both users to company ${targetCompanyId}`
            });
        }
        if (action === 'fix-roles') {
            // Fix 2: Ensure correct role
            const result = yield User_js_1.default.updateMany({ username: { $in: ['sales_jeet', 'sales_jeet01'] } }, { $set: { role: 'Sales' } });
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
    }
    catch (error) {
        console.error('Error applying fixes:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to apply fixes',
            error: error.message
        });
    }
}));
exports.default = router;
