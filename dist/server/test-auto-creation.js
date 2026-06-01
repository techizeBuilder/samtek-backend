"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
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
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
// Get current directory path for ES modules
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path_1.default.dirname(__filename);
// Load environment variables from parent directory
dotenv_1.default.config({ path: path_1.default.join(__dirname, '..', '.env') });
function testAutoCreation() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Connect to MongoDB
            const mongoUri = process.env.MONGODB_URI;
            yield mongoose_1.default.connect(mongoUri);
            console.log('✅ Connected to MongoDB');
            const db = mongoose_1.default.connection.db;
            const collection = db.collection('productdailysummaries');
            // Check initial count for today
            const today = new Date('2025-11-27');
            today.setUTCHours(0, 0, 0, 0);
            const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
            const initialCount = yield collection.countDocuments({
                date: { $gte: today, $lt: tomorrow }
            });
            console.log(`📊 Initial records for today: ${initialCount}`);
            // Simulate a frontend API call
            console.log('🔄 Simulating frontend API call...');
            // Import and call the function that frontend calls
            const { getSalesSummary } = yield Promise.resolve().then(() => __importStar(require('./controllers/salesSummaryController.js')));
            // Mock request and response objects
            const mockReq = {
                query: { date: '2025-11-27' },
                user: {
                    role: 'Unit Manager',
                    companyId: '6914090118cf85f80ad856bc',
                    id: 'test-user'
                }
            };
            const mockRes = {
                json: (data) => {
                    console.log('📋 API Response:', {
                        success: data.success,
                        productsCount: data.products ? data.products.length : 0
                    });
                    return mockRes;
                },
                status: (code) => {
                    console.log(`📡 Response Status: ${code}`);
                    return mockRes;
                }
            };
            // Call the function
            yield getSalesSummary(mockReq, mockRes);
            // Check final count for today
            const finalCount = yield collection.countDocuments({
                date: { $gte: today, $lt: tomorrow }
            });
            console.log(`📊 Final records for today: ${finalCount}`);
            if (finalCount > initialCount) {
                console.log('❌ AUTO-CREATION STILL HAPPENING! New records were created.');
            }
            else {
                console.log('✅ AUTO-CREATION DISABLED! No new records created.');
            }
        }
        catch (error) {
            console.error('❌ Error:', error);
        }
        finally {
            yield mongoose_1.default.disconnect();
            console.log('🔌 Disconnected from MongoDB');
            process.exit(0);
        }
    });
}
// Run the test
console.log('🚀 Testing if auto-creation is disabled...');
testAutoCreation();
