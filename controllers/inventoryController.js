import { Item, Category, CustomerCategory, Group, UnitType } from '../models/Inventory.js';
import InventoryMasterOption from '../models/InventoryMasterOption.js';
import { Company } from '../models/Company.js';
import ProductDailySummary from '../models/ProductDailySummary.js';
import MaterialIssueLog from '../models/MaterialIssueLog.js';
import * as XLSX from 'xlsx';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { USER_ROLES } from '../shared/schema.js';
import notificationService from '../services/notificationService.js';
import StagedPurchase from '../models/StagedPurchase.js';
import { initializeProductSummary, updateProductSummary } from '../services/productionSummaryService.js';

import ProductionOrder from '../models/ProductionOrder.js';

import DefectiveInventory from '../models/DefectiveMaterial.js';

import StoreTransferLog from '../models/StoreTransferLog.js';
import MaterialReturnLog from '../models/MaterialReturnLog.js';
import { getSellableItems as fetchSellableItems } from '../services/sellableItemsService.js';
import { dimensionSignature, resolveFabricationWeight } from '../services/fabricationDemandService.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import { toMm, toMm2 } from '../utils/unitConversion.js';

// Delivery Challan Order for Unit Head Inventory
const DELIVERY_CHALLAN_ORDER = [
  "PM 400",
  "SW 400",
  "WHEAT",
  "BROWN",
  "SW-800",
  "PAV-200",
  "BURGER",
  "Pizza Base",
  "Milk 250",
  "BUN 350",
  "Kova Bun250g",
  "CB 12PC",
  "CB 1Pc",
  "OB-300",
  "RAAGI",
  "JAR CAKE",
  "TwinBun",
  "5 Pc Bun",
  "PIZZA 9\"",
  "PIZZA 11\"",
  "CupBun 12 PC",
  "Rusk 10",
  "Rusk 35",
  "Milk 200",
  "Milk 300",
  "800 Brown",
  "Pizza 4\""
];

// Helper function to check inventory permissions
const checkInventoryPermission = (user, action) => {
  // Research & Development Head and Unit Head have all permissions (Super Admin removed)
  if (user.role === 'Research & Development Head' || user.role === 'Unit Head' || user.role === "Sales Head" || user.role === "Sales Employee") {
    return true;
  }

  // Allow Sales, Store, Production, QC, and Complaint Techs to view items
  if ((user.role === 'Sales' || user.role === 'Store Head' || user.role === 'Store Employee' ||
    user.role === 'Production' || user.role === 'Production Head' || user.role === 'Production Employee' ||
    user.role === 'QC Head' || user.role === 'QC Employee' ||
    user.role === 'Complaint Management Employee') && action === 'view') {
    return true;
  }

  return user.permissions?.Inventory?.[action] === true;
};

// Helper function to update qtyPerBatch in product summary
const updateProductSummaryQtyPerBatch = async (productId, productName, qtyPerBatch, date, companyId) => {
  try {
    console.log('🔄 Updating qtyPerBatch for product:', productName);
    console.log('  📦 Product ID:', productId);
    console.log('  🏢 Company ID:', companyId);
    console.log('  📊 New qtyPerBatch:', qtyPerBatch);
    console.log('  📅 Date:', date);

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      console.error('❌ Invalid company ID format:', companyId);
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      console.error('❌ Invalid product ID format:', productId);
      return;
    }

    // Find existing summary by PRODUCT + COMPANY only (COMPLETELY ignore date)
    // We want EXACTLY ONE record per product per company
    const query = {
      companyId: new mongoose.Types.ObjectId(companyId),
      productId: new mongoose.Types.ObjectId(productId)
    };

    console.log('🔍 Query for existing summary:', query);

    let existingSummary = await ProductDailySummary.findOne(query);

    console.log('📋 Found existing summary:', existingSummary ? 'YES' : 'NO');

    if (existingSummary) {
      console.log('📋 Existing summary details:', {
        id: existingSummary._id,
        productName: existingSummary.productName,
        currentQtyPerBatch: existingSummary.qtyPerBatch,
        newQtyPerBatch: qtyPerBatch
      });
    }

    if (existingSummary) {
      // Update existing summary - keep original date
      console.log('  📅 Existing date (keeping):', existingSummary.date ? existingSummary.date.toISOString().split('T')[0] : 'N/A');
      const oldValue = existingSummary.qtyPerBatch;
      existingSummary.qtyPerBatch = qtyPerBatch;
      // Don't call calculateFormulas() as it might overwrite qtyPerBatch
      await existingSummary.save();
      console.log('✅ Updated existing product summary qtyPerBatch from', oldValue, 'to', qtyPerBatch);
    } else {
      // Create new summary only if product doesn't exist
      const summaryDate = new Date(date);
      summaryDate.setUTCHours(0, 0, 0, 0);

      console.log('  📅 Creating new summary with date:', summaryDate.toISOString().split('T')[0]);

      const newSummary = new ProductDailySummary({
        date: summaryDate,
        companyId: new mongoose.Types.ObjectId(companyId),
        productId: new mongoose.Types.ObjectId(productId),
        productName: productName,
        qtyPerBatch: qtyPerBatch,
        totalIndent: 0,
        packing: 0,
        physicalStock: 0,
        batchAdjusted: 0,
        productionFinalBatches: 0,
        toBeProducedDay: 0,
        produceBatches: 0
      });

      await newSummary.save();
      console.log('✅ Created new product summary with qtyPerBatch');
    }

    console.log(`Product summary qtyPerBatch updated for ${productName}: ${qtyPerBatch}`);
  } catch (error) {
    console.error('Error updating product summary qtyPerBatch:', error);
    throw error;
  }
};

// Auto-generate item code - globally unique
const generateItemCode = async (type) => {
  const prefix = type === 'Product' ? 'PRO' : 'SER';

  let codeAttempts = 0;
  let uniqueCode = '';
  let codeExists = true;

  while (codeExists && codeAttempts < 100) {
    // Get GLOBAL count for this prefix to ensure global uniqueness
    const globalCount = await Item.countDocuments({
      code: new RegExp(`^${prefix}\\d{4}$`)
    });

    // Generate next available global number
    uniqueCode = `${prefix}${String(globalCount + 1 + codeAttempts).padStart(4, '0')}`;

    // Check if this code already exists GLOBALLY
    const existingItem = await Item.findOne({ code: uniqueCode });
    codeExists = !!existingItem;
    codeAttempts++;

    if (codeExists) {
      console.log(`Code ${uniqueCode} already exists globally, trying next number...`);
    }
  }

  if (codeAttempts >= 100) {
    throw new Error('Unable to generate unique code after 100 attempts');
  }

  console.log(`Generated globally unique code: ${uniqueCode}`);
  return uniqueCode;
};

// ITEM CONTROLLERS
// Unified "what can this company sell" endpoint — Product Master machines +
// Motor Master motors (see services/sellableItemsService.js), scoped to the
// caller's own company. Used by ProductSelector.jsx for roles without a more
// specific sales/admin item endpoint of their own.
export const getSellableItemsForUser = async (req, res) => {
  try {
    const { search } = req.query;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.json({ success: true, items: [] });
    }

    const items = await fetchSellableItems({ companyId, search });

    res.json({ success: true, items });
  } catch (error) {
    console.error('Get sellable items error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getItems = async (req, res) => {
  console.log('=== ITEMS API CALLED ===');
  console.log('User:', req.user?.username, 'Role:', req.user?.role, 'CompanyId:', req.user?.companyId);
  console.log('Query params:', req.query);

  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const {
      page = 1,
      limit = 20,
      search,
      type,
      productKind,
      category,
      subCategory,
      itemType,
      sourceType,
      itemSourceType,
      store,
      location,
      group,
      lowStock,
      quantity, // Add quantity filter
      discontinued,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // For Unit Head users, remove pagination to show all items
    const isUnitHead = req.user.role === 'Unit Head';
    const actualLimit = isUnitHead ? 0 : parseInt(limit); // 0 means no limit in MongoDB
    const skip = isUnitHead ? 0 : (page - 1) * limit;
    let query = {};

    // Add company filtering for Unit Head users
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      query.store = req.user.companyId;
      // Unit Head should only see Products, not other item types
      query.type = 'Product';
      console.log('🏢 Unit Head filtering applied: company =', req.user.companyId, ', type = Product');
    }

    // Add company filtering for Store Head / Store Employee
    if ((req.user.role === 'Store Head' || req.user.role === 'Store Employee') && req.user.companyId) {
      const storeCompanyIdStr = req.user.companyId.toString();
      query.$or = [
        { store: storeCompanyIdStr },
        { store: req.user.companyId },
        { companyId: storeCompanyIdStr },
        { companyId: req.user.companyId }
      ];
      console.log('🏢 Store user filtering applied: company =', storeCompanyIdStr);
    }

    // Add company filtering for Research & Development roles
    if ((req.user.role === 'Research & Development Head' || req.user.role === 'Research Development Employee') && req.user.companyId) {
      const rdCompanyIdStr = req.user.companyId.toString();
      query.$or = [
        { store: rdCompanyIdStr },
        { store: req.user.companyId },
        { companyId: rdCompanyIdStr },
        { companyId: req.user.companyId }
      ];
      console.log('🔬 R&D user filtering applied: company =', rdCompanyIdStr);
    }

    // Default company filtering for every other role (Complaint Management /
    // Service technicians, Sales, Accounts, Production, QC, Packaging, etc.).
    // The four blocks above only cover specific roles that needed their own
    // extra logic (Unit Head → Products only, etc.) — anything not already
    // scoped by one of them fell through with NO company filter at all,
    // meaning any authenticated user could see every company's inventory.
    // There is no cross-company "Super Admin" role in this app anymore
    // (every user always belongs to exactly one company), so this is a
    // straight default, not an opt-in.
    if (!query.$or && !query.store && req.user.companyId) {
      const cid = req.user.companyId.toString();
      query.$or = [
        { store: cid },
        { store: req.user.companyId },
        { companyId: cid },
        { companyId: req.user.companyId }
      ];
      console.log('🏢 Default company filtering applied: company =', cid);
    }

    // Search filter with improved partial matching
    if (search) {
      try {
        // Split search into words for better matching
        const searchWords = search.trim().split(/\s+/).filter(word => word.length > 0);
        console.log('🔍 Search words:', searchWords);

        let searchOr;
        if (searchWords.length === 1) {
          const escapedSearch = searchWords[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          searchOr = [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { code: { $regex: escapedSearch, $options: 'i' } },
            { description: { $regex: escapedSearch, $options: 'i' } }
          ];
        } else {
          const wordRegexes = searchWords.map(word => ({
            name: { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
          }));
          const exactPhrase = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          searchOr = [
            { $and: wordRegexes },
            { name: { $regex: exactPhrase, $options: 'i' } },
            { code: { $regex: exactPhrase, $options: 'i' } },
            { description: { $regex: exactPhrase, $options: 'i' } }
          ];
        }

        // If company $or already exists, combine using $and so both filters apply
        if (query.$or) {
          query.$and = [
            { $or: query.$or },
            { $or: searchOr }
          ];
          delete query.$or;
        } else {
          query.$or = searchOr;
        }

        console.log('🔍 Search query applied');
      } catch (error) {
        console.error('❌ Search regex error:', error);
        const simpleSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchOrFallback = [
          { name: { $regex: simpleSearch, $options: 'i' } },
          { code: { $regex: simpleSearch, $options: 'i' } },
          { description: { $regex: simpleSearch, $options: 'i' } }
        ];
        if (query.$or) {
          query.$and = [{ $or: query.$or }, { $or: searchOrFallback }];
          delete query.$or;
        } else {
          query.$or = searchOrFallback;
        }
      }
    }

    // Type filter - only allow if not Unit Head (Unit Head is auto-filtered to Products)
    if (type && req.user.role !== 'Unit Head') {
      query.type = type;
    }

    // productKind filter — distinguishes Machine (Product Master) vs Motor (Motor Master)
    // within type:'Product'. Sent by the frontend as a query param, never exposed as a
    // user-facing filter control (each master's own page hardcodes its own productKind).
    // Special value 'none' means "exclude Machine/Motor" — the plain Inventory
    // list (ModernInventoryUI.jsx) opts into this explicitly; every other
    // existing caller (e.g. the Sales product picker, which needs machines/
    // motors to show up as sellable products) keeps today's unfiltered
    // behavior when it doesn't send productKind at all — deliberately NOT
    // defaulted, so as not to silently change what they return.
    if (productKind === 'none') {
      query.productKind = null;
    } else if (productKind) {
      query.productKind = productKind;
    }

    // Discontinued filter — defaults to hiding discontinued items when not
    // specified (matches Product/Motor/Plant Master's own list convention).
    if (discontinued === 'true') {
      query.isDiscontinued = true;
    } else if (discontinued === 'false' || discontinued === undefined) {
      query.isDiscontinued = { $ne: true };
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Subcategory filter
    if (subCategory) {
      query.subCategory = subCategory;
    }

    // Item Type filter (the client's Raw Material/Tool/Readymade Material/
    // Assets classification — see Item.itemType)
    if (itemType) {
      query.itemType = itemType;
    }

    // Source Type / Item Source Type filters
    if (sourceType) {
      query.sourceType = sourceType;
    }
    if (itemSourceType) {
      query.itemSourceType = itemSourceType;
    }

    // Group filter
    if (group) {
      query.group = group;
    }

    // Store filter (for Super Admin to filter by specific store/company)
    if (store && req.user.role !== 'Unit Head') {
      query.store = store;
    }

    // Location filter (alias for store)
    if (location && req.user.role !== 'Unit Head') {
      query.store = location;
    }

    // Low stock filter
    if (lowStock === 'true') {
      query.$expr = { $lte: ['$qty', '$minStock'] };
    }

    // Product kind filter — 'none'/'null' means plain inventory items with
    // no productKind set (also matches legacy docs missing the field).
    if (productKind !== undefined && productKind !== '') {
      query.productKind = (productKind === 'none' || productKind === 'null') ? null : productKind;
    }


    // Sort options - default to order ASC, then category A-Z for Unit Head
    let sortOptions = {};

    if (isUnitHead && (!sortBy || sortBy === 'newest')) {
      // For Unit Head, if newest or no sort, we use custom order
      sortOptions = { order: 1, createdAt: -1 };
    } else {
      sortOptions = { createdAt: -1 };
    }

    // Add secondary sorting if specified
    if (sortBy && sortBy !== 'newest') {
      if (sortBy === 'name') {
        sortOptions.name = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'code') {
        sortOptions.code = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'category') {
        sortOptions.category = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'itemType') {
        sortOptions.itemType = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'qty' || sortBy === 'quantity') { // Use quantity instead of quality
        sortOptions.qty = sortOrder === 'desc' ? -1 : 1;
      }
    }

    console.log('🔍 Final query:', JSON.stringify(query, null, 2));
    console.log('📊 Sort options:', sortOptions);

    let items, total;

    try {
      // Execute database queries with error handling
      const query_builder = Item.find(query).sort(sortOptions).skip(skip);

      // Only apply limit if not Unit Head (Unit Head gets all items)
      if (actualLimit > 0) {
        query_builder.limit(actualLimit);
      }

      items = await query_builder;
      total = await Item.countDocuments(query);

      console.log(`📦 Found ${items.length} items out of ${total} total`);
    } catch (dbError) {
      console.error('❌ Database query error:', dbError);
      throw new Error(`Database query failed: ${dbError.message}`);
    }

    // Resolve company names for store locations
    const itemsWithCompanyNames = await Promise.all(
      items.map(async (item) => {
        const itemObj = item.toObject();

        // If store field contains an ObjectId, resolve the company name
        if (itemObj.store && itemObj.store.match(/^[0-9a-fA-F]{24}$/)) {
          try {
            const company = await Company.findById(itemObj.store).select('name city state');
            if (company) {
              itemObj.storeLocation = `${company.name} - ${company.city}, ${company.state}`;
              itemObj.companyId = itemObj.store;
            } else {
              itemObj.storeLocation = 'Unknown Location';
            }
          } catch (error) {
            console.error('Error resolving company for item:', item._id, error);
            itemObj.storeLocation = itemObj.store;
          }
        } else {
          // For backward compatibility with string store names
          itemObj.storeLocation = itemObj.store || 'No Location';
        }

        return itemObj;
      })
    );

    // Apply custom Delivery Challan sorting for Unit Head
    if (isUnitHead && (!sortBy || sortBy === 'newest')) {
      itemsWithCompanyNames.sort((a, b) => {
        const aName = (a.name || '').trim().toLowerCase();
        const bName = (b.name || '').trim().toLowerCase();

        // Helper to find index in DELIVERY_CHALLAN_ORDER with improved matching
        const getChallanIndex = (name) => {
          const normalizedName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!normalizedName) return 999999;

          const index = DELIVERY_CHALLAN_ORDER.findIndex(item => {
            const normalizedItem = item.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Check if normalized name contains the normalized list item
            return normalizedName.includes(normalizedItem);
          });
          return index === -1 ? 999999 : index;
        };

        // Level 1: Custom Manual Order (from drag-and-drop) - Now takes Priority 1
        const aOrder = (a.order && a.order > 0) ? a.order : 999999;
        const bOrder = (b.order && b.order > 0) ? b.order : 999999;

        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        const aIndex = getChallanIndex(aName);
        const bIndex = getChallanIndex(bName);

        // Level 2: Challan Order Match - Now takes Priority 2 (fallback)
        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }

        // Level 3: Newest First
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    } else if (isUnitHead && sortBy === 'category') {
      // Level 1: Category Sort (A-Z)
      itemsWithCompanyNames.sort((a, b) => {
        const aCat = (a.category || "").toLowerCase();
        const bCat = (b.category || "").toLowerCase();
        if (aCat !== bCat) {
          return sortOrder === 'desc' ? bCat.localeCompare(aCat) : aCat.localeCompare(bCat);
        }
        // Secondary sort by name
        return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
      });
    } else if (isUnitHead && (sortBy === 'qty' || sortBy === 'quantity')) {
      // Level 1: Numeric Sort by Batch (e.g. 10, 20, 100)
      itemsWithCompanyNames.sort((a, b) => {
        const aVal = parseFloat(a.batch) || 0;
        const bVal = parseFloat(b.batch) || 0;
        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      });
    } else if (isUnitHead && sortBy === 'name') {
      // Level 1: Strict Alphabetical Sort (A-Z)
      itemsWithCompanyNames.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        return aName.localeCompare(bName);
      });
    }

    console.log(`-----------------------Fetched ${items.length} items out of ${total} total matching items.`);

    // Calculate inventory statistics
    const stats = await Item.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } },
          lowStockCount: {
            $sum: {
              $cond: [{ $lte: ['$qty', '$minStock'] }, 1, 0]
            }
          }
        }
      }
    ]);

    const typeStats = await Item.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalQty: { $sum: '$qty' },
          totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } }
        }
      }
    ]);

    // Prepare pagination response
    const paginationResponse = isUnitHead ? {
      page: 1,
      limit: total, // Show actual total as limit for Unit Head
      total,
      pages: 1 // Only one page since all items are shown
    } : {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    };

    res.json({
      items: itemsWithCompanyNames,
      pagination: paginationResponse,
      stats: stats[0] || { totalItems: 0, totalValue: 0, lowStockCount: 0 },
      typeStats
    });
  } catch (error) {
    console.error('❌ Get items error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Query that caused error:', JSON.stringify(req.query));
    res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
};






// ── 1. HIGH-PERFORMANCE VARIANT AUTOFILL LOOKUP ──
// Pulls pristine variants and dynamic attributes for a specific item code without internal DB tracking IDs.
export const getVariantsByItemCode = async (req, res) => {
  try {
    const { code } = req.query;
    if (!code || code.trim() === '') {
      return res.status(400).json({ success: false, message: 'Item code is required for lookup.' });
    }

    const query = { code: code.trim() };
    if (req.user.companyId) {
      query.companyId = req.user.companyId;
    }

    const templateItem = await Item.findOne(query)
      .select('variants')
      .lean();

    if (!templateItem) {
      return res.status(404).json({
        success: false,
        message: `No item found with code: ${code}`
      });
    }

    // Clean subdocument IDs out of variants and attributes arrays for clean frontend adoption
    const cleanedVariants = (templateItem.variants || []).map(({ _id, attributes, ...rest }) => ({
      ...rest,
      attributes: (attributes || []).map(({ _id, ...attrRest }) => attrRest)
    }));

    res.json({
      success: true,
      variants: cleanedVariants
    });
  } catch (error) {
    console.error('Fetch variant template error:', error);
    res.status(500).json({ success: false, message: 'Internal server error fetching variant specifications.' });
  }
};

// ── 2. CREATE ITEM CONTROLLER ──
// ── Item media uploads ──────────────────────────────────────────────────────
// Standalone endpoints (decoupled from createItem/updateItem's JSON body) so the
// form can upload a file and get back a URL string before the item is saved —
// same convention as createSalespersonItem in salesController.js.

// Deletes a previously uploaded item image/brochure from disk, given its stored URL
// (e.g. "/uploads/items/images/product-123.jpg"). Best-effort — never throws, since
// a missing file (already cleaned up, or never existed) shouldn't fail the caller.
// Restricted to the items upload folder to prevent path traversal via a crafted URL.
const deleteUploadedItemFile = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') return;
  if (!fileUrl.startsWith('/uploads/items/')) return;
  try {
    const filePath = path.join(process.cwd(), fileUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Failed to delete uploaded item file:', fileUrl, error.message);
  }
};

// Lets the frontend explicitly clean up a file it just uploaded but never ended up
// saving to an item — e.g. the user cancels the Add/Edit Item dialog, or replaces
// their own not-yet-saved image/brochure with a different file before submitting.
export const deleteItemMedia = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'url is required' });
    }
    deleteUploadedItemFile(url);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to delete file' });
  }
};

export const uploadItemImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    res.json({ success: true, url: `/uploads/items/images/${req.file.filename}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to upload image' });
  }
};

export const uploadItemBrochure = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No brochure file provided' });
    }
    res.json({ success: true, url: `/uploads/items/brochures/${req.file.filename}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to upload brochure' });
  }
};

export const createItem = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'add')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    const itemData = req.body;
    console.log('📝 Received item data:', itemData);

    // Enhanced validation
    const validation = validateItemData(itemData);
    if (!validation.isValid) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: validation.errors
      });
    }

    // ─────────────────────────────────────────────────────────────
    // STRICT R&D CODING RULE (Point 8 Enforced):
    // System will NOT auto-generate codes. R&D must define them.
    // ─────────────────────────────────────────────────────────────
    if (!itemData.code || itemData.code.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Item Code is mandatory. Per company standardization rules, R&D must explicitly define the universal ERP Item Code.'
      });
    }

    itemData.code = itemData.code.trim();

    // Check if R&D's defined code already exists in the company
    const codeQuery = { code: itemData.code };
    if (req.user.companyId) {
      codeQuery.companyId = req.user.companyId;
    }

    const existingCode = await Item.findOne(codeQuery);
    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: `Coding Conflict: The Item Code "${itemData.code}" is already assigned to "${existingCode.name}". R&D must assign a unique ERP code.`
      });
    }

    // Check for duplicate item name (case-insensitive) within location
    if (itemData.name && itemData.name.trim()) {
      const trimmedName = itemData.name.trim();
      let companyIdForCheck = req.user.companyId;

      if (itemData.store && itemData.store.match(/^[0-9a-fA-F]{24}$/)) {
        companyIdForCheck = itemData.store;
      }

      const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const query = {
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        category: itemData.category,
        type: itemData.type
      };

      if (companyIdForCheck) {
        query.$or = [
          { companyId: companyIdForCheck },
          { store: companyIdForCheck }
        ];
      } else if (itemData.store) {
        query.store = itemData.store;
      }

      const existingItemByName = await Item.findOne(query);

      if (existingItemByName) {
        return res.status(400).json({
          success: false,
          message: `Duplicate item detected! Item "${trimmedName}" already exists in category "${itemData.category}" (Code: ${existingItemByName.code}).`,
          duplicateItem: {
            name: existingItemByName.name,
            code: existingItemByName.code,
            id: existingItemByName._id
          }
        });
      }
    }

    // Sanitize and prepare data
    const sanitizedData = sanitizeItemData(itemData);

    // Ensure company assignment
    if (req.user.companyId) {
      sanitizedData.companyId = req.user.companyId;
      sanitizedData.store = req.user.companyId.toString(); // Syncs missing frontend dropdown
    }
    if (sanitizedData.store && sanitizedData.store.match(/^[0-9a-fA-F]{24}$/)) {
      sanitizedData.companyId = sanitizedData.store;
    }

    // ─────────────────────────────────────────────────────────────
    // GUARANTEE ALL R&D AND FINANCIAL FIELDS ARE PRESERVED
    // ─────────────────────────────────────────────────────────────
    // 1. R&D Master Fields
    sanitizedData.specifications = itemData.specifications || [];
    sanitizedData.applications = itemData.applications || [];

    sanitizedData.variants = sanitizedData.variants || [];

    if (itemData.warranty) {
      sanitizedData.warranty = itemData.warranty;
    }

    // 2. Pricing, Tax & Category Fields (Restored & Protected)
    if (itemData.stdCost !== undefined) sanitizedData.stdCost = Number(itemData.stdCost) || 0;
    if (itemData.purchaseCost !== undefined) sanitizedData.purchaseCost = Number(itemData.purchaseCost) || 0;
    if (itemData.salePrice !== undefined) sanitizedData.salePrice = Number(itemData.salePrice) || 0;
    if (itemData.mrp !== undefined) sanitizedData.mrp = Number(itemData.mrp) || 0;
    if (itemData.gst !== undefined) sanitizedData.gst = Number(itemData.gst) || 0;
    if (itemData.hsn !== undefined) sanitizedData.hsn = itemData.hsn;
    if (itemData.customerCategory !== undefined) sanitizedData.customerCategory = itemData.customerCategory;
    if (itemData.group !== undefined) sanitizedData.group = itemData.group;

    // 3. Media & Notes — image/brochureUrl are uploaded separately (see uploadItemImage/
    // uploadItemBrochure) and arrive here as plain URL strings; videoUrl is never uploaded,
    // just a pasted link (e.g. YouTube); otherInfo is a free-text note.
    if (itemData.image !== undefined) sanitizedData.image = itemData.image || null;
    if (itemData.brochureUrl !== undefined) sanitizedData.brochureUrl = itemData.brochureUrl || null;
    if (itemData.videoUrl !== undefined) sanitizedData.videoUrl = itemData.videoUrl || null;
    if (itemData.otherInfo !== undefined) sanitizedData.otherInfo = itemData.otherInfo;

    const item = await Item.create(sanitizedData);
    console.log('✅ R&D Master Item created successfully:', item.code);

    // Initialize production summary
    try {
      const companyId = req.user.companyId ? req.user.companyId.toString() : (sanitizedData.store || item.store);
      if (companyId) {
        await initializeProductSummary(item._id.toString(), item.name, companyId);

        if (item.batch && !isNaN(parseFloat(item.batch))) {
          const today = new Date().toISOString().split('T')[0];
          await updateProductSummaryQtyPerBatch(item._id.toString(), item.name, parseFloat(item.batch), today, companyId);
        }
      }
    } catch (summaryError) {
      console.error('Failed to initialize production summary:', summaryError);
    }

    // Notifications
    try {
      const notifCompanyId = req.user.companyId || null;
      await notificationService.triggerInventoryNotification(item, 'created', null, notifCompanyId);
      if (item.qty <= (item.minStock || 10)) {
        await notificationService.triggerLowStockNotification(item, notifCompanyId);
      }
    } catch (notificationError) {
      console.error('Failed to send inventory notification:', notificationError);
    }

    res.status(201).json({
      success: true,
      message: 'Master Item created successfully with R&D assigned code.',
      item
    });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
};

// ── 3. UPDATE ITEM CONTROLLER ──
export const updateItem = async (req, res) => {
  try {
    console.log('🔧 UPDATE ITEM - Debug user info:', {
      userId: req.user._id,
      username: req.user.username,
      role: req.user.role,
      companyId: req.user.companyId,
      companyObject: req.user.company
    });

    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const itemData = req.body;

    // Enhanced validation
    const validation = validateItemData(itemData, true);
    if (!validation.isValid) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: validation.errors
      });
    }

    // Check if code is being changed and if it already exists
    if (itemData.code && itemData.code.trim() !== '') {
      const existingItem = await Item.findOne({
        code: itemData.code.trim(),
        _id: { $ne: id }
      });
      if (existingItem) {
        return res.status(400).json({
          message: 'Validation failed',
          errors: { code: 'Item code already exists' }
        });
      }
    }

    // Capture the item's current media URLs before overwriting, so a replaced
    // image/brochure can be cleaned up from disk once the update succeeds.
    const previousMedia = await Item.findById(id).select('image brochureUrl').lean();

    // Sanitize and prepare data
    const sanitizedData = sanitizeItemData(itemData);

    // ─────────────────────────────────────────────────────────────
    // GUARANTEE ALL R&D AND FINANCIAL FIELDS ARE UPDATED
    // ─────────────────────────────────────────────────────────────
    // 1. R&D Master Fields
    if (itemData.specifications !== undefined) sanitizedData.specifications = itemData.specifications;
    if (itemData.applications !== undefined) sanitizedData.applications = itemData.applications;
    if (itemData.itemCategories !== undefined) sanitizedData.itemCategories = sanitizedData.itemCategories;
    if (itemData.sourceType !== undefined) sanitizedData.sourceType = sanitizedData.sourceType;
    if (itemData.itemSourceType !== undefined) sanitizedData.itemSourceType = sanitizedData.itemSourceType;
    if (itemData.modelNumber !== undefined) sanitizedData.modelNumber = sanitizedData.modelNumber;
    if (itemData.materialGrade !== undefined) sanitizedData.materialGrade = sanitizedData.materialGrade;
    if (itemData.dimensions !== undefined) sanitizedData.dimensions = sanitizedData.dimensions;

    if (itemData.variants !== undefined) sanitizedData.variants = sanitizedData.variants;

    if (itemData.warranty !== undefined) sanitizedData.warranty = itemData.warranty;

    // 2. Pricing, Tax & Category Fields (Restored & Protected)
    if (itemData.stdCost !== undefined) sanitizedData.stdCost = Number(itemData.stdCost) || 0;
    if (itemData.purchaseCost !== undefined) sanitizedData.purchaseCost = Number(itemData.purchaseCost) || 0;
    if (itemData.salePrice !== undefined) sanitizedData.salePrice = Number(itemData.salePrice) || 0;
    if (itemData.mrp !== undefined) sanitizedData.mrp = Number(itemData.mrp) || 0;
    if (itemData.gst !== undefined) sanitizedData.gst = Number(itemData.gst) || 0;
    if (itemData.hsn !== undefined) sanitizedData.hsn = itemData.hsn;
    if (itemData.customerCategory !== undefined) sanitizedData.customerCategory = itemData.customerCategory;
    if (itemData.group !== undefined) sanitizedData.group = itemData.group;

    // 3. Media & Notes (see createItem for the upload flow this feeds from)
    if (itemData.image !== undefined) sanitizedData.image = itemData.image || null;
    if (itemData.brochureUrl !== undefined) sanitizedData.brochureUrl = itemData.brochureUrl || null;
    if (itemData.videoUrl !== undefined) sanitizedData.videoUrl = itemData.videoUrl || null;
    if (itemData.otherInfo !== undefined) sanitizedData.otherInfo = itemData.otherInfo;

    const item = await Item.findByIdAndUpdate(
      id,
      sanitizedData,
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Media was replaced with a different file/URL — the old one is now orphaned, clean it up
    if (previousMedia?.image && previousMedia.image !== item.image) {
      deleteUploadedItemFile(previousMedia.image);
    }
    if (previousMedia?.brochureUrl && previousMedia.brochureUrl !== item.brochureUrl) {
      deleteUploadedItemFile(previousMedia.brochureUrl);
    }

    // Sync qtyPerBatch if batch field was updated
    try {
      if (item.batch && !isNaN(parseFloat(item.batch))) {
        const today = new Date().toISOString().split('T')[0];
        const companyId = req.user.companyId ? req.user.companyId.toString() : item.store;

        if (companyId) {
          await updateProductSummaryQtyPerBatch(
            item._id.toString(),
            item.name,
            parseFloat(item.batch),
            today,
            companyId
          );
          console.log('QtyPerBatch synced for updated product:', item.name, 'Value:', item.batch, 'Company:', companyId);
        } else {
          console.log('❌ No company ID available for qtyPerBatch sync');
        }
      } else {
        console.log('❌ Batch sync skipped - invalid batch value:', item.batch);
      }
    } catch (syncError) {
      console.error('Failed to sync qtyPerBatch:', syncError);
    }

    res.json({
      message: 'Item updated successfully',
      item
    });
  } catch (error) {
    console.error('Update item error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      res.status(400).json({
        message: 'Validation failed',
        errors: { [field]: `${field} already exists` }
      });
    } else if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      res.status(400).json({
        message: 'Validation failed',
        errors
      });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

// ── 4. ENHANCED VALIDATION HELPER FUNCTION ──
// isUpdate: PUT /items/:id is also used for lightweight partial updates (e.g.
// the Discontinue/Continue toggle, which sends only { isDiscontinued }) — a
// required field is only enforced on update if the caller actually included
// it in the payload; omitted fields are left as-is by the DB layer, so there's
// nothing to validate. On create (isUpdate: false) every required field is
// always checked, since the item doesn't exist yet.
const validateItemData = (data, isUpdate = false) => {
  const errors = {};
  const has = (key) => !isUpdate || Object.prototype.hasOwnProperty.call(data, key);

  // Required fields validation
  if (has('name') && (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2)) {
    errors.name = 'Item name must be at least 2 characters';
  }

  if (data.customerCategory && typeof data.customerCategory !== 'string') {
    errors.customerCategory = 'Customer Category must be a valid string';
  }

  if (data.group && typeof data.group !== 'string') {
    errors.group = 'Group must be a valid string';
  }

  if (data.quality && typeof data.quality !== 'string') {
    errors.quality = 'Quality must be a valid string';
  }

  if (has('unit') && (!data.unit || typeof data.unit !== 'string' || data.unit.trim().length === 0)) {
    errors.unit = 'Unit is required';
  }

  if (has('type') && (!data.type || typeof data.type !== 'string' || data.type.trim().length === 0)) {
    errors.type = 'Item type is required';
  }

  if (has('importance') && (!data.importance || typeof data.importance !== 'string' || data.importance.trim().length === 0)) {
    errors.importance = 'Importance level is required';
  }

  // Numeric validations
  if (data.qty !== undefined && (isNaN(data.qty) || data.qty < 0)) {
    errors.qty = 'Quantity must be a non-negative number';
  }
  if (data.stdCost !== undefined && (isNaN(data.stdCost) || data.stdCost < 0)) {
    errors.stdCost = 'Standard cost must be a non-negative number';
  }
  if (data.purchaseCost !== undefined && (isNaN(data.purchaseCost) || data.purchaseCost < 0)) {
    errors.purchaseCost = 'Purchase cost must be a non-negative number';
  }
  if (data.salePrice !== undefined && (isNaN(data.salePrice) || data.salePrice < 0)) {
    errors.salePrice = 'Sale price must be a non-negative number';
  }
  if (data.mrp !== undefined && (isNaN(data.mrp) || data.mrp < 0)) {
    errors.mrp = 'MRP must be a non-negative number';
  }
  if (data.gst !== undefined && (isNaN(data.gst) || data.gst < 0 || data.gst > 100)) {
    errors.gst = 'GST must be between 0 and 100';
  }
  if (data.minStock !== undefined && (isNaN(data.minStock) || data.minStock < 0)) {
    errors.minStock = 'Minimum stock must be a non-negative number';
  }
  if (data.reorderQty !== undefined && (isNaN(data.reorderQty) || data.reorderQty < 0)) {
    errors.reorderQty = 'Order Quantity must be a non-negative number';
  } else if (Number(data.reorderQty) > 0 && Number(data.reorderQty) < (Number(data.minStock) || 0)) {
    // Ordering less than the trigger point means receiving it would still
    // leave stock at/below minStock — the request would fire again right away.
    errors.reorderQty = 'Order Quantity must be at least the Minimum Stock value, otherwise receiving it will immediately trigger another auto-purchase request.';
  }
  // Same reorderQty >= minStock guard, per fabrication dimension variant —
  // each is its own independent flow (see Inventory.js's own comment). Both
  // are piece counts here (not the item's purchaseUnit, unlike the top-level
  // fields above), so must be whole numbers — a vendor sells whole pieces
  // regardless of a weight-based purchaseUnit.
  if (data.dimensionVariants && Array.isArray(data.dimensionVariants)) {
    data.dimensionVariants.forEach((dv, index) => {
      const dvMinStock = Number(dv.minStock) || 0;
      const dvReorderQty = Number(dv.reorderQty) || 0;
      if (!Number.isInteger(dvMinStock)) {
        errors[`dimensionVariants[${index}].minStock`] = 'Minimum Stock must be a whole number of pieces for this dimension.';
      }
      if (!Number.isInteger(dvReorderQty)) {
        errors[`dimensionVariants[${index}].reorderQty`] = 'Order Quantity must be a whole number of pieces for this dimension.';
      } else if (dvReorderQty > 0 && dvReorderQty < dvMinStock) {
        errors[`dimensionVariants[${index}].reorderQty`] = 'Order Quantity must be at least the Minimum Stock value for this dimension.';
      }
    });
  }
  if (data.leadTime !== undefined && (isNaN(data.leadTime) || data.leadTime < 0)) {
    errors.leadTime = 'Lead time must be a non-negative number';
  }

  // Variant validation logic completely focused on the dynamic attributes array
  if (data.variants && Array.isArray(data.variants)) {
    data.variants.forEach((v, index) => {
      if (v.price !== undefined && (isNaN(v.price) || v.price < 0)) {
        errors[`variants[${index}].price`] = 'Variant price must be a non-negative number';
      }

      // Ensures runtime custom configurations contain valid label structures
      if (v.attributes && Array.isArray(v.attributes)) {
        v.attributes.forEach((attr, attrIdx) => {
          if (!attr.label || attr.label.trim() === '') {
            errors[`variants[${index}].attributes[${attrIdx}].label`] = 'Dynamic field name is required';
          }
        });
      }
    });
  }

  // Enum validations
  const validTypes = ['Product', 'Material', 'Spares', 'Assemblies'];
  if (data.type && !validTypes.includes(data.type)) {
    errors.type = 'Invalid item type';
  }

  const validImportance = ['Low', 'Normal', 'High', 'Critical'];
  if (data.importance && !validImportance.includes(data.importance)) {
    errors.importance = 'Invalid importance level';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// ── 5. ENHANCED DATA SANITIZATION HELPER ──
const sanitizeItemData = (data) => {
  const sanitized = { ...data };

  // Trim string fields and ensure they exist
  if (sanitized.name) sanitized.name = sanitized.name.trim();
  if (sanitized.code) sanitized.code = sanitized.code.trim();
  if (sanitized.category) sanitized.category = sanitized.category.trim();
  if (sanitized.subCategory) sanitized.subCategory = sanitized.subCategory.trim();
  if (sanitized.customerCategory) sanitized.customerCategory = sanitized.customerCategory.trim();
  if (sanitized.group) sanitized.group = sanitized.group.trim();
  if (sanitized.type) sanitized.type = sanitized.type.trim();
  if (sanitized.importance) sanitized.importance = sanitized.importance.trim();
  if (sanitized.batch) sanitized.batch = sanitized.batch.trim();
  if (sanitized.quality) sanitized.quality = sanitized.quality.trim();
  if (sanitized.unit) sanitized.unit = sanitized.unit.trim();
  if (sanitized.store) sanitized.store = sanitized.store.trim();
  if (sanitized.hsn) sanitized.hsn = sanitized.hsn.trim();
  if (sanitized.description) sanitized.description = sanitized.description.trim();
  if (sanitized.internalNotes) sanitized.internalNotes = sanitized.internalNotes.trim();
  if (sanitized.brand) sanitized.brand = sanitized.brand.trim();
  if (sanitized.metrology) sanitized.metrology = sanitized.metrology.trim();
  if (sanitized.materialGrade) sanitized.materialGrade = sanitized.materialGrade.trim();
  if (sanitized.modelNumber) sanitized.modelNumber = sanitized.modelNumber.trim();
  if (sanitized.sourceType) sanitized.sourceType = sanitized.sourceType.trim();
  if (sanitized.itemSourceType) sanitized.itemSourceType = sanitized.itemSourceType.trim();
  if (sanitized.itemProcessType) sanitized.itemProcessType = sanitized.itemProcessType.trim();
  if (sanitized.dimensionVariants && Array.isArray(sanitized.dimensionVariants)) {
    sanitized.dimensionVariants = sanitized.dimensionVariants.map((dv) => ({
      // Preserve the existing variant's _id when the form round-tripped one
      // (SimpleInventoryForm.jsx spreads the loaded item's dv, _id included).
      // Without this, every save minted a brand-new _id for every variant —
      // silently orphaning anything that had snapshotted the old one
      // (SheetMetalPlan.dimensionVariantId, RDBOM material lines,
      // ProductionOrder material demands). Freshly-added variants have no
      // _id yet, so this key is omitted for them and Mongoose's schema
      // default (a fresh ObjectId) applies exactly as before.
      ...(dv._id && mongoose.Types.ObjectId.isValid(dv._id) ? { _id: dv._id } : {}),
      category: dv.category ? String(dv.category).trim() : '',
      values: dv.values && typeof dv.values === 'object' ? dv.values : {},
      designation: dv.designation ? String(dv.designation).trim() : '',
      densityValue: dv.densityValue !== undefined && dv.densityValue !== null && dv.densityValue !== '' ? Number(dv.densityValue) : null,
      densityUnit: dv.densityUnit ? String(dv.densityUnit).trim() : 'kg/m3',
      weightPerMeterKg: dv.weightPerMeterKg !== undefined && dv.weightPerMeterKg !== null && dv.weightPerMeterKg !== '' ? Number(dv.weightPerMeterKg) : null,
      weightPerPieceKg: dv.weightPerPieceKg !== undefined && dv.weightPerPieceKg !== null && dv.weightPerPieceKg !== '' ? Number(dv.weightPerPieceKg) : null,
      subStock: Number(dv.subStock) || 0,
      // Material Flow (High/Medium/Low Flow) per-dimension reorder preset —
      // this map used to silently drop these on every single save (create
      // AND update), which is why they always read back as blank/0 no
      // matter what was entered: the object below never carried them
      // through to what actually got persisted.
      materialFlow: dv.materialFlow ? String(dv.materialFlow).trim() : '',
      minStock: Number(dv.minStock) || 0,
      reorderQty: Number(dv.reorderQty) || 0,
      // Same drop-on-every-save bug as the 3 fields above, separate concern
      // (marks a variant as Store-cut/Production-returned leftover stock,
      // not a real Fabrication Master catalog size — see Inventory.js's
      // own field comment) — without this, saving the Item via the normal
      // Edit form silently strips the tag off any leftover variant it
      // already has, making it indistinguishable from a real catalog size.
      isLeftover: !!dv.isLeftover,
    }));
  }
  if (sanitized.itemCategories && Array.isArray(sanitized.itemCategories)) {
    sanitized.itemCategories = sanitized.itemCategories.filter(c => c && c.trim()).map(c => c.trim());
  }
  if (sanitized.dimensions && typeof sanitized.dimensions === 'object') {
    const dims = {};
    for (const key of ['length', 'height', 'width', 'diaOD', 'diaID', 'thickness']) {
      const d = sanitized.dimensions[key] || {};
      dims[key] = {
        value: d.value !== undefined && d.value !== null && d.value !== '' ? Number(d.value) : null,
        unit: d.unit ? String(d.unit).trim() : '',
      };
    }
    sanitized.dimensions = dims;
  }
  if (sanitized.size) sanitized.size = sanitized.size.trim();
  if (sanitized.unitWeightValue !== undefined && sanitized.unitWeightValue !== null && sanitized.unitWeightValue !== '') {
    sanitized.unitWeightValue = Number(sanitized.unitWeightValue);
  }

  // Receive Unit is only meaningfully independent of Used Unit for
  // fabrication items (Pieces received vs. a Length/Area unit used, bridged
  // by geometry × density). No such conversion exists between two arbitrary
  // unit types, so for every other item Receive Unit must equal Used Unit —
  // enforced here (not just on the form) so it holds regardless of caller.
  // Guarded on unitType/unit actually being part of this payload so a
  // partial update that doesn't touch them (e.g. the discontinue/reactivate
  // toggle, which sends only { isDiscontinued }) leaves Receive Unit alone.
  if ((sanitized.unitType !== undefined || sanitized.unit !== undefined) && !sanitized.fabricationRef) {
    sanitized.receiveUnitType = sanitized.unitType;
    sanitized.receiveUnit = sanitized.unit;
  }

  // Convert numeric fields
  if (sanitized.qty !== undefined) sanitized.qty = Number(sanitized.qty);
  if (sanitized.stdCost !== undefined) sanitized.stdCost = Number(sanitized.stdCost);
  if (sanitized.purchaseCost !== undefined) sanitized.purchaseCost = Number(sanitized.purchaseCost);
  if (sanitized.salePrice !== undefined) sanitized.salePrice = Number(sanitized.salePrice);
  if (sanitized.mrp !== undefined) sanitized.mrp = Number(sanitized.mrp);
  if (sanitized.gst !== undefined) sanitized.gst = Number(sanitized.gst);
  if (sanitized.minStock !== undefined) sanitized.minStock = Number(sanitized.minStock);
  if (sanitized.leadTime !== undefined) sanitized.leadTime = Number(sanitized.leadTime);
  if (sanitized.order !== undefined) sanitized.order = Number(sanitized.order);

  // Convert boolean fields
  if (sanitized.internalManufacturing !== undefined) {
    sanitized.internalManufacturing = Boolean(sanitized.internalManufacturing);
  }
  if (sanitized.purchase !== undefined) {
    sanitized.purchase = Boolean(sanitized.purchase);
  }

  // Handle arrays
  if (sanitized.tags && Array.isArray(sanitized.tags)) {
    sanitized.tags = sanitized.tags.filter(tag => tag && tag.trim()).map(tag => tag.trim());
  }
  if (sanitized.customerPrices && Array.isArray(sanitized.customerPrices)) {
    sanitized.customerPrices = sanitized.customerPrices.map(cp => ({
      category: cp.category ? cp.category.trim() : '',
      price: Number(cp.price) || 0
    }));
  }

  // Sanitizes the variant array structure with nested attribute entries cleanly
  if (sanitized.variants && Array.isArray(sanitized.variants)) {
    sanitized.variants = sanitized.variants.map(v => ({
      name: v.name ? String(v.name).trim() : '',
      price: Number(v.price) || 0,
      code: v.code ? String(v.code).trim() : '',
      attributes: Array.isArray(v.attributes) ? v.attributes.map(attr => ({
        label: attr.label ? String(attr.label).trim() : '',
        value: attr.value ? String(attr.value).trim() : ''
      })) : []
    }));
  }

  return sanitized;
};

export const getItemById = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;

    // Handle special routes like 'export'
    if (id === 'export') {
      return exportItemsToExcel(req, res);
    }

    // Build query with company filtering for Unit Head and Store roles
    let query = { _id: id };
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      query.store = req.user.companyId;
    } else if ((req.user.role === 'Store Head' || req.user.role === 'Store Employee') && req.user.companyId) {
      const storeCompanyIdStr = req.user.companyId.toString();
      query.$or = [
        { store: storeCompanyIdStr },
        { store: req.user.companyId },
        { companyId: storeCompanyIdStr },
        { companyId: req.user.companyId }
      ];
    }

    const item = await Item.findOne(query);

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Resolve company name for store location
    const itemObj = item.toObject();

    // If store field contains an ObjectId, resolve the company name
    if (itemObj.store && itemObj.store.match(/^[0-9a-fA-F]{24}$/)) {
      try {
        const company = await Company.findById(itemObj.store).select('name city state');
        if (company) {
          itemObj.storeLocation = `${company.name} - ${company.city}, ${company.state}`;
          itemObj.companyId = itemObj.store;
        } else {
          itemObj.storeLocation = 'Unknown Location';
        }
      } catch (error) {
        console.error('Error resolving company for item:', item._id, error);
        itemObj.storeLocation = itemObj.store;
      }
    } else {
      // For backward compatibility with string store names
      itemObj.storeLocation = itemObj.store || 'No Location';
    }

    res.json({ item: itemObj });
  } catch (error) {
    console.error('Get item by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getItemByCode = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Code parameter is required' });
    }

    // Build query with case-insensitive code matching
    const escapedCode = code.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let query = { code: { $regex: `^${escapedCode}$`, $options: 'i' } };

    // Apply company/store filtering exactly like other query endpoints
    if (req.user.companyId) {
      const companyIdStr = req.user.companyId.toString();
      query.$and = [
        { code: { $regex: `^${escapedCode}$`, $options: 'i' } },
        {
          $or: [
            { store: companyIdStr },
            { store: req.user.companyId },
            { companyId: companyIdStr },
            { companyId: req.user.companyId }
          ]
        }
      ];
    }

    const item = await Item.findOne(query);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Get item by code error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};










export const deleteItem = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;

    const item = await Item.findById(id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Delete the item
    await Item.findByIdAndDelete(id);

    // Clean up the item's uploaded media so it doesn't sit orphaned on disk
    deleteUploadedItemFile(item.image);
    deleteUploadedItemFile(item.brochureUrl);
    deleteUploadedItemFile(item.warranty?.cardUrl);

    // Clean up production summary entries for this item
    try {
      const deleteResult = await ProductDailySummary.deleteMany({
        productId: id
      });
      console.log(`🗑️ Cleaned up ${deleteResult.deletedCount} production summary entries for deleted item: ${item.name}`);
    } catch (cleanupError) {
      console.error('⚠️ Warning: Failed to clean up production summary entries:', cleanupError);
      // Don't fail the main deletion if cleanup fails
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Bulk delete multiple items
export const bulkDeleteItems = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { itemIds } = req.body;

    // Validate input
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'itemIds must be a non-empty array'
      });
    }

    // Validate all IDs are valid ObjectIds
    const mongoose = await import('mongoose');
    const invalidIds = itemIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item IDs provided',
        invalidIds
      });
    }

    console.log(`🗑️ Bulk delete request for ${itemIds.length} items by ${req.user.username} (${req.user.role})`);

    // Check which items exist before deletion
    const existingItems = await Item.find({ _id: { $in: itemIds } });
    const existingIds = existingItems.map(item => item._id.toString());
    const notFoundIds = itemIds.filter(id => !existingIds.includes(id));

    if (existingItems.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No items found with the provided IDs',
        notFoundIds: itemIds
      });
    }

    // Perform bulk deletion
    const deleteResult = await Item.deleteMany({ _id: { $in: existingIds } });

    // Clean up each deleted item's uploaded media so it doesn't sit orphaned on disk
    existingItems.forEach(item => {
      deleteUploadedItemFile(item.image);
      deleteUploadedItemFile(item.brochureUrl);
      deleteUploadedItemFile(item.warranty?.cardUrl);
    });

    // Clean up production summary entries for deleted items
    try {
      const summaryDeleteResult = await ProductDailySummary.deleteMany({
        productId: { $in: existingIds }
      });
      console.log(`🗑️ Cleaned up ${summaryDeleteResult.deletedCount} production summary entries for ${deleteResult.deletedCount} deleted items`);
    } catch (cleanupError) {
      console.error('⚠️ Warning: Failed to clean up production summary entries:', cleanupError);
      // Don't fail the main deletion if cleanup fails
    }

    console.log(`✅ Bulk delete completed: ${deleteResult.deletedCount} items deleted`);

    // Prepare response with detailed information
    const response = {
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} item${deleteResult.deletedCount === 1 ? '' : 's'}`,
      deletedCount: deleteResult.deletedCount,
      requestedCount: itemIds.length,
      deletedItems: existingItems.map(item => ({
        id: item._id,
        name: item.name,
        code: item.code
      }))
    };

    // Include information about items that weren't found
    if (notFoundIds.length > 0) {
      response.warning = `${notFoundIds.length} item${notFoundIds.length === 1 ? '' : 's'} not found`;
      response.notFoundIds = notFoundIds;
    }

    res.json(response);

  } catch (error) {
    console.error('Bulk delete items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during bulk deletion',
      error: error.message
    });
  }
};

export const adjustStock = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { adjustment, reason } = req.body;

    if (typeof adjustment !== 'number') {
      return res.status(400).json({ message: 'Adjustment must be a number' });
    }

    const item = await Item.findById(id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const newQty = item.qty + adjustment;
    if (newQty < 0) {
      return res.status(400).json({ message: 'Insufficient stock for this adjustment' });
    }

    item.qty = newQty;
    await item.save();

    res.json({
      message: 'Stock adjusted successfully',
      item,
      adjustment,
      reason
    });
  } catch (error) {
    console.error('Adjust stock error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Reorder items in bulk
export const reorderItems = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { itemOrders } = req.body; // Array of { id: string, order: number }

    if (!Array.isArray(itemOrders)) {
      return res.status(400).json({ message: 'itemOrders must be an array' });
    }

    const bulkOps = itemOrders.map(item => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: { order: item.order } }
      }
    }));

    if (bulkOps.length > 0) {
      await Item.bulkWrite(bulkOps);
    }

    res.json({ success: true, message: 'Items reordered successfully' });
  } catch (error) {
    console.error('Reorder items error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── CATEGORY MANAGEMENT (COMPANY-WISE) ─────────────────────────────────

export const getCategories = async (req, res) => {
  try {
    console.log('🔍 GetCategories called by:', req.user?.role);

    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: 'Access denied. User does not belong to a company.' });
    }

    // Fetch ONLY categories belonging to the user's company
    const categories = await Category.find({ companyId }).sort({ createdAt: -1, name: 1 });

    // Add product count specifically for this company
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Item.countDocuments({
          category: category.name,
          companyId: companyId // Ensures it only counts items in this company
        });
        const categoryObj = category.toObject();
        categoryObj.productCount = productCount;
        return categoryObj;
      })
    );

    console.log(`✅ Returning ${categoriesWithCount.length} categories for company ${companyId}`);
    res.json({ categories: categoriesWithCount });
  } catch (error) {
    console.error('❌ Get categories error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'add')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description, subcategories = [] } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Check if category already exists IN THIS COMPANY
    const existingCategory = await Category.findOne({ name: name.trim(), companyId });
    if (existingCategory) {
      return res.status(400).json({ success: false, message: 'Category name already exists in your company.' });
    }

    // Filter out empty subcategories
    const validSubcategories = subcategories.filter(sub => sub && sub.trim() !== '');

    const categoryData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      subcategories: validSubcategories,
      companyId // Assign to the user's company
    };

    const category = await Category.create(categoryData);
    console.log('Category created successfully:', category.name);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { name, description, subcategories = [] } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Prevent renaming to an existing category IN THIS COMPANY
    const existingCategory = await Category.findOne({ name: name.trim(), companyId, _id: { $ne: id } });
    if (existingCategory) {
      return res.status(400).json({ success: false, message: 'Category name already exists in your company.' });
    }

    const validSubcategories = subcategories.filter(sub => sub && sub.trim() !== '');

    const updateData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      subcategories: validSubcategories
    };

    // Strict update: Must match both ID and Company ID
    const category = await Category.findOneAndUpdate(
      { _id: id, companyId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found or access denied.' });
    }

    res.json({
      success: true,
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const companyId = req.user.companyId;

    // Verify category belongs to this company
    const category = await Category.findOne({ _id: id, companyId });
    if (!category) {
      return res.status(404).json({ message: 'Category not found or access denied.' });
    }

    // Check if category is being used by any items IN THIS COMPANY
    const itemsUsingCategory = await Item.countDocuments({
      category: category.name,
      companyId: companyId
    });

    if (itemsUsingCategory > 0) {
      return res.status(400).json({
        message: `Cannot delete category. ${itemsUsingCategory} items in your inventory are using this category.`
      });
    }

    await Category.findByIdAndDelete(id);

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── UNIT TYPE MANAGEMENT (COMPANY-WISE) ─────────────────────────────────

export const getUnitTypes = async (req, res) => {
  try {
    console.log('🔍 GetUnitTypes called by:', req.user?.role);

    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: 'Access denied. User does not belong to a company.' });
    }

    let unitTypes = await UnitType.find({ companyId }).sort({ name: 1 });

    // Auto-seed default units if none exist for this company
    if (unitTypes.length === 0) {
      console.log(`🌱 Seeding default unit types for company ${companyId}...`);
      const seedData = [
        { name: 'Length Unit', units: ['Millimeter', 'Centimeter', 'Meter', 'Kilometer', 'Inch', 'Foot'], companyId },
        { name: 'Area Unit', units: ['Millimeter Square', 'Centimeter Square', 'Meter Square', 'Inch Square', 'Foot Square'], companyId },
        { name: 'Volume Unit', units: ['Centimeter Cube', 'Meter Cube', 'Liter', 'Inch Cube', 'Foot Cube'], companyId },
        { name: 'Mass Unit', units: ['Gram', 'Kilogram', 'Tonne'], companyId },
        { name: 'Count Unit', units: ['NOS', 'Pieces'], companyId }
      ];
      await UnitType.insertMany(seedData);
      unitTypes = await UnitType.find({ companyId }).sort({ name: 1 });
    }

    // Add product count specifically for this company
    const unitTypesWithCount = await Promise.all(
      unitTypes.map(async (ut) => {
        const count = await Item.countDocuments({
          companyId,
          $or: [
            { unitType: ut.name },
            { purchaseUnitType: ut.name }
          ]
        });
        const utObj = ut.toObject();
        utObj.productCount = count;
        return utObj;
      })
    );

    console.log(`✅ Returning ${unitTypesWithCount.length} unit types for company ${companyId}`);
    res.json({ unitTypes: unitTypesWithCount });
  } catch (error) {
    console.error('❌ Get unit types error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createUnitType = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'add')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description, units = [] } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Unit type name is required' });
    }

    // Check if unit type already exists IN THIS COMPANY
    const existingUnitType = await UnitType.findOne({ name: name.trim(), companyId });
    if (existingUnitType) {
      return res.status(400).json({ success: false, message: 'Unit type name already exists in your company.' });
    }

    // Filter out empty units
    const validUnits = units.filter(u => u && u.trim() !== '');

    const unitTypeData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      units: validUnits,
      companyId
    };

    const unitType = await UnitType.create(unitTypeData);
    console.log('Unit type created successfully:', unitType.name);

    res.status(201).json({
      success: true,
      message: 'Unit type created successfully',
      unitType
    });
  } catch (error) {
    console.error('Create unit type error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateUnitType = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { name, description, units = [] } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Unit type name is required' });
    }

    // Prevent renaming to an existing unit type IN THIS COMPANY
    const existingUnitType = await UnitType.findOne({ name: name.trim(), companyId, _id: { $ne: id } });
    if (existingUnitType) {
      return res.status(400).json({ success: false, message: 'Unit type name already exists in your company.' });
    }

    const validUnits = units.filter(u => u && u.trim() !== '');

    const updateData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      units: validUnits
    };

    // Strict update: Must match both ID and Company ID
    const unitType = await UnitType.findOneAndUpdate(
      { _id: id, companyId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!unitType) {
      return res.status(404).json({ success: false, message: 'Unit type not found or access denied.' });
    }

    res.json({
      success: true,
      message: 'Unit type updated successfully',
      unitType
    });
  } catch (error) {
    console.error('Update unit type error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteUnitType = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const companyId = req.user.companyId;

    // Verify unit type belongs to this company
    const unitType = await UnitType.findOne({ _id: id, companyId });
    if (!unitType) {
      return res.status(404).json({ message: 'Unit type not found or access denied.' });
    }

    // Check if unit type is being used by any items IN THIS COMPANY
    const itemsUsingUnitType = await Item.countDocuments({
      companyId: companyId,
      $or: [
        { unitType: unitType.name },
        { purchaseUnitType: unitType.name }
      ]
    });

    if (itemsUsingUnitType > 0) {
      return res.status(400).json({
        message: `Cannot delete unit type. ${itemsUsingUnitType} items in your inventory are using this unit type.`
      });
    }

    await UnitType.findByIdAndDelete(id);

    res.json({ message: 'Unit type deleted successfully' });
  } catch (error) {
    console.error('Delete unit type error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── CUSTOMER CATEGORY CONTROLLERS (COMPANY-WISE) ───────────────────────

export const getCustomerCategories = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: 'Access denied. User does not belong to a company.' });
    }

    // Fetch ONLY customer categories belonging to the user's company
    const customerCategories = await CustomerCategory.find({ companyId }).sort({ createdAt: -1, name: 1 });
    res.json({ customerCategories });
  } catch (error) {
    console.error('Get customer categories error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createCustomerCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'add')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'Customer category name is required' });
    }

    // Check for duplicate name IN THIS COMPANY
    const existingCategory = await CustomerCategory.findOne({ name: name.trim(), companyId });
    if (existingCategory) {
      return res.status(400).json({ message: 'Customer category name already exists in your company.' });
    }

    const customerCategory = await CustomerCategory.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      companyId
    });

    res.status(201).json({
      message: 'Customer category created successfully',
      customerCategory
    });
  } catch (error) {
    console.error('Create customer category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateCustomerCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { name, description } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'Customer category name is required' });
    }

    // Prevent renaming to an existing category IN THIS COMPANY
    const existingCategory = await CustomerCategory.findOne({
      name: name.trim(),
      companyId,
      _id: { $ne: id }
    });
    if (existingCategory) {
      return res.status(400).json({ message: 'Customer category name already exists in your company.' });
    }

    const updateData = {
      name: name.trim(),
      description: description ? description.trim() : ''
    };

    // Strict update: Must match both ID and Company ID
    const customerCategory = await CustomerCategory.findOneAndUpdate(
      { _id: id, companyId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!customerCategory) {
      return res.status(404).json({ message: 'Customer category not found or access denied.' });
    }

    res.json({
      message: 'Customer category updated successfully',
      customerCategory
    });
  } catch (error) {
    console.error('Update customer category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteCustomerCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const companyId = req.user.companyId;

    // Verify category belongs to this company
    const category = await CustomerCategory.findOne({ _id: id, companyId });
    if (!category) {
      return res.status(404).json({ message: 'Customer category not found or access denied.' });
    }

    // Check if category is being used by any items IN THIS COMPANY
    const itemsUsingCategory = await Item.countDocuments({
      customerCategory: category.name,
      companyId: companyId
    });

    if (itemsUsingCategory > 0) {
      return res.status(400).json({
        message: `Cannot delete. ${itemsUsingCategory} items in your inventory are assigned to this customer category.`
      });
    }

    await CustomerCategory.findOneAndDelete({ _id: id, companyId });

    res.json({ message: 'Customer category deleted successfully' });
  } catch (error) {
    console.error('Delete customer category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
    }
  }
});

// Export items to Excel - Simplified implementation
export const exportItemsToExcel = async (req, res) => {
  try {
    console.log('Starting Excel export for inventory items');

    // Build query with company filtering for Unit Head. Exclude Product
    // Master machines / Motor Master motors — this export is Inventory-only.
    let query = { productKind: null };
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      query.store = req.user.companyId;
    }

    const items = await Item.find(query).sort({ createdAt: -1 });
    console.log(`Found ${items.length} items to export`);

    if (items.length === 0) {
      return res.status(404).json({ message: 'No items found to export', success: false });
    }

    // Create simple data structure for Excel
    const excelData = items.map((item, index) => ({
      'Serial No': index + 1,
      'Item Name': item.name || '',
      'Description': item.description || '',
      'Category': item.category || '',
      'Sub Category': item.subCategory || '',
      'Customer Category': item.customerCategory || '',
      'Unit': item.unit || 'pieces',
      'Purchase Price': item.purchasePrice || 0,
      'Sale Price': item.salePrice || 0,
      'Current Stock': item.qty || 0,
      'Min Stock': item.minStock || 0,
      'Max Stock': item.maxStock || 0,
      'Store Location ID': item.store || item.companyId || '',
      'Supplier': item.supplier || '',
      'Created Date': item.createdAt ? item.createdAt.toISOString().split('T')[0] : ''
    }));

    console.log(`Prepared ${excelData.length} items for Excel export`);

    // Generate Excel file
    const excelBuffer = createSimpleExcel(excelData, 'Inventory Items');

    const filename = `inventory_items_${Date.now()}.xlsx`;

    console.log(`Generated Excel file: ${filename}, Size: ${excelBuffer.length} bytes`);

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);

    console.log(`Excel file sent successfully: ${filename}`);

  } catch (error) {
    console.error('Excel export error:', error);
    return res.status(500).json({
      message: 'Failed to export items to Excel',
      error: error.message,
      success: false
    });
  }
};

// Import items from Excel
export const importItemsFromExcel = [upload.single('file'), async (req, res) => {
  try {
    console.log('Import request received:', req.file ? 'File present' : 'No file');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
        results: null
      });
    }

    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    let workbook, worksheet, jsonData;

    try {
      // Parse Excel file
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      worksheet = workbook.Sheets[sheetName];
      jsonData = XLSX.utils.sheet_to_json(worksheet);
      console.log(`Parsed ${jsonData.length} rows from Excel`);
    } catch (parseError) {
      console.error('Excel parsing error:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Failed to parse Excel file: ' + parseError.message,
        results: null
      });
    }

    if (jsonData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel file is empty or has no valid data',
        results: null
      });
    }

    const results = {
      total: jsonData.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Initialize errors array for collection
    const errors = [];

    // Process each row
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 2; // Excel row number (accounting for header)
      let itemData = { name: 'Unknown' }; // Initialize with default values

      try {
        console.log(`\n🔄 Starting row ${rowNumber} processing...`);

        // Enhanced field mapping with null/undefined safety
        const safeString = (value) => value ? String(value).trim() : '';
        const safeNumber = (value) => {
          const num = Number(value);
          return isNaN(num) ? 0 : num;
        };

        itemData = {
          name: safeString(row['Item Name']),
          description: safeString(row['Description']),
          category: safeString(row['Category']),
          subCategory: safeString(row['Sub Category']),
          customerCategory: safeString(row['Customer Category']),
          type: safeString(row['Type']) || 'Product',
          importance: safeString(row['Importance']) || 'Normal',
          unit: safeString(row['Unit']) || 'pieces',
          qty: safeNumber(row['Current Stock']),
          minStock: safeNumber(row['Min Stock']),
          maxStock: safeNumber(row['Max Stock']),
          stdCost: safeNumber(row['Standard Cost']),
          purchaseCost: safeNumber(row['Purchase Price']),
          salePrice: safeNumber(row['Sale Price']),
          mrp: safeNumber(row['MRP']),
          gst: safeNumber(row['GST %']),
          hsn: safeString(row['HSN Code']),
          batch: safeString(row['Batch']),
          store: safeString(row['Store Location ID']),
          leadTime: safeNumber(row['Lead Time']),
          internalManufacturing: String(row['Internal Manufacturing'] || 'NO').toLowerCase() === 'yes',
          purchase: String(row['Purchase Allowed'] || 'YES').toLowerCase() === 'yes',
          internalNotes: safeString(row['Internal Notes'])
        };

        console.log(`\n🔄 Processing row ${rowNumber}:`, {
          originalName: row['Item Name'],
          originalStore: row['Store Location ID'],
          parsedName: itemData.name,
          parsedType: itemData.type,
          storeLocationId: itemData.store
        });

        // Validate required fields with better error messages
        if (!itemData.name || !itemData.name.trim()) {
          throw new Error(`Item name is required and cannot be empty`);
        }

        // IMPORTANT: Normalize type field FIRST before duplicate checking
        const validTypes = ['Product', 'Material', 'Spares', 'Assemblies'];
        const normalizedType = itemData.type ? itemData.type.trim() : '';

        // Find matching type (case-insensitive)
        const matchingType = validTypes.find(validType =>
          validType.toLowerCase() === normalizedType.toLowerCase()
        );

        if (!matchingType) {
          errors.push(`Row ${rowNumber}: Invalid type "${itemData.type}". Must be one of: ${validTypes.join(', ')} (case-insensitive). Row skipped.`);
          continue; // Skip this row but continue with others
        }

        // Set the properly formatted type BEFORE duplicate checking
        itemData.type = matchingType;
        console.log(`✅ Type normalized: "${normalizedType}" → "${matchingType}"`);

        // IMPORTANT: Normalize category field before duplicate checking  
        if (itemData.category) {
          itemData.category = itemData.category.trim();
        }

        // Validate Store Location ID format if provided - only accept valid company IDs
        if (itemData.store) {
          console.log(`🔍 Looking up company: "${itemData.store}" (Length: ${itemData.store.length} chars)`);

          try {
            const { Company } = await import('../models/Company.js');
            let company = null;

            // Only try to find by ID (must be a valid ObjectId format)
            if (itemData.store.match(/^[0-9a-fA-F]{24}$/)) {
              console.log(`📋 Searching by ID: ${itemData.store}`);
              try {
                company = await Company.findById(itemData.store);
                console.log(`📋 Found by ID:`, company ? `✅ ${company.name} (${company._id})` : '❌ NOT FOUND');
              } catch (idError) {
                console.log(`📋 ID lookup failed:`, idError.message);
              }
            } else {
              console.log(`📋 Not a valid 24-character ObjectId format, skipping this row`);
              errors.push(`Row ${rowNumber}: Invalid Store Location ID format "${itemData.store}". Must be a valid 24-character company ID. Row skipped.`);
              continue; // Skip this row but continue with others
            }

            if (!company) {
              // Add to error list instead of throwing error
              errors.push(`Row ${rowNumber}: Store Location ID "${itemData.store}" not found. Please use a valid company ID. Row skipped.`);
              continue; // Skip this row but continue with others
            }

            // 🔒 UNIT HEAD RESTRICTION: Only allow their own company
            if (req.user.role === 'Unit Head' && req.user.companyId) {
              const userCompanyId = req.user.companyId.toString();
              const itemCompanyId = company._id.toString();

              if (userCompanyId !== itemCompanyId) {
                // Get user's company name for better error message
                const userCompany = await Company.findById(req.user.companyId).select('name');
                const userCompanyName = userCompany ? userCompany.name : 'Your Company';

                console.log(`🚫 Unit Head restriction: User company ${userCompanyId} (${userCompanyName}) ≠ Item company ${itemCompanyId} (${company.name})`);
                errors.push(`Row ${rowNumber}: Access Denied - You can only import items for your location "${userCompanyName}". This item belongs to "${company.name}". Row skipped.`);
                continue; // Skip this row but continue with others
              } else {
                console.log(`✅ Unit Head validation passed: Item company matches user company`);
              }
            }

            // Store the company ID for consistency
            itemData.store = company._id.toString();
            console.log(`✅ Valid Store Location: ${itemData.store} -> ${company.name}`);
          } catch (err) {
            console.error(`❌ Company lookup error:`, err.message);
            errors.push(`Row ${rowNumber}: Store Location ID "${itemData.store}" validation failed. Please use a valid company ID. Row skipped.`);
            continue; // Skip this row but continue with others
          }
        } else {
          // Handle blank/empty Store Location ID
          if (req.user.role === 'Unit Head') {
            // 🔒 If no store provided and user is Unit Head, auto-assign their company
            console.log(`🏢 Unit Head: Auto-assigning company ${req.user.companyId}`);
            itemData.store = req.user.companyId;
          } else {
            // For Super Admin, require Store Location ID
            errors.push(`Row ${rowNumber}: Store Location ID is required and cannot be blank. Row skipped.`);
            continue; // Skip this row but continue with others
          }
        }

        const trimmedName = itemData.name.trim();

        // Determine company ID for storage first
        let companyIdForCheck = req.user.companyId;
        if (itemData.store) {
          companyIdForCheck = itemData.store;
        }

        // Check for duplicate item name in same location
        console.log(`📦 Checking for duplicate item "${trimmedName}" in location: ${companyIdForCheck}`);
        console.log(`🔍 Duplicate check details:`, {
          name: trimmedName,
          category: itemData.category,
          type: itemData.type,
          store: itemData.store,
          companyIdForCheck: companyIdForCheck
        });

        // Build duplicate check query - EXACT name match for better duplicate prevention
        const duplicateQuery = {
          name: trimmedName, // Exact name match (case sensitive for consistency)
          category: itemData.category,
          type: itemData.type,
          store: companyIdForCheck // Direct store match since all items use store field
        };

        console.log(`🔎 Duplicate check query:`, {
          name: `"${trimmedName}"`,
          category: itemData.category,
          type: itemData.type,
          store: companyIdForCheck
        });

        // Check if item with same name already exists in same location
        const existingItem = await Item.findOne(duplicateQuery);

        console.log(`🎯 Duplicate search result:`, existingItem ? {
          found: true,
          id: existingItem._id,
          name: `"${existingItem.name}"`,
          category: existingItem.category,
          type: existingItem.type,
          store: existingItem.store,
          code: existingItem.code
        } : { found: false, message: 'No duplicate found' });

        if (existingItem) {
          console.log(`🚫 BLOCKING DUPLICATE IMPORT: "${trimmedName}" already exists!`);
          errors.push(`Row ${rowNumber}: Item "${trimmedName}" already exists in category "${itemData.category}" with type "${itemData.type}" at this location (Code: ${existingItem.code}). Duplicate import blocked.`);
          continue; // Skip this row but continue with others
        }

        console.log(`✅ Item "${trimmedName}" is unique - proceeding with import`);

        // ✅ Item name is unique in this location, proceed with import

        // Ensure importance has a valid value - also normalize case and spaces
        const validImportance = ['Low', 'Normal', 'High', 'Critical'];
        const normalizedImportance = itemData.importance.trim();
        const matchingImportance = validImportance.find(validImp =>
          validImp.toLowerCase() === normalizedImportance.toLowerCase()
        );

        if (!matchingImportance) {
          itemData.importance = 'Normal';
          console.log(`⚠️ Invalid importance "${itemData.importance}" normalized to "Normal"`);
        } else {
          itemData.importance = matchingImportance;
          console.log(`✅ Importance normalized: "${normalizedImportance}" → "${matchingImportance}"`);
        }

        // Auto-generate code since Item Code is not required in import
        const prefix = itemData.type === 'Product' ? 'PRO' : 'SER';

        // Generate globally unique code to avoid MongoDB unique index conflicts
        let codeAttempts = 0;
        let uniqueCode = '';
        let codeExists = true;

        while (codeExists && codeAttempts < 100) {
          // Get GLOBAL count for this prefix to ensure global uniqueness
          const globalCount = await Item.countDocuments({
            code: new RegExp(`^${prefix}\\d{4}$`)
          });

          // Generate next available global number
          uniqueCode = `${prefix}${String(globalCount + 1 + codeAttempts).padStart(4, '0')}`;

          // Check if this code already exists GLOBALLY (not just in company)
          const existingItemByCode = await Item.findOne({ code: uniqueCode });
          codeExists = !!existingItemByCode;
          codeAttempts++;

          if (codeExists) {
            console.log(`Code ${uniqueCode} already exists globally, trying next number...`);
          } else {
            console.log(`✅ Generated globally unique code: ${uniqueCode}`);
          }
        }

        if (codeAttempts >= 100) {
          throw new Error('Unable to generate unique code after 100 attempts');
        }

        itemData.code = uniqueCode;
        console.log(`Auto-generated globally unique code for ${trimmedName}: ${itemData.code} (Company: ${companyIdForCheck})`);

        // 🔍 VALIDATE CATEGORY - Don't auto-create, show proper errors with available options
        if (itemData.category && itemData.category.trim()) {
          const trimmedCategory = itemData.category.trim();
          console.log(`🔍 Validating category: "${trimmedCategory}"`);

          const categoryExists = await Category.findOne({
            name: { $regex: new RegExp(`^${trimmedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });

          if (!categoryExists) {
            console.log(`❌ Category "${trimmedCategory}" not found`);

            // Get available categories for better error message
            const availableCategories = await Category.find({}).select('name').limit(10);
            const categoryNames = availableCategories.map(cat => cat.name).join(', ');
            const categoryList = availableCategories.length > 0 ? categoryNames : 'No categories available';

            errors.push(`Row ${rowNumber}: Category "${trimmedCategory}" does not exist. Available categories: ${categoryList}${availableCategories.length === 10 ? '...' : ''}`);
            continue; // Skip this row but continue with others
          } else {
            console.log(`✅ Category "${trimmedCategory}" exists as "${categoryExists.name}"`);

            // Update itemData with the exact category name from database for consistency
            itemData.category = categoryExists.name;

            // Validate subcategory if provided
            if (itemData.subCategory && itemData.subCategory.trim()) {
              const trimmedSubCategory = itemData.subCategory.trim();
              const subCategoryExists = categoryExists.subcategories.some(
                sub => sub.toLowerCase() === trimmedSubCategory.toLowerCase()
              );

              if (!subCategoryExists) {
                console.log(`❌ Subcategory "${trimmedSubCategory}" not found in category "${categoryExists.name}"`);
                const availableSubcategories = categoryExists.subcategories.length > 0
                  ? categoryExists.subcategories.join(', ')
                  : 'none';
                errors.push(`Row ${rowNumber}: Subcategory "${trimmedSubCategory}" does not exist in category "${categoryExists.name}". Available subcategories: ${availableSubcategories}`);
                continue; // Skip this row but continue with others
              } else {
                console.log(`✅ Subcategory "${trimmedSubCategory}" exists in category "${categoryExists.name}"`);

                // Find and set the exact subcategory name from database for consistency
                const exactSubCategory = categoryExists.subcategories.find(
                  sub => sub.toLowerCase() === trimmedSubCategory.toLowerCase()
                );
                itemData.subCategory = exactSubCategory;
              }
            }
          }
        }

        // 🔍 VALIDATE CUSTOMER CATEGORY - Don't auto-create, show proper errors with available options
        if (itemData.customerCategory && itemData.customerCategory.trim()) {
          const trimmedCustomerCategory = itemData.customerCategory.trim();
          console.log(`🔍 Validating customer category: "${trimmedCustomerCategory}"`);

          const customerCategoryExists = await CustomerCategory.findOne({
            name: { $regex: new RegExp(`^${trimmedCustomerCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });

          if (!customerCategoryExists) {
            console.log(`❌ Customer category "${trimmedCustomerCategory}" not found`);

            // Get available customer categories for better error message
            const availableCustomerCategories = await CustomerCategory.find({}).select('name').limit(10);
            const customerCategoryNames = availableCustomerCategories.map(cat => cat.name).join(', ');
            const customerCategoryList = availableCustomerCategories.length > 0 ? customerCategoryNames : 'No customer categories available';

            errors.push(`Row ${rowNumber}: Customer category "${trimmedCustomerCategory}" does not exist. Available customer categories: ${customerCategoryList}${availableCustomerCategories.length === 10 ? '...' : ''}`);
            continue; // Skip this row but continue with others
          } else {
            console.log(`✅ Customer category "${trimmedCustomerCategory}" exists as "${customerCategoryExists.name}"`);

            // Update itemData with the exact customer category name from database for consistency
            itemData.customerCategory = customerCategoryExists.name;
          }
        }

        // Resolve store location to company name (already validated above - just get the name)
        if (itemData.store) {
          try {
            const { Company } = await import('../models/Company.js');
            const company = await Company.findById(itemData.store);
            if (company) {
              console.log(`✅ Resolved store location: ${itemData.store} -> ${company.name}`);
              // Keep the company ID for companyId field but store readable name for display
              itemData.companyId = itemData.store;
              itemData.storeLocation = company.name;
            } else {
              console.log(`⚠️ Warning: Company ${itemData.store} not found during name resolution, but should have been validated already`);
              itemData.companyId = itemData.store;
              itemData.storeLocation = 'Unknown Company';
            }
          } catch (err) {
            console.log(`⚠️ Warning: Could not resolve company name:`, err.message);
            itemData.companyId = itemData.store;
            itemData.storeLocation = 'Unknown Company';
          }
        }

        // Ensure company assignment from store field or user
        if (companyIdForCheck) {
          itemData.companyId = companyIdForCheck;
        }

        // Create new item
        const newItem = await Item.create(itemData);
        console.log(`✅ Successfully created item: ${trimmedName} (Code: ${itemData.code}) - Row ${rowNumber}`);
        console.log(`📊 Item details saved:`, {
          id: newItem._id,
          name: newItem.name,
          companyId: newItem.companyId,
          store: newItem.store
        });

        // 🆕 AUTO-CREATE ProductDailySummary ENTRY for production
        if (companyIdForCheck) {
          try {
            console.log(`🏭 Creating ProductDailySummary entry for ${trimmedName}...`);

            // Check if entry already exists for this product and company (IGNORE DATE)
            const existingSummary = await ProductDailySummary.findOne({
              productId: newItem._id,
              companyId: companyIdForCheck
            });

            if (!existingSummary) {
              const summaryData = {
                productId: newItem._id,
                productName: newItem.name,
                companyId: companyIdForCheck,
                date: new Date().toISOString().split('T')[0], // Today's date
                totalQuantity: newItem.qty || 0,
                physicalStock: 0,
                qtyPerBatch: parseFloat(newItem.batch) || 0,
                batchAdjusted: 0,
                productionQuantity: 0,
                createdAt: new Date(),
                updatedAt: new Date()
              };

              const newSummary = await ProductDailySummary.create(summaryData);
              console.log(`✅ ProductDailySummary created successfully for ${trimmedName} (ID: ${newSummary._id})`);
            } else {
              console.log(`📊 ProductDailySummary already exists for ${trimmedName}, updating stock quantities...`);

              // Update existing entry with new stock information
              existingSummary.totalQuantity = (existingSummary.totalQuantity || 0) + (newItem.qty || 0);
              existingSummary.physicalStock = 0;
              if (!existingSummary.qtyPerBatch && newItem.batch) {
                existingSummary.qtyPerBatch = parseFloat(newItem.batch) || 0;
              }
              existingSummary.updatedAt = new Date();

              await existingSummary.save();
              console.log(`✅ ProductDailySummary updated for ${trimmedName}`);
            }
          } catch (summaryError) {
            console.error(`⚠️ Failed to create/update ProductDailySummary for ${trimmedName}:`, summaryError.message);
            // Don't fail the entire import for ProductDailySummary errors
          }
        }

        results.successful++;
      } catch (rowError) {
        console.error(`❌ ERROR processing row ${rowNumber}:`, {
          itemName: itemData?.name || 'Unknown',
          storeLocation: itemData?.store || 'Unknown',
          originalRowData: row,
          errorMessage: rowError.message,
          errorStack: rowError.stack?.split('\n')[0]
        });
        results.errors.push(`Row ${rowNumber}: ${rowError.message}`);
        results.failed++;
      }
    }

    // Add collected errors to results
    results.errors = [...results.errors, ...errors];

    // Final verification
    const finalCount = await Item.countDocuments();
    console.log(`Final items in database after import: ${finalCount}`);

    res.json({
      message: `Import completed: ${results.successful} successful, ${results.failed} failed`,
      success: results.failed === 0,
      results,
      finalCount
    });

  } catch (error) {
    console.error('Error importing Excel file:', error);
    res.status(500).json({
      message: 'Error importing Excel file',
      error: error.message,
      success: false
    });
  }
}];

// Export categories to Excel - Simplified implementation
export const exportCategoriesToExcel = async (req, res) => {
  try {
    console.log('Starting Excel export for categories');
    const categories = await Category.find({}).sort({ createdAt: -1 });
    console.log(`Found ${categories.length} categories to export`);

    if (categories.length === 0) {
      return res.status(404).json({ message: 'No categories found to export', success: false });
    }

    const excelData = categories.map((category, index) => ({
      'Serial No': index + 1,
      'Category Name': category.name || '',
      'Description': category.description || '',
      'Subcategories': Array.isArray(category.subcategories) ? category.subcategories.join(', ') : '',
      'Created Date': category.createdAt ? category.createdAt.toISOString().split('T')[0] : ''
    }));

    const excelBuffer = createSimpleExcel(excelData, 'Categories');
    const filename = `categories_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);

    console.log(`Categories Excel file sent: ${filename}`);

  } catch (error) {
    console.error('Categories Excel export error:', error);
    return res.status(500).json({
      message: 'Failed to export categories to Excel',
      error: error.message,
      success: false
    });
  }
};

// Export customer categories to Excel - Simplified implementation
export const exportCustomerCategoriesToExcel = async (req, res) => {
  try {
    console.log('Starting Excel export for customer categories');
    const customerCategories = await CustomerCategory.find({}).sort({ createdAt: -1 });
    console.log(`Found ${customerCategories.length} customer categories to export`);

    if (customerCategories.length === 0) {
      return res.status(404).json({ message: 'No customer categories found to export', success: false });
    }

    const excelData = customerCategories.map((category, index) => ({
      'Serial No': index + 1,
      'Category Name': category.name || '',
      'Description': category.description || '',
      'Created Date': category.createdAt ? category.createdAt.toISOString().split('T')[0] : ''
    }));

    const excelBuffer = createSimpleExcel(excelData, 'Customer Categories');
    const filename = `customer_categories_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);

    console.log(`Customer categories Excel file sent: ${filename}`);

  } catch (error) {
    console.error('Customer categories Excel export error:', error);
    return res.status(500).json({
      message: 'Failed to export customer categories to Excel',
      error: error.message,
      success: false
    });
  }
};

// UTILITY CONTROLLERS
export const getLowStockItems = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    // Build query with company filtering for Unit Head. Exclude Product
    // Master machines / Motor Master motors — this is Inventory's own view.
    let query = { $expr: { $lte: ['$qty', '$minStock'] }, productKind: null };
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      query.store = req.user.companyId;
    }

    const lowStockItems = await Item.find(query).sort({ qty: 1 });

    res.json({ lowStockItems });
  } catch (error) {
    console.error('Get low stock items error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getInventoryStats = async (req, res) => {
  console.log('=== STATS API CALLED ===');
  console.log('User:', req.user?.username, 'Role:', req.user?.role, 'CompanyId:', req.user?.companyId);

  try {
    console.log('DEBUG: getInventoryStats called for user:', req.user?.username, 'role:', req.user?.role);

    if (!checkInventoryPermission(req.user, 'view')) {
      console.log('DEBUG: Permission check failed for user:', req.user?.username);
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    console.log('DEBUG: Permission check passed for user:', req.user?.username);

    // Build match stage for company filtering
    let baseMatchStage = {};

    if (req.user.role === 'Unit Head' && req.user.companyId) {
      // Unit Head: filter by store field (string or ObjectId)
      const companyIdStr = String(req.user.companyId);
      baseMatchStage = {
        $or: [
          { store: companyIdStr },
          { store: req.user.companyId },
          { companyId: companyIdStr },
          { companyId: req.user.companyId }
        ]
      };
    } else if (
      (req.user.role === 'Store Head' || req.user.role === 'Store Employee') &&
      req.user.companyId
    ) {
      // Store roles: filter by companyId or store field
      const companyIdStr = String(req.user.companyId);
      baseMatchStage = {
        $or: [
          { store: companyIdStr },
          { store: req.user.companyId },
          { companyId: companyIdStr },
          { companyId: req.user.companyId }
        ]
      };
    }
    // Super Admin / Super Admin sees all — no filter

    // Inventory's own dashboard stats — exclude Product Master machines /
    // Motor Master motors, same reasoning as getItems' productKind=none.
    baseMatchStage.productKind = null;

    console.log('Debug - Base match stage:', JSON.stringify(baseMatchStage));

    const hasFilter = Object.keys(baseMatchStage).length > 0;

    const pipeline = [];
    if (hasFilter) pipeline.push({ $match: baseMatchStage });
    pipeline.push({
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } },
        totalQty: { $sum: '$qty' },
        lowStockCount: {
          $sum: { $cond: [{ $lte: ['$qty', '$minStock'] }, 1, 0] }
        }
      }
    });

    const stats = await Item.aggregate(pipeline);

    // Category stats pipeline
    const categoryPipeline = [];
    if (hasFilter) categoryPipeline.push({ $match: baseMatchStage });
    categoryPipeline.push(
      { $group: { _id: '$category', count: { $sum: 1 }, totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } } } },
      { $sort: { count: -1 } }
    );
    const categoryStats = await Item.aggregate(categoryPipeline);

    // Type stats pipeline
    const typePipeline = [];
    if (hasFilter) typePipeline.push({ $match: baseMatchStage });
    typePipeline.push({
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalQty: { $sum: '$qty' },
        totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } }
      }
    });
    const typeStats = await Item.aggregate(typePipeline);

    // Per-category total qty for inventory overview bars
    const categoryQtyPipeline = [];
    if (hasFilter) categoryQtyPipeline.push({ $match: baseMatchStage });
    categoryQtyPipeline.push({
      $group: {
        _id: '$category',
        totalQty: { $sum: '$qty' },
        totalItems: { $sum: 1 }
      }
    });
    const categoryQtyStats = await Item.aggregate(categoryQtyPipeline);

    // Item Type stats (client's Raw Material/Tool/Readymade Material/Assets
    // classification, Item.itemType) — the new form no longer collects
    // category/subCategory, so this is what ModernInventoryUI's stat cards
    // use in place of the old Category count.
    const itemTypePipeline = [];
    if (hasFilter) itemTypePipeline.push({ $match: baseMatchStage });
    itemTypePipeline.push(
      { $match: { itemType: { $nin: [null, ''] } } },
      { $group: { _id: '$itemType', count: { $sum: 1 } } }
    );
    const itemTypeStats = await Item.aggregate(itemTypePipeline);

    // Discontinued count — Item Status is now a real, form-editable field
    // (see SimpleInventoryForm.jsx), so this is meaningful going forward.
    const discontinuedPipeline = [];
    if (hasFilter) discontinuedPipeline.push({ $match: baseMatchStage });
    discontinuedPipeline.push({ $match: { isDiscontinued: true } }, { $count: 'count' });
    const discontinuedResult = await Item.aggregate(discontinuedPipeline);

    res.json({
      stats: {
        ...stats[0] || { totalItems: 0, totalValue: 0, totalQty: 0, lowStockCount: 0 },
        totalCategories: categoryStats.length,
        totalItemTypes: itemTypeStats.length,
        discontinuedCount: discontinuedResult[0]?.count || 0
      },
      categoryStats,
      typeStats,
      categoryQtyStats,
      itemTypeStats
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};



// ─── ITEM GROUP CONTROLLERS (COMPANY-WISE) ───────────────────────

export const getGroups = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: 'Access denied. User does not belong to a company.' });
    }

    // Fetch ONLY groups belonging to the user's company
    const groups = await Group.find({ companyId }).sort({ createdAt: -1, name: 1 });

    // Add product count specifically for this company
    const groupsWithCount = await Promise.all(
      groups.map(async (group) => {
        const productCount = await Item.countDocuments({
          group: group.name,
          companyId: companyId // Ensures it only counts items in this company
        });
        const groupObj = group.toObject();
        groupObj.productCount = productCount;
        return groupObj;
      })
    );

    console.log(`✅ Returning ${groupsWithCount.length} groups for company ${companyId}`);
    res.json({ success: true, groups: groupsWithCount });
  } catch (error) {
    console.error('❌ Get groups error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createGroup = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'add')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }

    // Check if group already exists IN THIS COMPANY
    const existingGroup = await Group.findOne({ name: name.trim(), companyId });
    if (existingGroup) {
      return res.status(400).json({ success: false, message: 'Group name already exists in your company.' });
    }

    const groupData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      companyId // Assign to the user's company
    };

    const group = await Group.create(groupData);
    console.log('Group created successfully:', group.name);

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      group
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateGroup = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { name, description } = req.body;
    const companyId = req.user.companyId;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }

    // Prevent renaming to an existing group IN THIS COMPANY
    const existingGroup = await Group.findOne({ name: name.trim(), companyId, _id: { $ne: id } });
    if (existingGroup) {
      return res.status(400).json({ success: false, message: 'Group name already exists in your company.' });
    }

    const updateData = {
      name: name.trim(),
      description: description ? description.trim() : ''
    };

    // Strict update: Must match both ID and Company ID
    const group = await Group.findOneAndUpdate(
      { _id: id, companyId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found or access denied.' });
    }

    res.json({
      success: true,
      message: 'Group updated successfully',
      group
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteGroup = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const companyId = req.user.companyId;

    // Verify group belongs to this company
    const group = await Group.findOne({ _id: id, companyId });
    if (!group) {
      return res.status(404).json({ message: 'Group not found or access denied.' });
    }

    // Check if group is being used by any items IN THIS COMPANY
    const itemsUsingGroup = await Item.countDocuments({
      group: group.name,
      companyId: companyId
    });

    if (itemsUsingGroup > 0) {
      return res.status(400).json({
        message: `Cannot delete group. ${itemsUsingGroup} items in your inventory are using this group.`
      });
    }

    await Group.findByIdAndDelete(id);

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ================================================================
//   INVENTORY MASTER OPTIONS (ItemCategory / SourceType / ItemSourceType /
//   ItemType) "+"-addable dynamic dropdown values, scoped to Inventory only
//   — see InventoryMasterOption.js for why these are kept separate from both
//   the Category/Group system and R&D's RDMasterOption.
// ================================================================

// Item column each field is the live source of truth for. ItemCategory is the
// only multi-select (array) — its rename/delete cascade needs $ positional /
// arrayFilters instead of a plain $set like the other single-value fields.
const INVENTORY_ITEM_FIELD_MAP = {
  SourceType: 'sourceType',
  ItemSourceType: 'itemSourceType',
  ItemType: 'itemType',
  ItemProcessType: 'itemProcessType',
};

export const getInventoryDropdownOptions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const options = await InventoryMasterOption.find({ companyId }).lean();
    const toOption = (o) => ({ _id: o._id, value: o.value });
    const grouped = {
      ItemCategory: options.filter(o => o.field === 'ItemCategory').map(toOption),
      SourceType: options.filter(o => o.field === 'SourceType').map(toOption),
      ItemSourceType: options.filter(o => o.field === 'ItemSourceType').map(toOption),
      ItemType: options.filter(o => o.field === 'ItemType').map(toOption),
      ItemProcessType: options.filter(o => o.field === 'ItemProcessType').map(toOption),
    };
    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addInventoryDropdownOption = async (req, res) => {
  try {
    const { field, value } = req.body;
    if (!['ItemCategory', 'SourceType', 'ItemSourceType', 'ItemType', 'ItemProcessType'].includes(field)) {
      return res.status(400).json({ success: false, message: 'Invalid field type.' });
    }
    if (!value || !value.trim()) {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }
    const option = await InventoryMasterOption.create({ field, value: value.trim(), companyId: req.user.companyId });
    res.status(201).json({ success: true, data: option });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'This option already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateInventoryDropdownOption = async (req, res) => {
  try {
    const { value } = req.body;
    if (!value || !value.trim()) {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }
    const newValue = value.trim();
    const companyId = req.user.companyId;

    const option = await InventoryMasterOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Option not found' });

    const oldValue = option.value;
    if (oldValue === newValue) return res.json({ success: true, data: option });

    const duplicate = await InventoryMasterOption.findOne({ _id: { $ne: option._id }, companyId, field: option.field, value: newValue });
    if (duplicate) return res.status(400).json({ success: false, message: 'This option already exists.' });

    option.value = newValue;
    await option.save();

    if (option.field === 'ItemCategory') {
      await Item.updateMany(
        { companyId, itemCategories: oldValue },
        { $set: { 'itemCategories.$[elem]': newValue } },
        { arrayFilters: [{ elem: oldValue }] }
      );
    } else {
      const itemField = INVENTORY_ITEM_FIELD_MAP[option.field];
      if (itemField) await Item.updateMany({ companyId, [itemField]: oldValue }, { $set: { [itemField]: newValue } });
    }

    res.json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteInventoryDropdownOption = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const option = await InventoryMasterOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Option not found' });

    let productCount;
    if (option.field === 'ItemCategory') {
      productCount = await Item.countDocuments({ companyId, itemCategories: option.value });
    } else {
      const itemField = INVENTORY_ITEM_FIELD_MAP[option.field];
      productCount = itemField ? await Item.countDocuments({ companyId, [itemField]: option.value }) : 0;
    }

    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${option.value}" — still used by ${productCount} item${productCount > 1 ? 's' : ''}. Reassign or remove those first.`,
        productCount,
      });
    }

    await option.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
//   NEW: PRODUCTION - STORE MATERIAL HANDSHAKE CONTROLLERS
// ================================================================



export const getMaterialIssueLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    // Step 1: Optimized Base match using the new field + compound index
    const matchStage = { company: new mongoose.Types.ObjectId(companyId) };
    if (search) {
      matchStage.orderId = { $regex: search, $options: 'i' }; // 👈 Index-friendly filter right at entry point
    }

    const pipeline = [
      { $match: matchStage }, // Filters out unneeded documents immediately
      { $sort: { createdAt: -1 } },

      // Step 2: Lookup user details to get the name of who issued it
      {
        $lookup: {
          from: 'users',
          localField: 'issuedTo',
          foreignField: '_id',
          as: 'issuerData'
        }
      },
      {
        $unwind: { path: '$issuerData', preserveNullAndEmptyArrays: true }
      },

      // Step 3: Group by production order id
      {
        $group: {
          _id: '$productionOrderId',
          orderId: { $first: '$orderId' }, // Keep tracking the clean string ID
          machineCode: { $first: '$machineCode' },
          lastIssueDate: { $max: '$createdAt' },
          logs: {
            $push: {
              _id: '$_id',
              materialCode: '$materialCode',
              materialName: '$materialName',
              sourceItemCode: '$sourceItemCode',
              fabricationCategory: '$fabricationCategory',
              bomDimensions: '$bomDimensions',
              quantityIssued: '$quantityIssued',
              unit: '$unit',
              issuedTo: '$issuedTo',
              issuedToName: { $ifNull: ['$issuerData.fullName', '$issuerData.username'] },
              createdAt: '$createdAt'
            }
          }
        }
      },

      // Step 4: Lookup the Production Order details to show at the wrapper level
      {
        $lookup: {
          from: 'productionorders',
          localField: '_id',
          foreignField: '_id',
          as: 'order'
        }
      },
      {
        $unwind: { path: '$order', preserveNullAndEmptyArrays: true }
      },

      { $sort: { lastIssueDate: -1 } },

      // Step 5: Pagination
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const results = await MaterialIssueLog.aggregate(pipeline);

    const data = results[0].data;
    const total = results[0].metadata[0] ? results[0].metadata[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data,
      pagination: {
        total,
        page,
        totalPages,
        limit
      }
    });

  } catch (error) {
    console.error('Error fetching material issue logs:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── 1. GET PENDING REQUESTS (Store Dashboard) ──────────────────────────
export const getPendingRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // Find all active orders that have materials with 'Requested' status
    const pendingOrders = await ProductionOrder.find({
      company: companyId,
      "materialDemands.status": "Requested"
    }).select('orderId machineCode machineName materialDemands createdAt').sort({ createdAt: -1 });

    // Filter to only return the demands that are actually requested
    const filteredOrders = pendingOrders.map(order => ({
      _id: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      machineName: order.machineName,
      createdAt: order.createdAt,
      pendingMaterials: order.materialDemands.filter(m => m.status === 'Requested')
    })).filter(o => o.pendingMaterials.length > 0);

    res.json({ success: true, data: filteredOrders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── 2. TRANSFER MATERIAL TO PRODUCTION ───────────────────────────────
export const transferMaterialToProduction = async (req, res) => {
  try {
    const { materialCode, quantityToTransfer, issuedTo } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;
    const transferQty = Number(quantityToTransfer);

    if (!materialCode || !transferQty || transferQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and quantity are required.' });
    }

    // Resolve the demand FIRST — a fabrication demand's materialCode is a
    // synthetic per-cut tracking key (see MaterialDemandSchema's comment),
    // not a real Inventory code, so it must never be used directly against
    // Item. The real code lives in demand.sourceItemCode. Fabrication
    // demands are handled by their own dedicated endpoint
    // (transferFabricationMaterialToProduction) instead, since fulfilling
    // them needs Store to pick which stock cut to use, not just a flat
    // quantity against Item.qty (fabrication stock lives in
    // dimensionVariants, not qty).
    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const demand = order.materialDemands.find(m => m.materialCode === materialCode);
    if (!demand) {
      return res.status(404).json({ success: false, message: 'Material not requested on this order.' });
    }
    if (demand.fabricationCategory) {
      return res.status(400).json({ success: false, message: 'This is a fabrication material — use the dimension-based transfer instead.' });
    }
    const sourceCode = demand.sourceItemCode || materialCode;

    // 1. ATOMIC DEDUCTION (The Store Gatekeeper)
    // Only deduct if we have enough stock. This prevents race conditions.
    // demand.quantity is always already the total amount in the item's own
    // stocking unit (even for a Length/Area/Volume material entered as
    // "Amount x Pieces" in the BOM — see UnitAmountField.jsx — that split is
    // resolved into one total quantity before it ever reaches here; the
    // per-piece breakdown is display-only, R&D/Store/Production never
    // transact in pieces for a non-fabrication material's continuous stock).
    const item = await Item.findOneAndUpdate(
      { code: sourceCode, companyId: companyId, qty: { $gte: transferQty } },
      { $inc: { qty: -transferQty } },
      { new: true }
    );

    if (!item) {
      return res.status(400).json({ success: false, message: 'Insufficient stock in Store for this transfer.' });
    }

    // 2. UPDATE ORDER
    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);

    // Update quantities
    order.materialDemands[demandIndex].transferredQuantity = (order.materialDemands[demandIndex].transferredQuantity || 0) + transferQty;
    order.materialDemands[demandIndex].status = 'In Transit'; // Moves to Production's "Receive" list
    if (issuedTo) order.materialDemands[demandIndex].issuedToName = issuedTo;

    await order.save();

    // 3. LOG TRANSFER
    await StoreTransferLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: materialCode,
      sourceItemCode: sourceCode,
      materialName: order.materialDemands[demandIndex].materialName,
      quantityTransferred: transferQty,
      unit: order.materialDemands[demandIndex].unit,
      transferredBy: req.user._id,
      company: companyId
    });

    res.json({ success: true, message: `Successfully transferred ${transferQty} to Production.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── 2a. TRANSFER FLAT-PIECES FABRICATION DEMAND TO PRODUCTION ────────
// Covers two demand shapes, both needing no per-cut cutting decision from
// Store: (1) Sheet Metal plan-driven demands (demand.sheetMetalPlanId set —
// R&D's SheetMetalPlan already decided how many whole catalog sheets are
// needed), and (2) length-fabrication group demands (Production Order
// Management's "Issue Material" — see bomMaterialGroupsService.js's
// lengthFabricationGroupsFromBOM — already combined every Child Part's cut
// length sharing one catalog dimension into a single whole-pieces count).
// Both share the same tell: demand.fabricationCategory set, but
// demand.bomDimensions is empty — there is no specific per-cut size left to
// track, only "N whole pieces of this exact catalog dimensionVariantId".
// This is a flat transfer of N whole pieces, same atomic-condition shape as
// transferMaterialToProduction above, just targeting one dimensionVariants[]
// subdocument's subStock instead of flat Item.qty (fabrication stock never
// lives in Item.qty — see Inventory.js). What Production actually returns
// after cutting is measured and reconciled separately (see
// returnMaterialToStore/confirmReturn).
// POST /api/inventory/transfer-sheet-metal/:id
export const transferSheetMetalPlanToProduction = async (req, res) => {
  try {
    const { materialCode, quantityToTransfer } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;
    const transferQty = Number(quantityToTransfer);

    if (!materialCode || !transferQty || transferQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and quantity are required.' });
    }

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const demand = order.materialDemands.find(m => m.materialCode === materialCode);
    if (!demand) return res.status(404).json({ success: false, message: 'Material not requested on this order.' });
    const hasSpecificCut = demand.bomDimensions && Object.keys(demand.bomDimensions).length > 0;
    if (!demand.fabricationCategory || !demand.dimensionVariantId || hasSpecificCut) {
      return res.status(400).json({ success: false, message: 'This demand has a specific cut size — use the dimension-based transfer instead.' });
    }
    const sourceCode = demand.sourceItemCode || materialCode;
    const { issuedTo } = req.body;

    // Atomic deduction against the specific catalog dimensionVariant's own
    // subStock — same "only deduct if enough stock" gatekeeper pattern as
    // the flat transfer above, just scoped into the array subdocument.
    const item = await Item.findOneAndUpdate(
      {
        code: sourceCode, companyId,
        'dimensionVariants._id': demand.dimensionVariantId,
        'dimensionVariants.subStock': { $gte: transferQty },
      },
      { $inc: { 'dimensionVariants.$.subStock': -transferQty } },
      { new: true }
    );
    if (!item) {
      return res.status(400).json({ success: false, message: 'Insufficient sheet stock in Store for this transfer.' });
    }

    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);
    order.materialDemands[demandIndex].transferredQuantity = (order.materialDemands[demandIndex].transferredQuantity || 0) + transferQty;
    order.materialDemands[demandIndex].status = 'In Transit';
    if (issuedTo) order.materialDemands[demandIndex].issuedToName = issuedTo;
    await order.save();

    await StoreTransferLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode,
      sourceItemCode: sourceCode,
      materialName: order.materialDemands[demandIndex].materialName,
      quantityTransferred: transferQty,
      unit: order.materialDemands[demandIndex].unit,
      transferredBy: req.user._id,
      company: companyId,
    });

    res.json({ success: true, message: `Successfully transferred ${transferQty} sheet(s) to Production.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── 2b. TRANSFER FABRICATION MATERIAL TO PRODUCTION ──────────────────
// Fabrication demands (demand.fabricationCategory set) can't use the flat
// quantity-only transfer above — the real stock is a set of distinct cut
// sizes (Item.dimensionVariants[]), so Store has to pick which one to cut
// from. If the picked variant isn't already the exact size the BOM needs,
// Store may optionally record what's left as a new variant (manual entry —
// a rectangle cut from a rectangle isn't generally another clean rectangle,
// so only the person physically cutting it knows the remaining shape).
// Leaving the leftover fields blank means the offcut is scrap.
//
// stockPiecesConsumed (how many physical stock pieces Store is cutting from)
// is deliberately separate from quantityFulfilled (how many of the demand's
// needed pieces this transfer covers) — the previous version of this
// endpoint conflated the two (deducted/left-overed by the demand's own
// quantity, as if 1 stock piece always == 1 demanded piece), so a single
// long stock bar that actually covered 2 short demanded cuts still deducted
// 2 whole stock pieces and recorded a leftover of quantity 2 instead of 1.
// POST /api/inventory/transfer-fabrication-material/:id
export const transferFabricationMaterialToProduction = async (req, res) => {
  try {
    const { materialCode, sourceVariantId, stockPiecesConsumed, quantityFulfilled, leftover, issuedTo } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;
    const piecesConsumed = Number(stockPiecesConsumed);
    const qtyFulfilled = Number(quantityFulfilled);

    if (!materialCode || !sourceVariantId || !(piecesConsumed > 0) || !(qtyFulfilled > 0)) {
      return res.status(400).json({ success: false, message: 'Material, source variant, stock pieces consumed, and quantity fulfilled are all required.' });
    }

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);
    if (demandIndex === -1) {
      return res.status(404).json({ success: false, message: 'Material not requested on this order.' });
    }
    const demand = order.materialDemands[demandIndex];
    if (!demand.fabricationCategory) {
      return res.status(400).json({ success: false, message: 'This material is not a fabrication item — use the standard transfer instead.' });
    }

    const remaining = (demand.quantity || 0) - (demand.transferredQuantity || 0);
    if (qtyFulfilled > remaining) {
      return res.status(400).json({ success: false, message: `Cannot fulfil ${qtyFulfilled} piece(s) — only ${remaining} still needed on this demand.` });
    }

    const sourceItem = await Item.findOne({ code: demand.sourceItemCode, companyId });
    if (!sourceItem) {
      return res.status(400).json({ success: false, message: `Source item "${demand.sourceItemCode}" not found in Inventory.` });
    }

    const sourceVariant = sourceItem.dimensionVariants.id(sourceVariantId);
    if (!sourceVariant) {
      return res.status(404).json({ success: false, message: 'Chosen stock size not found on this item.' });
    }
    if ((sourceVariant.subStock || 0) < piecesConsumed) {
      return res.status(400).json({ success: false, message: `Insufficient stock in the chosen size — only ${sourceVariant.subStock || 0} available.` });
    }

    const category = getCategoryByKey(demand.fabricationCategory);
    if (!category) {
      return res.status(400).json({ success: false, message: 'Unknown fabrication category for this material.' });
    }
    const isSheet = category.calcType === 'sheet';

    // Size-sufficiency check — the other real bug: today's system never
    // confirmed the chosen stock piece(s) were even physically big enough
    // for the cut. demand.amountValue/amountUnit is the per-piece amount
    // needed (set by the BOM/demand amount+quantity model — see
    // ProductionOrder.js's MaterialDemandSchema); missing on demands
    // created before that redesign, in which case this falls back to no
    // sufficiency check (matches the old behavior) so already-in-flight
    // orders don't suddenly start rejecting valid transfers.
    if (demand.amountValue != null && demand.amountUnit) {
      const neededPerPiece = isSheet ? toMm2(demand.amountValue, demand.amountUnit) : toMm(demand.amountValue, demand.amountUnit);
      const variantCapacity = isSheet
        ? (Number(sourceVariant.values?.width) || 0) * (Number(sourceVariant.values?.length) || 0)
        : (Number(sourceVariant.values?.length) || 0);
      if (neededPerPiece != null && variantCapacity > 0) {
        const totalNeeded = neededPerPiece * qtyFulfilled;
        const totalCapacity = variantCapacity * piecesConsumed;
        if (totalCapacity < totalNeeded) {
          const unitLabel = isSheet ? 'mm²' : 'mm';
          return res.status(400).json({
            success: false,
            message: `Not enough material — ${piecesConsumed} stock piece(s) of this size only cover ${Math.round(totalCapacity)}${unitLabel}, but ${qtyFulfilled} piece(s) at ${demand.amountValue} ${demand.amountUnit} each need ${Math.round(totalNeeded)}${unitLabel}.`
          });
        }
      }
    }

    // Snapshot before mutating — used for the audit log and the leftover calc.
    const sourceValuesSnapshot = { ...(sourceVariant.values || {}) };

    // Deduct the STOCK PIECES actually consumed — not the demand quantity
    // fulfilled (the core bug fix: these are no longer assumed equal).
    sourceVariant.subStock -= piecesConsumed;

    // Leftover is now an explicit batch: pieceCount identical leftover
    // pieces of amountValue+amountUnit size — Store's own count, not
    // re-derived from piecesConsumed/qtyFulfilled (the bug's other half:
    // consuming 1 stock piece could still leave more than 1 leftover piece,
    // or none at all, depending on how it was actually cut).
    let leftoverValuesRecorded = null;
    if (leftover && Number(leftover.pieceCount) > 0 && Number(leftover.amountValue) > 0 && leftover.amountUnit) {
      // Only the fields a straight cut can actually change (length, and
      // width for flat sheets) ever come from Store's entry — everything
      // else (thickness, wall thickness, OD, leg length...) is taken
      // straight from the source variant's own values, never trusted from
      // the request, so a leftover can never end up with a different
      // cross-section than what it was actually cut from.
      const leftoverValues = { ...sourceValuesSnapshot };
      if (isSheet) {
        // Sheet leftovers: Store enters a single area, but the stored shape
        // still needs width+length individually — width stays the source's
        // own fixed width, length is derived so width*length reproduces the
        // entered area exactly (calculateFabricationWeight's sheet formula
        // is width*length either way, so this is a pure re-encoding, not a
        // different number).
        const areaMm2 = toMm2(leftover.amountValue, leftover.amountUnit);
        const width = Number(sourceValuesSnapshot.width) || 0;
        if (areaMm2 != null && width > 0) leftoverValues.length = Math.round((areaMm2 / width) * 1000) / 1000;
      } else {
        const lengthMm = toMm(leftover.amountValue, leftover.amountUnit);
        if (lengthMm != null) leftoverValues.length = lengthMm;
      }

      const existingLeftover = sourceItem.dimensionVariants.find(
        dv => dv.isLeftover && dimensionSignature(dv.values) === dimensionSignature(leftoverValues)
      );
      if (existingLeftover) {
        existingLeftover.subStock = (existingLeftover.subStock || 0) + Number(leftover.pieceCount);
      } else {
        const { weightPerMeterKg, weightPerPieceKg } = calculateFabricationWeight(
          demand.fabricationCategory, leftoverValues, sourceVariant.densityValue, sourceVariant.densityUnit
        );
        sourceItem.dimensionVariants.push({
          category: demand.fabricationCategory,
          values: leftoverValues,
          designation: sourceVariant.designation || '',
          densityValue: sourceVariant.densityValue,
          densityUnit: sourceVariant.densityUnit,
          weightPerMeterKg,
          weightPerPieceKg,
          subStock: Number(leftover.pieceCount),
          isLeftover: true,
        });
      }
      leftoverValuesRecorded = leftoverValues;
    }

    await sourceItem.save();

    // Update the demand — transferredQuantity tracks demanded PIECES
    // (qtyFulfilled), the same unit as quantity/issuedQuantity everywhere
    // else in this app; stockPiecesConsumed only ever affects Item stock.
    demand.transferredQuantity = (demand.transferredQuantity || 0) + qtyFulfilled;
    demand.status = 'In Transit';
    if (issuedTo) demand.issuedToName = issuedTo;
    await order.save();

    await StoreTransferLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: demand.materialCode,
      sourceItemCode: demand.sourceItemCode,
      materialName: demand.materialName,
      quantityTransferred: qtyFulfilled,
      unit: demand.unit,
      fromDimensions: sourceValuesSnapshot,
      toDimensions: demand.bomDimensions,
      leftoverDimensions: leftoverValuesRecorded,
      transferredBy: req.user._id,
      company: companyId
    });

    res.json({ success: true, message: `Successfully transferred ${qtyFulfilled} piece(s) to Production (${piecesConsumed} stock piece(s) consumed).` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/bulk-transfer/:id
export const bulkTransferOrderMaterials = async (req, res) => {
  try {
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Production order not found.' });
    }

    const shortfalls = [];
    let orderUpdated = false;
    let skippedFabricationCount = 0;

    for (let demand of order.materialDemands) {
      if (demand.status !== 'Requested') continue;

      const neededQty = demand.quantity - (demand.transferredQuantity || 0);
      if (neededQty <= 0) continue;

      // Fabrication materials need Store to pick which stock cut to use (and
      // optionally record a leftover) — not something a fully-automatic bulk
      // transfer can decide. Skip entirely: not auto-transferred, and not
      // staged as a shortfall either (it isn't necessarily out of stock, it
      // just needs a human) — Store handles these individually via
      // transferFabricationMaterialToProduction instead.
      if (demand.fabricationCategory) {
        skippedFabricationCount++;
        continue;
      }

      const sourceCode = demand.sourceItemCode || demand.materialCode;
      const storeItem = await Item.findOne({ code: sourceCode, companyId: companyId });
      const availableStock = storeItem ? Math.max(0, storeItem.qty) : 0;

      // PATH 1: Stock is completely empty (This is what hit your "metal sheet" item)
      if (availableStock === 0) {
        shortfalls.push({
          companyId,
          productName: demand.materialName,
          quantity: neededQty,
          materialCode: demand.materialCode,
          itemId: storeItem ? storeItem._id : null,
          unit: demand.unit,
          productionOrderId: order.orderId,
          storeOrderId: order._id,
          stagedBy: req.user.username, // ✨ FIX 1: Added here
          priority: order.priority === 'Urgent' ? 'High' : 'Medium',
          source: 'Store'
        });
        continue;
      }

      const transferQty = Math.min(neededQty, availableStock);

      const deductedItem = await Item.findOneAndUpdate(
        { code: sourceCode, companyId: companyId, qty: { $gte: transferQty } },
        { $inc: { qty: -transferQty } },
        { new: true }
      );

      // PATH 2: Database concurrency race condition fallback
      if (!deductedItem) {
        shortfalls.push({
          companyId,
          productName: demand.materialName,
          quantity: neededQty,
          materialCode: demand.materialCode,
          itemId: storeItem ? storeItem._id : null,
          unit: demand.unit,
          productionOrderId: order.orderId,
          storeOrderId: order._id,
          stagedBy: req.user.username, // ✨ FIX 2: Added here
          priority: order.priority === 'Urgent' ? 'High' : 'Medium',
          source: 'Store'
        });
        continue;
      }

      demand.transferredQuantity = (demand.transferredQuantity || 0) + transferQty;
      demand.status = 'In Transit';
      orderUpdated = true;

      await StoreTransferLog.create({
        productionOrderId: order._id,
        orderId: order.orderId,
        machineCode: order.machineCode,
        materialCode: demand.materialCode,
        sourceItemCode: sourceCode,
        materialName: demand.materialName,
        quantityTransferred: transferQty,
        unit: demand.unit,
        transferredBy: req.user._id,
        company: companyId
      });

      // PATH 3: Partial stock available, remainder needs to be purchased
      if (transferQty < neededQty) {
        shortfalls.push({
          companyId,
          productName: demand.materialName,
          quantity: neededQty - transferQty,
          materialCode: demand.materialCode,
          itemId: deductedItem._id,
          unit: demand.unit,
          productionOrderId: order.orderId,
          storeOrderId: order._id,
          stagedBy: req.user.username, // ✅ Already matched your schema string format here!
          priority: order.priority === 'Urgent' ? 'High' : 'Medium',
          source: 'Store'
        });
      }
    }

    if (orderUpdated) {
      await order.save();
    }

    // Clear old staging snapshots for this order
    await StagedPurchase.deleteMany({ companyId, storeOrderId: order._id });

    // Write fresh shortfalls
    if (shortfalls.length > 0) {
      await StagedPurchase.insertMany(shortfalls);
    }

    res.json({
      success: true,
      message: 'Bulk transfer operation executed completely and queue updated.',
      shortfallsCount: shortfalls.length,
      skippedFabricationCount
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};





export const getStoreTransferLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    // Step 1: Optimized Base match using compound index fields
    const matchStage = { company: new mongoose.Types.ObjectId(companyId) };
    if (search) {
      matchStage.orderId = { $regex: search, $options: 'i' }; // 👈 Filters out non-matching logs immediately
    }

    const pipeline = [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },

      // Step 2: Lookup user details to get the name of who transferred it
      {
        $lookup: {
          from: 'users',
          localField: 'transferredBy',
          foreignField: '_id',
          as: 'transferrerData'
        }
      },
      {
        $unwind: { path: '$transferrerData', preserveNullAndEmptyArrays: true }
      },

      // Step 3: Group logs into a Production Order wrapper structure
      {
        $group: {
          _id: '$productionOrderId',
          orderId: { $first: '$orderId' }, // Custom human-friendly ID
          machineCode: { $first: '$machineCode' },
          lastTransferDate: { $max: '$createdAt' }, // Track most recent transfer activity
          logs: {
            $push: {
              _id: '$_id',
              materialCode: '$materialCode',
              sourceItemCode: '$sourceItemCode',
              materialName: '$materialName',
              quantityTransferred: '$quantityTransferred',
              unit: '$unit',
              fromDimensions: '$fromDimensions',
              toDimensions: '$toDimensions',
              leftoverDimensions: '$leftoverDimensions',
              transferredBy: '$transferredBy',
              transferredByName: { $ifNull: ['$transferrerData.fullName', '$transferrerData.username'] },
              createdAt: '$createdAt'
            }
          }
        }
      },

      // Step 4: Lookup Production Order collection metadata for safety fallback
      {
        $lookup: {
          from: 'productionorders',
          localField: '_id',
          foreignField: '_id',
          as: 'order'
        }
      },
      {
        $unwind: { path: '$order', preserveNullAndEmptyArrays: true }
      },

      // Step 5: Sort order groupings chronologically by latest activity
      { $sort: { lastTransferDate: -1 } },

      // Step 6: Paginate results through a safe $facet block
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const results = await StoreTransferLog.aggregate(pipeline);

    const data = results[0].data;
    const total = results[0].metadata[0] ? results[0].metadata[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data,
      pagination: {
        total,
        page,
        totalPages,
        limit
      }
    });
  } catch (err) {
    console.error('Error fetching store transfer logs:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── 3. GET RETURNED MATERIAL LOGS ────────────────────────────────────


// ── Refactored: GET RETURNED MATERIAL LOGS (Grouped by Production Order Wrapper) ──
export const getReturnedMaterials = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    // Step 1: Base filtration match stage
    const matchStage = { company: new mongoose.Types.ObjectId(companyId) };
    if (search) {
      matchStage.orderId = { $regex: search, $options: 'i' };
    }

    const pipeline = [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },

      // Step 2: Resolve the profile of the worker who initiated the return
      {
        $lookup: {
          from: 'users',
          localField: 'returnedBy',
          foreignField: '_id',
          as: 'runnerData'
        }
      },
      {
        $unwind: { path: '$runnerData', preserveNullAndEmptyArrays: true }
      },

      // Step 3: Group the flat return log assets under a production wrapper line
      {
        $group: {
          _id: '$productionOrderId',
          orderId: { $first: '$orderId' },
          machineCode: { $first: '$machineCode' },
          lastReturnDate: { $max: '$createdAt' }, // Anchors sorting based on newest activity
          logs: {
            $push: {
              _id: '$_id',
              materialCode: '$materialCode',
              sourceItemCode: '$sourceItemCode',
              fabricationCategory: '$fabricationCategory',
              bomDimensions: '$bomDimensions',
              materialName: '$materialName',
              quantityReturned: '$quantityReturned',
              unit: '$unit',
              returnType: '$returnType',
              status: '$status',
              reason: '$reason',
              returnedBy: '$returnedBy',
              returnedByName: { $ifNull: ['$runnerData.fullName', '$runnerData.username'] },
              createdAt: '$createdAt'
            }
          }
        }
      },

      // Step 4: Safely cross-reference the core order registry to retrieve the machineName
      {
        $lookup: {
          from: 'productionorders',
          localField: '_id',
          foreignField: '_id',
          as: 'productionOrder'
        }
      },
      {
        $unwind: { path: '$productionOrder', preserveNullAndEmptyArrays: true }
      },

      // Inject the machineName field directly onto our wrapper level object
      {
        $addFields: {
          machineName: { $ifNull: ['$productionOrder.machineName', 'Unknown Machine'] }
        }
      },

      // Step 5: Order the wrapper entities by their most recent log entry timestamp
      { $sort: { lastReturnDate: -1 } },

      // Step 6: Paginate aggregate groups using safe facet windows
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const results = await MaterialReturnLog.aggregate(pipeline);

    const data = results[0].data;
    const total = results[0].metadata[0] ? results[0].metadata[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data,
      pagination: {
        total,
        page,
        totalPages,
        limit
      }
    });
  } catch (err) {
    console.error('Error fetching returned material ledger groups:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Refactored: GET PENDING RETURNS (Grouped by Production Order Wrapper) ──
export const getPendingReturns = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // 1. Fetch all flat pending logs for this company
    const logs = await MaterialReturnLog.find({
      company: companyId,
      status: 'Pending'
    })
      .populate('productionOrderId', 'orderId machineCode machineName')
      .sort({ createdAt: -1 });

    // 2. Reduce the flat records into an order-mapped object structure
    const groupedOrdersMap = {};

    logs.forEach((log) => {
      // Guard clause in case a production order reference is broken or missing
      if (!log.productionOrderId) return;

      const pOrderId = log.productionOrderId._id.toString();

      // If this parent production order isn't in our map yet, initialize its wrapper card
      if (!groupedOrdersMap[pOrderId]) {
        groupedOrdersMap[pOrderId] = {
          _id: log.productionOrderId._id,
          orderId: log.productionOrderId.orderId,
          machineCode: log.productionOrderId.machineCode,
          machineName: log.productionOrderId.machineName,
          createdAt: log.createdAt, // Optional: tracking timing context
          pendingMaterials: []      // Array holding the nested line-items
        };
      }

      // Push the individual specific return log details into the nested materials layer
      groupedOrdersMap[pOrderId].pendingMaterials.push({
        logId: log._id, // Required to pass into req.body when clicking "Accept" or "Reject"
        materialCode: log.materialCode,
        sourceItemCode: log.sourceItemCode,
        fabricationCategory: log.fabricationCategory,
        bomDimensions: log.bomDimensions,
        materialName: log.materialName,
        quantityReturned: log.quantityReturned,
        unit: log.unit,
        returnType: log.returnType || 'Excess', // 👈 Shows "Excess" vs "Defect" on the UI row
        reason: log.reason || 'No reason provided'
      });
    });

    // 3. Convert the mapped object values back into a standard array for frontend mapping
    const structuredResult = Object.values(groupedOrdersMap);

    res.json({
      success: true,
      data: structuredResult
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── 5. CONFIRM RETURN (Accept or Reject) ─────────────────────────────
export const confirmReturn = async (req, res) => {
  try {
    const { logId, action } = req.body;
    const companyId = req.user.companyId;

    const log = await MaterialReturnLog.findById(logId);
    if (!log || log.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Invalid or already processed return.' });
    }

    const order = await ProductionOrder.findById(log.productionOrderId);
    const demand = order.materialDemands.find(m => m.materialCode === log.materialCode);

    if (!demand) {
      return res.status(404).json({ success: false, message: 'Material demand entry missing from referenced order.' });
    }

    if (action === 'Accept') {

      // log.materialCode is a fabrication demand's synthetic per-cut key for
      // Defective grouping (fine — it's just a bucket label there), but the
      // real Inventory Item must be resolved via sourceItemCode, not
      // materialCode directly — see MaterialDemandSchema's comment.
      const sourceCode = log.sourceItemCode || log.materialCode;
      if (log.returnType === 'Defect') {

        // 🎯 AUTOMATIC INITIALIZATION OR UPDATE (UPSERT)
        // This checks if the item exists. If NOT, it creates it. If YES, it updates it.
        await DefectiveInventory.findOneAndUpdate(
          { materialCode: log.materialCode, companyId: companyId },
          {
            $inc: { quantity: log.quantityReturned }, // Adds to the grouped total
            $setOnInsert: {
              materialName: log.materialName,
              unit: log.unit
            } // Only sets these fields on the very first creation
          },
          { upsert: true, new: true }
        );

      } else if (demand.fabricationCategory) {
        // Fabrication materials don't use Item.qty for stock — the piece
        // being returned is already cut to the exact size Store transferred
        // (demand.bomDimensions), so credit it back into a matching
        // dimensionVariant instead. Flagged isLeftover, same as an
        // uncut-remainder piece — an ad-hoc BOM-driven size isn't a real
        // catalog SKU Purchase should be able to reorder, even though it's
        // perfectly good stock for a future Production transfer.
        //
        // Sheet Metal plan returns (log.leftoverValues set — see
        // returnMaterialToStore) key/credit off THOSE actually-measured
        // dimensions instead — a plan-driven demand has no bomDimensions of
        // its own (Store shipped whole catalog sheets, not a specific cut),
        // so demand.bomDimensions would be an empty, meaningless signature
        // for this case.
        const creditDimensions = log.leftoverValues || demand.bomDimensions;
        const sourceItem = await Item.findOne({ code: sourceCode, companyId });
        if (sourceItem) {
          const existingVariant = sourceItem.dimensionVariants.find(
            dv => dimensionSignature(dv.values) === dimensionSignature(creditDimensions)
          );
          if (existingVariant) {
            existingVariant.subStock = (existingVariant.subStock || 0) + log.quantityReturned;
          } else {
            const fabWeight = await resolveFabricationWeight(sourceItem, creditDimensions);
            sourceItem.dimensionVariants.push({
              category: demand.fabricationCategory,
              values: creditDimensions,
              designation: '',
              densityValue: sourceItem.dimensionVariants?.[0]?.densityValue ?? null,
              densityUnit: sourceItem.dimensionVariants?.[0]?.densityUnit || 'kg/m3',
              weightPerMeterKg: null,
              weightPerPieceKg: fabWeight?.weightPerPieceKg ?? null,
              subStock: log.quantityReturned,
              isLeftover: true,
            });
          }
          await sourceItem.save();
        }
      } else {
        // If it's 'Excess', route back to main warehouse stock
        await Item.findOneAndUpdate(
          { code: sourceCode, companyId: companyId },
          { $inc: { qty: log.quantityReturned } }
        );
      }

      // B. Release the reservation lock
      demand.returnPendingQuantity = Math.max(0, (demand.returnPendingQuantity || 0) - log.quantityReturned);

      // C. Deduct balances from manufacturing counts
      demand.issuedQuantity = Math.max(0, (demand.issuedQuantity || 0) - log.quantityReturned);
      demand.transferredQuantity = Math.max(0, (demand.transferredQuantity || 0) - log.quantityReturned);

      // D. AUTOMATED FEEDBACK LOOP
      if (demand.issuedQuantity >= demand.quantity) {
        demand.status = 'Issued';
      } else {
        demand.status = 'Requested';
        order.materialIssued = false;
      }

      log.status = 'Accepted';
    }
    else if (action === 'Reject') {
      demand.returnPendingQuantity = Math.max(0, (demand.returnPendingQuantity || 0) - log.quantityReturned);
      log.status = 'Rejected';
    }
    else {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    await order.save();
    await log.save();

    res.json({ success: true, message: `Return processed as ${action}ed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── 1. GET ALL ACTIVE DEFECTIVE INVENTORY (Hides 0 quantity items) ──
export const getDefectiveInventory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, page = 1, limit = 10 } = req.query;

    // Only show items that currently have a defective balance > 0
    let query = { companyId, quantity: { $gt: 0 } };

    if (search) {
      query.$or = [
        { materialCode: { $regex: search, $options: 'i' } },
        { materialName: { $regex: search, $options: 'i' } }
      ];
    }

    const skipIdx = (Number(page) - 1) * Number(limit);

    const [items, totalCount] = await Promise.all([
      DefectiveInventory.find(query)
        .sort({ updatedAt: -1 })
        .skip(skipIdx)
        .limit(Number(limit)),
      DefectiveInventory.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        totalRecords: totalCount,
        currentPage: Number(page),
        totalPages: Math.ceil(totalCount / Number(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



// ── 1. SECURE REPAIR CONTROLLER ──
export const repairDefectiveInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityToRepair } = req.body;
    const companyId = req.user.companyId;

    const amtToProcess = Number(quantityToRepair);
    // Basic structural validation
    if (isNaN(amtToProcess) || amtToProcess <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive number.' });
    }

    // 🎯 ATOMIC CHECK & DEDUCTION
    // We only update IF the document matches the ID, the company, AND has enough quantity.
    const defectiveItem = await DefectiveInventory.findOneAndUpdate(
      {
        _id: id,
        companyId,
        quantity: { $gte: amtToProcess } // 🛡️ Database-level guardrail against exceeding stock
      },
      {
        $inc: { quantity: -amtToProcess } // Atomically subtract the quantity
      },
      {
        new: true, // Return the updated document
        runValidators: true
      }
    );

    // If no document matched, it means either it doesn't exist, belongs to another company, or stock is insufficient
    if (!defectiveItem) {
      return res.status(400).json({
        success: false,
        message: 'Action rejected. Item not found or requested quantity exceeds available defective stock.'
      });
    }

    // Step B: Safely move that quantity into the main active inventory pool
    await Item.findOneAndUpdate(
      { code: defectiveItem.materialCode, companyId },
      { $inc: { qty: amtToProcess } },
      { upsert: true }
    );

    res.json({
      success: true,
      message: `Successfully repaired ${amtToProcess} units. New defective balance: ${defectiveItem.quantity}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── 2. SECURE SCRAP CONTROLLER ──
export const scrapDefectiveInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityToScrap } = req.body;
    const companyId = req.user.companyId;

    const amtToScrap = Number(quantityToScrap);
    // Basic structural validation
    if (isNaN(amtToScrap) || amtToScrap <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive number.' });
    }

    // 🎯 ATOMIC CHECK & DEDUCTION
    const defectiveItem = await DefectiveInventory.findOneAndUpdate(
      {
        _id: id,
        companyId,
        quantity: { $gte: amtToScrap } // 🛡️ Database-level guardrail
      },
      {
        $inc: { quantity: -amtToScrap }
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!defectiveItem) {
      return res.status(400).json({
        success: false,
        message: 'Action rejected. Item not found or requested quantity exceeds available defective stock.'
      });
    }

    res.json({
      success: true,
      message: `Successfully scrapped ${amtToScrap} units. New defective balance: ${defectiveItem.quantity}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};