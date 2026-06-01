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
    const admin = mongoose_1.default.connection.db.admin();
    const { databases } = yield admin.listDatabases();
    let totalCollections = 0;
    for (const dbInfo of databases) {
        const db = mongoose_1.default.connection.client.db(dbInfo.name);
        const cols = yield db.listCollections().toArray();
        console.log(`${dbInfo.name}: ${cols.length} collections`);
        totalCollections += cols.length;
    }
    console.log(`\nTotal across all databases: ${totalCollections}`);
    yield mongoose_1.default.disconnect();
});
run().catch(err => { console.error(err.message); process.exit(1); });
