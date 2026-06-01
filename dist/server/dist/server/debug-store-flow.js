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
const Order_js_1 = __importDefault(require("./models/Order.js"));
const Customer_js_1 = __importDefault(require("./models/Customer.js"));
const Sale_js_1 = __importDefault(require("./models/Sale.js"));
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
const Lead_js_1 = __importDefault(require("./models/Lead.js"));
function debugStoreFlow() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('\n🔍 DEBUGGING STORE FLOW ISSUE\n');
            // 1. Check recent orders
            const recentOrders = yield Order_js_1.default.find({
                status: { $in: ['pending', 'pending_service_approval'] }
            })
                .populate('customer', 'name')
                .populate('leadId', 'leadCode')
                .sort({ createdAt: -1 })
                .limit(5);
            console.log(`📦 Found ${recentOrders.length} recent orders:`);
            recentOrders.forEach(order => {
                var _a, _b;
                console.log(`  - ${order.orderCode}: Status=${order.status}, Customer=${(_a = order.customer) === null || _a === void 0 ? void 0 : _a.name}, Lead=${((_b = order.leadId) === null || _b === void 0 ? void 0 : _b.leadCode) || 'N/A'}`);
            });
            // 2. Check Sales records for these orders
            console.log('\n📋 Checking Sales records:');
            for (const order of recentOrders) {
                const sale = yield Sale_js_1.default.findOne({ order: order._id });
                if (sale) {
                    console.log(`  - Order ${order.orderCode} → Sale ${sale.invoiceNumber}`);
                    console.log(`    ProductType: ${sale.productType || 'NOT SET'}`);
                    console.log(`    Inventory: ${sale.isAvailableInInventory || 'NOT SET'}`);
                    // Check if this should trigger production
                    if (sale.productType === 'In-house Manufactured' && sale.isAvailableInInventory === 'Not Available') {
                        console.log(`    🏭 SHOULD CREATE PRODUCTION ORDER!`);
                        // Check if production order exists
                        const sourceRefId = sale.invoiceNumber || sale._id.toString();
                        const existingProduction = yield ProductionOrder_js_1.default.findOne({
                            company: sale.companyId,
                            notes: new RegExp(sourceRefId)
                        });
                        if (existingProduction) {
                            console.log(`    ✅ Production Order exists: ${existingProduction.orderId}`);
                        }
                        else {
                            console.log(`    ❌ NO PRODUCTION ORDER FOUND!`);
                        }
                    }
                }
                else {
                    console.log(`  - Order ${order.orderCode} → NO SALE RECORD`);
                }
            }
            // 3. Check all Production Orders
            const productionOrders = yield ProductionOrder_js_1.default.find({})
                .sort({ createdAt: -1 })
                .limit(10);
            console.log(`\n🏭 Found ${productionOrders.length} recent Production Orders:`);
            productionOrders.forEach(prod => {
                console.log(`  - ${prod.orderId}: Machine=${prod.machineName}, Status=${prod.status}, Created=${prod.createdAt}`);
            });
            // 4. Test the automation logic manually
            console.log('\n🧪 TESTING AUTOMATION LOGIC:');
            const testSale = yield Sale_js_1.default.findOne({
                productType: 'In-house Manufactured',
                isAvailableInInventory: 'Not Available'
            });
            if (testSale) {
                console.log(`Found test sale: ${testSale.invoiceNumber}`);
                console.log(`ProductType: ${testSale.productType}`);
                console.log(`Inventory: ${testSale.isAvailableInInventory}`);
                const sourceRefId = testSale.invoiceNumber || testSale._id.toString();
                console.log(`SourceRefId: ${sourceRefId}`);
                // Check if production order should exist
                const shouldHaveProduction = testSale.productType === 'In-house Manufactured' &&
                    testSale.isAvailableInInventory === 'Not Available';
                console.log(`Should have production: ${shouldHaveProduction}`);
                if (shouldHaveProduction) {
                    const existingProduction = yield ProductionOrder_js_1.default.findOne({
                        company: testSale.companyId,
                        notes: new RegExp(sourceRefId)
                    });
                    console.log(`Existing production: ${existingProduction ? existingProduction.orderId : 'NONE'}`);
                }
            }
            else {
                console.log('No test sale found with In-house Manufactured + Not Available');
            }
            mongoose_1.default.connection.close();
        }
        catch (error) {
            console.error('❌ Debug error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
debugStoreFlow();
