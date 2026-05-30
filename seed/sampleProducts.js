import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';

const sampleProducts = [
  {
    name: "AUTOMATIC FLOUR MILL PLANT",
    code: "AFMP001",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 100000,
    gst: 18,
    hsn: "84295200",
    unit: "units",
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
      {
        name: "24 INCH Model",
        capacity: "24 INCH",
        motorPower: "N/A",
        price: 40000,
        code: "AFMP-24"
      },
      {
        name: "500-800 KG/HR Model",
        capacity: "500-800 KG/HR",
        motorPower: "N/A",
        price: 65000,
        code: "AFMP-500"
      },
      {
        name: "1200 KG/HR Model",
        capacity: "1200 KG/HR",
        motorPower: "1200 Kg/hr",
        price: 75000,
        code: "AFMP-1200"
      },
      {
        name: "1200 KG/HR Premium",
        capacity: "1200 KG/HR",
        motorPower: "N/A",
        price: 220000,
        code: "AFMP-1200P"
      },
      {
        name: "800-1000 KG/HR Model",
        capacity: "800-1000 KG/HR",
        motorPower: "N/A",
        price: 100000,
        code: "AFMP-800"
      },
      {
        name: "1000 Kg/Hr Standard",
        capacity: "1000 Kg/Hr",
        motorPower: "N/A",
        price: 115000,
        code: "AFMP-1000S"
      },
      {
        name: "1000 KG/HR Premium",
        capacity: "1000 KG/HR",
        motorPower: "N/A",
        price: 90000,
        code: "AFMP-1000P"
      },
      {
        name: "1000 KG/HR Deluxe",
        capacity: "1000 KG/HR",
        motorPower: "N/A",
        price: 35000,
        code: "AFMP-1000D"
      },
      {
        name: "98 HP Model",
        capacity: "98 HP",
        motorPower: "N/A",
        price: 300000,
        code: "AFMP-98HP"
      },
      {
        name: "3HP Model",
        capacity: "N/A",
        motorPower: "3HP",
        price: 18000,
        code: "AFMP-3HP"
      }
    ],
    warranty: {
      period: 13,
      type: "Comprehensive",
      terms: "Standard warranty terms apply"
    },
    image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxIQEhUTERI...",
    order: 1
  },
  {
    name: "1440 RPM MACHINE",
    code: "RPM1440",
    category: "Manufacturing Machine",
    subCategory: "RPM Machine",
    type: "Product",
    salePrice: 6,
    gst: 18,
    unit: "units",
    description: "High speed 1440 RPM machine for industrial use",
    specifications: [
      { key: "RPM", value: "1440" },
      { key: "Motor Power", value: "Variable" },
      { key: "Shaft Size", value: "25MM" }
    ],
    variants: [
      {
        name: "Standard 1440 RPM",
        capacity: "1440 RPM",
        motorPower: "5 HP",
        price: 6,
        code: "C/0.25/1440/3"
      }
    ],
    warranty: {
      period: 12,
      type: "Parts Only"
    },
    order: 2
  },
  {
    name: "3 in 1 Cleaning Machine",
    code: "3IN1CM",
    category: "Manufacturing Machine",
    subCategory: "Cleaning Machine",
    type: "Product",
    salePrice: 90000,
    gst: 18,
    unit: "units",
    description: "Multi-purpose cleaning machine for grain processing",
    specifications: [
      { key: "Functions", value: "Cleaning, Grading, Sorting" },
      { key: "Capacity", value: "Variable" }
    ],
    variants: [
      {
        name: "Standard 3 in 1",
        capacity: "Multi-Function",
        motorPower: "3 HP",
        price: 90000,
        code: "MS31C24"
      }
    ],
    warranty: {
      period: 12,
      type: "Comprehensive"
    },
    order: 3
  },
  {
    name: "960 RPM MACHINE",
    code: "RPM960",
    category: "Manufacturing Machine",
    subCategory: "RPM Machine",
    type: "Product",
    salePrice: 8330,
    gst: 18,
    unit: "units",
    description: "Medium speed 960 RPM machine",
    specifications: [
      { key: "RPM", value: "960" },
      { key: "Motor Power", value: "3 HP" }
    ],
    variants: [
      {
        name: "Standard 960 RPM",
        capacity: "960 RPM",
        motorPower: "3 HP",
        price: 8330,
        code: "C/1/960/3"
      }
    ],
    warranty: {
      period: 12,
      type: "Parts Only"
    },
    order: 4
  },
  {
    name: "AUTOMATIC FLOUR MILL PLANT 2000 KG/HR",
    code: "AFMP2000",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 350000,
    gst: 18,
    unit: "units",
    description: "High capacity flour mill plant for large scale operations",
    applications: ["Wheat", "Maize", "Bajra", "Jowar", "Commercial Use"],
    specifications: [
      { key: "Capacity", value: "2000 KG/HR" },
      { key: "Frame", value: "6 INCH FRAME" },
      { key: "Motor", value: "15 HP" }
    ],
    variants: [
      {
        name: "2000 KG/HR Standard",
        capacity: "2000 KG/HR",
        motorPower: "15 HP",
        price: 350000,
        code: "F2000AC24"
      }
    ],
    warranty: {
      period: 18,
      type: "Comprehensive"
    },
    order: 5
  },
  {
    name: "AUTOMATIC FLOUR MILL PLANT 250 KG/HR",
    code: "AFMP250",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 350000,
    gst: 18,
    unit: "units",
    description: "Compact flour mill plant for small to medium operations",
    applications: ["Wheat", "Maize", "Small Scale Operations"],
    specifications: [
      { key: "Capacity", value: "250 KG/HR" },
      { key: "Frame", value: "3 INCH FRAME" },
      { key: "Motor", value: "5 HP" }
    ],
    variants: [
      {
        name: "250 KG/HR Compact",
        capacity: "250 KG/HR",
        motorPower: "5 HP",
        price: 350000,
        code: "F250AC24"
      }
    ],
    warranty: {
      period: 12,
      type: "Comprehensive"
    },
    order: 6
  },
  {
    name: "AUTOMATIC FLOUR MILL PLANT 500 KG/HR",
    code: "AFMP500",
    category: "Manufacturing Machine",
    subCategory: "Flour Mill",
    type: "Product",
    salePrice: 350000,
    gst: 18,
    unit: "units",
    description: "Medium capacity flour mill plant",
    applications: ["Wheat", "Maize", "Bajra", "Medium Scale Operations"],
    specifications: [
      { key: "Capacity", value: "500 KG/HR" },
      { key: "Frame", value: "4 INCH FRAME" },
      { key: "Motor", value: "7.5 HP" }
    ],
    variants: [
      {
        name: "500 KG/HR Standard",
        capacity: "500 KG/HR",
        motorPower: "7.5 HP",
        price: 350000,
        code: "F500BEM500"
      }
    ],
    warranty: {
      period: 15,
      type: "Comprehensive"
    },
    order: 7
  },
  {
    name: "AUTOMATIC SPICE PLANT MS 200 KG/HR",
    code: "ASPMS200",
    category: "Manufacturing Machine",
    subCategory: "Spice Plant",
    type: "Product",
    salePrice: 350000,
    gst: 18,
    unit: "units",
    description: "Spice grinding plant with MS body",
    applications: ["Turmeric", "Coriander", "Red Chili", "Mixed Spices"],
    specifications: [
      { key: "Capacity", value: "200 KG/HR" },
      { key: "Body Material", value: "MS (Mild Steel)" },
      { key: "Motor", value: "10 HP" }
    ],
    variants: [
      {
        name: "MS 200 KG/HR",
        capacity: "200 KG/HR",
        motorPower: "10 HP",
        price: 350000,
        code: "S200MSBP1224"
      }
    ],
    warranty: {
      period: 12,
      type: "Comprehensive"
    },
    order: 8
  },
  {
    name: "AUTOMATIC SPICE PLANT SS 200 KG/HR",
    code: "ASPSS200",
    category: "Manufacturing Machine",
    subCategory: "Spice Plant",
    type: "Product",
    salePrice: 850000,
    gst: 18,
    unit: "units",
    description: "Premium spice grinding plant with SS body",
    applications: ["Turmeric", "Coriander", "Red Chili", "Premium Spices"],
    specifications: [
      { key: "Capacity", value: "200 KG/HR" },
      { key: "Body Material", value: "SS (Stainless Steel)" },
      { key: "Motor", value: "10 HP" }
    ],
    variants: [
      {
        name: "SS 200 KG/HR",
        capacity: "200 KG/HR",
        motorPower: "10 HP",
        price: 850000,
        code: "S200SC6P"
      }
    ],
    warranty: {
      period: 18,
      type: "Comprehensive"
    },
    order: 9
  },
  {
    name: "Blower Pulverizer (MS & SS Body)",
    code: "BLPUL001",
    category: "Manufacturing Machine",
    subCategory: "Pulverizer",
    type: "Product",
    salePrice: 1150000,
    gst: 18,
    unit: "units",
    description: "High capacity blower pulverizer for fine grinding",
    applications: ["Fine Grinding", "Powder Making", "Industrial Use"],
    specifications: [
      { key: "Body Material", value: "MS & SS Options" },
      { key: "Type", value: "Blower Pulverizer" },
      { key: "Motor", value: "25 HP" }
    ],
    variants: [
      {
        name: "MS & SS Blower Pulverizer",
        capacity: "High Capacity",
        motorPower: "25 HP",
        price: 1150000,
        code: "MSSSBP1020"
      }
    ],
    warranty: {
      period: 24,
      type: "Comprehensive"
    },
    order: 10
  }
];

export async function seedProducts() {
  try {
    console.log('🌱 Starting product seeding...');
    
    // Clear existing products (optional - remove if you want to keep existing)
    // await Item.deleteMany({ type: 'Product' });
    
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
  }
}

// Run seeding if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek')
    .then(() => {
      console.log('📦 Connected to MongoDB');
      return seedProducts();
    })
    .then(() => {
      console.log('🎉 Seeding completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seeding failed:', error);
      process.exit(1);
    });
}