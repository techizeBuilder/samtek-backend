"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const mongoose = require('mongoose');
require('dotenv').config();
// Define the schema inline
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
    store: { type: String, trim: true }, // Store field
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
// Only the new products I added
const newProductCodes = [
    'AFMP001',
    'RPM1440',
    '3IN1CM',
    'RPM960',
    'AFMP2000'
];
function updateOnlyNewProducts() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('🔄 Starting store field update for NEW products only...');
            // Connect to MongoDB
            yield mongoose.connect(process.env.MONGODB_URI);
            console.log('📦 Connected to MongoDB');
            // First, reset store field for all products that were incorrectly updated
            console.log('🔄 Resetting store field for old products...');
            yield Item.updateMany({
                code: { $nin: newProductCodes }, // Not in new products list
                store: "69ea063b78220d106638b0ef" // That have the store field we added
            }, {
                $unset: { store: "" } // Remove the store field
            });
            // Now update only the new products with store field
            const result = yield Item.updateMany({
                code: { $in: newProductCodes } // Only new products
            }, {
                $set: { store: "69ea063b78220d106638b0ef" }
            });
            console.log(`✅ Updated ${result.modifiedCount} NEW products with store field`);
            // Show updated products
            const updatedProducts = yield Item.find({
                code: { $in: newProductCodes },
                store: "69ea063b78220d106638b0ef"
            }).select('name code store');
            console.log('NEW products with store field:');
            updatedProducts.forEach(product => {
                console.log(`- ${product.name} (${product.code}) → Store: ${product.store}`);
            });
            // Show old products (should not have store field now)
            const oldProducts = yield Item.find({
                code: { $nin: newProductCodes }
            }).select('name code store').limit(5);
            console.log('\nOLD products (store field removed):');
            oldProducts.forEach(product => {
                console.log(`- ${product.name} (${product.code}) → Store: ${product.store || 'NOT SET'}`);
            });
            return result;
        }
        catch (error) {
            console.error('❌ Error updating store field:', error);
            throw error;
        }
        finally {
            yield mongoose.disconnect();
            console.log('📦 Disconnected from MongoDB');
        }
    });
}
// Run update
updateOnlyNewProducts()
    .then(() => {
    console.log('🎉 Store field update for NEW products completed successfully');
    process.exit(0);
})
    .catch((error) => {
    console.error('💥 Store field update failed:', error);
    process.exit(1);
});
