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
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const User_js_1 = __importDefault(require("../models/User.js"));
const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield mongoose_1.default.connect(MONGODB_URI);
    console.log('Connected to:', MONGODB_URI.split('@')[1]);
    const user = yield User_js_1.default.findOne({ email: 'qchead@gmail.com' }).lean();
    if (!user) {
        console.log('❌ User NOT FOUND in database');
    }
    else {
        console.log('✅ User found:');
        console.log('  email:', user.email);
        console.log('  username:', user.username);
        console.log('  role:', user.role);
        console.log('  isActive:', user.isActive);
        console.log('  companyId:', user.companyId);
        console.log('  passwordHash length:', (_a = user.password) === null || _a === void 0 ? void 0 : _a.length);
        // Test password
        const match = yield bcryptjs_1.default.compare('123456', user.password);
        console.log('  password "123456" matches:', match);
    }
    // Also list all users
    const all = yield User_js_1.default.find({}, 'email role isActive').lean();
    console.log('\nAll users in DB:', all.length);
    all.forEach(u => console.log(' ', u.email, '|', u.role, '|', u.isActive ? 'active' : 'INACTIVE'));
    yield mongoose_1.default.disconnect();
    process.exit(0);
});
run().catch(e => { console.error(e); process.exit(1); });
