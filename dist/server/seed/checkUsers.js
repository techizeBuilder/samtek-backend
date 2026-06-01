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
const User_js_1 = __importDefault(require("../models/User.js"));
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.connect(MONGODB_URI);
    const users = yield User_js_1.default.find({}, 'email role isActive fullName').lean();
    console.log('Total users:', users.length);
    if (users.length === 0) {
        console.log('NO USERS FOUND — database may be empty!');
    }
    else {
        users.forEach(u => console.log(`  ${(u.email || 'no-email').padEnd(35)} | ${(u.role || 'no-role').padEnd(30)} | ${u.isActive ? 'active' : 'INACTIVE'}`));
    }
    yield mongoose_1.default.disconnect();
    process.exit(0);
});
run().catch(e => { console.error(e.message); process.exit(1); });
