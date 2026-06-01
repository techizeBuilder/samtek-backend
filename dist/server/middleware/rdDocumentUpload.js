"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rdDocumentUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ALLOWED_MIMES = {
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/vnd.ms-excel': true,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
    'image/jpeg': true,
    'image/png': true,
    'application/zip': true,
    'application/x-zip-compressed': true,
    'application/octet-stream': true, // .dwg files
};
const storage = multer_1.default.diskStorage({
    destination(req, file, cb) {
        const dir = 'uploads/rd-docs/';
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'rd-' + unique + path_1.default.extname(file.originalname));
    },
});
exports.rdDocumentUpload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    fileFilter(req, file, cb) {
        if (ALLOWED_MIMES[file.mimetype])
            return cb(null, true);
        // Also allow by extension for .dwg files which have inconsistent MIME
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (['.dwg', '.dxf', '.step', '.stp', '.iges', '.igs'].includes(ext))
            return cb(null, true);
        cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP, DWG'));
    },
});
