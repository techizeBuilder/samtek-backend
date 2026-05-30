const mongoose = require('mongoose');
require('dotenv').config();

// Define the schema inline since we're using CommonJS
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true },
  category: { type: String, required: true, trim: true },
  subCategory: { type: String, trim: true },
  type: { type: String, required: true, enum: ['Product', 'Material', 'Spares', 'Assemblies'] },
  salePrice: { type: Number, min: 0, default: 0 },
  dealerPrice: { type: Number, min: 0, default: 0 },
  gst: { type: Number, min: 0, max: 100, default: 0 },
  hsn: { type: String, trim: true },
  unit: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  applications: [{ type: String, trim: true }],
  specifications: [{ key: String, value: String }],
  variants: [{
    name: { type: String, trim: true },
    capacity: { type: String, trim: true },
    motorPower: { type: String, trim: true },
    price: { type: Number, min: 0 },
    code: { type: String, trim: true }
  }],
  warranty: {
    period: { type: Number, default: 12 },
    type: { type: String, enum: ['Parts Only', 'Labor Only', 'Comprehensive'], default: 'Comprehensive' },
    terms: { type: String, trim: true }
  },
  image: { type: String, trim: true, default: null },
  order: { type: Number, default: 0 },
  qty: { type: Number, required: true, min: 0, default: 0 },
  importance: { type: String, enum: ['Low', 'Normal', 'High', 'Critical'], default: 'Normal' },
  stdCost: { type: Number, min: 0, default: 0 },
  purchaseCost: { type: Number, min: 0, default: 0 },
  currency: { type: String, default: 'INR' },
  unitType: { type: String, default: 'Nos' },
  mrp: { type: Number, min: 0, default: 0 },
  internalManufacturing: { type: Boolean, default: false },
  purchase: { type: Boolean, default: true },
  internalNotes: { type: String, trim: true },
  minStock: { type: Number, min: 0, default: 0 },
  leadTime: { type: Number, min: 0, default: 0 },
  customerCategory: { type: String, required: false, trim: true, default: 'Retail' },
  tags: [{ type: String, trim: true }],
  customerPrices: [{ category: String, price: Number }],
  quantity: { type: String, trim: true, default: "" },
  brochureUrl: { type: String, trim: true, default: null },
  videoUrl: { type: String, trim: true, default: null },
  uses: { type: String, trim: true },
  otherInfo: { type: String, trim: true },
  minOrderQty: { type: Number, min: 0, default: 1 },
  variant: { type: String, trim: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

const Item = mongoose.model('Item', itemSchema);

const sampleProducts = [
  {
    name: "AUTOMATIC FLOUR MILL PLANT",
    code: "AFMP001",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 100000,
    dealerPrice: 85000,
    gst: 18,
    hsn: "84295200",
    unit: "units",
    store: "69ea063b78220d106638b0ef",
    description: "Heavy duty flour mill plant for commercial use",
    applications: ["Wheat", "Maize", "Bajra", "Jowar", "Ragi", "Besan", "Suji", "& More"],
    specifications: [
      { key: "Frame", value: "4 INCH FRAME" },
      { key: "Shaft", value: "60 MM SHAFT" },
      { key: "Plate", value: "12 MM PLATE" },
      { key: "Bearing", value: "CHINESE BEARING" },
      { key: "Motor Frame", value: "MOTOR FRAME COST EXTRA" }
    ],
    variants: [
      { name: "24 INCH Model", capacity: "24 INCH", motorPower: "N/A", price: 40000, code: "AFMP-24" },
      { name: "500-800 KG/HR Model", capacity: "500-800 KG/HR", motorPower: "N/A", price: 65000, code: "AFMP-500" },
      { name: "1200 KG/HR Model", capacity: "1200 KG/HR", motorPower: "1200 Kg/hr", price: 75000, code: "AFMP-1200" },
      { name: "1200 KG/HR Premium", capacity: "1200 KG/HR", motorPower: "N/A", price: 220000, code: "AFMP-1200P" },
      { name: "800-1000 KG/HR Model", capacity: "800-1000 KG/HR", motorPower: "N/A", price: 100000, code: "AFMP-800" },
      { name: "1000 Kg/Hr Standard", capacity: "1000 Kg/Hr", motorPower: "N/A", price: 115000, code: "AFMP-1000S" },
      { name: "1000 KG/HR Premium", capacity: "1000 KG/HR", motorPower: "N/A", price: 90000, code: "AFMP-1000P" },
      { name: "1000 KG/HR Deluxe", capacity: "1000 KG/HR", motorPower: "N/A", price: 35000, code: "AFMP-1000D" },
      { name: "98 HP Model", capacity: "98 HP", motorPower: "N/A", price: 300000, code: "AFMP-98HP" },
      { name: "3HP Model", capacity: "N/A", motorPower: "3HP", price: 18000, code: "AFMP-3HP" }
    ],
    warranty: { period: 13, type: "Comprehensive", terms: "Standard warranty terms apply" },
    order: 1
  },
  {
    name: "1440 RPM MACHINE",
    code: "RPM1440",
    category: "Manufacturing Machine",
    subCategory: "RPM Machine",
    type: "Product",
    salePrice: 6,
    dealerPrice: 5,
    gst: 18,
    unit: "units",
    store: "69ea063b78220d106638b0ef",
    description: "High speed 1440 RPM machine for industrial use",
    specifications: [
      { key: "RPM", value: "1440" },
      { key: "Motor Power", value: "Variable" },
      { key: "Shaft Size", value: "25MM" }
    ],
    variants: [
      { name: "Standard 1440 RPM", capacity: "1440 RPM", motorPower: "5 HP", price: 6, code: "C/0.25/1440/3" }
    ],
    warranty: { period: 12, type: "Parts Only" },
    order: 2
  },
  {
    name: "3 in 1 Cleaning Machine",
    code: "3IN1CM",
    category: "Manufacturing Machine",
    subCategory: "Cleaning Machine",
    type: "Product",
    salePrice: 90000,
    dealerPrice: 80000,
    gst: 18,
    unit: "units",
    store: "69ea063b78220d106638b0ef",
    description: "Multi-purpose cleaning machine for grain processing",
    specifications: [
      { key: "Functions", value: "Cleaning, Grading, Sorting" },
      { key: "Capacity", value: "Variable" }
    ],
    variants: [
      { name: "Standard 3 in 1", capacity: "Multi-Function", motorPower: "3 HP", price: 90000, code: "MS31C24" }
    ],
    warranty: { period: 12, type: "Comprehensive" },
    order: 3
  },
  {
    name: "960 RPM MACHINE",
    code: "RPM960",
    category: "Manufacturing Machine",
    subCategory: "RPM Machine",
    type: "Product",
    salePrice: 8330,
    dealerPrice: 7500,
    gst: 18,
    unit: "units",
    store: "69ea063b78220d106638b0ef",
    description: "Medium speed 960 RPM machine",
    specifications: [
      { key: "RPM", value: "960" },
      { key: "Motor Power", value: "3 HP" }
    ],
    variants: [
      { name: "Standard 960 RPM", capacity: "960 RPM", motorPower: "3 HP", price: 8330, code: "C/1/960/3" }
    ],
    warranty: { period: 12, type: "Parts Only" },
    order: 4
  },
  {
    name: "AUTOMATIC FLOUR MILL PLANT 2000 KG/HR",
    code: "AFMP2000",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 350000,
    dealerPrice: 320000,
    gst: 18,
    unit: "units",
    store: "69ea063b78220d106638b0ef",
    description: "High capacity flour mill plant for large scale operations",
    applications: ["Wheat", "Maize", "Bajra", "Jowar", "Commercial Use"],
    specifications: [
      { key: "Capacity", value: "2000 KG/HR" },
      { key: "Frame", value: "6 INCH FRAME" },
      { key: "Motor", value: "15 HP" }
    ],
    variants: [
      { name: "2000 KG/HR Standard", capacity: "2000 KG/HR", motorPower: "15 HP", price: 350000, code: "F2000AC24" }
    ],
    warranty: { period: 18, type: "Comprehensive" },
    order: 5
  }
];

async function seedProducts() {
  try {
    console.log('🌱 Starting product seeding...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');
    
    // Insert sample products
    const insertedProducts = await Item.insertMany(sampleProducts);
    
    console.log(`✅ Successfully seeded ${insertedProducts.length} products`);
    console.log('Products added:');
    insertedProducts.forEach(product => {
      console.log(`- ${product.name} (${product.code})`);
    });
    
    return insertedProducts;
  } catch (error) {
    console.error('❌ Error seeding products:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('📦 Disconnected from MongoDB');
  }
}

// Run seeding
seedProducts()
  .then(() => {
    console.log('🎉 Seeding completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Seeding failed:', error);
    process.exit(1);
  });