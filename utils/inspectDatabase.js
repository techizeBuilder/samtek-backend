import mongoose from 'mongoose';

export const inspectCustomerCollection = async () => {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('customers');
    
    // Get collection stats
    const stats = await collection.stats().catch(() => ({ count: 0 }));
    console.log('Collection stats:', stats);
    
    // Get all indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));
    
    // Get sample documents
    const documents = await collection.find({}).limit(5).toArray();
    console.log('Sample documents:', JSON.stringify(documents, null, 2));
    
    return {
      success: true,
      stats,
      indexes,
      documents
    };
  } catch (error) {
    console.error('Error inspecting collection:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

export const inspectDatabaseRoute = async (req, res) => {
  try {
    const result = await inspectCustomerCollection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error inspecting database',
      error: error.message
    });
  }
};