import multer from "multer";
import path from "path";
import fs from "fs";

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/services/"; // Changed path for service module

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
      "service-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// File filter (Allow Images + Videos)
const fileFilter = (req, file, cb) => {
  const allowedMime = [
    "image/",
    "video/" // NEW: Allowing videos
  ];

  const allowedExt = [
    ".jpg", ".jpeg", ".png", 
    ".mp4", ".mov", ".mkv", ".avi", ".webm" // NEW: Video extensions
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  if (
    allowedMime.some(type => file.mimetype.startsWith(type)) ||
    allowedExt.includes(ext)
  ) {
    cb(null, true);
  } else {
    console.log("Rejected file:", file.mimetype, file.originalname);
    cb(new Error("File type not supported. Please upload images or videos."), false);
  }
};

// Export multer instance
export const serviceUpload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // BUMPED TO 100MB: Videos can be heavy!
  },
  fileFilter,
});