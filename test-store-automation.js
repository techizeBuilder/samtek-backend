import mongoose from 'mongoose';
import Sale from './models/Sale.js';
import Order from './models/Order.js';
import Customer from './models/Customer.js';
import ProductionOrder from './models/ProductionOrder.js';

async function testStoreAutomation() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('\n🧪 TESTING STORE AUTOMATION\n');
    
    // Get a user's company ID (use first available)
    const existingSale = await Sale.findOne({ companyId: { $exists: true } });
    if (!existingSale) {
      console.log('❌ No existing sale with company ID found');
      return;
    }
    
    const testCompanyId = existingSale.companyId;
    console.log(`🏢 Using Company ID: ${testCompanyId}`);
    
    // Create a test customer
    let customer = await Customer.findOne({ name: 'Test Automation Customer' });
    if (!customer) {
      customer = await Customer.create({
        name: 'Test Automation Customer',
        email: 'test@automation.com',
        mobile: '9999999999',
        address: 'Test Address',
        city: 'Test City',
        companyId: testCompanyId
      });
      console.log(`👤 Created test customer: ${customer._id}`);
    }
    
    // Create a test order
    const orderCode = `ORD-AUTO-${Date.now()}`;
    const order = await Order.create({
      orderCode,
      customer: customer._id,
      orderDate: new Date(),
      totalAmount: 50000,
      status: 'pending',
      companyId: testCompanyId,
      products: [{
        product: { name: 'Test Automation Product' },
        quantity: 1,
        price: 50000,
        total: 50000
      }],
      unit: 'pcs'
    });
    console.log(`📦 Created test order: ${order.orderCode}`);
    
    // Create a Sale record
    const invoiceNumber = `TEST-AUTO-${Date.now()}`;
    const sale = await Sale.create({
      invoiceNumber,
      order: order._id,
      customer: customer._id,
      items: [{
        productName: 'Test Automation Product',
        quantity: 1,
        unitPrice: 50000,
        totalPrice: 50000,
        tax: 0
      }],
      subtotal: 50000,
      taxAmount: 0,
      totalAmount: 50000,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      unit: 'pcs',
      companyId: testCompanyId,
      notes: 'Test automation sale'
    });
    console.log(`📄 Created test sale: ${sale.invoiceNumber}`);
    
    // Now update store info to trigger automation
    console.log('\\n🔄 Triggering Store Automation...');
    
    sale.productType = 'In-house Manufactured';
    sale.isAvailableInInventory = 'Not Available';
    await sale.save();
    
    console.log('✅ Updated Sale with:');
    console.log(`  ProductType: ${sale.productType}`);
    console.log(`  Inventory: ${sale.isAvailableInInventory}`);
    console.log(`  Company: ${sale.companyId}`);
    
    // Now manually trigger the automation logic (same as in controller)
    const sourceRefId = sale.invoiceNumber;
    
    // Check if Production Order already exists
    const existingProduction = await ProductionOrder.findOne({
      company: sale.companyId,
      notes: new RegExp(sourceRefId)
    });
    
    if (!existingProduction) {
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-6);
      const prodOrderId = `PROD-${year}-${timestamp}`;
      
      const production = await ProductionOrder.create({
        orderId: prodOrderId,
        machineCode: order.orderCode,
        machineName: 'Test Automation Product',
        priority: 'Normal',
        receivedDate: new Date().toISOString().split('T')[0],
        deliveryDate: new Date().toISOString().split('T')[0],
        status: 'Pending',
        company: sale.companyId,
        notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
      });
      
      console.log(`\\n🏭 Created Production Order: ${production.orderId}`);
      console.log(`  Company: ${production.company}`);
      console.log(`  Notes: ${production.notes}`);
    } else {
      console.log(`\\n✅ Production Order already exists: ${existingProduction.orderId}`);
    }
    
    // Verify the Production Order is visible for this company
    const productionOrders = await ProductionOrder.find({
      company: testCompanyId
    }).sort({ createdAt: -1 });
    
    console.log(`\\n📊 Production Orders for Company ${testCompanyId}: ${productionOrders.length}`);
    productionOrders.forEach(prod => {
      console.log(`  - ${prod.orderId}: ${prod.machineName} (${prod.status})`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.connection.close();
  }
}

testStoreAutomation();