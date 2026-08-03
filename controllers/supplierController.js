import Supplier from '../models/Supplier.js';
import * as XLSX from 'xlsx';
import multer from 'multer';

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

export const getSuppliers = async (req, res) => {
  try {
    const unit = req.user.unit;
    const { page, limit, search, supplierType } = req.query;
    const query = { unit: { $in: [unit, 'Main'] } };
    if (supplierType) query.supplierType = supplierType;
    if (search) {
      query.$or = [
        { supplierName: { $regex: search, $options: 'i' } },
        { supplierCode: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    // Vendor-picker dropdowns (PurchaseInvoices, VendorPayments, etc.) call
    // this with no page/limit and need the full list — only paginate when a
    // caller (Vendor Master's own browse page) actually asks for a page.
    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const [suppliers, total] = await Promise.all([
        Supplier.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        Supplier.countDocuments(query),
      ]);
      return res.json({
        suppliers,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const suppliers = await Supplier.find(query).sort({ createdAt: -1 });
    res.json({ suppliers });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'Error fetching suppliers' });
  }
};

export const getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json(supplier);
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ message: 'Error fetching supplier' });
  }
};

export const createSupplier = async (req, res) => {
  try {
    const supplierData = { ...req.body, unit: req.user.unit };
    const supplier = new Supplier(supplierData);
    await supplier.save();
    res.status(201).json({ message: 'Supplier created successfully', supplier });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({
      message: error.message || 'Error creating supplier',
      errors: error.errors
    });
  }
};

export const updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json({ message: 'Supplier updated successfully', supplier });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ message: 'Error updating supplier' });
  }
};

export const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'Error deleting supplier' });
  }
};

export const getSupplierStats = async (req, res) => {
  try {
    const unit = req.user.unit;
    const totalSuppliers = await Supplier.countDocuments({ unit: { $in: [unit, 'Main'] } });
    const activeSuppliers = await Supplier.countDocuments({
      unit: { $in: [unit, 'Main'] },
      status: 'active'
    });

    res.json({
      total: totalSuppliers,
      active: activeSuppliers,
      inactive: totalSuppliers - activeSuppliers
    });
  } catch (error) {
    console.error('Error fetching supplier stats:', error);
    res.status(500).json({ message: 'Error fetching supplier statistics' });
  }
};

// Export suppliers to Excel
export const exportSuppliersToExcel = async (req, res) => {
  try {
    const unit = req.user.unit;
    const suppliers = await Supplier.find({
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
      const maxLength = Math.max(
        key.length,
        ...excelData.map(row => String(row[key] || '').length)
      );
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
  } catch (error) {
    console.error('Error exporting suppliers to Excel:', error);
    res.status(500).json({ message: 'Error exporting suppliers to Excel', error: error.message });
  }
};

// Import suppliers from Excel
export const importSuppliersFromExcel = [upload.single('file'), async (req, res) => {
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
          const existingSupplier = await Supplier.findOne({ email: supplierData.email });
          if (existingSupplier) {
            await Supplier.findByIdAndUpdate(existingSupplier._id, supplierData);
          } else {
            await Supplier.create(supplierData);
          }
        } else {
          await Supplier.create(supplierData);
        }

        results.successful++;
      } catch (rowError) {
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

  } catch (error) {
    console.error('Error importing Excel file:', error);
    res.status(500).json({
      message: 'Error importing Excel file',
      error: error.message,
      success: false
    });
  }
}];