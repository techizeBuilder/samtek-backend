"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Storage config
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = "uploads/tasks/";
        // Create folder if not exists
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "task-" + uniqueSuffix + path_1.default.extname(file.originalname));
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
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (allowedMime.some(type => file.mimetype.startsWith(type)) ||
        allowedExt.includes(ext)) {
        cb(null, true);
    }
    else {
        console.log("Rejected file:", file.mimetype, file.originalname);
        cb(new Error("File type not supported"), false);
    }
};
// Export multer instance
exports.taskUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter,
});
