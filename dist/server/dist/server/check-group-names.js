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
const ProductionGroup_js_1 = __importDefault(require("./models/ProductionGroup.js"));
const database_js_1 = require("./config/database.js");
function checkGroupNames() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, database_js_1.connectDB)();
            console.log('📦 Checking Production Group Names...\n');
            const groups = yield ProductionGroup_js_1.default.find({})
                .populate('company', 'name')
                .populate('items', 'name');
            console.log(`Found ${groups.length} production groups:\n`);
            groups.forEach((group, index) => {
                var _a, _b;
                console.log(`${index + 1}. Group Name: "${group.groupName}"`);
                console.log(`   Company: ${((_a = group.company) === null || _a === void 0 ? void 0 : _a.name) || 'N/A'}`);
                console.log(`   Items: ${((_b = group.items) === null || _b === void 0 ? void 0 : _b.length) || 0}`);
                console.log(`   Active: ${group.isActive}`);
                console.log('');
            });
            // Check for typos
            const possibleTypos = groups.filter(g => g.groupName.toLowerCase().includes('broun') ||
                g.groupName.toLowerCase().includes('boun'));
            if (possibleTypos.length > 0) {
                console.log('\n⚠️  Groups with "broun" or "boun":');
                possibleTypos.forEach(g => {
                    console.log(`   - "${g.groupName}"`);
                });
            }
            process.exit(0);
        }
        catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    });
}
checkGroupNames();
