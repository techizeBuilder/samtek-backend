import { Item, Category, CustomerCategory } from '../models/Inventory.js';
import { Company } from '../models/Company.js';
import ProductDailySummary from '../models/ProductDailySummary.js';
import * as XLSX from 'xlsx';
import multer from 'multer';
import mongoose from 'mongoose';
import { USER_ROLES } from '../shared/schema.js';
import notificationService from '../services/notificationService.js';
import { initializeProductSummary, updateProductSummary } from '../services/productionSummaryService.js';

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
  // Super Admin and Unit Head have all permissions
  if (user.role === 'Superadmin' || user.role === 'Unit Head') {
    return true;
  }

  // Allow Sales users to view items for order creation
  if (user.role === 'Sales' && action === 'view') {
    return true;
  }
  // need finalized role for technican to view items for complaint service module
  if(user.role === 'Employee' && action === 'view') {
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
      category,
      subCategory,
      store,
      location,
      lowStock,
      quantity, // Add quantity filter
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

    // Search filter with improved partial matching
    if (search) {
      try {
        // Split search into words for better matching
        const searchWords = search.trim().split(/\s+/).filter(word => word.length > 0);
        console.log('🔍 Search words:', searchWords);

        if (searchWords.length === 1) {
          // Single word search - use simple regex
          const escapedSearch = searchWords[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          query.$or = [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { code: { $regex: escapedSearch, $options: 'i' } },
            { description: { $regex: escapedSearch, $options: 'i' } }
          ];
        } else {
          // Multi-word search - each word should be found somewhere in the name
          const wordRegexes = searchWords.map(word => ({
            name: { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
          }));

          // Also try exact phrase matching
          const exactPhrase = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          query.$or = [
            // All words must be found in name
            { $and: wordRegexes },
            // Or exact phrase in name
            { name: { $regex: exactPhrase, $options: 'i' } },
            // Or exact phrase in code
            { code: { $regex: exactPhrase, $options: 'i' } },
            // Or exact phrase in description
            { description: { $regex: exactPhrase, $options: 'i' } }
          ];
        }

        console.log('🔍 Search query applied:', JSON.stringify(query.$or, null, 2));
      } catch (error) {
        console.error('❌ Search regex error:', error);
        // Fallback to simple text matching if regex fails
        const simpleSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { name: { $regex: simpleSearch, $options: 'i' } },
          { code: { $regex: simpleSearch, $options: 'i' } },
          { description: { $regex: simpleSearch, $options: 'i' } }
        ];
      }
    }

    // Type filter - only allow if not Unit Head (Unit Head is auto-filtered to Products)
    if (type && req.user.role !== 'Unit Head') {
      query.type = type;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Subcategory filter
    if (subCategory) {
      query.subCategory = subCategory;
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

    // Build query with company filtering for Unit Head
    let query = { _id: id };
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      query.store = req.user.companyId;
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
    console.log('👤 User info:', {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role,
      companyId: req.user.companyId,
      hasCompany: !!req.user.company
    });

    // Enhanced validation
    const validation = validateItemData(itemData);
    if (!validation.isValid) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: validation.errors
      });
    }

    // Check for duplicate item name (case-insensitive) within company
    if (itemData.name && itemData.name.trim()) {
      const trimmedName = itemData.name.trim();

      // Determine the company ID for duplicate checking
      let companyIdForCheck = req.user.companyId;

      // If store field contains a companyId (ObjectId), use it for checking
      if (itemData.store && itemData.store.match(/^[0-9a-fA-F]{24}$/)) {
        companyIdForCheck = itemData.store;
      }

      // Escape special regex characters and create case-insensitive query
      const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const query = {
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        category: itemData.category, // Include category to allow same names in different categories
        type: itemData.type // Include type to allow same names with different types
      };

      // Add company/store filter for proper isolation
      if (companyIdForCheck) {
        // Check duplicates in both companyId and store fields
        // This handles both old items (stored in store field) and new items (stored in companyId)
        query.$or = [
          { companyId: companyIdForCheck },
          { store: companyIdForCheck }
        ];
      } else if (itemData.store) {
        // If no companyIdForCheck but we have store, still filter by store to prevent cross-store duplicates
        query.store = itemData.store;
        console.log('🚨 No companyId available, falling back to store-only filtering:', itemData.store);
      }

      console.log('📋 Duplicate check details:', {
        itemName: trimmedName,
        category: itemData.category,
        userCompanyId: req.user.companyId,
        storeValue: itemData.store,
        companyIdForCheck,
        finalQuery: query
      });
      const existingItemByName = await Item.findOne(query);
      console.log('Found existing item:', existingItemByName ? `${existingItemByName.name} (${existingItemByName.code})` : 'None');

      if (existingItemByName) {
        console.log(`Duplicate item found: "${trimmedName}" in category "${itemData.category}" (existing: "${existingItemByName.name}", ID: ${existingItemByName._id})`);
        return res.status(400).json({
          success: false,
          message: `Duplicate item detected! Item "${trimmedName}" already exists in category "${itemData.category}" with type "${itemData.type}" (Code: ${existingItemByName.code}). Please use a different name, category, or type.`,
          duplicateItem: {
            name: existingItemByName.name,
            code: existingItemByName.code,
            id: existingItemByName._id
          }
        });
      }
    }

    // Auto-generate code if not provided or if code already exists
    if (!itemData.code || itemData.code.trim() === '') {
      itemData.code = await generateItemCode(itemData.type);
    } else {
      // Check if code already exists within same company
      const codeQuery = {
        code: itemData.code.trim()
      };

      if (req.user.companyId) {
        codeQuery.companyId = req.user.companyId;
      }

      console.log('Code duplicate check query:', codeQuery);
      const existingItem = await Item.findOne(codeQuery);

      if (existingItem) {
        console.log('Code already exists, auto-generating new code...');
        itemData.code = await generateItemCode(itemData.type);
        console.log('New auto-generated code:', itemData.code);
      }
    }

    // Sanitize and prepare data
    const sanitizedData = sanitizeItemData(itemData);

    // Ensure company assignment - crucial for proper isolation
    if (req.user.companyId) {
      sanitizedData.companyId = req.user.companyId;
    }

    // If store field contains a companyId, use it for companyId
    if (sanitizedData.store && sanitizedData.store.match(/^[0-9a-fA-F]{24}$/)) {
      sanitizedData.companyId = sanitizedData.store;
    }

    console.log('Final data before creation:', {
      name: sanitizedData.name,
      code: sanitizedData.code,
      companyId: sanitizedData.companyId,
      userCompanyId: req.user.companyId
    });

    const item = await Item.create(sanitizedData);
    console.log('Item saved successfully:', item);

    // Initialize production summary for new product
    try {
      // Get company ID from user (for Unit Head) or from item's store field (for Super Admin)
      const companyId = req.user.companyId ? req.user.companyId.toString() : (sanitizedData.store || item.store);

      if (companyId) {
        await initializeProductSummary(
          item._id.toString(),
          item.name,
          companyId
        );
        console.log('Production summary initialized for new product:', item.name, 'Company:', companyId);

        // Sync qtyPerBatch if batch field is provided
        if (item.batch && !isNaN(parseFloat(item.batch))) {
          const today = new Date().toISOString().split('T')[0];
          await updateProductSummaryQtyPerBatch(
            item._id.toString(),
            item.name,
            parseFloat(item.batch),
            today,
            companyId
          );
          console.log('QtyPerBatch synced for new product:', item.name, 'Value:', item.batch, 'Company:', companyId);
        }
      } else {
        console.log('No company ID available for production summary initialization');
      }
    } catch (summaryError) {
      console.error('Failed to initialize production summary:', summaryError);
      // Don't fail the item creation if summary initialization fails
    }

    // Trigger notification for new inventory item
    try {
      await notificationService.triggerInventoryNotification(item, 'created');

      // Check for low stock alert
      if (item.qty <= (item.minStock || 10)) {
        await notificationService.triggerLowStockNotification(item);
      }
    } catch (notificationError) {
      console.error('Failed to send inventory notification:', notificationError);
    }

    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      item
    });
  } catch (error) {
    console.error('Create item error:', error);
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

// Enhanced validation helper function
const validateItemData = (data, isUpdate = false) => {
  const errors = {};

  // Required fields validation
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
    errors.name = 'Item name must be at least 2 characters';
  }

  if (!data.category || typeof data.category !== 'string' || data.category.trim().length === 0) {
    errors.category = 'Category is required';
  }

  // Customer category is optional with default value
  if (data.customerCategory && typeof data.customerCategory !== 'string') {
    errors.customerCategory = 'Customer Category must be a valid string';
  }

  if (data.quality && typeof data.quality !== 'string') {
    errors.quality = 'Quality must be a valid string';
  }

  if (!data.unit || typeof data.unit !== 'string' || data.unit.trim().length === 0) {
    errors.unit = 'Unit is required';
  }

  if (!data.type || typeof data.type !== 'string' || data.type.trim().length === 0) {
    errors.type = 'Item type is required';
  }

  if (!data.importance || typeof data.importance !== 'string' || data.importance.trim().length === 0) {
    errors.importance = 'Importance level is required';
  }
  if (!data.unit) {
    errors.unit = 'Unit is required';
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
  if (data.leadTime !== undefined && (isNaN(data.leadTime) || data.leadTime < 0)) {
    errors.leadTime = 'Lead time must be a non-negative number';
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

// Enhanced data sanitization helper
const sanitizeItemData = (data) => {
  const sanitized = { ...data };

  // Trim string fields and ensure they exist
  if (sanitized.name) sanitized.name = sanitized.name.trim();
  if (sanitized.code) sanitized.code = sanitized.code.trim();
  if (sanitized.category) sanitized.category = sanitized.category.trim();
  if (sanitized.subCategory) sanitized.subCategory = sanitized.subCategory.trim();
  if (sanitized.customerCategory) sanitized.customerCategory = sanitized.customerCategory.trim();
  if (sanitized.type) sanitized.type = sanitized.type.trim();
  if (sanitized.importance) sanitized.importance = sanitized.importance.trim();
  if (sanitized.batch) sanitized.batch = sanitized.batch.trim();
  if (sanitized.quality) sanitized.quality = sanitized.quality.trim();
  if (sanitized.unit) sanitized.unit = sanitized.unit.trim();
  if (sanitized.store) sanitized.store = sanitized.store.trim();
  if (sanitized.hsn) sanitized.hsn = sanitized.hsn.trim();
  if (sanitized.description) sanitized.description = sanitized.description.trim();
  if (sanitized.internalNotes) sanitized.internalNotes = sanitized.internalNotes.trim();

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

  return sanitized;
};

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
    //'🔧 UPDATE ITEM - Item data:';
    // Enhanced validation
    const validation = validateItemData(itemData);
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

    // Sanitize and prepare data
    const sanitizedData = sanitizeItemData(itemData);

    const item = await Item.findByIdAndUpdate(
      id,
      sanitizedData,
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Sync qtyPerBatch if batch field was updated
    try {
      if (item.batch && !isNaN(parseFloat(item.batch))) {
        const today = new Date().toISOString().split('T')[0];
        // Get company ID from user (for Unit Head) or from item's store field (for Super Admin)
        const companyId = req.user.companyId ? req.user.companyId.toString() : item.store;

        console.log('🔧 Debug sync info:', {
          itemBatch: item.batch,
          itemName: item.name,
          itemId: item._id,
          itemStore: item.store,
          userCompanyId: req.user.companyId,
          finalCompanyId: companyId,
          userRole: req.user.role
        });

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
      // Don't fail the update if sync fails
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

// CATEGORY CONTROLLERS
export const getCategories = async (req, res) => {
  try {
    console.log('🔍 GetCategories called by:', req.user?.role);

    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    let categories;

    // For Unit Head users, show all categories but with company-specific product counts
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      console.log('🏢 Unit Head - showing all categories with company-specific counts:', req.user.companyId);

      // Get all categories (not just ones with items in the company)
      const allCategories = await Category.find().sort({ createdAt: -1, name: 1 });

      // Add product count for each category (company-specific)
      categories = await Promise.all(
        allCategories.map(async (category) => {
          const productCount = await Item.countDocuments({
            category: category.name,
            store: req.user.companyId
          });
          const categoryObj = category.toObject();
          categoryObj.productCount = productCount;
          console.log(`📊 Category "${category.name}" has ${productCount} products in company ${req.user.companyId}`);
          return categoryObj;
        })
      );
    } else {
      console.log('👑 Super Admin or other role - showing all categories');

      // For Super Admin and other roles, show all categories
      categories = await Category.find().sort({ createdAt: -1, name: 1 });

      // Add product count for each category (all companies)
      const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
          const productCount = await Item.countDocuments({
            category: category.name
          });
          const categoryObj = category.toObject();
          categoryObj.productCount = productCount;
          console.log(`📊 Category "${category.name}" has ${productCount} products (global)`);
          return categoryObj;
        })
      );
      categories = categoriesWithCount;
    }

    console.log(`✅ Returning ${categories.length} categories with product counts`);
    res.json({ categories });
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
    console.log('Creating category with data:', { name, description, subcategories });

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Filter out empty subcategories
    const validSubcategories = subcategories.filter(sub => sub && sub.trim() !== '');

    const categoryData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      subcategories: validSubcategories
    };

    const category = await Category.create(categoryData);
    console.log('Category created successfully:', category);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    console.error('Create category error:', error);
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
};

export const updateCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { name, description, subcategories = [] } = req.body;
    console.log('Updating category with data:', { id, name, description, subcategories });

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Filter out empty subcategories
    const validSubcategories = subcategories.filter(sub => sub && sub.trim() !== '');

    const updateData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      subcategories: validSubcategories
    };

    const category = await Category.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    console.log('Category updated successfully:', category);

    res.json({
      success: true,
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    console.error('Update category error:', error);
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
};

export const deleteCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'delete')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;

    // Check if category is being used by any items
    const itemsUsingCategory = await Item.countDocuments({
      $or: [
        { category: id },
        { category: (await Category.findById(id))?.name }
      ]
    });

    if (itemsUsingCategory > 0) {
      return res.status(400).json({
        message: `Cannot delete category. ${itemsUsingCategory} items are using this category.`
      });
    }

    const category = await Category.findByIdAndDelete(id);

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// CUSTOMER CATEGORY CONTROLLERS
export const getCustomerCategories = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const customerCategories = await CustomerCategory.find().sort({ createdAt: -1, name: 1 });
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

    if (!name) {
      return res.status(400).json({ message: 'Customer category name is required' });
    }

    const customerCategory = await CustomerCategory.create({ name, description });

    res.status(201).json({
      message: 'Customer category created successfully',
      customerCategory
    });
  } catch (error) {
    console.error('Create customer category error:', error);
    if (error.code === 11000) {
      res.status(400).json({ message: 'Customer category name already exists' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

export const updateCustomerCategory = async (req, res) => {
  try {
    if (!checkInventoryPermission(req.user, 'edit')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const updateData = req.body;

    const customerCategory = await CustomerCategory.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!customerCategory) {
      return res.status(404).json({ message: 'Customer category not found' });
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

    const customerCategory = await CustomerCategory.findByIdAndDelete(id);

    if (!customerCategory) {
      return res.status(404).json({ message: 'Customer category not found' });
    }

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

    // Build query with company filtering for Unit Head
    let query = {};
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

    // Build query with company filtering for Unit Head
    let query = { $expr: { $lte: ['$qty', '$minStock'] } };
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
    let matchStage = {};
    if (req.user.role === 'Unit Head' && req.user.companyId) {
      // Use string comparison since both companyId and store field are strings
      matchStage = { store: req.user.companyId };
    }

    console.log('Debug - Match stage:', matchStage);
    console.log('Debug - User companyId:', req.user.companyId);
    console.log('Debug - User role:', req.user.role);

    const pipeline = [];
    if (Object.keys(matchStage).length > 0) {
      // Ensure proper string comparison for MongoDB
      const fixedMatchStage = { store: String(req.user.companyId) };
      console.log('Debug - Fixed match stage:', fixedMatchStage);
      pipeline.push({ $match: fixedMatchStage });
    }

    pipeline.push({
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } },
        totalQty: { $sum: '$qty' },
        lowStockCount: {
          $sum: {
            $cond: [{ $lte: ['$qty', '$minStock'] }, 1, 0]
          }
        }
      }
    });

    const stats = await Item.aggregate(pipeline);

    // Build category stats pipeline with company filtering
    const categoryPipeline = [];
    if (Object.keys(matchStage).length > 0) {
      const fixedMatchStage = { store: String(req.user.companyId) };
      categoryPipeline.push({ $match: fixedMatchStage });
    }
    categoryPipeline.push({
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } }
      }
    }, { $sort: { count: -1 } });

    const categoryStats = await Item.aggregate(categoryPipeline);

    // Build type stats pipeline with company filtering
    const typePipeline = [];
    if (Object.keys(matchStage).length > 0) {
      const fixedMatchStage = { store: String(req.user.companyId) };
      typePipeline.push({ $match: fixedMatchStage });
    }
    typePipeline.push({
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$qty', '$stdCost'] } }
      }
    });

    const typeStats = await Item.aggregate(typePipeline);

    res.json({
      stats: {
        ...stats[0] || { totalItems: 0, totalValue: 0, totalQty: 0, lowStockCount: 0 },
        totalCategories: categoryStats.length
      },
      categoryStats,
      typeStats
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};