import mongoose from 'mongoose';
import Sale from './models/Sale.js';
import Order from './models/Order.js';
import ProductionOrder from './models/ProductionOrder.js';

async function testSimpleAutomation() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('\n🧪 TESTING SIMPLE AUTOMATION\n');
    
    // Find an existing Sale that should trigger production
    const testSale = await Sale.findOne({
      invoiceNumber: 'TEMP-ORD-FLOW-794372-1780073794410'
    }).populate('order');
    
    if (!testSale) {
      console.log('❌ Test sale not found');
      return;
    }
    
    console.log(`📄 Found test sale: ${testSale.invoiceNumber}`);
    console.log(`  Company: ${testSale.companyId}`);
    console.log(`  ProductType: ${testSale.productType}`);
    console.log(`  Inventory: ${testSale.isAvailableInInventory}`);
    
    // Check if Production Order should exist
    const sourceRefId = testSale.invoiceNumber;
    
    // Look for existing Production Order
    let existingProduction = await ProductionOrder.findOne({
      company: testSale.companyId,
      notes: new RegExp(sourceRefId)
    });
    
    console.log(`\\n🔍 Looking for Production Order with notes containing: ${sourceRefId}`);
    
    if (existingProduction) {
      console.log(`✅ Found existing Production Order: ${existingProduction.orderId}`);
      console.log(`  Company: ${existingProduction.company}`);
      console.log(`  Notes: ${existingProduction.notes}`);
    } else {
      console.log(`❌ No Production Order found. Creating one...`);
      
      // Create Production Order manually to test
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-6);
      const prodOrderId = `PROD-${year}-${timestamp}`;
      
      const production = await ProductionOrder.create({
        orderId: prodOrderId,
        machineCode: testSale.order?.orderCode || 'TEST-CODE',
        machineName: 'Test Automation Product',
        priority: 'Normal',
        receivedDate: new Date().toISOString().split('T')[0],
        deliveryDate: new Date().toISOString().split('T')[0],
        status: 'Pending',
        company: testSale.companyId,
        createdBy: new mongoose.Types.ObjectId(), // Dummy user ID
        notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
      });
      
      console.log(`\\n🏭 Created Production Order: ${production.orderId}`);
      console.log(`  Company: ${production.company}`);
      console.log(`  Notes: ${production.notes}`);
    }
    
    // Now check if Production Orders are visible for this company
    const allProductionForCompany = await ProductionOrder.find({
      company: testSale.companyId
    }).sort({ createdAt: -1 });
    
    console.log(`\\n📊 All Production Orders for Company ${testSale.companyId}: ${allProductionForCompany.length}`);
    allProductionForCompany.forEach(prod => {
      console.log(`  - ${prod.orderId}: ${prod.machineName} (${prod.status})`);
      if (prod.notes) {
        console.log(`    Notes: ${prod.notes.substring(0, 80)}...`);
      }
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.connection.close();
  }
}

testSimpleAutomation();