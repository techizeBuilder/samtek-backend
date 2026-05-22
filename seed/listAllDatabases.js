import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  const admin = mongoose.connection.db.admin();
  const { databases } = await admin.listDatabases();

  let totalCollections = 0;
  for (const dbInfo of databases) {
    const db = mongoose.connection.client.db(dbInfo.name);
    const cols = await db.listCollections().toArray();
    console.log(`${dbInfo.name}: ${cols.length} collections`);
    totalCollections += cols.length;
  }
  console.log(`\nTotal across all databases: ${totalCollections}`);
  await mongoose.disconnect();
};

run().catch(err => { console.error(err.message); process.exit(1); });
