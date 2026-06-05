const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

const customerSchema = new mongoose.Schema({}, { strict: false });
const Customer = mongoose.model('Customer', customerSchema, 'customers');

async function inspect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');
    
    // Find customer by ID
    const customer = await Customer.findById('6a0427af1b42bca50e46e18c');
    console.log('CUSTOMER details:', JSON.stringify(customer, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

inspect();
