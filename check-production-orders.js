import mongoose from 'mongoose';
import ProductionOrder from './models/ProductionOrder.js';
import Sale from './models/Sale.js';

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

const checkProductionOrders = async () => {
  await connectDB();
  
  try {
    console.log('🔍 Checking Production Orders...');
    
    // Check all production orders
    const productionOrders = await ProductionOrder.find().sort({ createdAt: -1 }).limit(10);
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
    } else {
      console.log('❌ No Production Orders found');
    }
    
    // Check the specific sale that should have triggered production
    const targetSale = await Sale.findById('6a19ab844d478ab903a3282c');
    if (targetSale) {
      console.log('\n📋 Target Sale Details:');
      console.log(`Sale ID: ${targetSale._id}`);
      console.log(`Invoice: ${targetSale.invoiceNumber}`);
      console.log(`Product Type: ${targetSale.productType}`);
      console.log(`Available: ${targetSale.isAvailableInInventory}`);
      console.log(`Company: ${targetSale.companyId}`);
      
      // Check if production order exists for this sale
      const relatedProduction = await ProductionOrder.findOne({
        notes: new RegExp(targetSale.invoiceNumber)
      });
      
      if (relatedProduction) {
        console.log(`✅ Found related Production Order: ${relatedProduction.orderId}`);
      } else {
        console.log('❌ No Production Order found for this sale');
      }
    } else {
      console.log('❌ Target sale not found');
    }
    
  } catch (error) {
    console.error('Error checking production orders:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

checkProductionOrders();