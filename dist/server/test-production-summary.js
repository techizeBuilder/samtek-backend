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
const environment_js_1 = require("./config/environment.js");
const database_js_1 = __importDefault(require("./config/database.js"));
const ProductDailySummary_js_1 = __importDefault(require("./models/ProductDailySummary.js"));
const Order_js_1 = __importDefault(require("./models/Order.js"));
const Inventory_js_1 = require("./models/Inventory.js");
const productionSummaryService_js_1 = require("./services/productionSummaryService.js");
function testProductionSummary() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Connect to database
            yield (0, database_js_1.default)();
            console.log('✅ Connected to database');
            // Test 1: Get first product
            const product = yield Inventory_js_1.Item.findOne().limit(1);
            if (!product) {
                console.log('❌ No products found. Create a product first.');
                return;
            }
            console.log('✅ Found product:', product.name);
            // Test 2: Create a test summary
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const testSummary = new ProductDailySummary_js_1.default({
                date: today,
                companyId: new mongoose_1.default.Types.ObjectId('60f4b4b4b4b4b4b4b4b4b4b4'), // Test company ID
                productId: product._id,
                productName: product.name,
                qtyPerBatch: 100,
                packing: 50,
                physicalStock: 200,
                batchAdjusted: 5,
                totalIndent: 300
            });
            testSummary.calculateFormulas();
            yield testSummary.save();
            console.log('✅ Test summary created:', {
                productionFinalBatches: testSummary.productionFinalBatches,
                toBeProducedDay: testSummary.toBeProducedDay,
                toBeProducedBatches: testSummary.toBeProducedBatches,
                expiryShortage: testSummary.expiryShortage,
                produceBatches: testSummary.produceBatches
            });
            // Test 3: Test updateProductSummary function
            console.log('✅ Testing updateProductSummary function...');
            yield (0, productionSummaryService_js_1.updateProductSummary)(product._id.toString(), today, '60f4b4b4b4b4b4b4b4b4b4b4');
            console.log('✅ updateProductSummary completed');
            // Test 4: Test getSalesBreakdown function
            console.log('✅ Testing getSalesBreakdown function...');
            const breakdown = yield (0, productionSummaryService_js_1.getSalesBreakdown)(product._id.toString(), today, '60f4b4b4b4b4b4b4b4b4b4b4');
            console.log('✅ Sales breakdown:', breakdown);
            // Cleanup
            yield ProductDailySummary_js_1.default.deleteMany({
                productId: product._id,
                companyId: '60f4b4b4b4b4b4b4b4b4b4b4'
            });
            console.log('✅ Cleanup completed');
            console.log('\n🎉 All tests passed! Production Summary Module is working correctly.');
        }
        catch (error) {
            console.error('❌ Test failed:', error);
        }
        finally {
            yield mongoose_1.default.disconnect();
            console.log('✅ Disconnected from database');
        }
    });
}
// Run the test
testProductionSummary();
