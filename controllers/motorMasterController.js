// Motor Master's own save routes (22 Nov 2026). Motors are items, saved by the inventory
// controller's createItem / updateItem — but behind Motor Master's permissions (rnd →
// motorMaster → add / edit), the same ones the page's Add Motor button and its bulk import
// use. Before this, the page saved through /api/items, which checks the Inventory
// permission, so someone with only Motor Master "add" saw the button but couldn't save.
// These routes only ever create or change a motor.
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';
import { createItem, updateItem } from './inventoryController.js';

const MOTOR = { type: 'Product', productKind: 'Motor', category: 'Motor', subCategory: 'Motor' };

// POST /api/rd/motors — a new motor (always a motor, whatever the body says).
export const createMotor = (req, res) => {
  req.body = { ...(req.body || {}), ...MOTOR };
  req.permissionChecked = true; // the route checked rnd → motorMaster → add
  return createItem(req, res);
};

// PUT /api/rd/motors/:id — a motor of this company; it stays a motor.
export const updateMotor = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const isMotor = mongoose.isValidObjectId(req.params.id) && await Item.exists({
      _id: req.params.id, productKind: 'Motor', $or: [{ companyId }, { store: String(companyId) }],
    });
    if (!isMotor) return res.status(404).json({ success: false, message: 'Motor not found.' });
    const body = { ...(req.body || {}) };
    for (const k of ['type', 'productKind']) delete body[k];
    req.body = body;
    req.permissionChecked = true; // the route checked rnd → motorMaster → edit
    return updateItem(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
