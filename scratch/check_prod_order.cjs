const { MongoClient } = require('mongodb');

const uri = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('samtek-erp');
    
    console.log('--- FINDING ORDER ORD-AUTO-1818 ---');
    const order = await db.collection('orders').findOne({ orderCode: 'ORD-AUTO-1818' });
    console.log('Order Details:', JSON.stringify(order, null, 2));

    if (order) {
      console.log('--- FINDING SALE FOR ORDER ---');
      const sale = await db.collection('sales').findOne({ order: order._id });
      console.log('Sale Details:', JSON.stringify(sale, null, 2));
    }
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
