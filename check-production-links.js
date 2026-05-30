import mongoose from 'mongoose';
import ProductionOrder from './models/ProductionOrder.js';
import Sale from './models/Sale.js';

async function checkProductionLinks() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('\n🔍 CHECKING PRODUCTION ORDER LINKS\n');
    
    // Check all Production Orders
    const allProduction = await ProductionOrder.find({}).sort({ createdAt: -1 });
    
    console.log(`🏭 All Production Orders (${allProduction.length}):`);
    
    for (const prod of allProduction) {
      console.log(`\\n📦 Production: ${prod.orderId}`);
      console.log(`  Company: ${prod.company}`);
      console.log(`  Machine: ${prod.machineName}`);
      console.log(`  Status: ${prod.status}`);
      console.log(`  Notes: ${prod.notes || 'No notes'}`);
      
      // Try to find matching Sale
      if (prod.notes) {
        const refMatch = prod.notes.match(/Ref: (.+)$/);
        if (refMatch) {
          const sourceRefId = refMatch[1];
          console.log(`  Looking for Sale with invoiceNumber: ${sourceRefId}`);
          
          const matchingSale = await Sale.findOne({
            invoiceNumber: sourceRefId
          });
          
          if (matchingSale) {
            console.log(`  ✅ Found matching Sale: ${matchingSale.invoiceNumber} (Company: ${matchingSale.companyId})`);
            
            // Check if companies match
            if (String(prod.company) === String(matchingSale.companyId)) {
              console.log(`  ✅ Company IDs MATCH!`);
            } else {
              console.log(`  ❌ Company ID MISMATCH!`);
              console.log(`    Production: ${prod.company}`);
              console.log(`    Sale: ${matchingSale.companyId}`);
            }
          } else {
            console.log(`  ❌ No matching Sale found`);
          }
        }
      }
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.connection.close();
  }
}

checkProductionLinks();