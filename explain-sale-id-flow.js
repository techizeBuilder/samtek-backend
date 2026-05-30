import mongoose from 'mongoose';
import Sale from './models/Sale.js';
import Order from './models/Order.js';

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

const explainSaleIdFlow = async () => {
  await connectDB();
  
  try {
    console.log('🔍 Explaining Sale ID Flow...\n');
    
    // Check all orders
    const orders = await Order.find().sort({ createdAt: -1 }).limit(5);
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
        const sale = await Sale.findOne({ order: order._id });
        if (sale) {
          console.log(`   ✅ Has Sale: ${sale._id}`);
          console.log(`   📋 Invoice: ${sale.invoiceNumber}`);
          console.log(`   📋 Type: ${sale.invoiceType}`);
          console.log(`   📋 Product Type: ${sale.productType || 'Not Set'}`);
          console.log(`   📋 Available: ${sale.isAvailableInInventory || 'Not Set'}`);
        } else {
          console.log(`   ❌ No Sale Record`);
        }
        console.log('');
      }
    }
    
    // Check all sales
    const sales = await Sale.find().sort({ createdAt: -1 }).limit(5);
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
        } else if (sale.invoiceNumber.startsWith('INV-') || sale.invoiceNumber.startsWith('TEST-')) {
          console.log(`   📋 SOURCE: Manual Invoice (Old Flow)`);
        } else {
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
    
  } catch (error) {
    console.error('Error explaining flow:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

explainSaleIdFlow();