"use strict";
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
exports.inspectDatabaseRoute = exports.inspectCustomerCollection = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const inspectCustomerCollection = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = mongoose_1.default.connection.db;
        const collection = db.collection('customers');
        // Get collection stats
        const stats = yield collection.stats().catch(() => ({ count: 0 }));
        console.log('Collection stats:', stats);
        // Get all indexes
        const indexes = yield collection.indexes();
        console.log('Current indexes:', JSON.stringify(indexes, null, 2));
        // Get sample documents
        const documents = yield collection.find({}).limit(5).toArray();
        console.log('Sample documents:', JSON.stringify(documents, null, 2));
        return {
            success: true,
            stats,
            indexes,
            documents
        };
    }
    catch (error) {
        console.error('Error inspecting collection:', error);
        return {
            success: false,
            error: error.message
        };
    }
});
exports.inspectCustomerCollection = inspectCustomerCollection;
const inspectDatabaseRoute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, exports.inspectCustomerCollection)();
        res.json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error inspecting database',
            error: error.message
        });
    }
});
exports.inspectDatabaseRoute = inspectDatabaseRoute;
