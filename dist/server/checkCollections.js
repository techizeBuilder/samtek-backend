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
const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
function checkCollections() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose.connect(MONGODB_URI);
            console.log('Connected to MongoDB');
            const db = mongoose.connection.db;
            const collections = yield db.listCollections().toArray();
            console.log('Collections:', collections.map(c => c.name).join(', '));
            const itemsCount = yield db.collection('items').countDocuments();
            console.log(`items count: ${itemsCount}`);
            const productsCount = yield db.collection('products').countDocuments();
            console.log(`products count: ${productsCount}`);
        }
        catch (error) {
            console.error('Error:', error);
        }
        finally {
            yield mongoose.disconnect();
        }
    });
}
checkCollections();
