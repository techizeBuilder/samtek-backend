import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import connectDB from '../config/database.js';

// Import models
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import { Inventory } from '../models/Inventory.js';
import Order from '../models/Order.js';
import Manufacturing from '../models/Manufacturing.js';
import Dispatch from '../models/Dispatch.js';
import Sale from '../models/Sale.js';
import { Account } from '../models/Account.js';
import Purchase from '../models/Purchase.js';
import Settings from '../models/Settings.js';

// Import constants
import { USER_ROLES, ORDER_STATUS, PRODUCTION_STATUS, DISPATCH_STATUS, PAYMENT_STATUS } from '../../shared/schema.js';

const seedData = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await connectDB();

    console.log('Clearing existing data...');
    await Promise.all([
      User.deleteMany({}),
      Customer.deleteMany({}),
      Supplier.deleteMany({}),
      Inventory.deleteMany({}),
      Order.deleteMany({}),
      Manufacturing.deleteMany({}),
      Dispatch.deleteMany({}),
      Sale.deleteMany({}),
      Account.deleteMany({}),
      Purchase.deleteMany({}),
      Settings.deleteMany({})
    ]);

    console.log('Seeding users...');
    const users = await User.create([
      {
        username: 'superadmin',
        email: 'admin@manuErp.com',
        password: 'password123',
        fullName: 'Super Administrator',
        role: USER_ROLES.SUPER_USER,
        isActive: true
      },
      {
        username: 'unithead1',
        email: 'unithead1@manuErp.com',
        password: 'password123',
        fullName: 'Unit Head - Assembly',
        role: USER_ROLES.UNIT_HEAD,
        unit: 'Unit A - Assembly',
        isActive: true
      },
      {
        username: 'production1',
        email: 'production1@manuErp.com',
        password: 'password123',
        fullName: 'Production Manager',
        role: USER_ROLES.PRODUCTION,
        unit: 'Unit A - Assembly',
        isActive: true
      },
      {
        username: 'packing1',
        email: 'packing1@manuErp.com',
        password: 'password123',
        fullName: 'Packing Supervisor',
        role: USER_ROLES.PACKING,
        unit: 'Unit B - Packaging',
        isActive: true
      },
      {
        username: 'dispatch1',
        email: 'dispatch1@manuErp.com',
        password: 'password123',
        fullName: 'Dispatch Manager',
        role: USER_ROLES.DISPATCH,
        unit: 'Unit C - Dispatch',
        isActive: true
      },
      {
        username: 'accounts1',
        email: 'accounts1@manuErp.com',
        password: 'password123',
        fullName: 'Accounts Manager',
        role: USER_ROLES.ACCOUNTS,
        unit: 'Unit A - Assembly',
        isActive: true
      }
    ]);

    console.log('Seeding customers...');
    const customers = await Customer.create([
      {
        customerName: 'Acme Corporation',
        contactPerson: 'John Smith',
        email: 'john@acmecorp.com',
        phone: '+1-555-0101',
        address: {
          street: '123 Business St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'USA'
        },
        gstNumber: 'GST123456789',
        creditLimit: 50000,
        creditDays: 30,
        unit: 'Unit A - Assembly',
        customerType: 'VIP'
      },
      {
        customerName: 'TechFlow Solutions',
        contactPerson: 'Sarah Johnson',
        email: 'sarah@techflow.com',
        phone: '+1-555-0102',
        address: {
          street: '456 Tech Ave',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'USA'
        },
        gstNumber: 'GST987654321',
        creditLimit: 30000,
        creditDays: 45,
        unit: 'Unit A - Assembly',
        customerType: 'Regular'
      },
      {
        customerName: 'Global Manufacturing Inc',
        contactPerson: 'Mike Chen',
        email: 'mike@globalmanuf.com',
        phone: '+1-555-0103',
        address: {
          street: '789 Industrial Blvd',
          city: 'Detroit',
          state: 'MI',
          zipCode: '48201',
          country: 'USA'
        },
        creditLimit: 75000,
        creditDays: 30,
        unit: 'Unit B - Packaging',
        customerType: 'Wholesale'
      }
    ]);

    console.log('Seeding suppliers...');
    const suppliers = await Supplier.create([
      {
        supplierName: 'Steel Works Ltd',
        contactPerson: 'Robert Williams',
        email: 'robert@steelworks.com',
        phone: '+1-555-0201',
        address: {
          street: '100 Steel Mill Rd',
          city: 'Pittsburgh',
          state: 'PA',
          zipCode: '15201',
          country: 'USA'
        },
        gstNumber: 'GST111111111',
        unit: 'Unit A - Assembly',
        supplierType: 'Raw Material',
        rating: 4
      },
      {
        supplierName: 'Precision Components Co',
        contactPerson: 'Lisa Davis',
        email: 'lisa@precisioncomp.com',
        phone: '+1-555-0202',
        address: {
          street: '200 Component St',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          country: 'USA'
        },
        gstNumber: 'GST222222222',
        unit: 'Unit A - Assembly',
        supplierType: 'Raw Material',
        rating: 5
      },
      {
        supplierName: 'Packaging Solutions Inc',
        contactPerson: 'Tom Brown',
        email: 'tom@packagingsol.com',
        phone: '+1-555-0203',
        address: {
          street: '300 Package Way',
          city: 'Atlanta',
          state: 'GA',
          zipCode: '30301',
          country: 'USA'
        },
        unit: 'Unit B - Packaging',
        supplierType: 'Consumables',
        rating: 4
      }
    ]);

    console.log('Seeding inventory...');
    const inventoryItems = await Inventory.create([
      {
        itemName: 'Steel Sheets',
        description: 'High-grade steel sheets for manufacturing',
        category: 'Raw Material',
        unit: 'kg',
        currentStock: 500,
        minStockLevel: 100,
        maxStockLevel: 1000,
        reorderPoint: 150,
        costPrice: 50,
        sellingPrice: 80,
        location: { warehouse: 'Warehouse A', rack: 'A1', bin: '001' },
        supplier: suppliers[0]._id,
        unitName: 'Unit A - Assembly'
      },
      {
        itemName: 'Precision Bolts',
        description: 'M8 x 20mm precision bolts',
        category: 'Raw Material',
        unit: 'pieces',
        currentStock: 2000,
        minStockLevel: 500,
        maxStockLevel: 5000,
        reorderPoint: 800,
        costPrice: 2,
        sellingPrice: 4,
        location: { warehouse: 'Warehouse A', rack: 'A2', bin: '005' },
        supplier: suppliers[1]._id,
        unitName: 'Unit A - Assembly'
      },
      {
        itemName: 'Cardboard Boxes',
        description: 'Large cardboard boxes for packaging',
        category: 'Consumables',
        unit: 'pieces',
        currentStock: 300,
        minStockLevel: 50,
        maxStockLevel: 500,
        reorderPoint: 80,
        costPrice: 5,
        sellingPrice: 8,
        location: { warehouse: 'Warehouse B', rack: 'B1', bin: '001' },
        supplier: suppliers[2]._id,
        unitName: 'Unit B - Packaging'
      },
      {
        itemName: 'Finished Product A',
        description: 'Completed manufactured product A',
        category: 'Finished Goods',
        unit: 'pieces',
        currentStock: 100,
        minStockLevel: 20,
        maxStockLevel: 200,
        reorderPoint: 30,
        costPrice: 200,
        sellingPrice: 350,
        location: { warehouse: 'Finished Goods', rack: 'F1', bin: '001' },
        unitName: 'Unit A - Assembly'
      }
    ]);

    console.log('Seeding orders...');
    const orders = await Order.create([
      {
        customer: customers[0]._id,
        items: [
          {
            productName: 'Product A',
            productCode: 'PRD-A-001',
            quantity: 50,
            unitPrice: 350,
            totalPrice: 17500
          }
        ],
        totalAmount: 17500,
        status: ORDER_STATUS.COMPLETED,
        expectedDeliveryDate: new Date('2024-12-15'),
        actualDeliveryDate: new Date('2024-12-14'),
        unit: 'Unit A - Assembly',
        priority: 'High'
      },
      {
        customer: customers[1]._id,
        items: [
          {
            productName: 'Product B',
            productCode: 'PRD-B-001',
            quantity: 25,
            unitPrice: 500,
            totalPrice: 12500
          }
        ],
        totalAmount: 12500,
        status: ORDER_STATUS.IN_PROGRESS,
        expectedDeliveryDate: new Date('2024-12-20'),
        unit: 'Unit A - Assembly',
        priority: 'Medium'
      },
      {
        customer: customers[2]._id,
        items: [
          {
            productName: 'Product C',
            productCode: 'PRD-C-001',
            quantity: 100,
            unitPrice: 200,
            totalPrice: 20000
          }
        ],
        totalAmount: 20000,
        status: ORDER_STATUS.NEW,
        expectedDeliveryDate: new Date('2024-12-25'),
        unit: 'Unit B - Packaging',
        priority: 'Low'
      }
    ]);

    console.log('Seeding manufacturing jobs...');
    const manufacturingJobs = await Manufacturing.create([
      {
        order: orders[0]._id,
        productName: 'Product A',
        plannedQuantity: 50,
        actualQuantity: 50,
        status: PRODUCTION_STATUS.COMPLETED,
        startDate: new Date('2024-12-01'),
        expectedEndDate: new Date('2024-12-10'),
        actualEndDate: new Date('2024-12-09'),
        unit: 'Unit A - Assembly',
        assignedWorkers: [users[2]._id],
        machineUsed: 'Machine A1',
        qualityCheckPassed: true,
        efficiency: 95
      },
      {
        order: orders[1]._id,
        productName: 'Product B',
        plannedQuantity: 25,
        actualQuantity: 15,
        status: PRODUCTION_STATUS.IN_PROGRESS,
        startDate: new Date('2024-12-05'),
        expectedEndDate: new Date('2024-12-15'),
        unit: 'Unit A - Assembly',
        assignedWorkers: [users[2]._id],
        machineUsed: 'Machine A2',
        efficiency: 80
      }
    ]);

    console.log('Seeding dispatches...');
    const dispatches = await Dispatch.create([
      {
        order: orders[0]._id,
        customer: customers[0]._id,
        items: [
          {
            productName: 'Product A',
            quantity: 50,
            batchNumber: 'BATCH-A-001'
          }
        ],
        status: DISPATCH_STATUS.DELIVERED,
        expectedDeliveryDate: new Date('2024-12-15'),
        actualDeliveryDate: new Date('2024-12-14'),
        transporterName: 'Express Logistics',
        vehicleNumber: 'TRK-001',
        driverName: 'James Wilson',
        driverContact: '+1-555-0301',
        trackingNumber: 'TRK123456789',
        unit: 'Unit A - Assembly',
        shippingAddress: customers[0].address
      }
    ]);

    console.log('Seeding sales...');
    const sales = await Sale.create([
      {
        order: orders[0]._id,
        customer: customers[0]._id,
        items: [
          {
            productName: 'Product A',
            quantity: 50,
            unitPrice: 350,
            totalPrice: 17500,
            tax: 1750
          }
        ],
        subtotal: 17500,
        taxAmount: 1750,
        totalAmount: 19250,
        paymentStatus: PAYMENT_STATUS.PAID,
        paymentMethod: 'Bank Transfer',
        saleDate: new Date('2024-12-14'),
        dueDate: new Date('2024-12-29'),
        paidDate: new Date('2024-12-14'),
        paidAmount: 19250,
        unit: 'Unit A - Assembly',
        dispatch: dispatches[0]._id
      }
    ]);

    console.log('Seeding accounts...');
    const accounts = await Account.create([
      {
        accountName: 'Cash',
        accountType: 'Asset',
        balance: 100000,
        unit: 'Unit A - Assembly',
        description: 'Cash on hand'
      },
      {
        accountName: 'Accounts Receivable',
        accountType: 'Asset',
        balance: 50000,
        unit: 'Unit A - Assembly',
        description: 'Money owed by customers'
      },
      {
        accountName: 'Inventory',
        accountType: 'Asset',
        balance: 75000,
        unit: 'Unit A - Assembly',
        description: 'Inventory value'
      },
      {
        accountName: 'Sales Revenue',
        accountType: 'Revenue',
        balance: 200000,
        unit: 'Unit A - Assembly',
        description: 'Revenue from sales'
      },
      {
        accountName: 'Cost of Goods Sold',
        accountType: 'Expense',
        balance: 120000,
        unit: 'Unit A - Assembly',
        description: 'Direct costs of production'
      }
    ]);

    console.log('Seeding purchases...');
    const purchases = await Purchase.create([
      {
        supplier: suppliers[0]._id,
        items: [
          {
            item: inventoryItems[0]._id,
            itemName: 'Steel Sheets',
            quantity: 200,
            unitPrice: 50,
            totalPrice: 10000,
            receivedQuantity: 200,
            pendingQuantity: 0
          }
        ],
        totalAmount: 10000,
        taxAmount: 1000,
        grandTotal: 11000,
        status: 'Received',
        paymentStatus: PAYMENT_STATUS.PAID,
        expectedDeliveryDate: new Date('2024-12-10'),
        actualDeliveryDate: new Date('2024-12-09'),
        unit: 'Unit A - Assembly',
        createdBy: users[0]._id,
        isApproved: true,
        approvedBy: users[1]._id
      },
      {
        supplier: suppliers[1]._id,
        items: [
          {
            item: inventoryItems[1]._id,
            itemName: 'Precision Bolts',
            quantity: 1000,
            unitPrice: 2,
            totalPrice: 2000,
            receivedQuantity: 0,
            pendingQuantity: 1000
          }
        ],
        totalAmount: 2000,
        taxAmount: 200,
        grandTotal: 2200,
        status: 'Sent',
        paymentStatus: PAYMENT_STATUS.PENDING,
        expectedDeliveryDate: new Date('2024-12-18'),
        unit: 'Unit A - Assembly',
        createdBy: users[0]._id,
        isApproved: true,
        approvedBy: users[1]._id
      }
    ]);

    console.log('Seeding settings...');
    await Settings.create({
      company: {
        name: 'ManuERP Industries',
        address: {
          street: '123 Manufacturing Ave',
          city: 'Industrial City',
          state: 'Manufacturing State',
          zipCode: '12345',
          country: 'USA'
        },
        contact: {
          phone: '+1-555-0100',
          email: 'info@manuErp.com',
          website: 'www.manuErp.com'
        },
        gstNumber: 'GST000000000',
        panNumber: 'PAN0000000'
      },
      system: {
        currency: 'USD',
        timezone: 'America/New_York',
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12',
        language: 'en'
      },
      modules: {
        dashboard: true,
        orders: true,
        manufacturing: true,
        dispatches: true,
        sales: true,
        accounts: true,
        inventory: true,
        customers: true,
        suppliers: true,
        purchases: true
      },
      notifications: {
        lowStock: true,
        orderDelay: true,
        paymentDue: true,
        productionAlert: true
      }
    });

    console.log('✅ Database seeded successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// Run the seed function
seedData();
