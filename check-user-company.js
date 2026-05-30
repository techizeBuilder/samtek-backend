import mongoose from 'mongoose';
import User from './models/User.js';
import ProductionOrder from './models/ProductionOrder.js';

async function checkUserCompany() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('\n🔍 CHECKING USER COMPANY ACCESS\n');
    
    // Check all users and their company IDs
    const users = await User.find({}).select('username name companyId role').sort({ createdAt: -1 });
    
    console.log(`👥 All Users (${users.length}):`);
    users.forEach(user => {
      console.log(`  - ${user.username} (${user.name}): Company ${user.companyId} | Role: ${user.role}`);
    });
    
    // Check Production Orders by company
    const companies = await ProductionOrder.distinct('company');
    console.log(`\\n🏢 Companies with Production Orders (${companies.length}):`);
    
    for (const companyId of companies) {
      const orders = await ProductionOrder.find({ company: companyId }).sort({ createdAt: -1 });
      console.log(`\\n📦 Company ${companyId}: ${orders.length} orders`);
      orders.forEach(order => {
        console.log(`  - ${order.orderId}: ${order.machineName} (${order.status})`);
      });
      
      // Find users for this company
      const companyUsers = users.filter(u => String(u.companyId) === String(companyId));
      console.log(`  👥 Users: ${companyUsers.map(u => u.username).join(', ') || 'None'}`);
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.connection.close();
  }
}

checkUserCompany();