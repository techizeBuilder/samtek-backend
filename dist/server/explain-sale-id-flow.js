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
const Sale_js_1 = __importDefault(require("./models/Sale.js"));
const Order_js_1 = __importDefault(require("./models/Order.js"));
// Connect to MongoDB
const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const conn = yield mongoose_1.default.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    }
    catch (error) {
        console.error('Database connection error:', error);
        process.exit(1);
    }
});
const explainSaleIdFlow = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        console.log('🔍 Explaining Sale ID Flow...\n');
        // Check all orders
        const orders = yield Order_js_1.default.find().sort({ createdAt: -1 }).limit(5);
        console.log(`📊 Total Orders: ${orders.length}`);
        if (orders.length > 0) {
            console.log('\n📋 Recent Orders:');
            for (let i = 0; i < orders.length; i++) {
                const order = orders[i];
                console.log(`${i + 1}. Order ID: ${order._id}`);
                console.log(`   Order Code: ${order.orderCode}`);
                console.log(`   Status: ${order.status}`);
                console.log(`   Created: ${order.createdAt}`);
                // Check if this order has a sale
                const sale = yield Sale_js_1.default.findOne({ order: order._id });
                if (sale) {
                    console.log(`   ✅ Has Sale: ${sale._id}`);
                    console.log(`   📋 Invoice: ${sale.invoiceNumber}`);
                    console.log(`   📋 Type: ${sale.invoiceType}`);
                    console.log(`   📋 Product Type: ${sale.productType || 'Not Set'}`);
                    console.log(`   📋 Available: ${sale.isAvailableInInventory || 'Not Set'}`);
                }
                else {
                    console.log(`   ❌ No Sale Record`);
                }
                console.log('');
            }
        }
        // Check all sales
        const sales = yield Sale_js_1.default.find().sort({ createdAt: -1 }).limit(5);
        console.log(`\n📊 Total Sales: ${sales.length}`);
        if (sales.length > 0) {
            console.log('\n📋 Recent Sales:');
            sales.forEach((sale, index) => {
                console.log(`${index + 1}. Sale ID: ${sale._id}`);
                console.log(`   Invoice: ${sale.invoiceNumber}`);
                console.log(`   Type: ${sale.invoiceType}`);
                console.log(`   Order ID: ${sale.order || 'No Order'}`);
                console.log(`   Created: ${sale.createdAt}`);
                // Determine source
                if (sale.invoiceNumber.startsWith('TEMP-')) {
                    console.log(`   🔄 SOURCE: Auto-created by Store (New Flow)`);
                }
                else if (sale.invoiceNumber.startsWith('INV-') || sale.invoiceNumber.startsWith('TEST-')) {
                    console.log(`   📋 SOURCE: Manual Invoice (Old Flow)`);
                }
                else {
                    console.log(`   ❓ SOURCE: Unknown`);
                }
                console.log('');
            });
        }
        console.log('\n🔍 FLOW EXPLANATION:');
        console.log('');
        console.log('📊 OLD FLOW (Pehle):');
        console.log('1. Sales creates Order');
        console.log('2. Service verifies Order');
        console.log('3. Account approves & creates Invoice');
        console.log('4. Sale record created with real Invoice');
        console.log('5. Store gets Sale with proper Invoice number');
        console.log('');
        console.log('📊 NEW FLOW (Ab):');
        console.log('1. Sales creates Order');
        console.log('2. Service verifies Order');
        console.log('3. Store gets Order directly (No Invoice yet)');
        console.log('4. Store selects product type/availability');
        console.log('5. System auto-creates TEMP Sale record');
        console.log('6. Later Account will create proper Invoice');
        console.log('');
        console.log('🔧 ISSUE:');
        console.log('- Frontend shows TEMP Sale ID instead of Order ID');
        console.log('- User gets confused seeing temporary invoice numbers');
        console.log('- Flow looks different from before');
    }
    catch (error) {
        console.error('Error explaining flow:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('\nDatabase connection closed');
    }
});
explainSaleIdFlow();
