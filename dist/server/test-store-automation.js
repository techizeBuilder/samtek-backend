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
const Customer_js_1 = __importDefault(require("./models/Customer.js"));
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
function testStoreAutomation() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('\n🧪 TESTING STORE AUTOMATION\n');
            // Get a user's company ID (use first available)
            const existingSale = yield Sale_js_1.default.findOne({ companyId: { $exists: true } });
            if (!existingSale) {
                console.log('❌ No existing sale with company ID found');
                return;
            }
            const testCompanyId = existingSale.companyId;
            console.log(`🏢 Using Company ID: ${testCompanyId}`);
            // Create a test customer
            let customer = yield Customer_js_1.default.findOne({ name: 'Test Automation Customer' });
            if (!customer) {
                customer = yield Customer_js_1.default.create({
                    name: 'Test Automation Customer',
                    email: 'test@automation.com',
                    mobile: '9999999999',
                    address: 'Test Address',
                    city: 'Test City',
                    companyId: testCompanyId
                });
                console.log(`👤 Created test customer: ${customer._id}`);
            }
            // Create a test order
            const orderCode = `ORD-AUTO-${Date.now()}`;
            const order = yield Order_js_1.default.create({
                orderCode,
                customer: customer._id,
                orderDate: new Date(),
                totalAmount: 50000,
                status: 'pending',
                companyId: testCompanyId,
                products: [{
                        product: { name: 'Test Automation Product' },
                        quantity: 1,
                        price: 50000,
                        total: 50000
                    }],
                unit: 'pcs'
            });
            console.log(`📦 Created test order: ${order.orderCode}`);
            // Create a Sale record
            const invoiceNumber = `TEST-AUTO-${Date.now()}`;
            const sale = yield Sale_js_1.default.create({
                invoiceNumber,
                order: order._id,
                customer: customer._id,
                items: [{
                        productName: 'Test Automation Product',
                        quantity: 1,
                        unitPrice: 50000,
                        totalPrice: 50000,
                        tax: 0
                    }],
                subtotal: 50000,
                taxAmount: 0,
                totalAmount: 50000,
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                unit: 'pcs',
                companyId: testCompanyId,
                notes: 'Test automation sale'
            });
            console.log(`📄 Created test sale: ${sale.invoiceNumber}`);
            // Now update store info to trigger automation
            console.log('\\n🔄 Triggering Store Automation...');
            sale.productType = 'In-house Manufactured';
            sale.isAvailableInInventory = 'Not Available';
            yield sale.save();
            console.log('✅ Updated Sale with:');
            console.log(`  ProductType: ${sale.productType}`);
            console.log(`  Inventory: ${sale.isAvailableInInventory}`);
            console.log(`  Company: ${sale.companyId}`);
            // Now manually trigger the automation logic (same as in controller)
            const sourceRefId = sale.invoiceNumber;
            // Check if Production Order already exists
            const existingProduction = yield ProductionOrder_js_1.default.findOne({
                company: sale.companyId,
                notes: new RegExp(sourceRefId)
            });
            if (!existingProduction) {
                const year = new Date().getFullYear();
                const timestamp = Date.now().toString().slice(-6);
                const prodOrderId = `PROD-${year}-${timestamp}`;
                const production = yield ProductionOrder_js_1.default.create({
                    orderId: prodOrderId,
                    machineCode: order.orderCode,
                    machineName: 'Test Automation Product',
                    priority: 'Normal',
                    receivedDate: new Date().toISOString().split('T')[0],
                    deliveryDate: new Date().toISOString().split('T')[0],
                    status: 'Pending',
                    company: sale.companyId,
                    notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
                });
                console.log(`\\n🏭 Created Production Order: ${production.orderId}`);
                console.log(`  Company: ${production.company}`);
                console.log(`  Notes: ${production.notes}`);
            }
            else {
                console.log(`\\n✅ Production Order already exists: ${existingProduction.orderId}`);
            }
            // Verify the Production Order is visible for this company
            const productionOrders = yield ProductionOrder_js_1.default.find({
                company: testCompanyId
            }).sort({ createdAt: -1 });
            console.log(`\\n📊 Production Orders for Company ${testCompanyId}: ${productionOrders.length}`);
            productionOrders.forEach(prod => {
                console.log(`  - ${prod.orderId}: ${prod.machineName} (${prod.status})`);
            });
            mongoose_1.default.connection.close();
        }
        catch (error) {
            console.error('❌ Error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
testStoreAutomation();
