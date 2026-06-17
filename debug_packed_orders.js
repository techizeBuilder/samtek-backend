import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const OrderSchema = new mongoose.Schema({}, { strict: false });
const Order = mongoose.model('Order', OrderSchema, 'orders');

const PackagingJobSchema = new mongoose.Schema({}, { strict: false });
const PackagingJob = mongoose.model('PackagingJob', PackagingJobSchema, 'packagingjobs');

async function debug() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    console.log('--- Printing first 10 orders ---');
    const orders = await Order.find({}).limit(10);
    orders.forEach(o => {
      console.log(`ID: ${o._id}, orderCode: ${o.orderCode}, status: ${o.status}`);
    });

    console.log('--- Searching Order by _id or orderCode with value "MCH-CNC-003" ---');
    if (mongoose.Types.ObjectId.isValid("MCH-CNC-003")) {
      const byId = await Order.findById("MCH-CNC-003");
      console.log('Found by ID:', byId);
    } else {
      console.log('MCH-CNC-003 is not a valid ObjectId');
    }
    
    // Check if there is an order whose _id might match a hex value or if MCH-CNC-003 matches orderCode
    const byCode = await Order.findOne({ orderCode: "MCH-CNC-003" });
    console.log('Found by orderCode:', byCode);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debug();
