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
const mongoose_1 = __importDefault(require("mongoose"));
const User_js_1 = __importDefault(require("../models/User.js"));
// Connect to database
const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inventory';
        yield mongoose_1.default.connect(mongoURI);
        console.log('✅ MongoDB Connected');
    }
    catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
});
// Correct Unit Manager permissions (no accounts access)
const getCorrectUnitManagerPermissions = () => ({
    role: 'unit_manager',
    canAccessAllUnits: false,
    modules: [
        {
            name: 'dashboard',
            dashboard: true,
            features: [
                { key: 'overview', view: true, add: false, edit: false, delete: false, alter: false },
                { key: 'analytics', view: true, add: false, edit: false, delete: false, alter: false }
            ]
        },
        {
            name: 'unitManager',
            dashboard: true,
            features: [
                { key: 'salesApproval', view: true, add: true, edit: true, delete: true, alter: false },
                { key: 'salesOrderList', view: true, add: true, edit: true, delete: true, alter: false }
            ]
        }
    ]
});
// Remove accounts access from Unit Manager users
const removeAccountsAccessFromUnitManagers = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log('🔄 Starting Unit Manager accounts access removal...');
        // Find all Unit Manager users
        const unitManagers = yield User_js_1.default.find({ role: 'Unit Manager' });
        console.log(`📋 Found ${unitManagers.length} Unit Manager users`);
        if (unitManagers.length === 0) {
            console.log('ℹ️ No Unit Manager users found to update');
            return;
        }
        const correctPermissions = getCorrectUnitManagerPermissions();
        let updatedCount = 0;
        for (const user of unitManagers) {
            try {
                // Check if user has accounts access
                const hasAccountsAccess = (_b = (_a = user.permissions) === null || _a === void 0 ? void 0 : _a.modules) === null || _b === void 0 ? void 0 : _b.some(module => module.name === 'accounts' || module.name === 'Accounts');
                if (hasAccountsAccess) {
                    console.log(`⚠️ User ${user.username} has accounts access - updating...`);
                }
                // Update the user's permissions to the correct Unit Manager permissions
                const result = yield User_js_1.default.findByIdAndUpdate(user._id, { permissions: correctPermissions }, { new: true, runValidators: true });
                if (result) {
                    console.log(`✅ Updated permissions for Unit Manager: ${user.username} (${user.email})`);
                    updatedCount++;
                }
            }
            catch (updateError) {
                console.error(`❌ Failed to update ${user.username}:`, updateError.message);
            }
        }
        console.log(`🎉 Successfully updated ${updatedCount} out of ${unitManagers.length} Unit Manager users`);
        console.log('📄 Unit Manager permissions now correctly exclude Accounts access');
        console.log('✅ Unit Managers can only access: Dashboard, Sales Approval, Sales Order List');
    }
    catch (error) {
        console.error('❌ Error removing accounts access from Unit Managers:', error);
        throw error;
    }
});
// Main execution function
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield connectDB();
        yield removeAccountsAccessFromUnitManagers();
        console.log('✅ Unit Manager accounts access removal completed successfully!');
    }
    catch (error) {
        console.error('❌ Script failed:', error);
    }
    finally {
        yield mongoose_1.default.disconnect();
        console.log('📤 Database disconnected');
        process.exit(0);
    }
});
// Handle script execution
if (process.argv.includes('--execute')) {
    main();
}
else {
    console.log('ℹ️ Unit Manager Accounts Access Removal Script');
    console.log('This script will remove accounts access from all Unit Manager users.');
    console.log('');
    console.log('📋 Unit Manager will have access to ONLY:');
    console.log('✅ Dashboard (view only)');
    console.log('✅ Sales Approval (full access)');
    console.log('✅ Sales Order List (full access)');
    console.log('');
    console.log('❌ Unit Manager will NOT have access to:');
    console.log('❌ Accounts module');
    console.log('❌ Manufacturing (beyond oversight)');
    console.log('❌ Direct inventory management');
    console.log('');
    console.log('To execute this script, run:');
    console.log('node server/scripts/removeUnitManagerAccountsAccess.js --execute');
}
exports.default = main;
