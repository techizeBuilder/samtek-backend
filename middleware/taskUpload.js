import multer from "multer";
import path from "path";
import fs from "fs";

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "uploads/tasks/";

    // Create folder if not exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const uniqueSuffix =
      Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(
      null,
      "task-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// File filter (allow docs + images)
const fileFilter = (req, file, cb) => {
  const allowedMime = [
    "image/",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain"
  ];

  const allowedExt = [
    ".jpg", ".jpeg", ".png",
    ".pdf",
    ".doc", ".docx",
    ".txt"
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  if (
    allowedMime.some(type => file.mimetype.startsWith(type)) ||
    allowedExt.includes(ext)
  ) {
    cb(null, true);
  } else {
    console.log("Rejected file:", file.mimetype, file.originalname);
    cb(new Error("File type not supported"), false);
  }
};

// Export multer instance
export const taskUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter,
});