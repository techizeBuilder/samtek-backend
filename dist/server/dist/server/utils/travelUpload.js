"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.travelUpload = void 0;
/** @format */
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Configure storage for Travel Receipts/Documents
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = "uploads/travel/";
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "travel-" + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
// Create the multer instance
exports.travelUpload = (0, multer_1.default)({
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
        }
        else {
            cb(new Error("Only images (JPEG, PNG) and PDFs are allowed for travel documents!"), false);
        }
    },
});
