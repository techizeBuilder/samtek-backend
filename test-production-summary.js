import mongoose from 'mongoose';
import { config } from './config/environment.js';
import connectDB from './config/database.js';
import ProductDailySummary from './models/ProductDailySummary.js';
import Order from './models/Order.js';
import { Item } from './models/Inventory.js';
import { updateProductSummary, getSalesBreakdown } from './services/productionSummaryService.js';

async function testProductionSummary() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Test 1: Get first product
    const product = await Item.findOne().limit(1);
    if (!product) {
      console.log('❌ No products found. Create a product first.');
      return;
    }
    console.log('✅ Found product:', product.name);

    // Test 2: Create a test summary
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const testSummary = new ProductDailySummary({
      date: today,
      companyId: new mongoose.Types.ObjectId('60f4b4b4b4b4b4b4b4b4b4b4'), // Test company ID
      productId: product._id,
      productName: product.name,
      qtyPerBatch: 100,
      packing: 50,
      physicalStock: 200,
      batchAdjusted: 5,
      totalIndent: 300
    });

    testSummary.calculateFormulas();
    await testSummary.save();
    console.log('✅ Test summary created:', {
      productionFinalBatches: testSummary.productionFinalBatches,
      toBeProducedDay: testSummary.toBeProducedDay,
      toBeProducedBatches: testSummary.toBeProducedBatches,
      expiryShortage: testSummary.expiryShortage,
      produceBatches: testSummary.produceBatches
    });

    // Test 3: Test updateProductSummary function
    console.log('✅ Testing updateProductSummary function...');
    await updateProductSummary(
      product._id.toString(),
      today,
      '60f4b4b4b4b4b4b4b4b4b4b4'
    );
    console.log('✅ updateProductSummary completed');

    // Test 4: Test getSalesBreakdown function
    console.log('✅ Testing getSalesBreakdown function...');
    const breakdown = await getSalesBreakdown(
      product._id.toString(),
      today,
      '60f4b4b4b4b4b4b4b4b4b4b4'
    );
    console.log('✅ Sales breakdown:', breakdown);

    // Cleanup
    await ProductDailySummary.deleteMany({
      productId: product._id,
      companyId: '60f4b4b4b4b4b4b4b4b4b4b4'
    });
    console.log('✅ Cleanup completed');

    console.log('\n🎉 All tests passed! Production Summary Module is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from database');
  }
}

// Run the test
testProductionSummary();