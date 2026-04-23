import { Item, Category, CustomerCategory } from '../models/Inventory.js';

const categories = [
  {
    name: 'Electronics',
    subCategories: ['Components', 'Circuits', 'Sensors', 'Controllers']
  },
  {
    name: 'Mechanical',
    subCategories: ['Fasteners', 'Bearings', 'Gears', 'Springs']
  },
  {
    name: 'Raw Materials',
    subCategories: ['Metals', 'Plastics', 'Chemicals', 'Textiles']
  },
  {
    name: 'Tools',
    subCategories: ['Hand Tools', 'Power Tools', 'Measuring Tools', 'Safety Equipment']
  },
  {
    name: 'Packaging',
    subCategories: ['Boxes', 'Labels', 'Tape', 'Bubble Wrap']
  }
];

const customerCategories = [
  {
    name: 'Retail',
    description: 'Individual customers and small businesses'
  },
  {
    name: 'Wholesale',
    description: 'Bulk buyers and distributors'
  },
  {
    name: 'Export',
    description: 'International customers and partners'
  }
];

const items = [
  // Products
  {
    name: 'Industrial Motor Controller',
    code: 'PRO0001',
    category: 'Electronics',
    subCategory: 'Controllers',
    batch: 'B001',
    qty: 25,
    unit: 'pieces',
    store: 'Main Warehouse',
    importance: 'High',
    type: 'Product',
    stdCost: 1500,
    purchaseCost: 1200,
    salePrice: 2000,
    hsn: '85044090',
    gst: 18,
    mrp: 2200,
    internalManufacturing: true,
    purchase: false,
    description: 'High-performance industrial motor controller with advanced features',
    internalNotes: 'Requires quality check before dispatch',
    minStock: 10,
    leadTime: 7,
    tags: ['electronics', 'controller', 'industrial'],
    customerPrices: [
      { category: 'Retail', price: 2000 },
      { category: 'Wholesale', price: 1800 },
      { category: 'Export', price: 1900 }
    ]
  },
  {
    name: 'Precision Gear Assembly',
    code: 'PRO0002',
    category: 'Mechanical',
    subCategory: 'Gears',
    customerCategory: 'Retail',
    batch: 'B002',
    qty: 50,
    unit: 'pieces',
    store: 'Assembly Section',
    importance: 'High',
    type: 'Product',
    stdCost: 800,
    purchaseCost: 650,
    salePrice: 1200,
    hsn: '84834000',
    gst: 18,
    mrp: 1300,
    internalManufacturing: true,
    purchase: false,
    description: 'High-precision gear assembly for industrial machinery',
    internalNotes: 'Handle with care, precision machined parts',
    minStock: 20,
    leadTime: 10,
    tags: ['mechanical', 'gear', 'precision'],
    customerPrices: [
      { category: 'Retail', price: 1200 },
      { category: 'Wholesale', price: 1100 },
      { category: 'Export', price: 1150 }
    ]
  },
  
  // Materials
  {
    name: 'Stainless Steel Rod 316L',
    code: 'MAT0001',
    category: 'Raw Materials',
    subCategory: 'Metals',
    batch: 'SS316L-001',
    qty: 500,
    unit: 'kg',
    store: 'Raw Material Store',
    importance: 'Normal',
    type: 'Material',
    stdCost: 450,
    purchaseCost: 420,
    salePrice: 500,
    hsn: '72142000',
    gst: 18,
    mrp: 550,
    internalManufacturing: false,
    purchase: true,
    description: '316L grade stainless steel rod for manufacturing',
    internalNotes: 'Check material certificate before use',
    minStock: 100,
    leadTime: 5,
    tags: ['steel', 'rod', '316L', 'material'],
    customerPrices: [
      { category: 'Retail', price: 500 },
      { category: 'Wholesale', price: 480 },
      { category: 'Export', price: 490 }
    ]
  },
  {
    name: 'Engineering Plastic Sheets',
    code: 'MAT0002',
    category: 'Raw Materials',
    subCategory: 'Plastics',
    batch: 'PL-2024-001',
    qty: 200,
    unit: 'sheets',
    store: 'Raw Material Store',
    importance: 'Normal',
    type: 'Material',
    stdCost: 150,
    purchaseCost: 130,
    salePrice: 180,
    hsn: '39209990',
    gst: 18,
    mrp: 200,
    internalManufacturing: false,
    purchase: true,
    description: 'High-grade engineering plastic sheets for fabrication',
    internalNotes: 'Store in dry conditions',
    minStock: 50,
    leadTime: 3,
    tags: ['plastic', 'sheet', 'engineering'],
    customerPrices: [
      { category: 'Retail', price: 180 },
      { category: 'Wholesale', price: 170 },
      { category: 'Export', price: 175 }
    ]
  },
  
  // Spares
  {
    name: 'Motor Bearing SKF 6203',
    code: 'SPA0001',
    category: 'Mechanical',
    subCategory: 'Bearings',
    batch: 'SKF-001',
    qty: 100,
    unit: 'pieces',
    store: 'Spares Store',
    importance: 'Critical',
    type: 'Spares',
    stdCost: 250,
    purchaseCost: 200,
    salePrice: 350,
    hsn: '84821000',
    gst: 18,
    mrp: 400,
    internalManufacturing: false,
    purchase: true,
    description: 'SKF 6203 deep groove ball bearing for motors',
    internalNotes: 'Critical spare part - maintain stock levels',
    minStock: 30,
    leadTime: 2,
    tags: ['bearing', 'SKF', 'motor', 'spare'],
    customerPrices: [
      { category: 'Retail', price: 350 },
      { category: 'Wholesale', price: 320 },
      { category: 'Export', price: 330 }
    ]
  },
  {
    name: 'Control Panel Fuse 10A',
    code: 'SPA0002',
    category: 'Electronics',
    subCategory: 'Components',
    batch: 'FUSE-10A-001',
    qty: 500,
    unit: 'pieces',
    store: 'Electrical Store',
    importance: 'High',
    type: 'Spares',
    stdCost: 15,
    purchaseCost: 12,
    salePrice: 25,
    hsn: '85361000',
    gst: 18,
    mrp: 30,
    internalManufacturing: false,
    purchase: true,
    description: '10A fast-blow fuse for control panels',
    internalNotes: 'High consumption item',
    minStock: 200,
    leadTime: 1,
    tags: ['fuse', '10A', 'electrical', 'spare'],
    customerPrices: [
      { category: 'Retail', price: 25 },
      { category: 'Wholesale', price: 22 },
      { category: 'Export', price: 23 }
    ]
  },
  
  // Assemblies
  {
    name: 'Pump Assembly Unit',
    code: 'ASS0001',
    category: 'Mechanical',
    subCategory: 'Assemblies',
    batch: 'PA-001',
    qty: 15,
    unit: 'units',
    store: 'Assembly Section',
    importance: 'High',
    type: 'Assemblies',
    stdCost: 5000,
    purchaseCost: 4500,
    salePrice: 7000,
    hsn: '84137000',
    gst: 18,
    mrp: 7500,
    internalManufacturing: true,
    purchase: false,
    description: 'Complete pump assembly with motor and control unit',
    internalNotes: 'Final assembly product - test before dispatch',
    minStock: 5,
    leadTime: 14,
    tags: ['pump', 'assembly', 'complete'],
    customerPrices: [
      { category: 'Retail', price: 7000 },
      { category: 'Wholesale', price: 6500 },
      { category: 'Export', price: 6800 }
    ]
  },
  {
    name: 'Control Cabinet Assembly',
    code: 'ASS0002',
    category: 'Electronics',
    subCategory: 'Assemblies',
    customerCategory: 'Wholesale',
    batch: 'CC-001',
    qty: 8,
    unit: 'units',
    store: 'Assembly Section',
    importance: 'High',
    type: 'Assemblies',
    stdCost: 8000,
    purchaseCost: 7200,
    salePrice: 12000,
    hsn: '85371000',
    gst: 18,
    mrp: 13000,
    internalManufacturing: true,
    purchase: false,
    description: 'Complete electrical control cabinet with all components',
    internalNotes: 'Requires electrical testing and certification',
    minStock: 3,
    leadTime: 21,
    tags: ['control', 'cabinet', 'electrical', 'assembly'],
    customerPrices: [
      { category: 'Retail', price: 12000 },
      { category: 'Wholesale', price: 11000 },
      { category: 'Export', price: 11500 }
    ]
  }
];

export const seedInventoryData = async () => {
  try {
    console.log('Seeding inventory data...');
    
    // Clear existing data
    await Category.deleteMany({});
    await CustomerCategory.deleteMany({});
    await Item.deleteMany({});
    
    // Seed categories
    await Category.insertMany(categories);
    console.log('Categories seeded successfully');
    
    // Seed customer categories
    await CustomerCategory.insertMany(customerCategories);
    console.log('Customer categories seeded successfully');
    
    // Seed items
    await Item.insertMany(items);
    console.log('Items seeded successfully');
    
    console.log('Inventory data seeded successfully!');
    console.log(`Created ${categories.length} categories`);
    console.log(`Created ${customerCategories.length} customer categories`);
    console.log(`Created ${items.length} items`);
    
  } catch (error) {
    console.error('Error seeding inventory data:', error);
    throw error;
  }
};