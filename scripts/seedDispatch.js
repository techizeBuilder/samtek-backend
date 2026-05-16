import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const seedDispatchData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Get company
    const company = await db.collection('companies').findOne({});
    if (!company) {
      console.log('❌ No company found. Please create a company first.');
      process.exit(1);
    }
    console.log('✅ Using company:', company._id);

    // Get or create items
    const existingItems = await db.collection('items').find({ company: company._id }).limit(3).toArray();
    let items = existingItems;

    if (items.length === 0) {
      const timestamp = Date.now();
      items = await db.collection('items').insertMany([
        { name: 'Product A', code: `PA-${timestamp}`, category: 'Electronics', type: 'Product', unit: 'pieces', company: company._id, createdAt: new Date(), updatedAt: new Date() },
        { name: 'Material B', code: `MB-${timestamp}`, category: 'Electronics', type: 'Material', unit: 'pieces', company: company._id, createdAt: new Date(), updatedAt: new Date() },
        { name: 'Spare C', code: `SC-${timestamp}`, category: 'Mechanical', type: 'Spares', unit: 'kg', company: company._id, createdAt: new Date(), updatedAt: new Date() }
      ]);
      const createdItems = await db.collection('items').find({ company: company._id }).limit(3).toArray();
      items = createdItems;
      console.log('✅ Created sample items:', items.map(i => i.name).join(', '));
    } else {
      console.log('✅ Using existing items:', items.map(i => i.name).join(', '));
    }

    // Create dispatch entries
    const dispatchEntries = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dcCounter = 1;

    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 2; j++) {
        const item = items[j % items.length];
        const dcno = `DC${dcCounter.toString().padStart(3, '0')}`;
        dcCounter++;

        const dispatchData = {
          productId: item._id,
          productName: item.name,
          productGroup: `Test Group ${i + 1}`,
          company: company._id,
          date: new Date(today),
          packedQuantityReadyForDispatch: (i + 1) * 100 + j * 10,
          previousClosingStockYesterdayBalance: (i + 1) * 50,
          returnQuantityYesterdayReturns: j * 5,
          totalIndentQuantityOrdersForTheDay: (i + 1) * 120,
          dispatchedQuantitySentToday: (i + 1) * 80 + j * 5,
          physicalStockEntryManualVerification: (i + 1) * 70,
          dcno,
          status: ['pending', 'verified', 'dispatched'][i % 3],
          remarks: `Test dispatch entry for ${item.name}`,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Calculate dependent fields (auto-calculated in pre-save hook)
        dispatchData.totalAvailableStock =
          (dispatchData.packedQuantityReadyForDispatch || 0) +
          (dispatchData.previousClosingStockYesterdayBalance || 0) +
          (dispatchData.returnQuantityYesterdayReturns || 0);

        dispatchData.excessShortage =
          (dispatchData.totalIndentQuantityOrdersForTheDay || 0) -
          (dispatchData.totalAvailableStock || 0);

        dispatchData.closingStockEndOfDayBalance =
          (dispatchData.totalAvailableStock || 0) -
          (dispatchData.dispatchedQuantitySentToday || 0);

        dispatchData.overallLoss =
          (dispatchData.closingStockEndOfDayBalance || 0) -
          (dispatchData.physicalStockEntryManualVerification || 0);

        await db.collection('dispatches').insertOne(dispatchData);
        dispatchEntries.push(dispatchData);
        console.log(`✅ Created dispatch entry ${dcno} for ${item.name}`);
      }
    }

    console.log('\n✅ Dummy dispatch data created successfully!');
    console.log(`   - Total Dispatch Entries: ${dispatchEntries.length}`);
    console.log(`   - Items: ${items.length}`);
    console.log(`   - Company: ${company._id}`);
    console.log(`\n📊 Sample dispatch entries created:`);
    console.log(`   DC001-DC${dispatchEntries.length.toString().padStart(2, '0')} with statuses: pending, verified, dispatched`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating dummy data:', error.message);
    console.error(error);
    process.exit(1);
  }
};

seedDispatchData();
