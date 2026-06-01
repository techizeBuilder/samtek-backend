/**
 * Run this script ONCE to fix the duplicate key error on packagingjobs collection.
 * It drops the old index (without partialFilterExpression) and recreates it correctly.
 *
 * Usage: node fix-packaging-index.mjs
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error('❌ No MongoDB URI found in .env (tried MONGODB_URI, MONGO_URI, DATABASE_URL)');
  process.exit(1);
}

async function fixIndex() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('packagingjobs');

    // List current indexes
    const indexes = await collection.indexes();
    console.log('\nCurrent indexes:');
    indexes.forEach(idx => console.log(' -', JSON.stringify(idx)));

    // Drop the problematic index
    const indexName = 'company_1_productionOrderId_1';
    try {
      await collection.dropIndex(indexName);
      console.log(`\n✅ Dropped old index: ${indexName}`);
    } catch (e) {
      if (e.code === 27) {
        console.log(`\nℹ️  Index ${indexName} not found — may already be correct or dropped`);
      } else {
        throw e;
      }
    }

    // Recreate the correct partial index
    // Note: MongoDB partial index does not support $ne: null directly.
    // Use $exists: true + $type: "objectId" to only index real ObjectId values.
    await collection.createIndex(
      { company: 1, productionOrderId: 1 },
      {
        unique: true,
        partialFilterExpression: { productionOrderId: { $exists: true, $type: 'objectId' } },
        name: indexName,
      }
    );
    console.log('✅ Recreated index with partialFilterExpression ($type: objectId — null/missing values excluded)');

    // Verify
    const newIndexes = await collection.indexes();
    console.log('\nUpdated indexes:');
    newIndexes.forEach(idx => console.log(' -', JSON.stringify(idx)));

    console.log('\n✅ Done! Packaging jobs can now be created without duplicate key errors.');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fixIndex();
