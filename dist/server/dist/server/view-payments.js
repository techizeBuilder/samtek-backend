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
const LeadPayment_js_1 = __importDefault(require("./models/LeadPayment.js"));
const Lead_js_1 = __importDefault(require("./models/Lead.js"));
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
    try {
        const payments = yield LeadPayment_js_1.default.find({ leadCode: 'LD-0006' }).lean();
        console.log(`Found ${payments.length} payments for LD-0006:`);
        payments.forEach((p, idx) => {
            console.log(`\nPayment ${idx + 1}:`);
            console.log(`  ID: ${p._id}`);
            console.log(`  Amount: ${p.amount}`);
            console.log(`  Method: ${p.paymentMethod}`);
            console.log(`  BankAccount ID: ${p.bankAccount}`);
            console.log(`  Status: ${p.status}`);
            console.log(`  Created At: ${p.createdAt}`);
        });
    }
    catch (error) {
        console.error('Error:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
    }
});
run();
