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
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';
// Collections we NEVER want to drop (even if empty)
const PROTECTED = new Set(['users', 'companies', 'settings', 'branches', 'departments']);
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.connect(MONGODB_URI);
    const db = mongoose_1.default.connection.db;
    const collections = yield db.listCollections().toArray();
    const names = collections.map(c => c.name);
    const dropped = [];
    for (const name of names) {
        if (PROTECTED.has(name))
            continue;
        const count = yield db.collection(name).countDocuments({}, { limit: 1 });
        if (count === 0) {
            yield db.dropCollection(name);
            dropped.push(name);
            console.log(`  ✓ Dropped empty collection: ${name}`);
        }
    }
    console.log(`\nDropped ${dropped.length} empty collections: ${JSON.stringify(dropped)}`);
    const remaining = yield db.listCollections().toArray();
    console.log(`Collections remaining in manuerp: ${remaining.length}`);
    yield mongoose_1.default.disconnect();
});
run().catch(err => { console.error(err.message); process.exit(1); });
