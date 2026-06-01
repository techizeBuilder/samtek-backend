"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lmsUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Storage config
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = "uploads/lms_media/"; // Dedicated folder for training content
        // Create folder if not exists
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "module-" + uniqueSuffix + path_1.default.extname(file.originalname));
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
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    // Check if either the Mime Type matches OR the Extension matches
    if (allowedMime.some(type => file.mimetype.startsWith(type)) ||
        allowedExt.includes(ext)) {
        cb(null, true);
    }
    else {
        console.log("Rejected file:", file.mimetype, file.originalname);
        cb(new Error("File type not supported. Please upload Video, PDF, or PPT files only."), false);
    }
};
// Export multer instance
exports.lmsUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit for videos
    },
    fileFilter,
});
