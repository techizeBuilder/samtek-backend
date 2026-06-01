"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePurchaseRequestStatus = exports.createPurchaseRequest = exports.getPurchaseRequests = void 0;
const PurchaseRequest_js_1 = __importDefault(require("../models/PurchaseRequest.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Order_js_1 = __importDefault(require("../models/Order.js")); // Essential to register Order schema for population
const QCJob_js_1 = __importDefault(require("../models/QCJob.js"));
// Get all purchase requests for a company
const getPurchaseRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'User company is not configured' });
        }
        // --- Auto-sync existing matching Sales to Purchase Requests ---
        try {
            const matchingSales = yield Sale_js_1.default.find({
                companyId,
                isAvailableInInventory: 'Not Available',
                productType: 'Purchased (Trading Product)'
            }).populate('order');
            for (const sale of matchingSales) {
                const sourceRefId = sale.invoiceNumber || sale._id.toString();
                const existingReq = yield PurchaseRequest_js_1.default.findOne({
                    companyId,
                    itemId: sourceRefId
                });
                if (!existingReq) {
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    // Count GLOBALLY to avoid E11000 duplicate key error on requestId index
                    const count = yield PurchaseRequest_js_1.default.countDocuments({});
                    const requestId = `PR${String(count + 1).padStart(3, '0')}`;
                    yield PurchaseRequest_js_1.default.create({
                        requestId,
                        productName,
                        quantity: ((_a = sale.items) === null || _a === void 0 ? void 0 : _a.reduce((acc, item) => acc + (item.quantity || 0), 0)) || 1,
                        requestFromDepartment: 'Store',
                        priority: ((_b = sale.order) === null || _b === void 0 ? void 0 : _b.priority) || 'Medium',
                        companyId,
                        storeOrderId: ((_c = sale.order) === null || _c === void 0 ? void 0 : _c._id) || sale._id,
                        itemId: sourceRefId
                    });
                    console.log(`Auto-synced existing sale to Purchase Request: ${requestId}`);
                }
            }
        }
        catch (syncError) {
            console.error('Error during auto-sync of Purchase Requests:', syncError);
        }
        // -------------------------------------------------------------
        const query = { companyId };
        if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
            query.requestFromDepartment = 'Store';
        }
        const requests = yield PurchaseRequest_js_1.default.find(query)
            .populate({
            path: 'purchaseOrder',
            populate: { path: 'supplier' }
        })
            .sort({ createdAt: -1 });
        // --- Self-healing sync: Auto-update status to Ordered if a PO is linked and status is Pending/Approved ---
        let updatedAny = false;
        for (const reqObj of requests) {
            if (reqObj.purchaseOrder && (reqObj.status === 'Pending' || reqObj.status === 'Approved')) {
                reqObj.status = 'Ordered';
                yield reqObj.save();
                updatedAny = true;
                console.log(`[Self-healing] Auto-synced request status to Ordered for ${reqObj.requestId} because PO exists`);
            }
        }
        // Re-fetch if any requests were modified to have correct populated data and status in response
        let finalRequests = requests;
        if (updatedAny) {
            finalRequests = yield PurchaseRequest_js_1.default.find(query)
                .populate({
                path: 'purchaseOrder',
                populate: { path: 'supplier' }
            })
                .sort({ createdAt: -1 });
        }
        res.status(200).json({ success: true, data: finalRequests });
    }
    catch (error) {
        console.error('Error fetching purchase requests:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});
exports.getPurchaseRequests = getPurchaseRequests;
// Create a new purchase request
const createPurchaseRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { productName, quantity, requestFromDepartment, priority, storeOrderId, itemId } = req.body;
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'User company is not configured' });
        }
        // Generate Request ID globally to prevent unique index duplicates across companies
        const count = yield PurchaseRequest_js_1.default.countDocuments({});
        const requestId = `PR${String(count + 1).padStart(3, '0')}`;
        const newRequest = yield PurchaseRequest_js_1.default.create({
            requestId,
            productName,
            quantity,
            requestFromDepartment: (req.user.role === 'Store Head' || req.user.role === 'Store Employee') ? 'Store' : (requestFromDepartment || 'Store'),
            priority,
            companyId,
            storeOrderId,
            itemId
        });
        res.status(201).json({ success: true, data: newRequest });
    }
    catch (error) {
        console.error('Error creating purchase request:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});
exports.createPurchaseRequest = createPurchaseRequest;
const today = () => new Date().toISOString().split('T')[0];
function generateQCJobId() {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const lastJob = yield QCJob_js_1.default.findOne({
            qcJobId: new RegExp(`^QC-${year}-`)
        }).sort({ qcJobId: -1 }).lean();
        let nextNumber = 1;
        if (lastJob && lastJob.qcJobId) {
            const parts = lastJob.qcJobId.split('-');
            if (parts.length === 3) {
                const lastNumber = parseInt(parts[2]);
                if (!isNaN(lastNumber)) {
                    nextNumber = lastNumber + 1;
                }
            }
        }
        return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
    });
}
// Update purchase request status
const updatePurchaseRequestStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { status } = req.body;
        // Enforce that Store Head / Store Employee can only change status to "Received"
        if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
            if (status !== 'Received') {
                return res.status(403).json({ success: false, message: 'Store users can only change status to Received' });
            }
        }
        const request = yield PurchaseRequest_js_1.default.findById(id).populate('purchaseOrder');
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        const oldStatus = request.status;
        request.status = status;
        yield request.save();
        // Trigger QC Job & Purchase Invoice creation on 'Received' status transition
        if (status === 'Received' && oldStatus !== 'Received') {
            // 1. Generate QC Job
            try {
                const sourceRefId = ((_a = request.purchaseOrder) === null || _a === void 0 ? void 0 : _a.purchaseOrderNumber) || request.requestId;
                // Check if a QC job for this sourceRefId already exists
                const existingQC = yield QCJob_js_1.default.findOne({
                    source: 'Purchase',
                    sourceRefId: sourceRefId,
                    company: request.companyId
                });
                if (!existingQC) {
                    const qcJobId = yield generateQCJobId();
                    yield QCJob_js_1.default.create({
                        qcJobId,
                        source: 'Purchase',
                        sourceRefId: sourceRefId,
                        sourceDepartment: 'Store',
                        sentBy: req.user.fullName || req.user.username || 'Store Dept',
                        itemName: request.productName,
                        itemCode: request.itemId || request.requestId,
                        category: 'Raw Material', // purchase items are typically raw materials/trading goods
                        quantity: request.quantity || 1,
                        unit: 'pcs',
                        receivedDate: today(),
                        status: 'Pending',
                        company: request.companyId,
                        createdBy: req.user._id,
                        notes: `Automatically created from Store Purchase Requisition: ${request.requestId}`
                    });
                    console.log(`✅ QC Job ${qcJobId} automatically created for Purchase Request ${request.requestId}`);
                }
            }
            catch (qcError) {
                console.error('❌ Error creating QC job from Purchase Request:', qcError);
            }
            // 2. Generate Purchase Invoice
            try {
                const { createAutoPurchaseInvoice } = yield Promise.resolve().then(() => __importStar(require('./purchaseInvoiceController.js')));
                yield createAutoPurchaseInvoice(request, req.user);
                console.log(`✅ [Purchase Receipt] Created purchase invoice for request: ${request.requestId}`);
            }
            catch (invoiceError) {
                console.error('❌ Error creating purchase invoice on request receipt:', invoiceError);
            }
        }
        res.status(200).json({ success: true, data: request });
    }
    catch (error) {
        console.error('Error updating purchase request:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});
exports.updatePurchaseRequestStatus = updatePurchaseRequestStatus;
