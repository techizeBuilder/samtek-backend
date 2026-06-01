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
exports.cleanupUserPermissions = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
// Function to clean up permissions - remove Production module from non-Production roles
const cleanupUserPermissions = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Starting to clean up user permissions...');
        // Remove Production module permissions from Super Admin users
        // Super Admin should only have superAdmin module permissions
        const superAdminResult = yield User_js_1.default.updateMany({
            role: 'Superadmin',
            'permissions.modules.name': 'production'
        }, {
            $pull: {
                'permissions.modules': { name: 'production' }
            }
        });
        // Remove Production module permissions from Unit Head users
        // Unit Head should only have unitHead module permissions
        const unitHeadResult = yield User_js_1.default.updateMany({
            role: 'Unit Head',
            'permissions.modules.name': 'production'
        }, {
            $pull: {
                'permissions.modules': { name: 'production' }
            }
        });
        // Ensure Production role users ONLY have Production module permissions
        const productionUsers = yield User_js_1.default.find({ role: 'Production' });
        for (const user of productionUsers) {
            // Remove all non-production modules
            user.permissions.modules = user.permissions.modules.filter(module => module.name === 'production');
            // Ensure they have production module if missing
            const hasProductionModule = user.permissions.modules.some(module => module.name === 'production');
            if (!hasProductionModule) {
                user.permissions.modules.push({
                    name: 'production',
                    dashboard: true,
                    features: [
                        { key: 'productionDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'batchPlanning', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'productionExecution', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'productionRegister', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'verificationApproval', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'productionReports', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'quantityBatch', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'productionSheet', view: true, add: true, edit: true, delete: true, alter: true }
                    ]
                });
            }
            yield user.save();
        }
        console.log('Permission cleanup results:');
        console.log('- Super Admin users cleaned:', superAdminResult.modifiedCount);
        console.log('- Unit Head users cleaned:', unitHeadResult.modifiedCount);
        console.log('- Production users processed:', productionUsers.length);
        return {
            success: true,
            message: 'User permissions cleaned successfully',
            details: {
                superAdminCleaned: superAdminResult.modifiedCount,
                unitHeadCleaned: unitHeadResult.modifiedCount,
                productionUsersProcessed: productionUsers.length
            }
        };
    }
    catch (error) {
        console.error('Error cleaning up permissions:', error);
        throw new Error('Failed to clean up permissions: ' + error.message);
    }
});
exports.cleanupUserPermissions = cleanupUserPermissions;
