import RDChildPart from '../models/RDChildPart.js';
import { Item } from '../models/Inventory.js';
import fs from 'fs';
import path from 'path';

// Deletes a Design File upload (Child Part / Sub Child Part's own `image`)
// from disk once its DB reference is gone — deleting a (sub) child part
// previously only removed the database record, leaving the real file
// orphaned in uploads/rd-docs/ forever, and (since Documentation.jsx and
// Design Approval both pull these files in live off the (sub) child part
// record rather than a stored copy) it also silently disappears from both
// of those pages the moment the record is gone — no separate cleanup
// needed there (confirmed 2026-09-03). Fire-and-forget and non-fatal: a
// missing/already-gone file never blocks the actual delete.
function deleteUploadedFile(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const filePath = path.join(process.cwd(), url.replace(/^\/+/, ''));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to delete uploaded design file:', filePath, err.message);
    }
  });
}

const MANUFACTURING_SOURCE_TYPES = ['In House Manufacturing', 'Out Source Manufactured'];

// Shared guard: Child Part Creation (like BOM Creation) only applies to
// manufacturing products — client confirmed this restriction applies
// everywhere, not just BOM Creation.
async function findManufacturingProduct(productId, companyId) {
  const product = await Item.findOne({ _id: productId, companyId, productKind: 'Machine' }).lean();
  if (!product) return null;
  if (!MANUFACTURING_SOURCE_TYPES.includes(product.productSourceType)) return null;
  return product;
}

const pad2 = (n) => String(n).padStart(2, '0');

export const getChildParts = async (req, res) => {
  try {
    const { productId } = req.query;
    if (!productId) return res.status(400).json({ success: false, message: 'productId is required' });
    const childParts = await RDChildPart.find({ company: req.user.companyId, product: productId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: childParts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Hybrid code generation: the frontend's "Generate" button calls this to get
// a suggested next code, but the user can just type their own instead — this
// endpoint never enforces its own output, createChildPart validates whatever
// code actually gets submitted.
export const generateChildPartCode = async (req, res) => {
  try {
    const { productId } = req.query;
    if (!productId) return res.status(400).json({ success: false, message: 'productId is required' });
    const product = await Item.findOne({ _id: productId, companyId: req.user.companyId }).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const count = await RDChildPart.countDocuments({ company: req.user.companyId, product: productId });
    res.json({ success: true, code: `CP-${product.code}-${pad2(count + 1)}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createChildPart = async (req, res) => {
  try {
    const { productId, name, code, image } = req.body;
    if (!productId || !name || !code) {
      return res.status(400).json({ success: false, message: 'productId, name and code are required' });
    }
    if (!image) {
      return res.status(400).json({ success: false, message: 'A Design File (image or PDF) is required.' });
    }
    const product = await findManufacturingProduct(productId, req.user.companyId);
    if (!product) {
      return res.status(400).json({ success: false, message: 'Child Parts can only be created for manufacturing products (In House / Out Source Manufactured).' });
    }
    const existing = await RDChildPart.findOne({ company: req.user.companyId, product: productId, code: code.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: `Child Part code "${code}" already exists for this product.` });
    }
    const childPart = await RDChildPart.create({
      product: productId,
      productCode: product.code,
      name: name.trim(),
      code: code.trim(),
      image: image || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChildPart = async (req, res) => {
  try {
    const { name, image, isDiscontinued } = req.body;
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (image !== undefined) update.image = image;
    if (isDiscontinued !== undefined) update.isDiscontinued = !!isDiscontinued;
    const childPart = await RDChildPart.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { $set: update },
      { new: true }
    );
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });
    res.json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Backs the Child Part Creation tab's "Design File" field, for both Child
// Parts and Sub Child Parts — accepts an image or a PDF (via the shared
// rdDocumentUpload middleware) and just hands back the stored URL; the
// child/sub child part itself is created/updated separately.
export const uploadChildPartFile = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
  res.json({
    success: true,
    url: `/uploads/rd-docs/${req.file.filename}`,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
  });
};

export const deleteChildPart = async (req, res) => {
  try {
    // subChildParts live as subdocuments on the Child Part itself, so
    // deleting the parent document cascades them automatically — their own
    // design files need cleaning up right here too, same as the parent's.
    const childPart = await RDChildPart.findOneAndDelete({ _id: req.params.id, company: req.user.companyId });
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });
    deleteUploadedFile(childPart.image);
    (childPart.subChildParts || []).forEach(sub => deleteUploadedFile(sub.image));
    res.json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const generateSubChildPartCode = async (req, res) => {
  try {
    const childPart = await RDChildPart.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });
    const count = (childPart.subChildParts || []).length;
    res.json({ success: true, code: `SCP-${childPart.code}-${pad2(count + 1)}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addSubChildPart = async (req, res) => {
  try {
    const { name, code, image } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'name and code are required' });
    if (!image) return res.status(400).json({ success: false, message: 'A Design File (image or PDF) is required.' });
    const childPart = await RDChildPart.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });

    const codeTrim = code.trim();
    if (childPart.subChildParts.some(s => s.code === codeTrim)) {
      return res.status(400).json({ success: false, message: `Sub Child Part code "${codeTrim}" already exists under this Child Part.` });
    }
    childPart.subChildParts.push({ name: name.trim(), code: codeTrim, image: image || '' });
    await childPart.save();
    res.status(201).json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateSubChildPart = async (req, res) => {
  try {
    const { name, image, isDiscontinued } = req.body;
    const childPart = await RDChildPart.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });
    const sub = childPart.subChildParts.id(req.params.subId);
    if (!sub) return res.status(404).json({ success: false, message: 'Sub Child Part not found' });
    if (name !== undefined) sub.name = name.trim();
    if (image !== undefined) sub.image = image;
    if (isDiscontinued !== undefined) sub.isDiscontinued = !!isDiscontinued;
    await childPart.save();
    res.json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSubChildPart = async (req, res) => {
  try {
    const childPart = await RDChildPart.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!childPart) return res.status(404).json({ success: false, message: 'Child Part not found' });
    const sub = childPart.subChildParts.id(req.params.subId);
    if (!sub) return res.status(404).json({ success: false, message: 'Sub Child Part not found' });
    const subImage = sub.image;
    childPart.subChildParts.pull({ _id: req.params.subId });
    await childPart.save();
    deleteUploadedFile(subImage);
    res.json({ success: true, data: childPart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
