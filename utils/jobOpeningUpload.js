/** @format */
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure storage for Job Opening documents
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/jobs/";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "job-doc-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create the multer instance
export const uploadJobDocument = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow images, PDFs, and Word docs
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, Word, and Image files are allowed!"), false);
    }
  },
});
