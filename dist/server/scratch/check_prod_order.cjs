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
const { MongoClient } = require('mongodb');
const uri = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new MongoClient(uri);
        try {
            yield client.connect();
            const db = client.db('samtek-erp');
            console.log('--- FINDING ORDER ORD-AUTO-1818 ---');
            const order = yield db.collection('orders').findOne({ orderCode: 'ORD-AUTO-1818' });
            console.log('Order Details:', JSON.stringify(order, null, 2));
            if (order) {
                console.log('--- FINDING SALE FOR ORDER ---');
                const sale = yield db.collection('sales').findOne({ order: order._id });
                console.log('Sale Details:', JSON.stringify(sale, null, 2));
            }
        }
        finally {
            yield client.close();
        }
    });
}
run().catch(console.dir);
