import mongoose from 'mongoose';
import Lead from './models/Lead.js';
import { Account } from './models/Account.js';
import { addLeadPayment } from './controllers/leadPaymentController.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const run = async () => {
  await connectDB();
  try {
    // Find the lead LD-0006
    const lead = await Lead.findOne({ leadCode: 'LD-0006' });
    if (!lead) {
      console.log('Lead not found');
      return;
    }
    console.log('Found Lead:', lead._id, lead.leadCode, lead.companyName);
    
    // Find any bank or cash account
    const accounts = await Account.find({ isBankOrCash: true });
    const bankAccount = accounts.length > 0 ? accounts[0]._id : null;
    console.log('Using Bank Account ID:', bankAccount);

    // Call the controller directly
    const req = {
      body: {
        leadId: lead._id.toString(),
        amount: 10000,
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: 'Bank Transfer',
        bankAccount: bankAccount ? bankAccount.toString() : undefined,
        transactionId: 'TXN-' + Date.now(),
        remarks: 'Test controller call'
      },
      user: {
        _id: new mongoose.Types.ObjectId(),
        fullName: 'Test Auditor',
        role: 'Accounts',
        companyId: lead.companyId,
        unit: 'Default'
      }
    };
    
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        console.log(`Response [${this.statusCode || 200}]:`, JSON.stringify(data, null, 2));
      }
    };
    
    console.log('\nCalling addLeadPayment controller...');
    await addLeadPayment(req, res);
    
  } catch (error) {
    console.error('❌ CRASHED:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Connection closed');
  }
};

run();
