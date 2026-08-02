/** @format */
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure storage for Expense Receipts
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/expenses/";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "expense-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create the multer instance
// No fileFilter: any bill/receipt file type (image, PDF, etc.) is accepted.
export const expenseUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (bumped up so larger scanned PDFs aren't rejected)
  },
});
