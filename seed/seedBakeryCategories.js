import mongoose from 'mongoose';
import { Category, CustomerCategory } from '../models/Inventory.js';

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

export const seedBakeryCategories = async () => {
  try {
    console.log('Seeding bakery categories...');
    
    // Clear existing categories
    await Category.deleteMany({});
    await CustomerCategory.deleteMany({});
    
    // Insert bakery categories
    const insertedCategories = await Category.insertMany(bakeryCategories);
    console.log(`✓ Inserted ${insertedCategories.length} bakery categories`);
    
    // Insert customer categories
    const insertedCustomerCategories = await CustomerCategory.insertMany(customerCategories);
    console.log(`✓ Inserted ${insertedCustomerCategories.length} customer categories`);
    
    console.log('Bakery categories seeded successfully!');
    return { categories: insertedCategories, customerCategories: insertedCustomerCategories };
  } catch (error) {
    console.error('Error seeding bakery categories:', error);
    throw error;
  }
};