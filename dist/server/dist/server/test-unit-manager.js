"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const User_js_1 = __importDefault(require("./models/User.js"));
const Order_js_1 = __importDefault(require("./models/Order.js"));
// Mock login as unit manager and test the API
function testUnitManagerAPI() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // First let's check what salespeople are in the system
            console.log('Checking salespeople in the system...');
            const users = yield User_js_1.default.find({ role: { $in: ['Sales Head', 'Sales Person', 'sales_head', 'sales_person'] } }).select('fullName email role unit');
            console.log('Sales personnel:', users.map(u => ({ name: u.fullName, email: u.email, role: u.role, unit: u.unit })));
            console.log('\n--- Testing Unit Manager Login ---');
            // Find unit manager
            const unitManager = yield User_js_1.default.findOne({ role: 'Unit Manager' }).lean();
            console.log('Unit Manager found:', unitManager ? { name: unitManager.fullName, email: unitManager.email, unit: unitManager.unit, company: unitManager.company } : 'None');
            if (!unitManager) {
                console.log('No unit manager found!');
                return;
            }
            // Now test the orders API logic directly
            console.log('\n--- Testing Orders API Logic ---');
            // Get orders for this unit manager's company
            const pipeline = [
                { $match: { company: unitManager.company } },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'assignedSalesperson',
                        foreignField: '_id',
                        as: 'salespersonDetails'
                    }
                },
                {
                    $unwind: {
                        path: '$salespersonDetails',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'customerId',
                        foreignField: '_id',
                        as: 'customerDetails'
                    }
                }
            ];
            const orders = yield Order_js_1.default.aggregate(pipeline);
            console.log('Orders count:', orders.length);
            if (orders.length > 0) {
                console.log('Sample orders with salespeople:');
                orders.slice(0, 3).forEach((order, idx) => {
                    console.log(`Order ${idx + 1}:`, {
                        orderId: order.orderId,
                        salesperson: order.salespersonDetails ? order.salespersonDetails.fullName : 'None',
                        salespersonEmail: order.salespersonDetails ? order.salespersonDetails.email : 'None',
                        company: order.company
                    });
                });
                // Group by salesperson
                const salespeople = {};
                orders.forEach(order => {
                    if (order.salespersonDetails) {
                        const sp = order.salespersonDetails;
                        if (!salespeople[sp._id]) {
                            salespeople[sp._id] = {
                                name: sp.fullName,
                                email: sp.email,
                                role: sp.role,
                                count: 0
                            };
                        }
                        salespeople[sp._id].count++;
                    }
                });
                console.log('\nSalespeople with orders:');
                Object.values(salespeople).forEach(sp => {
                    console.log(`- ${sp.name} (${sp.email}): ${sp.count} orders`);
                });
            }
            else {
                console.log('No orders found for this company');
            }
        }
        catch (error) {
            console.error('Error:', error);
        }
    });
}
// Connect to DB and run test
Promise.resolve().then(() => __importStar(require('./config/database.js'))).then(testUnitManagerAPI).then(() => process.exit(0));
