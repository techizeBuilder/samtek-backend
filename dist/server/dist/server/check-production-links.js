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
const ProductionOrder_js_1 = __importDefault(require("./models/ProductionOrder.js"));
const Sale_js_1 = __importDefault(require("./models/Sale.js"));
function checkProductionLinks() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect('mongodb://localhost:27017/samtek');
            console.log('🔗 MongoDB Connected');
            console.log('\n🔍 CHECKING PRODUCTION ORDER LINKS\n');
            // Check all Production Orders
            const allProduction = yield ProductionOrder_js_1.default.find({}).sort({ createdAt: -1 });
            console.log(`🏭 All Production Orders (${allProduction.length}):`);
            for (const prod of allProduction) {
                console.log(`\\n📦 Production: ${prod.orderId}`);
                console.log(`  Company: ${prod.company}`);
                console.log(`  Machine: ${prod.machineName}`);
                console.log(`  Status: ${prod.status}`);
                console.log(`  Notes: ${prod.notes || 'No notes'}`);
                // Try to find matching Sale
                if (prod.notes) {
                    const refMatch = prod.notes.match(/Ref: (.+)$/);
                    if (refMatch) {
                        const sourceRefId = refMatch[1];
                        console.log(`  Looking for Sale with invoiceNumber: ${sourceRefId}`);
                        const matchingSale = yield Sale_js_1.default.findOne({
                            invoiceNumber: sourceRefId
                        });
                        if (matchingSale) {
                            console.log(`  ✅ Found matching Sale: ${matchingSale.invoiceNumber} (Company: ${matchingSale.companyId})`);
                            // Check if companies match
                            if (String(prod.company) === String(matchingSale.companyId)) {
                                console.log(`  ✅ Company IDs MATCH!`);
                            }
                            else {
                                console.log(`  ❌ Company ID MISMATCH!`);
                                console.log(`    Production: ${prod.company}`);
                                console.log(`    Sale: ${matchingSale.companyId}`);
                            }
                        }
                        else {
                            console.log(`  ❌ No matching Sale found`);
                        }
                    }
                }
            }
            mongoose_1.default.connection.close();
        }
        catch (error) {
            console.error('❌ Error:', error);
            mongoose_1.default.connection.close();
        }
    });
}
checkProductionLinks();
