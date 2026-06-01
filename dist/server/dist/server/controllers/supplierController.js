"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.importSuppliersFromExcel = exports.exportSuppliersToExcel = exports.getSupplierStats = exports.deleteSupplier = exports.updateSupplier = exports.createSupplier = exports.getSupplierById = exports.getSuppliers = void 0;
const Supplier_js_1 = __importDefault(require("../models/Supplier.js"));
const XLSX = __importStar(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
// Configure multer for file upload
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});
const getSuppliers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unit = req.user.unit;
        const suppliers = yield Supplier_js_1.default.find({
            unit: { $in: [unit, 'Main'] }
        }).sort({ createdAt: -1 });
        res.json({ suppliers });
    }
    catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ message: 'Error fetching suppliers' });
    }
});
exports.getSuppliers = getSuppliers;
const getSupplierById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const supplier = yield Supplier_js_1.default.findById(req.params.id);
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json(supplier);
    }
    catch (error) {
        console.error('Error fetching supplier:', error);
        res.status(500).json({ message: 'Error fetching supplier' });
    }
});
exports.getSupplierById = getSupplierById;
const createSupplier = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const supplierData = Object.assign(Object.assign({}, req.body), { unit: req.user.unit });
        const supplier = new Supplier_js_1.default(supplierData);
        yield supplier.save();
        res.status(201).json({ message: 'Supplier created successfully', supplier });
    }
    catch (error) {
        console.error('Error creating supplier:', error);
        res.status(error.name === 'ValidationError' ? 400 : 500).json({
            message: error.message || 'Error creating supplier',
            errors: error.errors
        });
    }
});
exports.createSupplier = createSupplier;
const updateSupplier = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const supplier = yield Supplier_js_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json({ message: 'Supplier updated successfully', supplier });
    }
    catch (error) {
        console.error('Error updating supplier:', error);
        res.status(500).json({ message: 'Error updating supplier' });
    }
});
exports.updateSupplier = updateSupplier;
const deleteSupplier = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const supplier = yield Supplier_js_1.default.findByIdAndDelete(req.params.id);
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json({ message: 'Supplier deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ message: 'Error deleting supplier' });
    }
});
exports.deleteSupplier = deleteSupplier;
const getSupplierStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unit = req.user.unit;
        const totalSuppliers = yield Supplier_js_1.default.countDocuments({ unit: { $in: [unit, 'Main'] } });
        const activeSuppliers = yield Supplier_js_1.default.countDocuments({
            unit: { $in: [unit, 'Main'] },
            status: 'active'
        });
        res.json({
            total: totalSuppliers,
            active: activeSuppliers,
            inactive: totalSuppliers - activeSuppliers
        });
    }
    catch (error) {
        console.error('Error fetching supplier stats:', error);
        res.status(500).json({ message: 'Error fetching supplier statistics' });
    }
});
exports.getSupplierStats = getSupplierStats;
// Export suppliers to Excel
const exportSuppliersToExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unit = req.user.unit;
        const suppliers = yield Supplier_js_1.default.find({
            unit: { $in: [unit, 'Main'] }
        }).sort({ createdAt: -1 });
        const excelData = suppliers.map(supplier => ({
            'Supplier Name': supplier.supplierName || supplier.name,
            'Contact Person': supplier.contactPerson || '',
            'Email': supplier.email || '',
            'Phone': supplier.phone || '',
            'Company': supplier.company || '',
            'Address': supplier.address || '',
            'City': supplier.city || '',
            'State': supplier.state || '',
            'Country': supplier.country || '',
            'Postal Code': supplier.postalCode || '',
            'Tax ID': supplier.taxId || '',
            'Payment Terms': supplier.paymentTerms || '',
            'Status': supplier.status || 'active',
            'Created Date': supplier.createdAt ? supplier.createdAt.toISOString().split('T')[0] : ''
        }));
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const colWidths = [];
        Object.keys(excelData[0] || {}).forEach(key => {
            const maxLength = Math.max(key.length, ...excelData.map(row => String(row[key] || '').length));
            colWidths.push({ width: Math.min(maxLength + 2, 50) });
        });
        worksheet['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Suppliers');
        const excelBuffer = XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx'
        });
        const filename = `suppliers_${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(excelBuffer);
        console.log(`Suppliers Excel file sent: ${filename}`);
    }
    catch (error) {
        console.error('Error exporting suppliers to Excel:', error);
        res.status(500).json({ message: 'Error exporting suppliers to Excel', error: error.message });
    }
});
exports.exportSuppliersToExcel = exportSuppliersToExcel;
// Import suppliers from Excel
exports.importSuppliersFromExcel = [upload.single('file'), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            if (jsonData.length === 0) {
                return res.status(400).json({ message: 'Excel file is empty or has no valid data' });
            }
            const results = {
                total: jsonData.length,
                successful: 0,
                failed: 0,
                errors: []
            };
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const rowNumber = i + 2;
                try {
                    const supplierData = {
                        supplierName: row['Supplier Name'] || row['Name'] || '',
                        contactPerson: row['Contact Person'] || '',
                        email: row['Email'] || '',
                        phone: row['Phone'] || '',
                        company: row['Company'] || '',
                        address: row['Address'] || '',
                        city: row['City'] || '',
                        state: row['State'] || '',
                        country: row['Country'] || '',
                        postalCode: row['Postal Code'] || row['Zip Code'] || '',
                        taxId: row['Tax ID'] || '',
                        paymentTerms: row['Payment Terms'] || '',
                        status: row['Status'] || 'active',
                        unit: req.user.unit // Important: Assign to current user's unit
                    };
                    if (!supplierData.supplierName) {
                        results.errors.push(`Row ${rowNumber}: Supplier name is required`);
                        results.failed++;
                        continue;
                    }
                    // Check if supplier with same email exists
                    if (supplierData.email) {
                        const existingSupplier = yield Supplier_js_1.default.findOne({ email: supplierData.email });
                        if (existingSupplier) {
                            yield Supplier_js_1.default.findByIdAndUpdate(existingSupplier._id, supplierData);
                        }
                        else {
                            yield Supplier_js_1.default.create(supplierData);
                        }
                    }
                    else {
                        yield Supplier_js_1.default.create(supplierData);
                    }
                    results.successful++;
                }
                catch (rowError) {
                    console.error(`Error processing row ${rowNumber}:`, rowError);
                    results.errors.push(`Row ${rowNumber}: ${rowError.message}`);
                    results.failed++;
                }
            }
            res.json({
                message: `Import completed: ${results.successful} successful, ${results.failed} failed`,
                success: results.failed === 0,
                results
            });
        }
        catch (error) {
            console.error('Error importing Excel file:', error);
            res.status(500).json({
                message: 'Error importing Excel file',
                error: error.message,
                success: false
            });
        }
    })];
