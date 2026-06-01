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
const debugSaleAutomation = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        console.log('🔍 Debugging Sale Automation...');
        // Find all sales with store info
        const salesWithStoreInfo = yield Sale_js_1.default.find({
            $or: [
                { productType: { $ne: null } },
                { isAvailableInInventory: { $ne: null } }
            ]
        }).sort({ updatedAt: -1 });
        console.log(`📊 Sales with Store Info: ${salesWithStoreInfo.length}`);
        salesWithStoreInfo.forEach((sale, index) => {
            console.log(`\n${index + 1}. Sale ID: ${sale._id}`);
            console.log(`   Invoice: ${sale.invoiceNumber}`);
            console.log(`   Product Type: ${sale.productType}`);
            console.log(`   Available: ${sale.isAvailableInInventory}`);
            console.log(`   Company: ${sale.companyId}`);
            console.log(`   Updated: ${sale.updatedAt}`);
            // Check automation condition
            if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'In-house Manufactured') {
                console.log(`   🏭 SHOULD TRIGGER PRODUCTION!`);
            }
            else if (sale.isAvailableInInventory === 'Available') {
                console.log(`   🔍 SHOULD TRIGGER QC!`);
            }
            else if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'Purchased (Trading Product)') {
                console.log(`   🛒 SHOULD TRIGGER PURCHASE!`);
            }
            else {
                console.log(`   ⏸️ No automation trigger`);
            }
        });
        // Check if the specific sale exists
        const targetSaleId = '6a19ab844d478ab903a3282c';
        const targetSale = yield Sale_js_1.default.findById(targetSaleId);
        if (targetSale) {
            console.log(`\n🎯 Target Sale Found:`);
            console.log(`   ID: ${targetSale._id}`);
            console.log(`   Invoice: ${targetSale.invoiceNumber}`);
            console.log(`   Product Type: ${targetSale.productType}`);
            console.log(`   Available: ${targetSale.isAvailableInInventory}`);
            console.log(`   Company: ${targetSale.companyId}`);
        }
        else {
            console.log(`\n❌ Target Sale ${targetSaleId} not found`);
        }
    }
    catch (error) {
        console.error('Error debugging sale automation:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('\nDatabase connection closed');
    }
});
debugSaleAutomation();
