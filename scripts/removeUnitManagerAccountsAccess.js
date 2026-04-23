import mongoose from 'mongoose';
import User from '../models/User.js';

// Connect to database
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inventory';
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Correct Unit Manager permissions (no accounts access)
const getCorrectUnitManagerPermissions = () => ({
  role: 'unit_manager',
  canAccessAllUnits: false,
  modules: [
    {
      name: 'dashboard',
      dashboard: true,
      features: [
        { key: 'overview', view: true, add: false, edit: false, delete: false, alter: false },
        { key: 'analytics', view: true, add: false, edit: false, delete: false, alter: false }
      ]
    },
    {
      name: 'unitManager',
      dashboard: true,
      features: [
        { key: 'salesApproval', view: true, add: true, edit: true, delete: true, alter: false },
        { key: 'salesOrderList', view: true, add: true, edit: true, delete: true, alter: false }
      ]
    }
  ]
});

// Remove accounts access from Unit Manager users
const removeAccountsAccessFromUnitManagers = async () => {
  try {
    console.log('🔄 Starting Unit Manager accounts access removal...');
    
    // Find all Unit Manager users
    const unitManagers = await User.find({ role: 'Unit Manager' });
    console.log(`📋 Found ${unitManagers.length} Unit Manager users`);
    
    if (unitManagers.length === 0) {
      console.log('ℹ️ No Unit Manager users found to update');
      return;
    }
    
    const correctPermissions = getCorrectUnitManagerPermissions();
    let updatedCount = 0;
    
    for (const user of unitManagers) {
      try {
        // Check if user has accounts access
        const hasAccountsAccess = user.permissions?.modules?.some(
          module => module.name === 'accounts' || module.name === 'Accounts'
        );
        
        if (hasAccountsAccess) {
          console.log(`⚠️ User ${user.username} has accounts access - updating...`);
        }
        
        // Update the user's permissions to the correct Unit Manager permissions
        const result = await User.findByIdAndUpdate(
          user._id,
          { permissions: correctPermissions },
          { new: true, runValidators: true }
        );
        
        if (result) {
          console.log(`✅ Updated permissions for Unit Manager: ${user.username} (${user.email})`);
          updatedCount++;
        }
      } catch (updateError) {
        console.error(`❌ Failed to update ${user.username}:`, updateError.message);
      }
    }
    
    console.log(`🎉 Successfully updated ${updatedCount} out of ${unitManagers.length} Unit Manager users`);
    console.log('📄 Unit Manager permissions now correctly exclude Accounts access');
    console.log('✅ Unit Managers can only access: Dashboard, Sales Approval, Sales Order List');
    
  } catch (error) {
    console.error('❌ Error removing accounts access from Unit Managers:', error);
    throw error;
  }
};

// Main execution function
const main = async () => {
  try {
    await connectDB();
    await removeAccountsAccessFromUnitManagers();
    console.log('✅ Unit Manager accounts access removal completed successfully!');
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Database disconnected');
    process.exit(0);
  }
};

// Handle script execution
if (process.argv.includes('--execute')) {
  main();
} else {
  console.log('ℹ️ Unit Manager Accounts Access Removal Script');
  console.log('This script will remove accounts access from all Unit Manager users.');
  console.log('');
  console.log('📋 Unit Manager will have access to ONLY:');
  console.log('✅ Dashboard (view only)');
  console.log('✅ Sales Approval (full access)');
  console.log('✅ Sales Order List (full access)');
  console.log('');
  console.log('❌ Unit Manager will NOT have access to:');
  console.log('❌ Accounts module');
  console.log('❌ Manufacturing (beyond oversight)');
  console.log('❌ Direct inventory management');
  console.log('');
  console.log('To execute this script, run:');
  console.log('node server/scripts/removeUnitManagerAccountsAccess.js --execute');
}

export default main;