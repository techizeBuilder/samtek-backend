"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
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
// Updated Unit Head permissions with all features enabled
const getFullUnitHeadPermissions = () => ({
    role: 'unit_head',
    canAccessAllUnits: false,
    modules: [
        {
            name: 'unitHead',
            dashboard: true,
            features: [
                { key: 'dashboard', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'orders', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'sales', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'dispatches', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'accounts', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'inventory', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'customers', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'suppliers', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'purchases', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'manufacturing', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'production', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'userManagement', view: true, add: true, edit: true, delete: true, alter: true }
            ]
        }
    ]
});
// Update Unit Head permissions
const updateUnitHeadPermissions = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔄 Starting Unit Head permissions update...');
        // Find all Unit Head users
        const unitHeads = yield User_js_1.default.find({ role: 'Unit Head' });
        console.log(`📋 Found ${unitHeads.length} Unit Head users`);
        if (unitHeads.length === 0) {
            console.log('ℹ️ No Unit Head users found to update');
            return;
        }
        const fullPermissions = getFullUnitHeadPermissions();
        let updatedCount = 0;
        for (const user of unitHeads) {
            try {
                // Update the user's permissions
                const result = yield User_js_1.default.findByIdAndUpdate(user._id, { permissions: fullPermissions }, { new: true, runValidators: true });
                if (result) {
                    console.log(`✅ Updated permissions for Unit Head: ${user.username} (${user.email})`);
                    updatedCount++;
                }
            }
            catch (updateError) {
                console.error(`❌ Failed to update ${user.username}:`, updateError.message);
            }
        }
        console.log(`🎉 Successfully updated ${updatedCount} out of ${unitHeads.length} Unit Head users`);
        console.log('📄 New permissions include full access to all features (View, Add, Edit, Delete)');
    }
    catch (error) {
        console.error('❌ Error updating Unit Head permissions:', error);
        throw error;
    }
});
// Main execution function
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield connectDB();
        yield updateUnitHeadPermissions();
        console.log('✅ Unit Head permissions update completed successfully!');
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
    console.log('ℹ️ Unit Head Permissions Update Script');
    console.log('This script will update all existing Unit Head users to have full permissions.');
    console.log('');
    console.log('📋 Current Unit Head permissions will be updated to:');
    console.log('✅ View, Add, Edit, Delete access to all modules');
    console.log('✅ Dashboard, Orders, Sales, Dispatches, Accounts, Inventory');
    console.log('✅ Customers, Suppliers, Purchases, Manufacturing, Production');
    console.log('✅ User Management');
    console.log('');
    console.log('To execute this script, run:');
    console.log('node server/scripts/updateUnitHeadPermissions.js --execute');
}
exports.default = main;
