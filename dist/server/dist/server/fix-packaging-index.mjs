"use strict";
/**
 * Run this script ONCE to fix the duplicate key error on packagingjobs collection.
 * It drops the old index (without partialFilterExpression) and recreates it correctly.
 *
 * Usage: node fix-packaging-index.mjs
 */
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
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!MONGO_URI) {
    console.error('❌ No MongoDB URI found in .env (tried MONGODB_URI, MONGO_URI, DATABASE_URL)');
    process.exit(1);
}
function fixIndex() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose.connect(MONGO_URI);
            console.log('✅ Connected to MongoDB');
            const db = mongoose.connection.db;
            const collection = db.collection('packagingjobs');
            // List current indexes
            const indexes = yield collection.indexes();
            console.log('\nCurrent indexes:');
            indexes.forEach(idx => console.log(' -', JSON.stringify(idx)));
            // Drop the problematic index
            const indexName = 'company_1_productionOrderId_1';
            try {
                yield collection.dropIndex(indexName);
                console.log(`\n✅ Dropped old index: ${indexName}`);
            }
            catch (e) {
                if (e.code === 27) {
                    console.log(`\nℹ️  Index ${indexName} not found — may already be correct or dropped`);
                }
                else {
                    throw e;
                }
            }
            // Recreate the correct partial index
            // Note: MongoDB partial index does not support $ne: null directly.
            // Use $exists: true + $type: "objectId" to only index real ObjectId values.
            yield collection.createIndex({ company: 1, productionOrderId: 1 }, {
                unique: true,
                partialFilterExpression: { productionOrderId: { $exists: true, $type: 'objectId' } },
                name: indexName,
            });
            console.log('✅ Recreated index with partialFilterExpression ($type: objectId — null/missing values excluded)');
            // Verify
            const newIndexes = yield collection.indexes();
            console.log('\nUpdated indexes:');
            newIndexes.forEach(idx => console.log(' -', JSON.stringify(idx)));
            console.log('\n✅ Done! Packaging jobs can now be created without duplicate key errors.');
        }
        catch (err) {
            console.error('❌ Error:', err.message);
        }
        finally {
            yield mongoose.disconnect();
            process.exit(0);
        }
    });
}
fixIndex();
