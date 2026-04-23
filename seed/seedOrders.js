import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import connectDB from '../config/database.js';

const seedOrdersData = async () => {
  try {
    console.log('Starting order seeding process...');

    // Connect to database if not already connected
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    // Clear existing orders
    await Order.deleteMany({});
    console.log('Cleared existing orders');

    // Get existing customers and products
    const customers = await Customer.find().limit(10);
    const products = await Product.find().limit(20);

    if (customers.length === 0 || products.length === 0) {
      console.log('Warning: No customers or products found. Please seed customers and products first.');
      return;
    }

    console.log(`Found ${customers.length} customers and ${products.length} products`);

    // Order statuses to use
    const statuses = ['Pending', 'Approved', 'Completed', 'Cancelled'];
    const statusWeights = [0.3, 0.3, 0.3, 0.1]; // Most orders are active statuses

    // Generate 15 comprehensive dummy orders
    const ordersToCreate = [];

    for (let i = 1; i <= 15; i++) {
      // Random customer
      const randomCustomer = customers[Math.floor(Math.random() * customers.length)];
      
      // Random products (1-4 products per order)
      const numberOfProducts = Math.floor(Math.random() * 4) + 1;
      const selectedProducts = [];
      const usedProductIds = new Set();
      
      for (let j = 0; j < numberOfProducts; j++) {
        let randomProduct;
        do {
          randomProduct = products[Math.floor(Math.random() * products.length)];
        } while (usedProductIds.has(randomProduct._id.toString()));
        
        usedProductIds.add(randomProduct._id.toString());
        
        const quantity = Math.floor(Math.random() * 50) + 1; // 1-50 quantity
        const price = randomProduct.price || (Math.floor(Math.random() * 500) + 50); // Use product price or random 50-550
        
        selectedProducts.push({
          product: randomProduct._id,
          quantity: quantity,
          price: price,
          total: quantity * price
        });
      }

      // Calculate total amount
      const totalAmount = selectedProducts.reduce((sum, product) => sum + product.total, 0);

      // Random status based on weights
      const randomWeight = Math.random();
      let cumulativeWeight = 0;
      let selectedStatus = statuses[0];
      
      for (let k = 0; k < statuses.length; k++) {
        cumulativeWeight += statusWeights[k];
        if (randomWeight <= cumulativeWeight) {
          selectedStatus = statuses[k];
          break;
        }
      }

      // Random order date (last 90 days)
      const randomDaysAgo = Math.floor(Math.random() * 90);
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - randomDaysAgo);

      const orderData = {
        orderCode: `ORD-2025-${String(i).padStart(3, '0')}`,
        customer: randomCustomer._id,
        orderDate: orderDate,
        products: selectedProducts,
        totalAmount: totalAmount,
        status: selectedStatus,
        notes: [
          'Standard delivery request',
          'Urgent processing needed',
          'Special packaging required',
          'Customer follow-up pending',
          'Quality check completed',
          'Bulk order - discount applied',
          '',
        ][Math.floor(Math.random() * 7)]
      };

      ordersToCreate.push(orderData);
    }

    // Insert all orders
    const insertedOrders = await Order.insertMany(ordersToCreate);
    console.log(`Successfully created ${insertedOrders.length} orders`);

    // Show summary
    const statusCounts = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    console.log('\nOrder Status Summary:');
    statusCounts.forEach(status => {
      console.log(`${status._id}: ${status.count} orders`);
    });

    const totalOrderAmount = await Order.aggregate([
      { $group: { _id: null, totalValue: { $sum: '$totalAmount' } } }
    ]);
    
    console.log(`\nTotal Order Value: ₹${totalOrderAmount[0]?.totalValue?.toLocaleString() || 0}`);

    console.log('\nOrder seeding completed successfully!');
    return {
      success: true,
      message: `Successfully created ${insertedOrders.length} orders`,
      ordersCreated: insertedOrders.length,
      statusCounts
    };

  } catch (error) {
    console.error('Error seeding orders:', error);
    return {
      success: false,
      message: 'Error seeding orders',
      error: error.message
    };
  }
};

// Export for use in other files
export { seedOrdersData };

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  seedOrdersData()
    .then((result) => {
      console.log('Seed result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}