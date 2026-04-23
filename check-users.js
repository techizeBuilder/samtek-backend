import mongoose from 'mongoose';
import User from './models/User.js';

async function checkSalesUsers() {
  try {
    await mongoose.connect('mongodb://localhost:27017/inventory');
    console.log('Connected to MongoDB');
    
    const users = await User.find({ 
      username: { $in: ['sales_jeet', 'sales_jeet01'] }
    }).select('username role companyId unit fullName').lean();
    
    console.log('Found sales users:');
    users.forEach(user => {
      console.log(`
        Username: ${user.username}
        Full Name: ${user.fullName}
        Role: ${user.role}
        Company ID: ${user.companyId}
        Unit: ${user.unit}
        ---
      `);
    });
    
    // Also check orders for these users
    const Order = (await import('./models/Order.js')).default;
    
    const userIds = users.map(u => u._id);
    const orders = await Order.find({
      salesPerson: { $in: userIds }
    }).populate('salesPerson', 'username').lean();
    
    console.log('Found orders for these users:');
    orders.forEach(order => {
      console.log(`Order ${order.orderCode} - Sales Person: ${order.salesPerson?.username}`);
    });
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSalesUsers();