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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedBakeryCategories = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Inventory_js_1 = require("../models/Inventory.js");
// Bakery product categories with subcategories
const bakeryCategories = [
    {
        name: 'Breads',
        description: 'Various types of breads and buns',
        subcategories: ['White Bread', 'Brown Bread', 'Burger Buns', 'Sandwich Bread', 'Dinner Rolls']
    },
    {
        name: 'Biscuits',
        description: 'Sweet and savory biscuits',
        subcategories: ['Cream Biscuits', 'Digestive', 'Chocolate', 'Plain', 'Marie']
    },
    {
        name: 'Cakes',
        description: 'Cakes and pastries',
        subcategories: ['Sponge Cake', 'Chocolate Cake', 'Fruit Cake', 'Pastries', 'Cupcakes']
    },
    {
        name: 'Cookies',
        description: 'Various cookies and crackers',
        subcategories: ['Butter Cookies', 'Chocolate Chip', 'Oatmeal', 'Sugar Cookies', 'Crackers']
    },
    {
        name: 'Snacks',
        description: 'Bakery snacks and chips',
        subcategories: ['Potato Chips', 'Corn Chips', 'Pretzels', 'Nuts Mix', 'Trail Mix']
    }
];
// Customer categories for bakery business
const customerCategories = [
    {
        name: 'Retail',
        description: 'Individual customers and small purchases'
    },
    {
        name: 'Wholesale',
        description: 'Bulk purchases for resale'
    },
    {
        name: 'Restaurant',
        description: 'Hotels, restaurants, and cafes'
    },
    {
        name: 'Distributor',
        description: 'Large distributors and chains'
    },
    {
        name: 'Institution',
        description: 'Schools, hospitals, and institutions'
    }
];
const seedBakeryCategories = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Seeding bakery categories...');
        // Clear existing categories
        yield Inventory_js_1.Category.deleteMany({});
        yield Inventory_js_1.CustomerCategory.deleteMany({});
        // Insert bakery categories
        const insertedCategories = yield Inventory_js_1.Category.insertMany(bakeryCategories);
        console.log(`✓ Inserted ${insertedCategories.length} bakery categories`);
        // Insert customer categories
        const insertedCustomerCategories = yield Inventory_js_1.CustomerCategory.insertMany(customerCategories);
        console.log(`✓ Inserted ${insertedCustomerCategories.length} customer categories`);
        console.log('Bakery categories seeded successfully!');
        return { categories: insertedCategories, customerCategories: insertedCustomerCategories };
    }
    catch (error) {
        console.error('Error seeding bakery categories:', error);
        throw error;
    }
});
exports.seedBakeryCategories = seedBakeryCategories;
