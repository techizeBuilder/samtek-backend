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
exports.getNotifications = exports.getAuditLogs = exports.getReports = exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.getCategories = exports.shareAsset = exports.deleteAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getAssets = exports.getDashboard = void 0;
const MarketingAsset_js_1 = __importDefault(require("../models/MarketingAsset.js"));
const MarketingCategory_js_1 = __importDefault(require("../models/MarketingCategory.js"));
const MarketingShareLog_js_1 = __importDefault(require("../models/MarketingShareLog.js"));
const marketingUpload_js_1 = require("../middleware/marketingUpload.js");
const fs_1 = __importDefault(require("fs"));
const cid = (req) => req.user.companyId;
const uid = (req) => req.user._id;
// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const getDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const company = cid(req);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalAssets, totalCategories, sharesToday, totalShares, recentUploads, topAssets] = yield Promise.all([
            MarketingAsset_js_1.default.countDocuments({ company }),
            MarketingCategory_js_1.default.countDocuments({ company }),
            MarketingShareLog_js_1.default.countDocuments({ company, action: 'Share', createdAt: { $gte: today } }),
            MarketingShareLog_js_1.default.countDocuments({ company, action: 'Share' }),
            MarketingAsset_js_1.default.find({ company }).sort({ createdAt: -1 }).limit(5)
                .populate('uploadedBy', 'fullName').populate('category', 'name').lean(),
            MarketingAsset_js_1.default.find({ company }).sort({ shareCount: -1 }).limit(5).lean(),
        ]);
        const fileTypeBreakdown = yield MarketingAsset_js_1.default.aggregate([
            { $match: { company } },
            { $group: { _id: '$fileType', count: { $sum: 1 } } },
        ]);
        res.json({ success: true, data: { totalAssets, totalCategories, sharesToday, totalShares, recentUploads, topAssets, fileTypeBreakdown } });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getDashboard = getDashboard;
// ─── ASSETS ──────────────────────────────────────────────────────────────────
const getAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search, category, fileType, tag, page = 1, limit = 20 } = req.query;
        const query = { company: cid(req) };
        if (search)
            query.$or = [
                { fileName: new RegExp(search, 'i') },
                { product: new RegExp(search, 'i') },
                { tags: new RegExp(search, 'i') },
                { description: new RegExp(search, 'i') },
            ];
        if (category)
            query.category = category;
        if (fileType)
            query.fileType = fileType.toUpperCase();
        if (tag)
            query.tags = new RegExp(tag, 'i');
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [assets, total] = yield Promise.all([
            MarketingAsset_js_1.default.find(query)
                .populate('category', 'name')
                .populate('subcategory', 'name')
                .populate('uploadedBy', 'fullName')
                .sort({ createdAt: -1 })
                .skip(skip).limit(parseInt(limit)).lean(),
            MarketingAsset_js_1.default.countDocuments(query),
        ]);
        res.json({ success: true, data: assets, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getAssets = getAssets;
const getAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const asset = yield MarketingAsset_js_1.default.findOne({ _id: req.params.id, company: cid(req) })
            .populate('category', 'name').populate('subcategory', 'name').populate('uploadedBy', 'fullName').lean();
        if (!asset)
            return res.status(404).json({ success: false, message: 'Asset not found' });
        res.json({ success: true, data: asset });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getAsset = getAsset;
const createAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file)
            return res.status(400).json({ success: false, message: 'File is required' });
        const { fileName, category, subcategory, product, description, tags, versionNumber } = req.body;
        if (!fileName)
            return res.status(400).json({ success: false, message: 'File name is required' });
        const fileType = (0, marketingUpload_js_1.getFileType)(req.file.mimetype);
        const fileUrl = `uploads/marketing/${req.file.filename}`;
        const asset = yield MarketingAsset_js_1.default.create({
            fileName, originalName: req.file.originalname, fileType, fileUrl,
            category: category || null, subcategory: subcategory || null,
            product: product || '', description: description || '',
            tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean)) : [],
            versionNumber: versionNumber || '1.0',
            uploadedBy: uid(req), company: cid(req),
        });
        yield MarketingShareLog_js_1.default.create({ action: 'Upload', asset: asset._id, assetName: fileName, performedBy: uid(req), company: cid(req) });
        res.status(201).json({ success: true, data: asset, message: 'Asset uploaded successfully' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createAsset = createAsset;
const updateAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const asset = yield MarketingAsset_js_1.default.findOne({ _id: req.params.id, company: cid(req) });
        if (!asset)
            return res.status(404).json({ success: false, message: 'Asset not found' });
        const { fileName, category, subcategory, product, description, tags, versionNumber } = req.body;
        if (fileName)
            asset.fileName = fileName;
        if (category !== undefined)
            asset.category = category || null;
        if (subcategory !== undefined)
            asset.subcategory = subcategory || null;
        if (product !== undefined)
            asset.product = product;
        if (description !== undefined)
            asset.description = description;
        if (tags !== undefined)
            asset.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
        if (versionNumber)
            asset.versionNumber = versionNumber;
        yield asset.save();
        yield MarketingShareLog_js_1.default.create({ action: 'Edit', asset: asset._id, assetName: asset.fileName, performedBy: uid(req), company: cid(req) });
        res.json({ success: true, data: asset, message: 'Asset updated successfully' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateAsset = updateAsset;
const deleteAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const asset = yield MarketingAsset_js_1.default.findOne({ _id: req.params.id, company: cid(req) });
        if (!asset)
            return res.status(404).json({ success: false, message: 'Asset not found' });
        // Delete physical file
        if (asset.fileUrl && fs_1.default.existsSync(asset.fileUrl))
            fs_1.default.unlinkSync(asset.fileUrl);
        yield MarketingShareLog_js_1.default.create({ action: 'Delete', assetName: asset.fileName, performedBy: uid(req), company: cid(req) });
        yield asset.deleteOne();
        res.json({ success: true, message: 'Asset deleted successfully' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteAsset = deleteAsset;
// ─── SHARE ────────────────────────────────────────────────────────────────────
const shareAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const asset = yield MarketingAsset_js_1.default.findOne({ _id: req.params.id, company: cid(req) });
        if (!asset)
            return res.status(404).json({ success: false, message: 'Asset not found' });
        const { shareMethod, customerName, customerPhone, customerEmail } = req.body;
        yield MarketingShareLog_js_1.default.create({
            action: 'Share', asset: asset._id, assetName: asset.fileName,
            performedBy: uid(req), shareMethod: shareMethod || '',
            customerName: customerName || '', customerPhone: customerPhone || '',
            customerEmail: customerEmail || '', company: cid(req),
        });
        asset.shareCount += 1;
        yield asset.save();
        res.json({ success: true, message: 'Share logged successfully' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.shareAsset = shareAsset;
// ─── CATEGORIES ───────────────────────────────────────────────────────────────
const getCategories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const categories = yield MarketingCategory_js_1.default.find({ company: cid(req) })
            .populate('parentCategory', 'name').sort({ parentCategory: 1, name: 1 }).lean();
        res.json({ success: true, data: categories });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getCategories = getCategories;
const createCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, parentCategory } = req.body;
        if (!name)
            return res.status(400).json({ success: false, message: 'Category name is required' });
        const category = yield MarketingCategory_js_1.default.create({ name, parentCategory: parentCategory || null, company: cid(req) });
        res.status(201).json({ success: true, data: category, message: 'Category created' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createCategory = createCategory;
const updateCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const category = yield MarketingCategory_js_1.default.findOneAndUpdate({ _id: req.params.id, company: cid(req) }, { $set: req.body }, { new: true });
        if (!category)
            return res.status(404).json({ success: false, message: 'Category not found' });
        res.json({ success: true, data: category, message: 'Category updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateCategory = updateCategory;
const deleteCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const category = yield MarketingCategory_js_1.default.findOne({ _id: req.params.id, company: cid(req) });
        if (!category)
            return res.status(404).json({ success: false, message: 'Category not found' });
        // Unset category from assets using it
        yield MarketingAsset_js_1.default.updateMany({ company: cid(req), category: req.params.id }, { $set: { category: null } });
        yield MarketingAsset_js_1.default.updateMany({ company: cid(req), subcategory: req.params.id }, { $set: { subcategory: null } });
        yield MarketingCategory_js_1.default.deleteMany({ company: cid(req), parentCategory: req.params.id }); // delete sub-categories
        yield category.deleteOne();
        res.json({ success: true, message: 'Category deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteCategory = deleteCategory;
// ─── REPORTS ─────────────────────────────────────────────────────────────────
const getReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const company = cid(req);
        const [byEmployee, byCustomer, mostUsed, byMethod] = yield Promise.all([
            // Employee sharing report
            MarketingShareLog_js_1.default.aggregate([
                { $match: { company, action: 'Share' } },
                { $group: { _id: '$performedBy', count: { $sum: 1 }, customers: { $addToSet: '$customerName' } } },
                { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                { $project: { name: '$user.fullName', count: 1, uniqueCustomers: { $size: '$customers' } } },
                { $sort: { count: -1 } },
            ]),
            // Customer-wise shared files
            MarketingShareLog_js_1.default.aggregate([
                { $match: { company, action: 'Share', customerName: { $ne: '' } } },
                { $group: { _id: '$customerName', count: { $sum: 1 }, phone: { $first: '$customerPhone' }, files: { $addToSet: '$assetName' } } },
                { $sort: { count: -1 } },
                { $limit: 50 },
            ]),
            // Most used content
            MarketingAsset_js_1.default.find({ company }).sort({ shareCount: -1 }).limit(20)
                .populate('category', 'name').lean(),
            // Share method breakdown
            MarketingShareLog_js_1.default.aggregate([
                { $match: { company, action: 'Share' } },
                { $group: { _id: '$shareMethod', count: { $sum: 1 } } },
            ]),
        ]);
        res.json({ success: true, data: { byEmployee, byCustomer, mostUsed, byMethod } });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getReports = getReports;
// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
const getAuditLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { action, page = 1, limit = 30 } = req.query;
        const query = { company: cid(req) };
        if (action)
            query.action = action;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [logs, total] = yield Promise.all([
            MarketingShareLog_js_1.default.find(query)
                .populate('performedBy', 'fullName role')
                .sort({ createdAt: -1 })
                .skip(skip).limit(parseInt(limit)).lean(),
            MarketingShareLog_js_1.default.countDocuments(query),
        ]);
        res.json({ success: true, data: logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getAuditLogs = getAuditLogs;
// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
const getNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const logs = yield MarketingShareLog_js_1.default.find({ company: cid(req), action: { $in: ['Upload', 'Edit'] } })
            .populate('performedBy', 'fullName').sort({ createdAt: -1 }).limit(20).lean();
        res.json({ success: true, data: logs });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getNotifications = getNotifications;
