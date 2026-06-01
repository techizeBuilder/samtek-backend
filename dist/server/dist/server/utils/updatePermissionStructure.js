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
exports.updatePermissionStructure = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
// Function to update users with new permission structure
const updatePermissionStructure = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Starting permission structure update...');
        // Update Production role users - limit to only required features
        const productionPermissions = {
            name: 'production',
            dashboard: true,
            features: [
                { key: 'productionDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'productionReports', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'productionSheet', view: true, add: true, edit: true, delete: true, alter: true }
            ]
        };
        // Define Packing permissions for roles that need it
        const packingPermissions = {
            name: 'packing',
            dashboard: true,
            features: [
                { key: 'packingDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'packingSheet', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'packingHistory', view: true, add: false, edit: false, delete: false, alter: false }
            ]
        };
        // Define Dispatch permissions for roles that need it
        const dispatchPermissions = {
            name: 'dispatches',
            dashboard: true,
            features: [
                { key: 'dispatchDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'deliveryChallan', view: true, add: true, edit: true, delete: true, alter: true },
                { key: 'dispatchHistory', view: true, add: false, edit: false, delete: false, alter: false }
            ]
        };
        // Update Production role users
        const productionUsers = yield User_js_1.default.find({ role: 'Production' });
        for (const user of productionUsers) {
            // Remove all modules except dashboard and production
            user.permissions.modules = user.permissions.modules.filter(module => module.name === 'dashboard');
            // Add/update production module with limited features
            const productionModuleIndex = user.permissions.modules.findIndex(m => m.name === 'production');
            if (productionModuleIndex !== -1) {
                user.permissions.modules[productionModuleIndex] = productionPermissions;
            }
            else {
                user.permissions.modules.push(productionPermissions);
            }
            yield user.save();
        }
        // Update Unit Manager users - add productionGroup feature
        const unitManagerUsers = yield User_js_1.default.find({ role: 'Unit Manager' });
        for (const user of unitManagerUsers) {
            // Find or create unitManager module
            let unitManagerModule = user.permissions.modules.find(m => m.name === 'unitManager');
            if (!unitManagerModule) {
                unitManagerModule = {
                    name: 'unitManager',
                    dashboard: true,
                    features: []
                };
                user.permissions.modules.push(unitManagerModule);
            }
            // Add productionGroup feature if not exists
            const hasProductionGroup = unitManagerModule.features.some(f => f.key === 'productionGroup');
            if (!hasProductionGroup) {
                unitManagerModule.features.push({
                    key: 'productionGroup',
                    view: true,
                    add: true,
                    edit: true,
                    delete: true,
                    alter: false
                });
                yield user.save();
            }
        }
        // Update Unit Head users - add new module permissions
        const unitHeadUsers = yield User_js_1.default.find({ role: 'Unit Head' });
        for (const user of unitHeadUsers) {
            // Update/add production module
            let productionModule = user.permissions.modules.find(m => m.name === 'production');
            if (productionModule) {
                productionModule.features = [
                    { key: 'productionDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionReports', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionSheet', view: true, add: true, edit: true, delete: true, alter: true }
                ];
            }
            // Add/update packing module with history feature
            let packingModule = user.permissions.modules.find(m => m.name === 'packing');
            if (packingModule) {
                // Add history feature if not exists
                const hasHistory = packingModule.features.some(f => f.key === 'packingHistory');
                if (!hasHistory) {
                    packingModule.features.push({
                        key: 'packingHistory',
                        view: true,
                        add: false,
                        edit: false,
                        delete: false,
                        alter: false
                    });
                }
            }
            else {
                // Create new packing module if it doesn't exist
                user.permissions.modules.push(packingPermissions);
            }
            // Add/update dispatches module with new features
            let dispatchModule = user.permissions.modules.find(m => m.name === 'dispatches');
            if (dispatchModule) {
                // Add delivery challan feature if not exists
                const hasDeliveryChallan = dispatchModule.features.some(f => f.key === 'deliveryChallan');
                if (!hasDeliveryChallan) {
                    dispatchModule.features.push({
                        key: 'deliveryChallan',
                        view: true,
                        add: true,
                        edit: true,
                        delete: true,
                        alter: true
                    });
                }
                // Add dispatch history feature if not exists
                const hasHistory = dispatchModule.features.some(f => f.key === 'dispatchHistory');
                if (!hasHistory) {
                    dispatchModule.features.push({
                        key: 'dispatchHistory',
                        view: true,
                        add: false,
                        edit: false,
                        delete: false,
                        alter: false
                    });
                }
            }
            else {
                // Create new dispatch module if it doesn't exist
                user.permissions.modules.push(dispatchPermissions);
            }
            yield user.save();
        }
        // Update Super Admin users - add new module permissions
        const superAdminUsers = yield User_js_1.default.find({ role: 'Superadmin' });
        for (const user of superAdminUsers) {
            // Update production module
            let productionModule = user.permissions.modules.find(m => m.name === 'production');
            if (productionModule) {
                productionModule.features = [
                    { key: 'productionDashboard', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionReports', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: true },
                    { key: 'productionSheet', view: true, add: true, edit: true, delete: true, alter: true }
                ];
            }
            // Add/update packing module with history feature
            let packingModule = user.permissions.modules.find(m => m.name === 'packing');
            if (packingModule) {
                // Add history feature if not exists
                const hasHistory = packingModule.features.some(f => f.key === 'packingHistory');
                if (!hasHistory) {
                    packingModule.features.push({
                        key: 'packingHistory',
                        view: true,
                        add: false,
                        edit: false,
                        delete: false,
                        alter: false
                    });
                }
            }
            else {
                // Create new packing module with all features
                user.permissions.modules.push(packingPermissions);
            }
            // Add/update dispatches module with new features
            let dispatchModule = user.permissions.modules.find(m => m.name === 'dispatches');
            if (dispatchModule) {
                // Add delivery challan feature if not exists
                const hasDeliveryChallan = dispatchModule.features.some(f => f.key === 'deliveryChallan');
                if (!hasDeliveryChallan) {
                    dispatchModule.features.push({
                        key: 'deliveryChallan',
                        view: true,
                        add: true,
                        edit: true,
                        delete: true,
                        alter: true
                    });
                }
                // Add dispatch history feature if not exists
                const hasHistory = dispatchModule.features.some(f => f.key === 'dispatchHistory');
                if (!hasHistory) {
                    dispatchModule.features.push({
                        key: 'dispatchHistory',
                        view: true,
                        add: false,
                        edit: false,
                        delete: false,
                        alter: false
                    });
                }
            }
            else {
                // Create new dispatch module with all features
                user.permissions.modules.push(dispatchPermissions);
            }
            yield user.save();
        }
        console.log('Permission structure update completed');
        return {
            success: true,
            message: 'Permission structure updated successfully',
            updated: {
                production: productionUsers.length,
                unitManager: unitManagerUsers.length,
                unitHead: unitHeadUsers.length,
                superAdmin: superAdminUsers.length
            },
            newFeatures: {
                packing: ['packingHistory'],
                dispatches: ['deliveryChallan', 'dispatchHistory']
            }
        };
    }
    catch (error) {
        console.error('Error updating permission structure:', error);
        return {
            success: false,
            message: 'Failed to update permission structure',
            error: error.message
        };
    }
});
exports.updatePermissionStructure = updatePermissionStructure;
