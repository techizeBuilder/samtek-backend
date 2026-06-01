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
dotenv_1.default.config();
const seedPackingData = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield mongoose_1.default.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
        console.log('✅ Connected to MongoDB');
        const db = mongoose_1.default.connection.db;
        // Get company
        const company = yield db.collection('companies').findOne({});
        if (!company) {
            console.log('❌ No company found. Please create a company first.');
            process.exit(1);
        }
        console.log('✅ Using company:', company._id);
        // Get items
        const items = yield db.collection('items').find({ company: company._id }).limit(3).toArray();
        if (items.length === 0) {
            console.log('❌ No items found. Run seedDispatch.js first to create items.');
            process.exit(1);
        }
        console.log('✅ Using items:', items.map(i => i.name).join(', '));
        // Create packing sheets
        const packingSheets = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Get next serial number
        const lastSheet = yield db.collection('packingsheets').findOne({ company: company._id }, { sort: { slNo: -1 } });
        let slNo = lastSheet ? lastSheet.slNo + 1 : 1;
        for (let i = 0; i < 3; i++) {
            const packingData = {
                slNo,
                productionGroupName: `Generic Group ${i + 1}`,
                packingDate: new Date(today),
                shift: ['morning', 'evening', 'night'][i % 3],
                status: ['pending', 'in_progress', 'completed'][i % 3],
                packingLoss: Math.floor(Math.random() * 10),
                totalPackedQty: (i + 1) * 100,
                notes: `Packing sheet ${slNo} - dummy data`,
                items: items.slice(0, 2).map(item => ({
                    productId: item._id,
                    productName: item.name,
                    indentQty: (i + 1) * 50,
                    producedQty: (i + 1) * 50,
                    packedQty: (i + 1) * 45,
                    packingLoss: i + 2,
                    notes: ''
                })),
                company: company._id,
                createdAt: new Date(),
                updatedAt: new Date(),
                isActive: true
            };
            if (i % 3 === 2) {
                packingData.approvedAt = new Date();
            }
            yield db.collection('packingsheets').insertOne(packingData);
            packingSheets.push(packingData);
            console.log(`✅ Created packing sheet SL.${slNo}`);
            slNo++;
        }
        console.log('\n✅ Dummy packing data created successfully!');
        console.log(`   - Total Packing Sheets: ${packingSheets.length}`);
        console.log(`   - Items per sheet: 2`);
        console.log(`   - Shifts: Morning, Evening, Night`);
        console.log(`   - Statuses: Pending, In Progress, Completed (Approved)`);
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Error creating dummy data:', error.message);
        console.error(error);
        process.exit(1);
    }
});
seedPackingData();
