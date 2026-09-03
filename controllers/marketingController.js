import mongoose from 'mongoose';
import MarketingAsset from '../models/MarketingAsset.js';
import MarketingCategory from '../models/MarketingCategory.js';
import MarketingShareLog from '../models/MarketingShareLog.js';
import { getFileType } from '../middleware/marketingUpload.js';
import { Item, Group, Category } from '../models/Inventory.js';
import Lead from '../models/Lead.js';
import AdminSettings from '../models/AdminSettings.js';
import fs from 'fs';
import path from 'path';

const cid = (req) => req.user.companyId;
const uid = (req) => req.user._id;

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    const company = cid(req);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [totalAssets, totalCategories, sharesToday, totalShares, recentUploads, topAssets] = await Promise.all([
      MarketingAsset.countDocuments({ company }),
      MarketingCategory.countDocuments({ company }),
      MarketingShareLog.countDocuments({ company, action: 'Share', createdAt: { $gte: today } }),
      MarketingShareLog.countDocuments({ company, action: 'Share' }),
      MarketingAsset.find({ company }).sort({ createdAt: -1 }).limit(5)
        .populate('uploadedBy', 'fullName').populate('category', 'name').lean(),
      MarketingAsset.find({ company }).sort({ shareCount: -1 }).limit(5).lean(),
    ]);

    const fileTypeBreakdown = await MarketingAsset.aggregate([
      { $match: { company } },
      { $group: { _id: '$fileType', count: { $sum: 1 } } },
    ]);

    res.json({ success: true, data: { totalAssets, totalCategories, sharesToday, totalShares, recentUploads, topAssets, fileTypeBreakdown } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ASSETS ──────────────────────────────────────────────────────────────────
export const getAssets = async (req, res) => {
  try {
    const { search, category, fileType, tag, page = 1, limit = 20 } = req.query;
    const query = { company: cid(req) };

    if (search) query.$or = [
      { fileName: new RegExp(search, 'i') },
      { product: new RegExp(search, 'i') },
      { tags: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') },
    ];
    if (category) query.category = category;
    if (fileType) {
      // Comma-separated list lets the frontend send a type BUCKET (e.g.
      // "PDF,DOC,DOCX" for "Documents") instead of one exact fileType.
      const types = fileType.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      query.fileType = types.length > 1 ? { $in: types } : types[0];
    }
    if (tag) query.tags = new RegExp(tag, 'i');

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [assets, total] = await Promise.all([
      MarketingAsset.find(query)
        .populate('category', 'name')
        .populate('subcategory', 'name')
        .populate('uploadedBy', 'fullName')
        .sort({ createdAt: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
      MarketingAsset.countDocuments(query),
    ]);

    res.json({ success: true, data: assets, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAsset = async (req, res) => {
  try {
    const asset = await MarketingAsset.findOne({ _id: req.params.id, company: cid(req) })
      .populate('category', 'name').populate('subcategory', 'name').populate('uploadedBy', 'fullName').lean();
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createAsset = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'File is required' });

    const { fileName, category, subcategory, product, description, tags, versionNumber } = req.body;
    if (!fileName) return res.status(400).json({ success: false, message: 'File name is required' });

    const fileType = getFileType(req.file.mimetype);
    const fileUrl = `uploads/marketing/${req.file.filename}`;

    const asset = await MarketingAsset.create({
      fileName, originalName: req.file.originalname, fileType, fileUrl,
      category: category || null, subcategory: subcategory || null,
      product: product || '', description: description || '',
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean)) : [],
      versionNumber: versionNumber || '1.0',
      uploadedBy: uid(req), company: cid(req),
    });

    await MarketingShareLog.create({ action: 'Upload', asset: asset._id, assetName: fileName, performedBy: uid(req), company: cid(req) });

    res.status(201).json({ success: true, data: asset, message: 'Asset uploaded successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAsset = async (req, res) => {
  try {
    const asset = await MarketingAsset.findOne({ _id: req.params.id, company: cid(req) });
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const { fileName, category, subcategory, product, description, tags, versionNumber } = req.body;
    if (fileName) asset.fileName = fileName;
    if (category !== undefined) asset.category = category || null;
    if (subcategory !== undefined) asset.subcategory = subcategory || null;
    if (product !== undefined) asset.product = product;
    if (description !== undefined) asset.description = description;
    if (tags !== undefined) asset.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    if (versionNumber) asset.versionNumber = versionNumber;

    await asset.save();
    await MarketingShareLog.create({ action: 'Edit', asset: asset._id, assetName: asset.fileName, performedBy: uid(req), company: cid(req) });

    res.json({ success: true, data: asset, message: 'Asset updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteAsset = async (req, res) => {
  try {
    const asset = await MarketingAsset.findOne({ _id: req.params.id, company: cid(req) });
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    // Delete physical file
    if (asset.fileUrl && fs.existsSync(asset.fileUrl)) fs.unlinkSync(asset.fileUrl);

    await MarketingShareLog.create({ action: 'Delete', assetName: asset.fileName, performedBy: uid(req), company: cid(req) });
    await asset.deleteOne();

    res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SHARE ────────────────────────────────────────────────────────────────────
export const shareAsset = async (req, res) => {
  try {
    const asset = await MarketingAsset.findOne({ _id: req.params.id, company: cid(req) });
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const { shareMethod, customerName, customerPhone, customerEmail } = req.body;

    await MarketingShareLog.create({
      action: 'Share', asset: asset._id, assetName: asset.fileName,
      performedBy: uid(req), shareMethod: shareMethod || '',
      customerName: customerName || '', customerPhone: customerPhone || '',
      customerEmail: customerEmail || '', company: cid(req),
    });

    asset.shareCount += 1;
    await asset.save();

    res.json({ success: true, message: 'Share logged successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
export const getCategories = async (req, res) => {
  try {
    const categories = await MarketingCategory.find({ company: cid(req) })
      .populate('parentCategory', 'name').sort({ parentCategory: 1, name: 1 }).lean();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { name, parentCategory } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });
    const category = await MarketingCategory.create({ name, parentCategory: parentCategory || null, company: cid(req) });
    res.status(201).json({ success: true, data: category, message: 'Category created' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const category = await MarketingCategory.findOneAndUpdate(
      { _id: req.params.id, company: cid(req) },
      { $set: req.body },
      { new: true }
    );
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, data: category, message: 'Category updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const category = await MarketingCategory.findOne({ _id: req.params.id, company: cid(req) });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    // Unset category from assets using it
    await MarketingAsset.updateMany({ company: cid(req), category: req.params.id }, { $set: { category: null } });
    await MarketingAsset.updateMany({ company: cid(req), subcategory: req.params.id }, { $set: { subcategory: null } });
    await MarketingCategory.deleteMany({ company: cid(req), parentCategory: req.params.id }); // delete sub-categories
    await category.deleteOne();
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── REPORTS ─────────────────────────────────────────────────────────────────
export const getReports = async (req, res) => {
  try {
    const company = cid(req);

    const [byEmployee, byCustomer, mostUsed, byMethod] = await Promise.all([
      // Employee sharing report
      MarketingShareLog.aggregate([
        { $match: { company, action: 'Share' } },
        { $group: { _id: '$performedBy', count: { $sum: 1 }, customers: { $addToSet: '$customerName' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { name: '$user.fullName', count: 1, uniqueCustomers: { $size: '$customers' } } },
        { $sort: { count: -1 } },
      ]),
      // Customer-wise shared files
      MarketingShareLog.aggregate([
        { $match: { company, action: 'Share', customerName: { $ne: '' } } },
        { $group: { _id: '$customerName', count: { $sum: 1 }, phone: { $first: '$customerPhone' }, files: { $addToSet: '$assetName' } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      // Most used content
      MarketingAsset.find({ company }).sort({ shareCount: -1 }).limit(20)
        .populate('category', 'name').lean(),
      // Share method breakdown
      MarketingShareLog.aggregate([
        { $match: { company, action: 'Share' } },
        { $group: { _id: '$shareMethod', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ success: true, data: { byEmployee, byCustomer, mostUsed, byMethod } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SALES / LEAD REPORT ────────────────────────────────────────────────────
// Stage-wise lead counts, Won/Late totals, and a Source-wise performance
// breakdown — scoped to the logged-in Marketing Head's own company (never
// cross-company), matching the same cid(req) convention as the rest of this
// controller. Stage order follows this company's own configured pipeline
// (AdminSettings.leadStages, per-company) since stages are admin-editable,
// not a fixed enum — see getOrCreateSettings in adminSettingsController.js
// and leadSettingRequestController.js (Sales Head request -> Company Admin
// approval flow that now manages this list).
export const getLeadReports = async (req, res) => {
  try {
    const companyId = cid(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'User does not belong to a company.' });

    const companyObjectId = new mongoose.Types.ObjectId(companyId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // "Won" = status is literally 'Won' (set by markLeadAsWon) — the stage
    // field is a separate, freely-editable pipeline label and not a reliable
    // won/lost indicator on its own.
    const wonExpr = { $eq: ['$status', 'Won'] };
    // "Late" = an open (not-Won) lead whose next follow-up date has already
    // passed — the same definition already used by the "Pending Follow-up"
    // filter on the Leads page (leadController.js getLeads).
    const lateExpr = {
      $and: [
        { $ne: ['$status', 'Won'] },
        { $ne: ['$nextFollowUpDate', null] },
        { $lt: ['$nextFollowUpDate', todayStart] },
      ],
    };

    const [byStage, bySource, totalsAgg, settings] = await Promise.all([
      Lead.aggregate([
        { $match: { companyId: companyObjectId } },
        { $group: { _id: '$stage', total: { $sum: 1 }, won: { $sum: { $cond: [wonExpr, 1, 0] } } } },
      ]),
      Lead.aggregate([
        { $match: { companyId: companyObjectId } },
        {
          $group: {
            _id: '$source',
            total: { $sum: 1 },
            won: { $sum: { $cond: [wonExpr, 1, 0] } },
            late: { $sum: { $cond: [lateExpr, 1, 0] } },
            wonValue: { $sum: { $cond: [wonExpr, { $ifNull: ['$dealValue', 0] }, 0] } },
          },
        },
        { $sort: { total: -1 } },
      ]),
      Lead.aggregate([
        { $match: { companyId: companyObjectId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            won: { $sum: { $cond: [wonExpr, 1, 0] } },
            late: { $sum: { $cond: [lateExpr, 1, 0] } },
            wonValue: { $sum: { $cond: [wonExpr, { $ifNull: ['$dealValue', 0] }, 0] } },
          },
        },
      ]),
      AdminSettings.findOne({ companyId: companyObjectId }).select('leadStages').lean(),
    ]);

    // Order stage rows by the company's configured pipeline order. Any stage
    // value not found in that list (legacy 'N/A' default, a since-renamed/
    // deleted stage) sorts after the configured ones, by count desc.
    const stageOrder = new Map(
      (settings?.leadStages || [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s, i) => [s.name, i])
    );
    const byStageSorted = [...byStage].sort((a, b) => {
      const ai = stageOrder.has(a._id) ? stageOrder.get(a._id) : Infinity;
      const bi = stageOrder.has(b._id) ? stageOrder.get(b._id) : Infinity;
      if (ai !== bi) return ai - bi;
      return b.total - a.total;
    });

    const totals = totalsAgg[0] || { total: 0, won: 0, late: 0, wonValue: 0 };
    const winRate = (won, total) => (total > 0 ? Math.round((won / total) * 1000) / 10 : 0);

    res.json({
      success: true,
      data: {
        totals: {
          total: totals.total,
          won: totals.won,
          late: totals.late,
          wonValue: totals.wonValue,
          winRate: winRate(totals.won, totals.total),
        },
        byStage: byStageSorted.map(s => ({ stage: s._id || 'N/A', total: s.total, won: s.won })),
        bySource: bySource.map(s => ({
          source: s._id || 'Unknown',
          total: s.total,
          won: s.won,
          late: s.late,
          wonValue: s.wonValue,
          winRate: winRate(s.won, s.total),
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
export const getAuditLogs = async (req, res) => {
  try {
    const { action, page = 1, limit = 30 } = req.query;
    const query = { company: cid(req) };
    if (action) query.action = action;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      MarketingShareLog.find(query)
        .populate('performedBy', 'fullName role')
        .sort({ createdAt: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
      MarketingShareLog.countDocuments(query),
    ]);

    res.json({ success: true, data: logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
export const getNotifications = async (req, res) => {
  try {
    const logs = await MarketingShareLog.find({ company: cid(req), action: { $in: ['Upload', 'Edit'] } })
      .populate('performedBy', 'fullName').sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ITEM MEDIA ───────────────────────────────────────────────────────────────
// Lets Marketing browse products via the same Group/Category/SubCategory
// filter used on Sales > Send Quotation (customer & dealer), then attach
// image/video/PDF brochure directly to that Item — the same fields Send
// Quotation reads (Item.image/videoUrl/brochureUrl), so uploads here show up
// there immediately.

// Groups + Categories (with subcategories) for the cascading filter, scoped
// to the logged-in user's company — mirrors inventoryController's
// getGroups/getCategories but reachable by Marketing roles.
export const getItemFilters = async (req, res) => {
  try {
    const companyId = cid(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'User does not belong to a company.' });

    const [groups, categories] = await Promise.all([
      Group.find({ companyId }).sort({ name: 1 }).select('name').lean(),
      Category.find({ companyId }).sort({ name: 1 }).select('name subcategories').lean(),
    ]);

    res.json({ success: true, groups, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Lightweight, unpaginated group/category/subCategory values for every
// Product-type item in the company — used only to populate the cascading
// filter dropdowns (never for display), so it stays cheap even when the
// paginated list below only returns one page of full item records.
export const getMarketingItemFacets = async (req, res) => {
  try {
    const companyId = cid(req);
    if (!companyId) return res.json({ success: true, items: [] });

    const items = await Item.find({ store: companyId.toString(), type: 'Product' })
      .select('group category subCategory')
      .lean();

    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Product-type items for the company, filtered by group/category/subCategory
// and paginated server-side (default 15 per page) — same
// { data/total/page/pages } convention as getAssets above.
export const getMarketingItems = async (req, res) => {
  try {
    const companyId = cid(req);
    if (!companyId) return res.json({ success: true, items: [], total: 0, page: 1, pages: 1 });

    const { group, category, subCategory, page = 1, limit = 15 } = req.query;
    const query = { store: companyId.toString(), type: 'Product' };
    if (group && group !== 'All') query.group = group;
    if (category && category !== 'All') query.category = category;
    if (subCategory && subCategory !== 'All') query.subCategory = subCategory;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 15);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Item.find(query)
        .select('name code group category subCategory image videoUrl brochureUrl unit')
        .sort({ category: 1, name: 1 })
        .skip(skip).limit(limitNum).lean(),
      Item.countDocuments(query),
    ]);

    res.json({ success: true, items, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Deletes a previously uploaded item media file from disk, given its stored
// URL (e.g. "/uploads/marketing/mkt-123.jpg"). Best-effort — a missing file
// shouldn't fail the caller. Restricted to the uploads folder to prevent
// path traversal via a crafted URL.
const deleteUploadedMediaFile = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return;
  try {
    const filePath = path.join(process.cwd(), fileUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Failed to delete uploaded item media file:', fileUrl, err.message);
  }
};

// Attaches image / video / PDF brochure to a single Item. Only items
// belonging to the caller's own company can be updated.
export const uploadItemMedia = async (req, res) => {
  const files = req.files || {};
  const imageFile = files.image?.[0];
  const videoFile = files.video?.[0];
  const brochureFile = files.brochure?.[0];
  // Multer already wrote these to disk before the handler runs — any early
  // return below (validation failure, ownership check) must clean them up
  // too, not just the catch block.
  const cleanupNewFiles = () => [imageFile, videoFile, brochureFile]
    .forEach(f => { if (f) deleteUploadedMediaFile(`/uploads/marketing/${f.filename}`); });

  try {
    const companyId = cid(req);
    const item = await Item.findById(req.params.id);
    if (!item) { cleanupNewFiles(); return res.status(404).json({ success: false, message: 'Item not found' }); }
    if (!companyId || item.store !== companyId.toString()) {
      cleanupNewFiles();
      return res.status(403).json({ success: false, message: 'Access denied. Item does not belong to your company.' });
    }

    if (!imageFile && !videoFile && !brochureFile) {
      return res.status(400).json({ success: false, message: 'Please provide at least one file (image, video, or PDF brochure).' });
    }
    if (imageFile && !imageFile.mimetype.startsWith('image/')) {
      cleanupNewFiles();
      return res.status(400).json({ success: false, message: 'Image field must be an image file.' });
    }
    if (videoFile && !videoFile.mimetype.startsWith('video/')) {
      cleanupNewFiles();
      return res.status(400).json({ success: false, message: 'Video field must be a video file.' });
    }
    if (brochureFile && brochureFile.mimetype !== 'application/pdf') {
      cleanupNewFiles();
      return res.status(400).json({ success: false, message: 'Brochure must be a PDF file.' });
    }

    const previous = { image: item.image, videoUrl: item.videoUrl, brochureUrl: item.brochureUrl };

    if (imageFile) item.image = `/uploads/marketing/${imageFile.filename}`;
    if (videoFile) item.videoUrl = `/uploads/marketing/${videoFile.filename}`;
    if (brochureFile) item.brochureUrl = `/uploads/marketing/${brochureFile.filename}`;

    await item.save();

    if (imageFile && previous.image && previous.image !== item.image) deleteUploadedMediaFile(previous.image);
    if (videoFile && previous.videoUrl && previous.videoUrl !== item.videoUrl) deleteUploadedMediaFile(previous.videoUrl);
    if (brochureFile && previous.brochureUrl && previous.brochureUrl !== item.brochureUrl) deleteUploadedMediaFile(previous.brochureUrl);

    // Best-effort audit entry — must never roll back the media that's already saved on the item.
    MarketingShareLog.create({
      action: 'Upload', assetName: `${item.name} (${item.code})`, performedBy: uid(req), company: companyId,
    }).catch(err => console.error('Failed to log item media upload:', err.message));

    res.json({ success: true, message: 'Item media uploaded successfully', item });
  } catch (err) {
    // Clean up files that were written to disk but never attached to the item,
    // e.g. an Item.save() error.
    cleanupNewFiles();
    res.status(500).json({ success: false, message: err.message });
  }
};
