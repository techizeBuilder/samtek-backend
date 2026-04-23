import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testAutoCreation() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('productdailysummaries');

    // Check initial count for today
    const today = new Date('2025-11-27');
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const initialCount = await collection.countDocuments({
      date: { $gte: today, $lt: tomorrow }
    });
    console.log(`📊 Initial records for today: ${initialCount}`);

    // Simulate a frontend API call
    console.log('🔄 Simulating frontend API call...');
    
    // Import and call the function that frontend calls
    const { getSalesSummary } = await import('./controllers/salesSummaryController.js');
    
    // Mock request and response objects
    const mockReq = {
      query: { date: '2025-11-27' },
      user: { 
        role: 'Unit Manager', 
        companyId: '6914090118cf85f80ad856bc',
        id: 'test-user'
      }
    };
    
    const mockRes = {
      json: (data) => {
        console.log('📋 API Response:', {
          success: data.success,
          productsCount: data.products ? data.products.length : 0
        });
        return mockRes;
      },
      status: (code) => {
        console.log(`📡 Response Status: ${code}`);
        return mockRes;
      }
    };

    // Call the function
    await getSalesSummary(mockReq, mockRes);

    // Check final count for today
    const finalCount = await collection.countDocuments({
      date: { $gte: today, $lt: tomorrow }
    });
    console.log(`📊 Final records for today: ${finalCount}`);

    if (finalCount > initialCount) {
      console.log('❌ AUTO-CREATION STILL HAPPENING! New records were created.');
    } else {
      console.log('✅ AUTO-CREATION DISABLED! No new records created.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the test
console.log('🚀 Testing if auto-creation is disabled...');
testAutoCreation();