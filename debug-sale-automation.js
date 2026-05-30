import mongoose from 'mongoose';
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

const debugSaleAutomation = async () => {
  await connectDB();
  
  try {
    console.log('🔍 Debugging Sale Automation...');
    
    // Find all sales with store info
    const salesWithStoreInfo = await Sale.find({
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
      } else if (sale.isAvailableInInventory === 'Available') {
        console.log(`   🔍 SHOULD TRIGGER QC!`);
      } else if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'Purchased (Trading Product)') {
        console.log(`   🛒 SHOULD TRIGGER PURCHASE!`);
      } else {
        console.log(`   ⏸️ No automation trigger`);
      }
    });
    
    // Check if the specific sale exists
    const targetSaleId = '6a19ab844d478ab903a3282c';
    const targetSale = await Sale.findById(targetSaleId);
    
    if (targetSale) {
      console.log(`\n🎯 Target Sale Found:`);
      console.log(`   ID: ${targetSale._id}`);
      console.log(`   Invoice: ${targetSale.invoiceNumber}`);
      console.log(`   Product Type: ${targetSale.productType}`);
      console.log(`   Available: ${targetSale.isAvailableInInventory}`);
      console.log(`   Company: ${targetSale.companyId}`);
    } else {
      console.log(`\n❌ Target Sale ${targetSaleId} not found`);
    }
    
  } catch (error) {
    console.error('Error debugging sale automation:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

debugSaleAutomation();