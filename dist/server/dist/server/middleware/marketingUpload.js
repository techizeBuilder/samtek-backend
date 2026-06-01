"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileType = exports.marketingUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ALLOWED_MIMES = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
    'video/mp4': 'MP4',
    'video/quicktime': 'MOV',
};
const storage = multer_1.default.diskStorage({
    destination(req, file, cb) {
        const dir = 'uploads/marketing/';
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'mkt-' + unique + path_1.default.extname(file.originalname));
    },
});
exports.marketingUpload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter(req, file, cb) {
        if (ALLOWED_MIMES[file.mimetype])
            return cb(null, true);
        cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP, MP4, MOV'));
    },
});
const getFileType = (mimetype) => ALLOWED_MIMES[mimetype] || 'PDF';
exports.getFileType = getFileType;
