"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hrPolicyUpload = void 0;
/** @format */
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Configure storage for HR Policies
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = "uploads/policies/";
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "policy-" + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
// Create the multer instance
exports.hrPolicyUpload = (0, multer_1.default)({
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
        }
        else {
            cb(new Error("Only PDF, Word, and Image files are allowed for policies!"), false);
        }
    },
});
