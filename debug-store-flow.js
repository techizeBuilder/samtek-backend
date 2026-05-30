import mongoose from 'mongoose';
import Order from './models/Order.js';
import Customer from './models/Customer.js';
import Sale from './models/Sale.js';
import ProductionOrder from './models/ProductionOrder.js';
import Lead from './models/Lead.js';

async function debugStoreFlow() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('\n🔍 DEBUGGING STORE FLOW ISSUE\n');
    
    // 1. Check recent orders
    const recentOrders = await Order.find({
      status: { $in: ['pending', 'pending_service_approval'] }
    })
    .populate('customer', 'name')
    .populate('leadId', 'leadCode')
    .sort({ createdAt: -1 })
    .limit(5);
    
    console.log(`📦 Found ${recentOrders.length} recent orders:`);
    recentOrders.forEach(order => {
      console.log(`  - ${order.orderCode}: Status=${order.status}, Customer=${order.customer?.name}, Lead=${order.leadId?.leadCode || 'N/A'}`);
    });
    
    // 2. Check Sales records for these orders
    console.log('\n📋 Checking Sales records:');
    for (const order of recentOrders) {
      const sale = await Sale.findOne({ order: order._id });
      if (sale) {
        console.log(`  - Order ${order.orderCode} → Sale ${sale.invoiceNumber}`);
        console.log(`    ProductType: ${sale.productType || 'NOT SET'}`);
        console.log(`    Inventory: ${sale.isAvailableInInventory || 'NOT SET'}`);
        
        // Check if this should trigger production
        if (sale.productType === 'In-house Manufactured' && sale.isAvailableInInventory === 'Not Available') {
          console.log(`    🏭 SHOULD CREATE PRODUCTION ORDER!`);
          
          // Check if production order exists
          const sourceRefId = sale.invoiceNumber || sale._id.toString();
          const existingProduction = await ProductionOrder.findOne({
            company: sale.companyId,
            notes: new RegExp(sourceRefId)
          });
          
          if (existingProduction) {
            console.log(`    ✅ Production Order exists: ${existingProduction.orderId}`);
          } else {
            console.log(`    ❌ NO PRODUCTION ORDER FOUND!`);
          }
        }
      } else {
        console.log(`  - Order ${order.orderCode} → NO SALE RECORD`);
      }
    }
    
    // 3. Check all Production Orders
    const productionOrders = await ProductionOrder.find({})
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log(`\n🏭 Found ${productionOrders.length} recent Production Orders:`);
    productionOrders.forEach(prod => {
      console.log(`  - ${prod.orderId}: Machine=${prod.machineName}, Status=${prod.status}, Created=${prod.createdAt}`);
    });
    
    // 4. Test the automation logic manually
    console.log('\n🧪 TESTING AUTOMATION LOGIC:');
    
    const testSale = await Sale.findOne({
      productType: 'In-house Manufactured',
      isAvailableInInventory: 'Not Available'
    });
    
    if (testSale) {
      console.log(`Found test sale: ${testSale.invoiceNumber}`);
      console.log(`ProductType: ${testSale.productType}`);
      console.log(`Inventory: ${testSale.isAvailableInInventory}`);
      
      const sourceRefId = testSale.invoiceNumber || testSale._id.toString();
      console.log(`SourceRefId: ${sourceRefId}`);
      
      // Check if production order should exist
      const shouldHaveProduction = testSale.productType === 'In-house Manufactured' && 
                                   testSale.isAvailableInInventory === 'Not Available';
      console.log(`Should have production: ${shouldHaveProduction}`);
      
      if (shouldHaveProduction) {
        const existingProduction = await ProductionOrder.findOne({
          company: testSale.companyId,
          notes: new RegExp(sourceRefId)
        });
        
        console.log(`Existing production: ${existingProduction ? existingProduction.orderId : 'NONE'}`);
      }
    } else {
      console.log('No test sale found with In-house Manufactured + Not Available');
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Debug error:', error);
    mongoose.connection.close();
  }
}

debugStoreFlow();