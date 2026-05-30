import mongoose from 'mongoose';
import Order from './models/Order.js';
import Customer from './models/Customer.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const createTestOrder = async () => {
  await connectDB();
  
  try {
    console.log('🏗️ Creating Test Order for Service Verification Flow...');
    
    // Create a test customer first
    let customer = await Customer.findOne({ name: 'Test Customer' });
    if (!customer) {
      customer = new Customer({
        name: 'Test Customer',
        email: 'test@example.com',
        mobile: '9876543210',
        address: 'Test Address',
        city: 'Test City',
        state: 'Test State'
      });
      await customer.save();
      console.log(`✅ Created test customer: ${customer._id}`);
    }
    
    // Create a test order (Service Verified)
    const testOrder = new Order({
      orderCode: 'ORD-TEST-001',
      customer: customer._id,
      salesPerson: new mongoose.Types.ObjectId(), // Dummy sales person
      companyId: new mongoose.Types.ObjectId(), // Dummy company
      unit: 'Test Unit',
      orderDate: new Date(),
      products: [
        {
          product: new mongoose.Types.ObjectId(), // Dummy product
          quantity: 2,
          price: 1000,
          total: 2000
        }
      ],
      totalAmount: 2000,
      status: 'pending', // Service verified status
      priority: 'Medium'
    });
    
    await testOrder.save();
    
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
    
  } catch (error) {
    console.error('Error creating test order:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

createTestOrder();