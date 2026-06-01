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
const mongoose_1 = __importDefault(require("mongoose"));
const Account_js_1 = require("./models/Account.js");
function cleanupDuplicateAccounts() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('🧹 Starting duplicate account cleanup...');
            // Find all accounts grouped by accountNumber
            const duplicates = yield Account_js_1.Account.aggregate([
                {
                    $group: {
                        _id: "$accountNumber",
                        count: { $sum: 1 },
                        docs: { $push: "$_id" }
                    }
                },
                {
                    $match: {
                        count: { $gt: 1 }
                    }
                }
            ]);
            console.log(`Found ${duplicates.length} duplicate account numbers`);
            let deletedCount = 0;
            for (const duplicate of duplicates) {
                console.log(`Processing duplicate accountNumber: ${duplicate._id}`);
                // Keep the first document, delete the rest
                const docsToDelete = duplicate.docs.slice(1);
                for (const docId of docsToDelete) {
                    yield Account_js_1.Account.findByIdAndDelete(docId);
                    deletedCount++;
                    console.log(`  Deleted duplicate account: ${docId}`);
                }
            }
            console.log(`✅ Cleanup completed. Deleted ${deletedCount} duplicate accounts.`);
            // Also clean up any accounts with null or empty accountNumber
            const invalidAccounts = yield Account_js_1.Account.find({
                $or: [
                    { accountNumber: null },
                    { accountNumber: "" },
                    { accountNumber: { $exists: false } }
                ]
            });
            if (invalidAccounts.length > 0) {
                console.log(`Found ${invalidAccounts.length} accounts with invalid accountNumber`);
                for (const account of invalidAccounts) {
                    // Generate a new unique account number
                    const newAccountNumber = `CLEANUP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                    account.accountNumber = newAccountNumber;
                    yield account.save();
                    console.log(`  Fixed account ${account._id} with new accountNumber: ${newAccountNumber}`);
                }
            }
            mongoose_1.default.connection.close();
            console.log('🎉 Database cleanup completed successfully!');
        }
        catch (error) {
            console.error('❌ Cleanup error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
cleanupDuplicateAccounts();
