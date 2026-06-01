"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Storage config
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = "uploads/services/"; // Changed path for service module
        // Create folder if not exists
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "service-" + uniqueSuffix + path_1.default.extname(file.originalname));
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
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (allowedMime.some(type => file.mimetype.startsWith(type)) ||
        allowedExt.includes(ext)) {
        cb(null, true);
    }
    else {
        console.log("Rejected file:", file.mimetype, file.originalname);
        cb(new Error("File type not supported. Please upload images or videos."), false);
    }
};
// Export multer instance
exports.serviceUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // BUMPED TO 100MB: Videos can be heavy!
    },
    fileFilter,
});
