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
const testApiCall = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        console.log('🧪 Testing API Call Simulation...');
        // Simulate the API call with correct Sale ID
        const saleId = '6a197a5972b6450bdcb414ae';
        const updates = {
            productType: 'In-house Manufactured',
            isAvailableInInventory: 'Not Available'
        };
        console.log(`📋 Simulating API call for Sale: ${saleId}`);
        console.log(`📋 Updates:`, updates);
        // Find and update the sale
        const sale = yield Sale_js_1.default.findById(saleId);
        if (!sale) {
            console.log('❌ Sale not found');
            return;
        }
        console.log(`📋 Before Update:`);
        console.log(`   Product Type: ${sale.productType}`);
        console.log(`   Available: ${sale.isAvailableInInventory}`);
        // Apply updates
        sale.productType = updates.productType;
        sale.isAvailableInInventory = updates.isAvailableInInventory;
        yield sale.save();
        console.log(`📋 After Update:`);
        console.log(`   Product Type: ${sale.productType}`);
        console.log(`   Available: ${sale.isAvailableInInventory}`);
        console.log('✅ Sale updated successfully');
        // Now check if we can call the API endpoint
        console.log('\n🔗 API Endpoint Test:');
        console.log(`PATCH /api/orders/sale/${saleId}/store-info`);
        console.log('Body:', JSON.stringify(updates, null, 2));
    }
    catch (error) {
        console.error('Error testing API call:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('\nDatabase connection closed');
    }
});
testApiCall();
