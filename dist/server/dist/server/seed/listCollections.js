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
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.connect(MONGODB_URI);
    const db = mongoose_1.default.connection.db;
    const collections = yield db.listCollections().toArray();
    const names = collections.map(c => c.name).sort();
    console.log(`Total collections: ${names.length}`);
    // R&D and Production related
    const relevant = names.filter(n => /rd|bom|prototype|production|change|toolprocess|qualityparam|document/i.test(n));
    console.log('\nR&D / Production collections:', JSON.stringify(relevant, null, 2));
    // Find empty collections (check all)
    const empty = [];
    for (const col of names) {
        const count = yield db.collection(col).countDocuments({}, { limit: 1 });
        if (count === 0)
            empty.push(col);
    }
    console.log(`\nEmpty collections (${empty.length}):`, JSON.stringify(empty, null, 2));
    yield mongoose_1.default.disconnect();
});
run().catch(err => { console.error(err); process.exit(1); });
