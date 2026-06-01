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
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
const Sale_js_1 = __importDefault(require("./models/Sale.js"));
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
const checkProductionOrders = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        console.log('🔍 Checking Production Orders...');
        // Check all production orders
        const productionOrders = yield ProductionOrder_js_1.default.find().sort({ createdAt: -1 }).limit(10);
        console.log(`📊 Total Production Orders: ${productionOrders.length}`);
        if (productionOrders.length > 0) {
            console.log('\n📋 Recent Production Orders:');
            productionOrders.forEach((order, index) => {
                console.log(`${index + 1}. ID: ${order.orderId}`);
                console.log(`   Machine: ${order.machineName}`);
                console.log(`   Status: ${order.status}`);
                console.log(`   Notes: ${order.notes}`);
                console.log(`   Created: ${order.createdAt}`);
                console.log('');
            });
        }
        else {
            console.log('❌ No Production Orders found');
        }
        // Check the specific sale that should have triggered production
        const targetSale = yield Sale_js_1.default.findById('6a19ab844d478ab903a3282c');
        if (targetSale) {
            console.log('\n📋 Target Sale Details:');
            console.log(`Sale ID: ${targetSale._id}`);
            console.log(`Invoice: ${targetSale.invoiceNumber}`);
            console.log(`Product Type: ${targetSale.productType}`);
            console.log(`Available: ${targetSale.isAvailableInInventory}`);
            console.log(`Company: ${targetSale.companyId}`);
            // Check if production order exists for this sale
            const relatedProduction = yield ProductionOrder_js_1.default.findOne({
                notes: new RegExp(targetSale.invoiceNumber)
            });
            if (relatedProduction) {
                console.log(`✅ Found related Production Order: ${relatedProduction.orderId}`);
            }
            else {
                console.log('❌ No Production Order found for this sale');
            }
        }
        else {
            console.log('❌ Target sale not found');
        }
    }
    catch (error) {
        console.error('Error checking production orders:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('Database connection closed');
    }
});
checkProductionOrders();
