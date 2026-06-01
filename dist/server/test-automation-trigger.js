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
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
const QCJob_js_1 = __importDefault(require("./models/QCJob.js"));
const PurchaseRequest_js_1 = __importDefault(require("./models/PurchaseRequest.js"));
const today = () => new Date().toISOString().split('T')[0];
function generateQCJobId() {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const lastJob = yield QCJob_js_1.default.findOne({
            qcJobId: new RegExp(`^QC-${year}-`)
        }).sort({ qcJobId: -1 }).lean();
        let nextNumber = 1;
        if (lastJob && lastJob.qcJobId) {
            const parts = lastJob.qcJobId.split('-');
            if (parts.length === 3) {
                const lastNumber = parseInt(parts[2]);
                if (!isNaN(lastNumber)) {
                    nextNumber = lastNumber + 1;
                }
            }
        }
        return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
    });
}
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
const testAutomationTrigger = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield connectDB();
    try {
        console.log('🧪 Testing Automation Trigger...');
        // Get the existing sale
        const sale = yield Sale_js_1.default.findById('6a197a5972b6450bdcb414ae').populate('order');
        if (!sale) {
            console.log('❌ Sale not found');
            return;
        }
        console.log(`📋 Testing with Sale: ${sale._id}`);
        console.log(`📋 Product Type: ${sale.productType}`);
        console.log(`📋 Available: ${sale.isAvailableInInventory}`);
        console.log(`📋 Company: ${sale.companyId}`);
        // Manually trigger automation logic
        const orderCode = ((_a = sale.order) === null || _a === void 0 ? void 0 : _a.orderCode) || 'N/A';
        const sourceRefId = sale.invoiceNumber || sale._id.toString();
        console.log(`📋 Order Code: ${orderCode}`);
        console.log(`📋 Source Ref: ${sourceRefId}`);
        // CASE: Not Available & In-house Manufactured -> Create Production Order
        if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'In-house Manufactured') {
            console.log('🏭 Triggering Production Order creation...');
            try {
                // Check if production order already exists
                const existingProduction = yield ProductionOrder_js_1.default.findOne({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId)
                });
                if (existingProduction) {
                    console.log(`✅ Production Order already exists: ${existingProduction.orderId}`);
                }
                else {
                    const year = new Date().getFullYear();
                    const timestamp = Date.now().toString().slice(-6);
                    const prodOrderId = `PROD-${year}-${timestamp}`;
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const machineName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    const newProductionOrder = yield ProductionOrder_js_1.default.create({
                        orderId: prodOrderId,
                        machineCode: orderCode,
                        machineName: machineName,
                        priority: 'Normal',
                        receivedDate: today(),
                        deliveryDate: today(),
                        status: 'Pending',
                        company: sale.companyId,
                        createdBy: new mongoose_1.default.Types.ObjectId(), // Dummy user ID
                        notes: `Manually triggered test - Product Not Available in Inventory. Ref: ${sourceRefId}`
                    });
                    console.log(`✅ Production Order created: ${newProductionOrder.orderId}`);
                    console.log(`📋 Production Order ID: ${newProductionOrder._id}`);
                }
            }
            catch (prodError) {
                console.error('❌ Error creating Production Order:', prodError);
            }
        }
        else {
            console.log('⏸️ Conditions not met for Production Order');
        }
        // Check final state
        const finalProductionOrders = yield ProductionOrder_js_1.default.find().sort({ createdAt: -1 }).limit(5);
        console.log(`\n📊 Total Production Orders after test: ${finalProductionOrders.length}`);
        finalProductionOrders.forEach((order, index) => {
            console.log(`${index + 1}. ${order.orderId} - ${order.status} - ${order.machineName}`);
        });
    }
    catch (error) {
        console.error('Error testing automation:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('\nDatabase connection closed');
    }
});
testAutomationTrigger();
