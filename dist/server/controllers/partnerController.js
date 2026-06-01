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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePartner = exports.updatePartner = exports.createPartner = exports.getPartners = void 0;
const Partner_js_1 = require("../models/Partner.js");
const getPartners = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        if (!companyId)
            return res.status(400).json({ success: false, message: 'Company ID required' });
        const partners = yield Partner_js_1.Partner.find({ companyId, isActive: true });
        res.json({ success: true, partners });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPartners = getPartners;
const createPartner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, percentage } = req.body;
        const companyId = req.user.companyId;
        if (!companyId)
            return res.status(400).json({ success: false, message: 'Company ID required' });
        // Check if total percentage exceeds 100
        const existingPartners = yield Partner_js_1.Partner.find({ companyId, isActive: true });
        const totalPct = existingPartners.reduce((sum, p) => sum + p.percentage, 0);
        if (totalPct + percentage > 100) {
            return res.status(400).json({
                success: false,
                message: `Total percentage cannot exceed 100%. Current total: ${totalPct}%`
            });
        }
        const partner = new Partner_js_1.Partner({
            companyId,
            name,
            percentage
        });
        yield partner.save();
        res.status(201).json({ success: true, partner });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.createPartner = createPartner;
const updatePartner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, percentage, isActive } = req.body;
        const companyId = req.user.companyId;
        const partner = yield Partner_js_1.Partner.findOne({ _id: id, companyId });
        if (!partner)
            return res.status(404).json({ success: false, message: 'Partner not found' });
        if (percentage !== undefined) {
            const otherPartners = yield Partner_js_1.Partner.find({ companyId, isActive: true, _id: { $ne: id } });
            const totalPct = otherPartners.reduce((sum, p) => sum + p.percentage, 0);
            if (totalPct + percentage > 100) {
                return res.status(400).json({
                    success: false,
                    message: `Total percentage cannot exceed 100%. Current others: ${totalPct}%`
                });
            }
            partner.percentage = percentage;
        }
        if (name)
            partner.name = name;
        if (isActive !== undefined)
            partner.isActive = isActive;
        yield partner.save();
        res.json({ success: true, partner });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updatePartner = updatePartner;
const deletePartner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;
        const partner = yield Partner_js_1.Partner.findOneAndDelete({ _id: id, companyId });
        if (!partner)
            return res.status(404).json({ success: false, message: 'Partner not found' });
        res.json({ success: true, message: 'Partner deleted' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.deletePartner = deletePartner;
