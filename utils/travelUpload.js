/** @format */
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure storage for Travel Receipts/Documents
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/travel/";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "travel-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create the multer instance
export const travelUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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
      cb(new Error("Only images (JPEG, PNG) and PDFs are allowed for travel documents!"), false);
    }
  },
});
