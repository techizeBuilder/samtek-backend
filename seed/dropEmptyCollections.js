import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';

// Collections we NEVER want to drop (even if empty)
const PROTECTED = new Set(['users', 'companies', 'settings', 'branches', 'departments']);

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const names = collections.map(c => c.name);

  const dropped = [];
  for (const name of names) {
    if (PROTECTED.has(name)) continue;
    const count = await db.collection(name).countDocuments({}, { limit: 1 });
    if (count === 0) {
      await db.dropCollection(name);
      dropped.push(name);
      console.log(`  ✓ Dropped empty collection: ${name}`);
    }
  }

  console.log(`\nDropped ${dropped.length} empty collections: ${JSON.stringify(dropped)}`);
  const remaining = await db.listCollections().toArray();
  console.log(`Collections remaining in manuerp: ${remaining.length}`);
  await mongoose.disconnect();
};

run().catch(err => { console.error(err.message); process.exit(1); });
