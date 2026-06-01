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
exports.resetCustomerCollectionRoute = exports.resetCustomerCollection = void 0;
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const mongoose_1 = __importDefault(require("mongoose"));
const resetCustomerCollection = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Resetting customer collection...');
        // First, try to drop all indexes
        try {
            yield Customer_js_1.default.collection.dropIndexes();
            console.log('All indexes dropped successfully');
        }
        catch (indexError) {
            console.log('Could not drop indexes:', indexError.message);
        }
        // Drop the entire collection to remove any conflicting indexes
        yield Customer_js_1.default.collection.drop().catch(err => {
            if (err.code !== 26) { // 26 = NamespaceNotFound
                throw err;
            }
            console.log('Collection did not exist, continuing...');
        });
        console.log('Customer collection dropped successfully');
        // Wait a moment for the drop to complete
        yield new Promise(resolve => setTimeout(resolve, 1000));
        // Recreate the collection with proper indexes
        yield Customer_js_1.default.createIndexes();
        console.log('Customer collection recreated with proper indexes');
        return { success: true, message: 'Customer collection reset successfully' };
    }
    catch (error) {
        console.error('Error resetting customer collection:', error);
        throw error;
    }
});
exports.resetCustomerCollection = resetCustomerCollection;
// Add this as a route for testing
const resetCustomerCollectionRoute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, exports.resetCustomerCollection)();
        res.json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error resetting customer collection',
            error: error.message
        });
    }
});
exports.resetCustomerCollectionRoute = resetCustomerCollectionRoute;
