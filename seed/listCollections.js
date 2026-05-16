import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const names = collections.map(c => c.name).sort();
  console.log(`Total collections: ${names.length}`);

  // R&D and Production related
  const relevant = names.filter(n => /rd|bom|prototype|production|change|toolprocess|qualityparam|document/i.test(n));
  console.log('\nR&D / Production collections:', JSON.stringify(relevant, null, 2));

  // Find empty collections (check all)
  const empty = [];
  for (const col of names) {
    const count = await db.collection(col).countDocuments({}, { limit: 1 });
    if (count === 0) empty.push(col);
  }
  console.log(`\nEmpty collections (${empty.length}):`, JSON.stringify(empty, null, 2));

  await mongoose.disconnect();
};

run().catch(err => { console.error(err); process.exit(1); });
