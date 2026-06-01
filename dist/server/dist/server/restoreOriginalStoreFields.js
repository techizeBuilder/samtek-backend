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
// My new products (should have the new store ID)
const newProductCodes = [
    'AFMP001',
    'RPM1440',
    '3IN1CM',
    'RPM960',
    'AFMP2000'
];
// Original products that likely had store field before (restore original store ID)
const originalProductsWithStore = [
    'MAC0001', // Hydraulic Excavator XE200
    'MAC0002', // Portable Concrete Mixer 300L  
    'MAC0003', // CNC Turning Machine CTX-300
    'MAC0004', // Diesel Generator 25kVA
    'INV-2026-329' // Portable Concrete Mixer 500L
];
function restoreOriginalStoreFields() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('🔄 Restoring original store fields...');
            // Connect to MongoDB
            yield mongoose.connect(process.env.MONGODB_URI);
            console.log('📦 Connected to MongoDB');
            // Restore original store field for old products (assuming they had the same store ID originally)
            console.log('🔄 Restoring store field for original products...');
            const restoreResult = yield Item.updateMany({
                code: { $in: originalProductsWithStore }
            }, {
                $set: { store: "69ea063b78220d106638b0ef" } // Assuming original store ID was same
            });
            console.log(`✅ Restored store field for ${restoreResult.modifiedCount} original products`);
            // Ensure my new products have the store field
            console.log('🔄 Ensuring my new products have store field...');
            const newResult = yield Item.updateMany({
                code: { $in: newProductCodes }
            }, {
                $set: { store: "69ea063b78220d106638b0ef" }
            });
            console.log(`✅ Ensured store field for ${newResult.modifiedCount} new products`);
            // Show final status
            const allProductsWithStore = yield Item.find({
                store: "69ea063b78220d106638b0ef"
            }).select('name code store');
            console.log('\n📋 Final products with store field:');
            allProductsWithStore.forEach(product => {
                const isNew = newProductCodes.includes(product.code);
                const isOriginal = originalProductsWithStore.includes(product.code);
                const type = isNew ? '[NEW]' : isOriginal ? '[RESTORED]' : '[OTHER]';
                console.log(`${type} ${product.name} (${product.code}) → Store: ${product.store}`);
            });
            // Show products without store field
            const productsWithoutStore = yield Item.find({
                $or: [
                    { store: { $exists: false } },
                    { store: null },
                    { store: "" }
                ]
            }).select('name code');
            console.log('\n📋 Products without store field:');
            productsWithoutStore.forEach(product => {
                console.log(`- ${product.name} (${product.code})`);
            });
            return true;
        }
        catch (error) {
            console.error('❌ Error restoring store fields:', error);
            throw error;
        }
        finally {
            yield mongoose.disconnect();
            console.log('📦 Disconnected from MongoDB');
        }
    });
}
// Run restore
restoreOriginalStoreFields()
    .then(() => {
    console.log('🎉 Store field restoration completed successfully');
    process.exit(0);
})
    .catch((error) => {
    console.error('💥 Store field restoration failed:', error);
    process.exit(1);
});
