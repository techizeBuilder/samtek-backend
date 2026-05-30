import mongoose from 'mongoose';
import Sale from './models/Sale.js';
import ProductionOrder from './models/ProductionOrder.js';
import QCJob from './models/QCJob.js';
import PurchaseRequest from './models/PurchaseRequest.js';

const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

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

const testAutomationTrigger = async () => {
  await connectDB();
  
  try {
    console.log('🧪 Testing Automation Trigger...');
    
    // Get the existing sale
    const sale = await Sale.findById('6a197a5972b6450bdcb414ae').populate('order');
    
    if (!sale) {
      console.log('❌ Sale not found');
      return;
    }
    
    console.log(`📋 Testing with Sale: ${sale._id}`);
    console.log(`📋 Product Type: ${sale.productType}`);
    console.log(`📋 Available: ${sale.isAvailableInInventory}`);
    console.log(`📋 Company: ${sale.companyId}`);
    
    // Manually trigger automation logic
    const orderCode = sale.order?.orderCode || 'N/A';
    const sourceRefId = sale.invoiceNumber || sale._id.toString();
    
    console.log(`📋 Order Code: ${orderCode}`);
    console.log(`📋 Source Ref: ${sourceRefId}`);
    
    // CASE: Not Available & In-house Manufactured -> Create Production Order
    if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'In-house Manufactured') {
      console.log('🏭 Triggering Production Order creation...');
      
      try {
        // Check if production order already exists
        const existingProduction = await ProductionOrder.findOne({
          company: sale.companyId,
          notes: new RegExp(sourceRefId)
        });
        
        if (existingProduction) {
          console.log(`✅ Production Order already exists: ${existingProduction.orderId}`);
        } else {
          const year = new Date().getFullYear();
          const timestamp = Date.now().toString().slice(-6);
          const prodOrderId = `PROD-${year}-${timestamp}`;

          const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
          const machineName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;

          const newProductionOrder = await ProductionOrder.create({
            orderId: prodOrderId,
            machineCode: orderCode,
            machineName: machineName,
            priority: 'Normal',
            receivedDate: today(),
            deliveryDate: today(),
            status: 'Pending',
            company: sale.companyId,
            createdBy: new mongoose.Types.ObjectId(), // Dummy user ID
            notes: `Manually triggered test - Product Not Available in Inventory. Ref: ${sourceRefId}`
          });
          
          console.log(`✅ Production Order created: ${newProductionOrder.orderId}`);
          console.log(`📋 Production Order ID: ${newProductionOrder._id}`);
        }
      } catch (prodError) {
        console.error('❌ Error creating Production Order:', prodError);
      }
    } else {
      console.log('⏸️ Conditions not met for Production Order');
    }
    
    // Check final state
    const finalProductionOrders = await ProductionOrder.find().sort({ createdAt: -1 }).limit(5);
    console.log(`\n📊 Total Production Orders after test: ${finalProductionOrders.length}`);
    
    finalProductionOrders.forEach((order, index) => {
      console.log(`${index + 1}. ${order.orderId} - ${order.status} - ${order.machineName}`);
    });
    
  } catch (error) {
    console.error('Error testing automation:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

testAutomationTrigger();