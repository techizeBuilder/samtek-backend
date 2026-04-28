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
export const expenseUpload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow images and PDFs
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/pdf",
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images (JPEG, PNG) and PDFs are allowed for expense receipts!"), false);
    }
  },
});
