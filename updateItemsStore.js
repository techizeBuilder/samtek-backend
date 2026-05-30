const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

async function updateItems() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await mongoose.connection.db.collection('items').updateMany(
      {}, // filter: update all items
      { $set: { store: new mongoose.Types.ObjectId("69ea063b78220d106638b0ef") } }
    );

    console.log(`Successfully updated ${result.modifiedCount} items. Matched ${result.matchedCount} items.`);

  } catch (error) {
    console.error('Error updating items:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

updateItems();
