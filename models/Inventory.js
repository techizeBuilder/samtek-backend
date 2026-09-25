import mongoose from 'mongoose';
import { ProcessCategorySchema } from './ProcessDefinitionSchema.js';

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  group: {
    type: String,
    trim: true
  },
  // Legacy classification pair — still shared, productKind-scoped storage for
  // Product Master ("P-Type"/"Category") and Motor Master ("MotorCategory"/
  // "MotorSubCategory"); see rdController.js. No longer required/shown on the
  // plain-Inventory form (superseded there by itemType below) — old items and
  // other productKind's data keep working untouched.
  category: {
    type: String,
    default: '',
    trim: true,
  },
  subCategory: {
    type: String,
    trim: true
  },
  // The client's real "Item Type" business classification (Raw Material/
  // Tool/Readymade Material/Assets) — Inventory-own, dynamic ("+"-addable),
  // InventoryMasterOption-backed, same pattern as sourceType/itemSourceType
  // below. Deliberately separate from the internal `type` field further down
  // (system classification: Product/Material/Spares/Assemblies, hidden from
  // this form, governs Pricing Value/QC/Sales/codegen — untouched by this).
  itemType: { type: String, default: '', trim: true },
  // Only meaningful when itemType is "Job Work" (case-insensitive, checked
  // in the form, not enforced here) — which specific outsourced service this
  // item represents (e.g. Powder Coating, Anodizing, Heat Treatment).
  // Dynamic ("+"-addable), InventoryMasterOption-backed, same pattern as
  // itemType itself. Feeds the upcoming Job Work production stage — not
  // consumed by anything else in the codebase yet.
  jobWorkType: { type: String, default: '', trim: true },
  // Inventory's own new classification fields (InventoryMasterOption-backed,
  // "+"-addable) — deliberately separate from the Category Management system
  // above (which Product/Motor Master's own dropdowns and Sales/Quotation
  // filtering still use) and from Product/Motor Master's own lists.
  itemCategories: [{ type: String, trim: true }], // multi-select, e.g. Fabrication, Sheet Metal, Machining
  sourceType: { type: String, default: '', trim: true }, // e.g. Purchase, In House
  itemSourceType: { type: String, default: '', trim: true }, // e.g. In House, Out Source, Both
  // Item Process Type — dynamic ("+"-addable), InventoryMasterOption-backed
  // like itemType/sourceType above. 'Fabrication Item' is the one value with
  // special frontend behavior (opens the Fabrication Master picker); every
  // other value is just a plain tag, same as the fields above.
  itemProcessType: { type: String, default: '', trim: true },
  // Set when this Item was created by picking a Fabrication Master entry —
  // traceability back to the catalog item; see FabricationMaster.js.
  fabricationRef: { type: mongoose.Schema.Types.ObjectId, ref: 'FabricationMaster', default: null },
  batch: {
    type: String,
    trim: true
  },
  // Denominated in Receive Unit (see receiveUnit/receiveUnitType below) — the
  // unit Store actually counts physical stock in. For non-fabrication items
  // Receive Unit is enforced equal to `unit` (sanitizeItemData in
  // inventoryController.js — no general conversion exists between two
  // arbitrary unit types), so this is numerically the same as `unit` for
  // them. For fabrication items `qty` stays 0/unused — real stock lives in
  // dimensionVariants[].subStock, itself Receive-Unit/Pieces-denominated.
  qty: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  // "Used Unit" — despite the field name, this is the BOM/consumption unit,
  // not necessarily what stock is counted in (see qty's comment above).
  unit: {
    type: String,
    required: true,
    trim: true
  },
  store: {
    type: String,
    trim: true
  },
  importance: {
    type: String,
    enum: ['Low', 'Normal', 'High', 'Critical'],
    default: 'Normal'
  },
  // Internal/system classification — Product Master and Motor Master hardcode
  // 'Product' here server-side (see productKind below); plain Inventory items
  // pick from this fixed list. NOT the client's "Item Type" business
  // classification (Raw Material/Tool/etc.) — that lives in category/subCategory.
  type: {
    type: String,
    required: true,
    enum: ['Product', 'Material', 'Spares', 'Assemblies']
  },
  // Only meaningful when type: 'Product' — distinguishes which "master" this
  // sellable item is managed under (Product Master's machines vs Motor
  // Master's motors). Everything genuinely shared (price, stock, purchase
  // unit, specs, description, image) stays on the item's common fields above;
  // only what's truly master-specific lives in the nested details below.
  //
  // 'ChildPart' — an in-house-assembled sub-assembly that Production builds
  // and Store stocks ahead of demand, reusable across every Machine whose BOM
  // references it (see ChildPartBOM.js). Renamed from 'SubChildPart'
  // 2026-09 — everything built under that name (reorder cron, Job Work/
  // Fabrication/Assembly/Painting pipeline, QC checklist infra) was correct,
  // just anchored one hierarchy level too low; see
  // server/docs/bom-hierarchy-redesign-2026-09.md. Only the stock side lives
  // here (qty/materialFlow/minStock/reorderQty, same generic fields every
  // other Item already has) — a Child Part's own material list (which Sub
  // Child Parts + other materials it's assembled from) lives on its own
  // ChildPartBOM document, never duplicated here.
  //
  // 'SubChildPart' (NEW, 2026-09) — the true leaf of the hierarchy: exactly
  // one source raw material, sent through Job Work (see subChildPartDetails
  // below) to become this part. Its own stock/reorder lives here exactly
  // like ChildPart's; it has no material list of its own (source material is
  // the one input) and no multi-step build pipeline (Job Work is its only —
  // and, when in-house, single — process step).
  productKind: {
    type: String,
    enum: ['Machine', 'Motor', 'ChildPart', 'SubChildPart', null],
    default: null,
  },
  // Simple free-text spec note — collected on Child Part / Sub Child Part
  // creation (BOM Management), but a generic field on Item rather than
  // something kind-specific, matching how name/code/image already work here.
  specification: { type: String, default: '', trim: true },
  // Sub Child Part specific fields (productKind: 'SubChildPart' only) —
  // mirrors machineDetails/motorDetails's own nesting pattern. A Sub Child
  // Part is always exactly one source raw material (confirmed with the
  // client 2026-09-11 — never a multi-material BOM); sourceQty/sourceUnit is
  // how much of it one Sub Child Part unit consumes.
  subChildPartDetails: {
    sourceItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    // sourceQty/sourceUnit are always expressed in the source item's own
    // locked Used Unit (never a separate unit choice, same rule the BOM
    // material picker's UnitAmountField/FabricationVariantAmountFields
    // enforce) — for a Length/Area/Volume-unit or Fabrication Master source
    // item this IS the "Area/Length Used" amount, not a separate pieces
    // multiplier; a Sub Child Part is one atomic unit, nothing else to
    // multiply by.
    sourceQty: { type: Number, min: 0, default: null },
    sourceUnit: { type: String, default: '', trim: true },
    // Fabrication Master source material only — which catalog
    // Item.dimensionVariants[] entry this Sub Child Part is cut from.
    // Mirrors RDBOM.MaterialSchema's own dimensionVariantId field.
    sourceDimensionVariantId: { type: String, default: null },
    // Computed server-side on every create/update (see
    // subChildPartMasterController.js) from the resolved source item —
    // weight x weightUnitPrice for a Fabrication Master source,
    // purchaseCost x sourceQty otherwise. Stored (not just computed live in
    // the create/edit form) so the list/View-modal/drill-down card can show
    // it without that form being open.
    materialsCost: { type: Number, default: 0 },
    // Category -> Internal Process pipeline for this Sub Child Part (see
    // ProcessDefinitionSchema.js) — replaces jobWork/jobWorkTypes above.
    // Each internal process is independently typed In-House/Out Source, with
    // ordering by array position (category order, then internal-process
    // order within each category). No materials picker at this level in the
    // UI — a Sub Child Part's one sourceItem above is the implicit material
    // for an OutSource-first pipeline, so internalProcesses[].materialRefs
    // stays empty here (there is no materials[] array to reference into).
    processDefinition: { type: [ProcessCategorySchema], default: [] },
    // Manual-only for now (confirmed 2026-09-13) — R&D's own estimate of what
    // Job Work costs to build/outsource one unit. Same "Manual -> Actual"
    // mechanic RDBOM.productionCost already uses: once Purchase (outsourced)
    // or Production (in-house) flows exist for Sub Child Part, completing
    // one there overwrites this and flips the source to 'Actual' — not
    // wired yet, that's later work.
    jobWorkCost: { type: Number, default: null, min: 0 },
    jobWorkCostSource: { type: String, enum: ['Manual', 'Actual'], default: 'Manual' },
    jobWorkCostUpdatedAt: { type: Date, default: null },
    // Average scrap cost for ONE Sub Child Part unit — computed server-side
    // whenever its Sheet Metal Plan is saved (see
    // subChildPartSheetPlanController.js), from the same
    // computeSheetMetalPlanCostBreakdown math the Machine BOM's own Sheet
    // Metal Plan uses, divided by that plan's orderQty. Stays 0 for a
    // non-sheet-metal Sub Child Part, or one with no plan yet.
    scrapCost: { type: Number, default: 0 },
    // Weight of ONE Sub Child Part unit, in kg — computed server-side
    // alongside materialsCost (see subChildPartMasterController.js's
    // computeUnitWeightKg), from the same fabrication weight or
    // unitWeightValue-based math every BOM material line already uses (see
    // server/utils/bomWeightCalc.js). Needed so Child Part and Machine can
    // roll up a real total weight without it, there's no way to compute a
    // Machine's own Total Weight once its BOM references Child Parts
    // instead of flat raw materials.
    unitWeightKg: { type: Number, default: 0 },
  },
  // Universal active/discontinued toggle — client asked for this on both
  // Inventory items and Product Master machines ("Continue"/"Discontinue"),
  // so it lives here as a genuinely common field rather than duplicated per kind.
  isDiscontinued: { type: Boolean, default: false },
  // Explicit dynamic "Source Type" field (Manufacturing/Purchase for Product
  // Master) — kept as its own real field per the client's literal requirement,
  // even though it drives the same purchase/internalManufacturing booleans
  // itemPricingService already depends on. Never silently collapsed away.
  productSourceType: { type: String, default: '', trim: true },
  // Product Master (Machine) specific fields
  machineDetails: {
    variant: { type: String, default: '', trim: true },
    productionRate: { type: String, default: '', trim: true }, // e.g. "200 Kg/hr"
    // Legacy single-power fields — a machine could only ever declare one
    // motor/power source. Superseded by powerRequirements[] below (a machine
    // can run on several motors, e.g. one 5 HP + one 10 HP); kept, unwritten,
    // so existing machines saved before the change still show their one
    // entry until next edited (see rdController.js toMachineItemFields and
    // PlantMaster.jsx's powerLine()).
    powerSource: { type: String, default: '', trim: true }, // Motor / Gas / Engine
    powerRequiredHP: { type: Number, default: null },
    powerRequiredKWH: { type: Number, default: null },
    powerRequiredRPM: { type: Number, default: null },
    powerRequirements: [{
      powerSource: { type: String, default: '', trim: true },
      hp: { type: Number, default: null },
      kwh: { type: Number, default: null },
      rpm: { type: Number, default: null },
    }],
    accessories: [{ type: String, trim: true }],
    modelNumber: { type: String, default: '', trim: true },
    machineType: { type: String, enum: ['Standard', 'Custom', 'Special Purpose Machine (SPM)'], default: 'Standard' },
    // R&D workflow state — migrated as-is from the old RDMachine collection.
    forwardToNextPhase: { type: Boolean, default: false },
    designStatus: { type: String, enum: ['Draft', 'Testing', 'Approved', 'Rejected'], default: 'Draft' },
    releaseStatus: { type: String, enum: ['Not Released', 'Released'], default: 'Not Released' },
    rejectionNote: { type: String, default: '' },
    // Set the first time a ProductionOrder for this machine reaches 'Completed'
    // — see itemPricingService.js.
    firstBuiltAt: { type: Date, default: null },
  },
  // R&D custom field templates (parent label -> sub-field name -> value),
  // shaped per RDCustomFieldTemplate matching category+subCategory+productSourceType.
  // Kept at the top level (not nested in machineDetails) since it's plain
  // key/value data with no other Machine-only typing needs.
  customFields: [{
    groupLabel: { type: String, trim: true },
    fieldName: { type: String, trim: true },
    value: { type: String, trim: true, default: '' }
  }],
  // Motor Master specific fields
  motorDetails: {
    motorType: { type: String, default: '', trim: true },
    modelNumber: { type: String, default: '', trim: true },
    version: { type: String, default: '', trim: true },
    hp: { type: Number, default: null },
    kwh: { type: Number, default: null }, // auto-calculated from hp (see client formula)
    rpm: { type: Number, default: null },
    pole: { type: String, default: '', trim: true },
    phase: { type: String, default: '', trim: true },
    // Set the first time a ProductionOrder for this motor reaches 'Completed'
    // — mirrors machineDetails.firstBuiltAt, see itemPricingService.js.
    firstBuiltAt: { type: Date, default: null },
  },
  stdCost: {
    type: Number,
    min: 0,
    default: 0
  },
  purchaseCost: {
    type: Number,
    min: 0,
    default: 0
  },
  // ₹ per kg — fabrication items only (fabricationRef set). purchaseCost above
  // is structurally ₹-per-base-unit (piece) and stays that way for every item;
  // it can't double as a weight rate because one fabrication Item can carry
  // multiple dimensionVariants (different sizes) with different per-piece
  // weights — only a ₹/kg rate is constant across all of them. Populated the
  // same two ways purchaseCost is: automatically from the raw pre-conversion
  // PurchaseInvoice unit price (itemPricingService.resolvePurchaseItemCost),
  // or manually by Accounts on first purchase (Purchase > Inventory). Hidden
  // from the Inventory form, like purchaseCost/stdCost.
  weightUnitPrice: {
    type: Number,
    min: 0,
    default: null
  },
  salePrice: {
    type: Number,
    min: 0,
    default: 0
  },
  hsn: {
    type: String,
    trim: true
  },
  gst: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  unitType: {
    type: String,
    default: 'Nos'
  },
  mrp: {
    type: Number,
    min: 0,
    default: 0
  },
  // Per-item Pricing Value (Company Admin > Pricing Value) — set only on
  // items the company actually sells (type: 'Product'). Once a real cost is
  // known (BOM roll-up or purchase price), MRP = cost + cost*profitPercent/100
  // and Sale Price = cost - cost*discountPercent/100. null means "not set
  // yet" — treated as 0 (no markup/discount) by itemPricingService.js.
  profitPercent: {
    type: Number,
    min: 0,
    max: 1000,
    default: null
  },
  discountPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  // Also set from Company Admin > Pricing Value. The Sales Order Form's Bill
  // Amt for this item (when it's a Machine billed against its BOM) must
  // exceed the BOM's per-unit material cost by more than this percent —
  // replaces what used to be a hardcoded 10% everywhere. null/unset is
  // treated as 10 (the old hardcoded default) by itemPricingService.js.
  billAmountPercent: {
    type: Number,
    min: 0,
    max: 1000,
    default: 10
  },
  // Tracks whether stdCost/purchaseCost/salePrice/mrp are still R&D's manual
  // guess, or have been auto-computed from a real BOM roll-up / purchase
  // price. See server/services/itemPricingService.js.
  costSource: {
    type: String,
    enum: ['Manual', 'BOM', 'Purchase'],
    default: 'Manual'
  },
  costResolvedAt: {
    type: Date,
    default: null
  },
  // Human-readable reason costSource is still 'Manual' despite
  // internalManufacturing/purchase being set (e.g. missing BOM material
  // link, machine not built yet) — surfaced in the Add/Edit Item form.
  costResolutionIssue: {
    type: String,
    trim: true,
    default: null
  },
  internalManufacturing: {
    type: Boolean,
    default: false
  },
  purchase: {
    type: Boolean,
    default: true
  },
  purchaseUnitType: {
    type: String,
    trim: true
  },
  purchaseUnit: {
    type: String,
    trim: true
  },
  // Receive Unit — the unit Store actually receives/counts stock in, which
  // can differ from Purchase Unit (e.g. purchased by weight, received/counted
  // by piece). Same Type+Unit pairing as Purchase/Used Unit above (UnitType
  // collection). Auto-filled from FabricationMaster's own receiveUnitType/
  // receiveUnit when picking a Fabrication Item (see SimpleInventoryForm's
  // handleFabricationSelect), editable afterward like every other unit field.
  receiveUnitType: {
    type: String,
    trim: true,
    default: ''
  },
  receiveUnit: {
    type: String,
    trim: true,
    default: ''
  },
  description: {
    type: String,
    trim: true
  },
  // Optional attributes mirrored from Product Master when the item's code matches an
  // R&D-defined product (see itemCode autofill in SimpleInventoryForm). Independent of
  // Product Master's own Category/P-Type taxonomy — never populated from those.
  brand: {
    type: String,
    trim: true,
    default: ''
  },
  metrology: {
    type: String,
    trim: true,
    default: ''
  },
  // Shared/universal — same real-world spec (e.g. SS304) regardless of whether
  // it's an Inventory item or a Product Master machine, so Product Master's
  // Material Grade dropdown (RDMasterOption field 'MaterialGrade') reads and
  // writes this same top-level field rather than keeping its own copy.
  materialGrade: {
    type: String,
    trim: true,
    default: ''
  },
  // Sheet Metal / Non Sheet Metal classification — only ever meaningful for
  // fabrication items. Auto-filled from FabricationMaster.isSheetMetal (its
  // own comment has the full reasoning) and locked in the Inventory form,
  // same pattern as materialGrade/the 3 Unit fields above. Consumed by BOM.
  isSheetMetal: {
    type: Boolean,
    default: false
  },
  modelNumber: {
    type: String,
    trim: true,
    default: ''
  },
  size: {
    type: String,
    trim: true,
    default: ''
  },
  // Structured dimension breakdown (Inventory-specific — Product Master keeps
  // its own simple free-text `size` field above for "6x12" style dimensions).
  dimensions: {
    length: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    height: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    width: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    diaOD: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    diaID: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    thickness: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
  },
  // Populated when this Item is created from a Fabrication Master pick — a
  // per-Item COPY of the catalog entry's dimensions (see FabricationMaster.js),
  // each with its own `subStock` since stock is tracked here, not on the
  // catalog. Left empty ([]) for every other Item; the fixed `dimensions`
  // object above is what those use.
  dimensionVariants: [{
    category: { type: String, trim: true },
    // Mixed, not Map — see FabricationMaster.js's dimensions.values comment.
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    designation: { type: String, default: '', trim: true },
    densityValue: { type: Number, default: null },
    densityUnit: { type: String, default: 'kg/m3', trim: true },
    weightPerMeterKg: { type: Number, default: null },
    weightPerPieceKg: { type: Number, default: null },
    subStock: { type: Number, default: 0 },
    // Set when Store creates this variant themselves by cutting a piece down
    // to fulfil a Production demand and recording what's left (see
    // inventoryController.js's transferFabricationMaterialToProduction) —
    // as opposed to a variant that came from the original Fabrication
    // Master catalog pick. Leftover variants are valid stock for a future
    // Production transfer but must never be offered as a choice when Store
    // raises a Purchase Request (Purchase only reorders catalog sizes).
    isLeftover: { type: Boolean, default: false },
    // Material Flow — same High/Medium/Low reorder-point classification as
    // the top-level fields below, but per dimension size: Store cuts and
    // reorders each catalog size independently, so each one gets its own
    // trigger point and order quantity rather than sharing the item's single
    // top-level minStock/reorderQty (which stay unused for fabrication items
    // — real stock lives here in subStock, not in top-level qty). Excluded
    // from the low-stock sweep when isLeftover — same "Purchase only
    // reorders catalog sizes" rule as above.
    materialFlow: { type: String, enum: ['', 'High Flow', 'Medium Flow', 'Low Flow'], default: '' },
    // Both denominated in PIECES of this exact size, NOT the item's
    // purchaseUnit (unlike the top-level reorderQty above) — subStock itself
    // is a piece count, and a vendor sells whole pieces regardless of the
    // purchaseUnit being weight-based (e.g. kg). The cron job
    // (lowStockReorderCron.js) converts reorderQty pieces -> the actual
    // purchase-unit total (typically kg) via resolveFabricationLines, which
    // is always an exact multiplication (pieces x weight/piece) — never a
    // division back into pieces, so there's no fractional-piece risk. Both
    // must be whole numbers (enforced in inventoryController.js).
    minStock: { type: Number, min: 0, default: 0 },
    reorderQty: { type: Number, min: 0, default: 0 },
  }],
  unitWeightValue: {
    type: Number,
    default: null
  },
  unitWeightUnitType: {
    type: String,
    trim: true,
    default: ''
  },
  unitWeightUnit: {
    type: String,
    trim: true,
    default: ''
  },
  internalNotes: {
    type: String,
    trim: true
  },
  // Reorder trigger point ("cap") for the low-stock auto-purchase sweep (see
  // server/jobs/lowStockReorderCron.js) — a PR auto-raises once qty falls to
  // this. Only meaningful for non-fabrication items (fabrication real stock
  // lives per-dimension in dimensionVariants[].subStock/minStock instead,
  // since qty stays 0/unused for them).
  minStock: {
    type: Number,
    min: 0,
    default: 0
  },
  // Material Flow — High/Medium/Low preset that auto-fills (but doesn't
  // lock) minStock above with a default of 20/10/5 respectively, resolving
  // the client's own "fixed label value vs custom per item" ask: the label
  // is a convenience default, minStock is what's actually compared. Only
  // shown/used for Purchasable items (formData.purchase === true) — an
  // Internal-Manufacturing item has no purchase-based reorder concept.
  materialFlow: { type: String, enum: ['', 'High Flow', 'Medium Flow', 'Low Flow'], default: '' },
  // How much to auto-order once minStock triggers, denominated in
  // purchaseUnit (not the stock-counting unit) — must be >= minStock or
  // receiving the order would immediately re-trigger the same request
  // (enforced in inventoryController.js's validateItemData).
  reorderQty: { type: Number, min: 0, default: 0 },
  leadTime: {
    type: Number,
    min: 0,
    default: 0
  },
  customerCategory: {
    type: String,
    required: false,
    trim: true,
    default: 'Retail'
  },
  tags: [{
    type: String,
    trim: true
  }],
  customerPrices: [{
    category: String,
    price: Number
  }],
  image: {
    type: String,
    trim: true,
    default: null
  },
  quantity: {
    type: String,
    trim: true,
    default: ""
  },
  dealerPrice: {
    type: Number,
    min: 0,
    default: 0
  },
  brochureUrl: {
    type: String,
    trim: true,
    default: null
  },
  videoUrl: {
    type: String,
    trim: true,
    default: null
  },
  uses: {
    type: String,
    trim: true
  },
  otherInfo: {
    type: String,
    trim: true
  },
  specifications: [{
    key: String,
    value: String
  }],
  minOrderQty: {
    type: Number,
    min: 0,
    default: 1
  },
  variant: {
    type: String,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  // NEW: Product variants for quotation price list
  variants: [{
    name: {
      type: String,
      trim: true
    },
    price: {
      type: Number,
      min: 0
    },
    code: {
      type: String,
      trim: true
    },
    // 💥 Clean dynamic key-value array for unlimited custom columns/fields
    attributes: [{
      label: { type: String, trim: true }, // e.g., "Chamber Size", "Phase Type", "Color"
      value: { type: String, trim: true }  // e.g., "400mm", "3-Phase", "Red"
    }]
  }],
  // NEW: Product applications (for flour mill, etc.)
  applications: [{
    type: String,
    trim: true
  }],
  // NEW: Warranty information
  warranty: {
    period: {
      type: Number,
      default: 12 // months
    },
    type: {
      type: String,
      enum: ['Parts Only', 'Labor Only', 'Comprehensive'],
      default: 'Comprehensive'
    },
    terms: {
      type: String,
      trim: true
    },
    // Warranty card document uploaded at time of receiving item from purchase
    cardUrl: {
      type: String,
      trim: true,
      default: null
    },
    cardUploadedAt: {
      type: Date,
      default: null
    }
  },
  // Serial number of the physical item (added at time of receiving from purchase)
  serialNumber: {
    type: String,
    trim: true,
    default: null
  },
  // Reference back to the purchase request that brought this item in
  receivedFromPurchaseRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
    default: null
  }
}, {
  timestamps: true
});

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    // unique: true, <--- REMOVE THIS GLOBAL UNIQUE CONSTRAINT
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  subcategories: [{
    type: String,
    trim: true
  }],
  // ADD COMPANY ID
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});



const customerCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    // unique: true,  <--- REMOVE THIS GLOBAL CONSTRAINT
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // ADD COMPANY ID
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

// ADD THIS: Ensures names are unique PER COMPANY, not globally
customerCategorySchema.index({ name: 1, companyId: 1 }, { unique: true });

// Indexes for better performance
itemSchema.index({ name: 1, code: 1 });
itemSchema.index({ category: 1, subCategory: 1 });
itemSchema.index({ type: 1 });
itemSchema.index({ productKind: 1, purchase: 1 });
itemSchema.index({ qty: 1, minStock: 1 });
itemSchema.index({ order: 1 });
itemSchema.index({ companyId: 1 });
itemSchema.index({ store: 1 });
// ADD THIS: Ensures category names are unique PER COMPANY, not globally
categorySchema.index({ name: 1, companyId: 1 }, { unique: true });

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

groupSchema.index({ name: 1, companyId: 1 }, { unique: true });

const unitTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  units: [{
    type: String,
    trim: true
  }],
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

unitTypeSchema.index({ name: 1, companyId: 1 }, { unique: true });

export const Item = mongoose.model('Item', itemSchema);
export const Category = mongoose.model('Category', categorySchema);
export const CustomerCategory = mongoose.model('CustomerCategory', customerCategorySchema);
export const Group = mongoose.model('Group', groupSchema);
export const UnitType = mongoose.model('UnitType', unitTypeSchema);