"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCompanySeeding = exports.seedCompanyData = void 0;
const Company_js_1 = require("../models/Company.js");
const companiesData = [
    {
        unitName: 'Sunrise Foods Pvt Ltd',
        name: 'Sunrise Foods',
        mobile: '+91-9876543210',
        email: 'info@sunrisefoods.hyderabad.com',
        address: 'Plot No. 123, Industrial Estate, Gachibowli',
        locationPin: '500032',
        city: 'Hyderabad',
        state: 'Telangana',
        country: 'India',
        gst: '36AABCS1234N1Z5',
        fssai: '12345678901234',
        orderCutoffTime: '18:00',
        isActive: true,
        businessHours: {
            opening: '09:00',
            closing: '18:00'
        }
    },
    {
        unitName: 'Akshaya Foods Pvt Ltd',
        name: 'Akshaya Foods',
        mobile: '+91-9876543211',
        email: 'contact@akshayafoods.hyderabad.com',
        address: 'No. 456, Food Processing Zone, Medchal',
        locationPin: '501401',
        city: 'Hyderabad',
        state: 'Telangana',
        country: 'India',
        gst: '36AABCA2345M1Z6',
        fssai: '23456789012345',
        orderCutoffTime: '17:30',
        isActive: true,
        businessHours: {
            opening: '08:30',
            closing: '17:30'
        }
    },
    {
        unitName: 'Sunrise Foods Pvt Ltd',
        name: 'Sunrise Foods',
        mobile: '+91-9876543212',
        email: 'bengaluru@sunrisefoods.com',
        address: 'No. 789, Electronic City Phase 1',
        locationPin: '560100',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        gst: '29AABCS1234N2Z7',
        fssai: '34567890123456',
        orderCutoffTime: '18:30',
        isActive: true,
        businessHours: {
            opening: '09:30',
            closing: '18:30'
        }
    },
    {
        unitName: 'Sunrise Foods Pvt Ltd',
        name: 'Sunrise Foods (Bangalore)',
        mobile: '+91-9876543213',
        email: 'bangalore@sunrisefoods.com',
        address: 'Plot No. 321, Whitefield Industrial Area',
        locationPin: '560066',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        gst: '29AABCS1234N3Z8',
        fssai: '45678901234567',
        orderCutoffTime: '19:00',
        isActive: true,
        businessHours: {
            opening: '10:00',
            closing: '19:00'
        }
    },
    {
        unitName: 'Sunrise Foods Pvt Ltd',
        name: 'Sunrise Foods (Tirupati)',
        mobile: '+91-9876543214',
        email: 'tirupati@sunrisefoods.com',
        address: 'Survey No. 654, Renigunta Industrial Park',
        locationPin: '517520',
        city: 'Tirupati',
        state: 'Andhra Pradesh',
        country: 'India',
        gst: '37AABCS1234N4Z9',
        fssai: '56789012345678',
        orderCutoffTime: '17:00',
        isActive: true,
        businessHours: {
            opening: '08:00',
            closing: '17:00'
        }
    }
];
const seedCompanyData = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🌱 Starting company seeding...');
        // Check if companies already exist
        const existingCompaniesCount = yield Company_js_1.Company.countDocuments();
        if (existingCompaniesCount > 0) {
            console.log(`📋 Found ${existingCompaniesCount} existing companies. Checking for duplicates...`);
            // Check for duplicates by GST number
            const existingGSTs = yield Company_js_1.Company.distinct('gst');
            const newCompanies = companiesData.filter(company => !existingGSTs.includes(company.gst));
            if (newCompanies.length === 0) {
                console.log('✅ All companies already exist. Skipping seeding.');
                return { success: true, message: 'All companies already exist', added: 0, existing: existingCompaniesCount };
            }
            // Add only new companies
            const result = yield Company_js_1.Company.insertMany(newCompanies, { ordered: false });
            console.log(`✅ Added ${result.length} new companies successfully!`);
            return {
                success: true,
                message: 'Companies seeded successfully',
                added: result.length,
                existing: existingCompaniesCount,
                companies: result
            };
        }
        else {
            // No existing companies, add all
            const result = yield Company_js_1.Company.insertMany(companiesData);
            console.log(`✅ Seeded ${result.length} companies successfully!`);
            // Log the companies
            result.forEach((company, index) => {
                console.log(`${index + 1}. ${company.name} - ${company.city}`);
            });
            return {
                success: true,
                message: 'Companies seeded successfully',
                added: result.length,
                companies: result
            };
        }
    }
    catch (error) {
        console.error('❌ Error seeding companies:', error);
        // Handle duplicate key errors gracefully
        if (error.code === 11000) {
            console.log('⚠️ Some companies already exist (duplicate GST numbers). Continuing...');
            return {
                success: true,
                message: 'Some companies already exist',
                error: 'Duplicate entries found'
            };
        }
        return {
            success: false,
            message: 'Failed to seed companies',
            error: error.message
        };
    }
});
exports.seedCompanyData = seedCompanyData;
// Function to run seeding independently
const runCompanySeeding = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { default: connectDB } = yield Promise.resolve().then(() => __importStar(require('../config/database.js')));
        yield connectDB();
        const result = yield (0, exports.seedCompanyData)();
        console.log('Seeding result:', result);
        process.exit(0);
    }
    catch (error) {
        console.error('Error running company seeding:', error);
        process.exit(1);
    }
});
exports.runCompanySeeding = runCompanySeeding;
// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    (0, exports.runCompanySeeding)();
}
