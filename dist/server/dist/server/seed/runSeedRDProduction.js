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
const seedRDProduction_js_1 = require("./seedRDProduction.js");
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Connecting to MongoDB...');
        yield mongoose_1.default.connect(MONGODB_URI);
        console.log('Connected. Seeding R&D and Production data...\n');
        const result = yield (0, seedRDProduction_js_1.seedRDProduction)();
        console.log('\nResult:', JSON.stringify(result, null, 2));
        yield mongoose_1.default.disconnect();
        console.log('\nDone.');
        process.exit(0);
    }
    catch (err) {
        console.error('Seed error:', err);
        process.exit(1);
    }
});
run();
