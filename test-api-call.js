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

const testApiCall = async () => {
  await connectDB();
  
  try {
    console.log('🧪 Testing API Call Simulation...');
    
    // Simulate the API call with correct Sale ID
    const saleId = '6a197a5972b6450bdcb414ae';
    const updates = {
      productType: 'In-house Manufactured',
      isAvailableInInventory: 'Not Available'
    };
    
    console.log(`📋 Simulating API call for Sale: ${saleId}`);
    console.log(`📋 Updates:`, updates);
    
    // Find and update the sale
    const sale = await Sale.findById(saleId);
    
    if (!sale) {
      console.log('❌ Sale not found');
      return;
    }
    
    console.log(`📋 Before Update:`);
    console.log(`   Product Type: ${sale.productType}`);
    console.log(`   Available: ${sale.isAvailableInInventory}`);
    
    // Apply updates
    sale.productType = updates.productType;
    sale.isAvailableInInventory = updates.isAvailableInInventory;
    
    await sale.save();
    
    console.log(`📋 After Update:`);
    console.log(`   Product Type: ${sale.productType}`);
    console.log(`   Available: ${sale.isAvailableInInventory}`);
    
    console.log('✅ Sale updated successfully');
    
    // Now check if we can call the API endpoint
    console.log('\n🔗 API Endpoint Test:');
    console.log(`PATCH /api/orders/sale/${saleId}/store-info`);
    console.log('Body:', JSON.stringify(updates, null, 2));
    
  } catch (error) {
    console.error('Error testing API call:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

testApiCall();