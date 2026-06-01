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
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const Dispatch_js_1 = __importDefault(require("../models/Dispatch.js"));
const Company_js_1 = require("../models/Company.js");
const User_js_1 = __importDefault(require("../models/User.js"));
const Inventory_js_1 = require("../models/Inventory.js");
dotenv_1.default.config();
const createDummyData = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Connect to MongoDB
        yield mongoose_1.default.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
        console.log('✅ Connected to MongoDB');
        // Get or create company
        let company = yield Company_js_1.Company.findOne();
        if (!company) {
            company = yield Company_js_1.Company.create({
                unitName: 'Test Company',
                companyName: 'Test Company'
            });
            console.log('✅ Created test company:', company._id);
        }
        else {
            console.log('✅ Using existing company:', company._id);
        }
        // Get existing user
        let user = yield User_js_1.default.findOne({ company: company._id });
        if (!user) {
            console.log('⚠️  No user found. Creating dispatch data without user references.');
            user = { _id: new mongoose_1.default.Types.ObjectId() }; // Create a placeholder user ID
        }
        else {
            console.log('✅ Using existing user:', user._id);
        }
        // Get items
        let items = yield Inventory_js_1.Item.find({ company: company._id }).limit(3);
        if (items.length === 0) {
            // Create sample items with unique codes
            const timestamp = Date.now();
            const sampleItems = [
                { name: 'Product A', code: `PA-${timestamp}`, category: 'Electronics', type: 'Product', unit: 'pieces', company: company._id },
                { name: 'Material B', code: `MB-${timestamp}`, category: 'Electronics', type: 'Material', unit: 'pieces', company: company._id },
                { name: 'Spare C', code: `SC-${timestamp}`, category: 'Mechanical', type: 'Spares', unit: 'kg', company: company._id }
            ];
            items = yield Inventory_js_1.Item.create(sampleItems);
            console.log('✅ Created sample items:', items.map(i => i.name).join(', '));
        }
        else {
            console.log('✅ Using existing items:', items.map(i => i.name).join(', '));
        }
        // Create dummy dispatch entries
        const dispatchEntries = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 5; i++) {
            const dcno = yield Dispatch_js_1.default.generateNextDCno(company._id);
            for (let j = 0; j < 2; j++) {
                const item = items[j % items.length];
                const dispatchData = {
                    productId: item._id,
                    productName: item.name,
                    productGroup: `Test Group ${i + 1}`,
                    company: company._id,
                    date: new Date(today),
                    packedQuantityReadyForDispatch: (i + 1) * 100 + j * 10,
                    previousClosingStockYesterdayBalance: (i + 1) * 50,
                    returnQuantityYesterdayReturns: j * 5,
                    totalIndentQuantityOrdersForTheDay: (i + 1) * 120,
                    dispatchedQuantitySentToday: (i + 1) * 80 + j * 5,
                    physicalStockEntryManualVerification: (i + 1) * 70,
                    dcno,
                    status: ['pending', 'verified', 'dispatched'][i % 3],
                    verifiedBy: i % 2 === 0 ? user._id : undefined,
                    verifiedAt: i % 2 === 0 ? new Date() : undefined,
                    lastUpdatedBy: user._id,
                    remarks: `Test dispatch entry for ${item.name}`
                };
                const dispatch = yield Dispatch_js_1.default.create(dispatchData);
                dispatchEntries.push(dispatch);
                console.log(`✅ Created dispatch entry DC${dispatchData.dcno.slice(-3)} for ${item.name}`);
            }
        }
        console.log('\n✅ Dummy dispatch data created successfully!');
        console.log(`   - Dispatch Entries: ${dispatchEntries.length}`);
        console.log(`   - Items: ${items.length}`);
        console.log(`   - Company: ${company._id}`);
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Error creating dummy data:', error.message);
        console.error(error);
        process.exit(1);
    }
});
createDummyData();
