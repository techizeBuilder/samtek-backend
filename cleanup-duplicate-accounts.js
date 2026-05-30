import mongoose from 'mongoose';
import { Account } from './models/Account.js';

async function cleanupDuplicateAccounts() {
  try {
    await mongoose.connect('mongodb://localhost:27017/samtek');
    console.log('🔗 MongoDB Connected');
    
    console.log('🧹 Starting duplicate account cleanup...');
    
    // Find all accounts grouped by accountNumber
    const duplicates = await Account.aggregate([
      {
        $group: {
          _id: "$accountNumber",
          count: { $sum: 1 },
          docs: { $push: "$_id" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    
    console.log(`Found ${duplicates.length} duplicate account numbers`);
    
    let deletedCount = 0;
    
    for (const duplicate of duplicates) {
      console.log(`Processing duplicate accountNumber: ${duplicate._id}`);
      
      // Keep the first document, delete the rest
      const docsToDelete = duplicate.docs.slice(1);
      
      for (const docId of docsToDelete) {
        await Account.findByIdAndDelete(docId);
        deletedCount++;
        console.log(`  Deleted duplicate account: ${docId}`);
      }
    }
    
    console.log(`✅ Cleanup completed. Deleted ${deletedCount} duplicate accounts.`);
    
    // Also clean up any accounts with null or empty accountNumber
    const invalidAccounts = await Account.find({
      $or: [
        { accountNumber: null },
        { accountNumber: "" },
        { accountNumber: { $exists: false } }
      ]
    });
    
    if (invalidAccounts.length > 0) {
      console.log(`Found ${invalidAccounts.length} accounts with invalid accountNumber`);
      
      for (const account of invalidAccounts) {
        // Generate a new unique account number
        const newAccountNumber = `CLEANUP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        account.accountNumber = newAccountNumber;
        await account.save();
        console.log(`  Fixed account ${account._id} with new accountNumber: ${newAccountNumber}`);
      }
    }
    
    mongoose.connection.close();
    console.log('🎉 Database cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    mongoose.connection.close();
  }
}

cleanupDuplicateAccounts();