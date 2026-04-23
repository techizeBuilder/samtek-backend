import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function checkCurrentRecords() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('productdailysummaries');

    // Check for today's records
    const today = new Date('2025-11-27');
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const todayRecords = await collection.find({
      date: { $gte: today, $lt: tomorrow }
    }).toArray();

    console.log(`📊 Current records for 2025-11-27: ${todayRecords.length}`);
    
    if (todayRecords.length > 0) {
      console.log('📋 Current records:');
      todayRecords.forEach((record, index) => {
        console.log(`  ${index + 1}. ${record.productName} - ID: ${record._id}`);
        console.log(`      Created: ${record._id.getTimestamp().toISOString()}`);
      });
      
      console.log('🗑️ Deleting all current records...');
      const deleteResult = await collection.deleteMany({
        date: { $gte: today, $lt: tomorrow }
      });
      console.log(`✅ Deleted ${deleteResult.deletedCount} records`);
    } else {
      console.log('ℹ️ No records found for today');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

console.log('🔍 Checking current database state...');
checkCurrentRecords();