import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  subCategory: {
    type: String,
    trim: true
  },
  batch: {
    type: String,
    trim: true
  },
  qty: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  store: {
    type: String,
    trim: true
  },
  importance: {
    type: String,
    enum: ['Low', 'Normal', 'High', 'Critical'],
    default: 'Normal'
  },
  type: {
    type: String,
    required: true,
    enum: ['Product', 'Material', 'Spares', 'Assemblies']
  },
  stdCost: {
    type: Number,
    min: 0,
    default: 0
  },
  purchaseCost: {
    type: Number,
    min: 0,
    default: 0
  },
  salePrice: {
    type: Number,
    min: 0,
    default: 0
  },
  hsn: {
    type: String,
    trim: true
  },
  gst: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  mrp: {
    type: Number,
    min: 0,
    default: 0
  },
  internalManufacturing: {
    type: Boolean,
    default: false
  },
  purchase: {
    type: Boolean,
    default: true
  },
  description: {
    type: String,
    trim: true
  },
  internalNotes: {
    type: String,
    trim: true
  },
  minStock: {
    type: Number,
    min: 0,
    default: 0
  },
  leadTime: {
    type: Number,
    min: 0,
    default: 0
  },
  customerCategory: {
    type: String,
    required: false,
    trim: true,
    default: 'Retail'
  },
  tags: [{
    type: String,
    trim: true
  }],
  customerPrices: [{
    category: String,
    price: Number
  }],
  image: {
    type: String,
    trim: true,
    default: null
  },
  quantity: {
    type: String,
    trim: true,
    default: ""
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  subcategories: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

const customerCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
itemSchema.index({ name: 1, code: 1 });
itemSchema.index({ category: 1, subCategory: 1 });
itemSchema.index({ type: 1 });
itemSchema.index({ qty: 1, minStock: 1 });
itemSchema.index({ order: 1 });

export const Item = mongoose.model('Item', itemSchema);
export const Category = mongoose.model('Category', categorySchema);
export const CustomerCategory = mongoose.model('CustomerCategory', customerCategorySchema);