/** @format */
import UserDocument from "../models/UserDocument.js";
import User from "../models/User.js";
import path from "path";
import fs from "fs";
import { documentAccess } from "../services/documentAccessService.js";

// Private documents (2026-11-06). Runs before a file is saved, so a refused upload
// leaves nothing on disk. action: "view" or "upload".
const refuseOr = (req, res, next, target, action) => {
  const access = documentAccess(req.user, target);
  if (!(action === "view" ? access.canView : access.canUpload)) {
    return res.status(403).json({ message: "Access denied" });
  }
  req.docAccess = access;
  return next();
};

export const guardUserDocuments = (action) => async (req, res, next) => {
  try {
    const target = await User.findById(req.params.userId).select("companyId reportingManager").lean();
    if (!target) return res.status(404).json({ message: "User not found" });
    return refuseOr(req, res, next, target, action);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const guardDocument = (action) => async (req, res, next) => {
  try {
    const doc = await UserDocument.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: "Document not found" });
    const target = await User.findById(doc.userId).select("companyId reportingManager").lean();
    if (!target) return res.status(404).json({ message: "Document not found" });
    req.doc = doc;
    // A Verified document is locked for its owner. Refused here, before the file is
    // saved, or the refused file would stay on disk.
    const access = documentAccess(req.user, target);
    if (action === "upload" && access.canUpload && !access.actsAsHr && doc.status === "VERIFIED") {
      return res.status(403).json({ message: "This document is already verified and cannot be re-uploaded" });
    }
    return refuseOr(req, res, next, target, action);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    The file itself, for someone allowed to view it
// @route   GET /api/documents/file/:docId
export const getDocumentFile = async (req, res) => {
  try {
    const { fileUrl } = req.doc;
    if (/^https?:\/\//i.test(fileUrl)) return res.redirect(fileUrl);
    const root = path.resolve(process.cwd(), "uploads");
    const file = path.resolve(process.cwd(), fileUrl.replace(/\\/g, "/"));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      return res.status(404).json({ message: "File not found" });
    }
    return res.sendFile(file);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Legacy field-name → type mapping, kept only as a fallback for any client
// still using the old fixed-field-name upload form. New uploads should send
// the document's `type` (key from AdminSettings.hrmsDocumentTypes) explicitly
// in the request body instead, since the document type list is now
// admin-configurable rather than a fixed set of form fields.
const getDocTypeFromField = (field) => {
  switch (field) {
    case "aadhaar": return "AADHAAR";
    case "pan": return "PAN";
    case "marksheet10": return "MARKSHEET_12";
    case "passbook": return "PASSBOOK";
    default: return null;
  }
};

// multer `.any()` populates req.files (array), not req.file (singular) —
// resolve whichever the request actually has.
const resolveUploadedFile = (req) => req.file || (req.files && req.files[0]);

// @desc    Upload a new document
// @route   POST /api/documents/upload/:userId
export const uploadDocument = async (req, res) => {
  try {
    const { userId } = req.params;

    const file = resolveUploadedFile(req);

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const type = req.body.type || getDocTypeFromField(file.fieldname);
    if (!type) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const targetUser = await User.findById(userId).select('companyId');
    const fileUrl = `uploads/documents/${file.filename}`;

    // HR uploading for someone else has seen the original: Verified at once.
    const byHr = !!req.docAccess?.actsAsHr;
    const newDoc = new UserDocument({
      userId,
      companyId: targetUser?.companyId || null,
      type,
      fileUrl,
      status: byHr ? "VERIFIED" : "UPLOADED",
      ...(byHr ? { verifiedBy: req.user._id, verifiedAt: new Date() } : {}),
    });

    await newDoc.save();

    res.status(201).json({
      message: "Document uploaded successfully",
      document: newDoc
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Update (re-upload) an existing document
// @route   PUT /api/documents/update/:docId
export const updateDocument = async (req, res) => {
  try {
    const { docId } = req.params;

    const file = resolveUploadedFile(req);
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const existingDoc = await UserDocument.findById(docId);
    if (!existingDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Once HR has verified a document, the employee can no longer replace it —
    // matches the requirement that a verified document is locked. HR still can.
    const byHr = !!req.docAccess?.actsAsHr;
    if (existingDoc.status === "VERIFIED" && !byHr) {
      return res.status(403).json({ message: "This document is already verified and cannot be re-uploaded" });
    }

    // Delete old file
    const oldFilePath = path.join(process.cwd(), existingDoc.fileUrl);
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    existingDoc.fileUrl = `uploads/documents/${file.filename}`;
    existingDoc.status = byHr ? "VERIFIED" : "UPLOADED"; // Reset status to uploaded if it was rejected
    existingDoc.verifiedBy = byHr ? req.user._id : null;
    existingDoc.verifiedAt = byHr ? new Date() : null;
    existingDoc.remarks = '';

    await existingDoc.save();

    res.status(200).json({
      message: "Document updated successfully",
      document: existingDoc
    });
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Get all documents for a specific user
// @route   GET /api/documents/user/:userId
export const getUserDocuments = async (req, res) => {
  try {
    const { userId } = req.params;
    const documents = await UserDocument.find({ userId });
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching user documents:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Get all documents for HR-Admin's company (Document Verification list)
// @route   GET /api/documents/all
export const getAllDocuments = async (req, res) => {
  try {
    const query = {};
    // Scope to the caller's own company unless they're a platform-wide admin.
    // Scoped via the employee's own companyId rather than UserDocument.companyId
    // directly — documents uploaded before that field existed have no value
    // there, so filtering on it alone would silently hide them.
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role) && req.user.companyId) {
      const companyUsers = await User.find({ companyId: req.user.companyId }).select('_id').lean();
      query.userId = { $in: companyUsers.map(u => u._id) };
    }
    const documents = await UserDocument.find(query).populate("userId", "name fullName employeeId email role");
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching all documents:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Verify or reject an employee's uploaded document
// @route   PATCH /api/documents/:docId/status
export const setDocumentStatus = async (req, res) => {
  try {
    const { docId } = req.params;
    const { status, remarks } = req.body;

    if (!["VERIFIED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Status must be VERIFIED or REJECTED" });
    }

    const doc = await UserDocument.findById(docId);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Restrict to the caller's own company (unless platform-wide admin).
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role)
      && doc.companyId && req.user.companyId
      && doc.companyId.toString() !== req.user.companyId.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    doc.status = status;
    doc.verifiedBy = req.user._id || req.user.id;
    doc.verifiedAt = new Date();
    doc.remarks = remarks || '';
    await doc.save();

    res.status(200).json({
      message: `Document ${status === 'VERIFIED' ? 'verified' : 'rejected'} successfully`,
      document: doc
    });
  } catch (error) {
    console.error("Error setting document status:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
