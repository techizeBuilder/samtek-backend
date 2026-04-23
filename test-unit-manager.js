import express from 'express';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Order from './models/Order.js';

// Mock login as unit manager and test the API
async function testUnitManagerAPI() {
  try {
    // First let's check what salespeople are in the system
    console.log('Checking salespeople in the system...');
    const users = await User.find({ role: { $in: ['Sales Head', 'Sales Person', 'sales_head', 'sales_person'] } }).select('fullName email role unit');
    console.log('Sales personnel:', users.map(u => ({ name: u.fullName, email: u.email, role: u.role, unit: u.unit })));
    
    console.log('\n--- Testing Unit Manager Login ---');
    
    // Find unit manager
    const unitManager = await User.findOne({ role: 'Unit Manager' }).lean();
    console.log('Unit Manager found:', unitManager ? { name: unitManager.fullName, email: unitManager.email, unit: unitManager.unit, company: unitManager.company } : 'None');
    
    if (!unitManager) {
      console.log('No unit manager found!');
      return;
    }
    
    // Now test the orders API logic directly
    console.log('\n--- Testing Orders API Logic ---');
    
    // Get orders for this unit manager's company
    const pipeline = [
      { $match: { company: unitManager.company } },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedSalesperson',
          foreignField: '_id',
          as: 'salespersonDetails'
        }
      },
      {
        $unwind: {
          path: '$salespersonDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customerDetails'
        }
      }
    ];
    
    const orders = await Order.aggregate(pipeline);
    console.log('Orders count:', orders.length);
    
    if (orders.length > 0) {
      console.log('Sample orders with salespeople:');
      orders.slice(0, 3).forEach((order, idx) => {
        console.log(`Order ${idx + 1}:`, {
          orderId: order.orderId,
          salesperson: order.salespersonDetails ? order.salespersonDetails.fullName : 'None',
          salespersonEmail: order.salespersonDetails ? order.salespersonDetails.email : 'None',
          company: order.company
        });
      });
      
      // Group by salesperson
      const salespeople = {};
      orders.forEach(order => {
        if (order.salespersonDetails) {
          const sp = order.salespersonDetails;
          if (!salespeople[sp._id]) {
            salespeople[sp._id] = {
              name: sp.fullName,
              email: sp.email,
              role: sp.role,
              count: 0
            };
          }
          salespeople[sp._id].count++;
        }
      });
      
      console.log('\nSalespeople with orders:');
      Object.values(salespeople).forEach(sp => {
        console.log(`- ${sp.name} (${sp.email}): ${sp.count} orders`);
      });
    } else {
      console.log('No orders found for this company');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Connect to DB and run test
import('./config/database.js').then(testUnitManagerAPI).then(() => process.exit(0));