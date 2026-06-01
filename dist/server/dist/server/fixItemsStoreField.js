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
const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
function fixItemsStoreField() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose.connect(MONGODB_URI);
            console.log('Connected to MongoDB');
            const db = mongoose.connection.db;
            // Find items where store is an ObjectId and convert to String
            const items = yield db.collection('items').find({ store: { $type: 'objectId' } }).toArray();
            console.log(`Found ${items.length} items with store as ObjectId`);
            let updatedCount = 0;
            for (const item of items) {
                const storeStr = item.store.toString();
                yield db.collection('items').updateOne({ _id: item._id }, { $set: { store: storeStr } });
                updatedCount++;
            }
            console.log(`Successfully updated ${updatedCount} items to use String for store field.`);
            // Also, just in case, let's update all items that have the store as "69ea063b78220d106638b0ef" 
            // to ensure they are definitely strings.
            const result2 = yield db.collection('items').updateMany({ store: new mongoose.Types.ObjectId("69ea063b78220d106638b0ef") }, { $set: { store: "69ea063b78220d106638b0ef" } });
            console.log(`Second pass updated: ${result2.modifiedCount} items (matched ${result2.matchedCount}).`);
        }
        catch (error) {
            console.error('Error fixing items:', error);
        }
        finally {
            yield mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        }
    });
}
fixItemsStoreField();
