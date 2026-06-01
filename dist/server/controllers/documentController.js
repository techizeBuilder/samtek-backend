"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllDocuments = exports.getUserDocuments = exports.updateDocument = exports.uploadDocument = void 0;
/** @format */
const UserDocument_js_1 = __importDefault(require("../models/UserDocument.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Helper to get document type from field name
const getDocTypeFromField = (field) => {
    switch (field) {
        case "aadhaar": return "AADHAAR";
        case "pan": return "PAN";
        case "marksheet10": return "MARKSHEET_12";
        case "passbook": return "PASSBOOK";
        default: return null;
    }
};
// @desc    Upload a new document
// @route   POST /api/documents/upload/:userId
const uploadDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const file = req.file || (req.files && req.files[0]);
        if (!file) {
            return res.status(400).json({ message: "No file uploaded" });
        }
        const type = getDocTypeFromField(file.fieldname);
        if (!type) {
            return res.status(400).json({ message: "Invalid document field" });
        }
        const fileUrl = `uploads/documents/${file.filename}`;
        const newDoc = new UserDocument_js_1.default({
            userId,
            type,
            fileUrl,
            status: "UPLOADED"
        });
        yield newDoc.save();
        res.status(201).json({
            message: "Document uploaded successfully",
            document: newDoc
        });
    }
    catch (error) {
        console.error("Error uploading document:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.uploadDocument = uploadDocument;
// @desc    Update an existing document
// @route   PUT /api/documents/update/:docId
const updateDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { docId } = req.params;
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }
        const existingDoc = yield UserDocument_js_1.default.findById(docId);
        if (!existingDoc) {
            return res.status(404).json({ message: "Document not found" });
        }
        // Delete old file
        const oldFilePath = path_1.default.join(process.cwd(), existingDoc.fileUrl);
        if (fs_1.default.existsSync(oldFilePath)) {
            fs_1.default.unlinkSync(oldFilePath);
        }
        existingDoc.fileUrl = `uploads/documents/${req.file.filename}`;
        existingDoc.status = "UPLOADED"; // Reset status to uploaded if it was verified/rejected
        yield existingDoc.save();
        res.status(200).json({
            message: "Document updated successfully",
            document: existingDoc
        });
    }
    catch (error) {
        console.error("Error updating document:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.updateDocument = updateDocument;
// @desc    Get all documents for a specific user
// @route   GET /api/documents/user/:userId
const getUserDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const documents = yield UserDocument_js_1.default.find({ userId });
        res.status(200).json(documents);
    }
    catch (error) {
        console.error("Error fetching user documents:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getUserDocuments = getUserDocuments;
// @desc    Get all documents (for Admin/SuperAdmin)
// @route   GET /api/documents/all
const getAllDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const documents = yield UserDocument_js_1.default.find().populate("userId", "name fullName employeeId email");
        res.status(200).json(documents);
    }
    catch (error) {
        console.error("Error fetching all documents:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAllDocuments = getAllDocuments;
