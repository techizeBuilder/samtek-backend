"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Configure multer for item file uploads (images and brochures)
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = 'uploads/items/';
        if (file.fieldname === 'brochure') {
            uploadPath = 'uploads/items/brochures/';
        }
        else if (file.fieldname === 'image') {
            uploadPath = 'uploads/items/images/';
        }
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const prefix = file.fieldname === 'brochure' ? 'brochure-' : 'product-';
        cb(null, prefix + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
exports.itemUpload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.fieldname === 'image') {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            }
            else {
                cb(new Error('Only image files are allowed for product photo!'), false);
            }
        }
        else if (file.fieldname === 'brochure') {
            if (file.mimetype === 'application/pdf') {
                cb(null, true);
            }
            else {
                cb(new Error('Only PDF files are allowed for brochure!'), false);
            }
        }
        else {
            cb(null, true);
        }
    }
});
