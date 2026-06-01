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
const Lead_js_1 = __importDefault(require("./models/Lead.js"));
const Account_js_1 = require("./models/Account.js");
const leadPaymentController_js_1 = require("./controllers/leadPaymentController.js");
const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const conn = yield mongoose_1.default.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    }
    catch (error) {
        console.error('Database connection error:', error);
        process.exit(1);
    }
});
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield connectDB();
    try {
        // Find the lead LD-0006
        const lead = yield Lead_js_1.default.findOne({ leadCode: 'LD-0006' });
        if (!lead) {
            console.log('Lead not found');
            return;
        }
        console.log('Found Lead:', lead._id, lead.leadCode, lead.companyName);
        // Find any bank or cash account
        const accounts = yield Account_js_1.Account.find({ isBankOrCash: true });
        const bankAccount = accounts.length > 0 ? accounts[0]._id : null;
        console.log('Using Bank Account ID:', bankAccount);
        // Call the controller directly
        const req = {
            body: {
                leadId: lead._id.toString(),
                amount: 10000,
                paymentDate: new Date().toISOString().split('T')[0],
                paymentMethod: 'Bank Transfer',
                bankAccount: bankAccount ? bankAccount.toString() : undefined,
                transactionId: 'TXN-' + Date.now(),
                remarks: 'Test controller call'
            },
            user: {
                _id: new mongoose_1.default.Types.ObjectId(),
                fullName: 'Test Auditor',
                role: 'Accounts',
                companyId: lead.companyId,
                unit: 'Default'
            }
        };
        const res = {
            status: function (code) {
                this.statusCode = code;
                return this;
            },
            json: function (data) {
                console.log(`Response [${this.statusCode || 200}]:`, JSON.stringify(data, null, 2));
            }
        };
        console.log('\nCalling addLeadPayment controller...');
        yield (0, leadPaymentController_js_1.addLeadPayment)(req, res);
    }
    catch (error) {
        console.error('❌ CRASHED:', error);
    }
    finally {
        yield mongoose_1.default.connection.close();
        console.log('Connection closed');
    }
});
run();
