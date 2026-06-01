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
const User_js_1 = __importDefault(require("./models/User.js"));
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
function checkUserCompany() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('\n🔍 CHECKING USER COMPANY ACCESS\n');
            // Check all users and their company IDs
            const users = yield User_js_1.default.find({}).select('username name companyId role').sort({ createdAt: -1 });
            console.log(`👥 All Users (${users.length}):`);
            users.forEach(user => {
                console.log(`  - ${user.username} (${user.name}): Company ${user.companyId} | Role: ${user.role}`);
            });
            // Check Production Orders by company
            const companies = yield ProductionOrder_js_1.default.distinct('company');
            console.log(`\\n🏢 Companies with Production Orders (${companies.length}):`);
            for (const companyId of companies) {
                const orders = yield ProductionOrder_js_1.default.find({ company: companyId }).sort({ createdAt: -1 });
                console.log(`\\n📦 Company ${companyId}: ${orders.length} orders`);
                orders.forEach(order => {
                    console.log(`  - ${order.orderId}: ${order.machineName} (${order.status})`);
                });
                // Find users for this company
                const companyUsers = users.filter(u => String(u.companyId) === String(companyId));
                console.log(`  👥 Users: ${companyUsers.map(u => u.username).join(', ') || 'None'}`);
            }
            mongoose_1.default.connection.close();
        }
        catch (error) {
            console.error('❌ Error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
checkUserCompany();
