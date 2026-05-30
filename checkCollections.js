const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

async function checkCollections() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name).join(', '));

    const itemsCount = await db.collection('items').countDocuments();
    console.log(`items count: ${itemsCount}`);
    
    const productsCount = await db.collection('products').countDocuments();
    console.log(`products count: ${productsCount}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkCollections();
