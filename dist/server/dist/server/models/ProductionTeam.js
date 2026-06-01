"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ProductionTeamSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, trim: true },
    supervisor: { type: String, required: true, trim: true },
    members: [{ type: String, trim: true }],
    skills: [{ type: String }],
    efficiency: { type: Number, default: 85, min: 0, max: 100 },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
ProductionTeamSchema.index({ company: 1, isActive: 1 });
exports.default = mongoose_1.default.model('ProductionTeam', ProductionTeamSchema);
