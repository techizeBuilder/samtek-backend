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
const createTestOrder = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        console.log('🏗️ Creating Test Order for Service Verification Flow...');
        // Create a test customer first
        let customer = yield Customer_js_1.default.findOne({ name: 'Test Customer' });
        if (!customer) {
            customer = new Customer_js_1.default({
                name: 'Test Customer',
                email: 'test@example.com',
                mobile: '9876543210',
                address: 'Test Address',
                city: 'Test City',
                state: 'Test State'
            });
            yield customer.save();
            console.log(`✅ Created test customer: ${customer._id}`);
        }
        // Create a test order (Service Verified)
        const testOrder = new Order_js_1.default({
            orderCode: 'ORD-TEST-001',
            customer: customer._id,
            salesPerson: new mongoose_1.default.Types.ObjectId(), // Dummy sales person
            companyId: new mongoose_1.default.Types.ObjectId(), // Dummy company
            unit: 'Test Unit',
            orderDate: new Date(),
            products: [
                {
                    product: new mongoose_1.default.Types.ObjectId(), // Dummy product
                    quantity: 2,
                    price: 1000,
                    total: 2000
                }
            ],
            totalAmount: 2000,
            status: 'pending', // Service verified status
            priority: 'Medium'
        });
        yield testOrder.save();
        console.log('✅ Test Order Created Successfully!');
        console.log(`📋 Order ID: ${testOrder._id}`);
        console.log(`📋 Order Code: ${testOrder.orderCode}`);
        console.log(`📋 Status: ${testOrder.status}`);
        console.log(`📋 Customer: ${customer.name}`);
        console.log(`📋 Total Amount: ₹${testOrder.totalAmount}`);
        console.log('\n🔧 Now you can test Store Orders with:');
        console.log(`Order ID: ${testOrder._id}`);
        console.log(`API Endpoint: PATCH /api/orders/order/${testOrder._id}/store-info`);
        console.log('Body: {"productType": "In-house Manufactured", "isAvailableInInventory": "Not Available"}');
    }
    catch (error) {
        console.error('Error creating test order:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('\nDatabase connection closed');
    }
});
createTestOrder();
