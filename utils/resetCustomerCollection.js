import Customer from '../models/Customer.js';
import mongoose from 'mongoose';

export const resetCustomerCollection = async () => {
  try {
    console.log('Resetting customer collection...');
    
    // First, try to drop all indexes
    try {
      await Customer.collection.dropIndexes();
      console.log('All indexes dropped successfully');
    } catch (indexError) {
      console.log('Could not drop indexes:', indexError.message);
    }
    
    // Drop the entire collection to remove any conflicting indexes
    await Customer.collection.drop().catch(err => {
      if (err.code !== 26) { // 26 = NamespaceNotFound
        throw err;
      }
      console.log('Collection did not exist, continuing...');
    });
    
    console.log('Customer collection dropped successfully');
    
    // Wait a moment for the drop to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Recreate the collection with proper indexes
    await Customer.createIndexes();
    console.log('Customer collection recreated with proper indexes');
    
    return { success: true, message: 'Customer collection reset successfully' };
  } catch (error) {
    console.error('Error resetting customer collection:', error);
    throw error;
  }
};

// Add this as a route for testing
export const resetCustomerCollectionRoute = async (req, res) => {
  try {
    const result = await resetCustomerCollection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resetting customer collection',
      error: error.message
    });
  }
};