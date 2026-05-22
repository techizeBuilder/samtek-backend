import multer from "multer";
import path from "path";
import fs from "fs";

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/lms_media/"; // Dedicated folder for training content

    // Create folder if not exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      "module-" + uniqueSuffix + path.extname(file.originalname)
    );
  }
});

// File filter (Allow Videos, PDFs, and PPTs)
const fileFilter = (req, file, cb) => {
  const allowedMime = [
    "video/", // All video types
    "application/pdf", // PDFs
    "application/vnd.ms-powerpoint", // .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation" // .pptx
  ];

  const allowedExt = [
    ".pdf", ".ppt", ".pptx", 
    ".mp4", ".mov", ".mkv", ".avi", ".webm"
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  // Check if either the Mime Type matches OR the Extension matches
  if (
    allowedMime.some(type => file.mimetype.startsWith(type)) ||
    allowedExt.includes(ext)
  ) {
    cb(null, true);
  } else {
    console.log("Rejected file:", file.mimetype, file.originalname);
    cb(new Error("File type not supported. Please upload Video, PDF, or PPT files only."), false);
  }
};

// Export multer instance
export const lmsUpload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for videos
  },
  fileFilter,
});