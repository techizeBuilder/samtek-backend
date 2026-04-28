/** @format */
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure storage for HR Policies
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/policies/";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "policy-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create the multer instance
export const hrPolicyUpload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow PDFs, Word docs, and Images
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
      cb(new Error("Only PDF, Word, and Image files are allowed for policies!"), false);
    }
  },
});
