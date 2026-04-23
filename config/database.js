import mongoose from 'mongoose';
import { config } from './environment.js';

const connectDB = async () => {
  try {
    const mongoURI = config.MONGODB_URI;

    await mongoose.connect(mongoURI);

    const dbName = mongoURI.split('/').pop() || 'unknown';
    const environment = config.NODE_ENV;

    console.log(`MongoDB connected successfully to: ${dbName} (${environment} environment)`);
    console.log('Connection string (masked):', mongoURI.replace(/\/\/.*@/, '//***:***@'));
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
};

export default connectDB;
