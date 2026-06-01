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
const Order_js_1 = __importDefault(require("./models/Order.js"));
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
function testSimpleAutomation() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('\n🧪 TESTING SIMPLE AUTOMATION\n');
            // Find an existing Sale that should trigger production
            const testSale = yield Sale_js_1.default.findOne({
                invoiceNumber: 'TEMP-ORD-FLOW-794372-1780073794410'
            }).populate('order');
            if (!testSale) {
                console.log('❌ Test sale not found');
                return;
            }
            console.log(`📄 Found test sale: ${testSale.invoiceNumber}`);
            console.log(`  Company: ${testSale.companyId}`);
            console.log(`  ProductType: ${testSale.productType}`);
            console.log(`  Inventory: ${testSale.isAvailableInInventory}`);
            // Check if Production Order should exist
            const sourceRefId = testSale.invoiceNumber;
            // Look for existing Production Order
            let existingProduction = yield ProductionOrder_js_1.default.findOne({
                company: testSale.companyId,
                notes: new RegExp(sourceRefId)
            });
            console.log(`\\n🔍 Looking for Production Order with notes containing: ${sourceRefId}`);
            if (existingProduction) {
                console.log(`✅ Found existing Production Order: ${existingProduction.orderId}`);
                console.log(`  Company: ${existingProduction.company}`);
                console.log(`  Notes: ${existingProduction.notes}`);
            }
            else {
                console.log(`❌ No Production Order found. Creating one...`);
                // Create Production Order manually to test
                const year = new Date().getFullYear();
                const timestamp = Date.now().toString().slice(-6);
                const prodOrderId = `PROD-${year}-${timestamp}`;
                const production = yield ProductionOrder_js_1.default.create({
                    orderId: prodOrderId,
                    machineCode: ((_a = testSale.order) === null || _a === void 0 ? void 0 : _a.orderCode) || 'TEST-CODE',
                    machineName: 'Test Automation Product',
                    priority: 'Normal',
                    receivedDate: new Date().toISOString().split('T')[0],
                    deliveryDate: new Date().toISOString().split('T')[0],
                    status: 'Pending',
                    company: testSale.companyId,
                    createdBy: new mongoose_1.default.Types.ObjectId(), // Dummy user ID
                    notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
                });
                console.log(`\\n🏭 Created Production Order: ${production.orderId}`);
                console.log(`  Company: ${production.company}`);
                console.log(`  Notes: ${production.notes}`);
            }
            // Now check if Production Orders are visible for this company
            const allProductionForCompany = yield ProductionOrder_js_1.default.find({
                company: testSale.companyId
            }).sort({ createdAt: -1 });
            console.log(`\\n📊 All Production Orders for Company ${testSale.companyId}: ${allProductionForCompany.length}`);
            allProductionForCompany.forEach(prod => {
                console.log(`  - ${prod.orderId}: ${prod.machineName} (${prod.status})`);
                if (prod.notes) {
                    console.log(`    Notes: ${prod.notes.substring(0, 80)}...`);
                }
            });
            mongoose_1.default.connection.close();
        }
        catch (error) {
            console.error('❌ Error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
testSimpleAutomation();
