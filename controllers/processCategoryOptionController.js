// Master catalog controller for the Category -> Internal Process picker used
// by all three BOM Management tabs (see ProcessCategoryOption.js). Mirrors
// inventoryController.js's own getInventoryDropdownOptions/
// addInventoryDropdownOption/updateInventoryDropdownOption/
// deleteInventoryDropdownOption pattern — including the delete-guard and
// rename-cascade — adapted for this catalog's extra bomLevel scoping and
// its two-tier (category -> internal process) shape.
import ProcessCategoryOption from '../models/ProcessCategoryOption.js';
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';

const BOM_LEVELS = ['SubChildPart', 'ChildPart', 'Machine'];

// Where a bomLevel's actual processDefinition data lives, and which company
// field that model uses — Item uses companyId, ChildPartBOM/MachineBOM use
// company (confirmed by direct inspection of both models, not assumed).
// Used by the rename-cascade / delete-guard below so renaming or removing a
// catalog entry can't silently orphan BOM data that already references it.
const BOM_LEVEL_SOURCES = {
  SubChildPart: { Model: Item, path: 'subChildPartDetails.processDefinition', extraMatch: { productKind: 'SubChildPart' }, companyField: 'companyId' },
  ChildPart: { Model: ChildPartBOM, path: 'processDefinition', extraMatch: {}, companyField: 'company' },
  Machine: { Model: MachineBOM, path: 'processDefinition', extraMatch: {}, companyField: 'company' },
};

// GET /api/rd/process-category-options?bomLevel=X
export const getProcessCategoryOptions = async (req, res) => {
  try {
    const { bomLevel } = req.query;
    if (!BOM_LEVELS.includes(bomLevel)) return res.status(400).json({ success: false, message: 'Invalid bomLevel.' });
    const options = await ProcessCategoryOption.find({ companyId: req.user.companyId, bomLevel }).sort({ label: 1 }).lean();
    res.json({ success: true, data: options });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/process-category-options — { bomLevel, label }
export const addProcessCategoryOption = async (req, res) => {
  try {
    const { bomLevel, label } = req.body;
    if (!BOM_LEVELS.includes(bomLevel)) return res.status(400).json({ success: false, message: 'Invalid bomLevel.' });
    if (!label || !label.trim()) return res.status(400).json({ success: false, message: 'Category label cannot be empty.' });
    const option = await ProcessCategoryOption.create({ companyId: req.user.companyId, bomLevel, label: label.trim(), internalProcesses: [] });
    res.status(201).json({ success: true, data: option });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This category already exists for this BOM level.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/process-category-options/:id — { label } — renames the
// category and cascades the rename into every BOM at this level that
// already references it.
export const updateProcessCategoryOption = async (req, res) => {
  try {
    const { label } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ success: false, message: 'Category label cannot be empty.' });
    const newLabel = label.trim();
    const companyId = req.user.companyId;

    const option = await ProcessCategoryOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Category not found.' });

    const oldLabel = option.label;
    if (oldLabel === newLabel) return res.json({ success: true, data: option });

    const duplicate = await ProcessCategoryOption.findOne({ _id: { $ne: option._id }, companyId, bomLevel: option.bomLevel, label: newLabel });
    if (duplicate) return res.status(400).json({ success: false, message: 'This category already exists for this BOM level.' });

    option.label = newLabel;
    await option.save();

    const src = BOM_LEVEL_SOURCES[option.bomLevel];
    await src.Model.updateMany(
      { [src.companyField]: companyId, ...src.extraMatch, [`${src.path}.label`]: oldLabel },
      { $set: { [`${src.path}.$[cat].label`]: newLabel } },
      { arrayFilters: [{ 'cat.label': oldLabel }] }
    );

    res.json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/process-category-options/:id — blocked while any BOM at
// this level still has this category in its own processDefinition.
export const deleteProcessCategoryOption = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const option = await ProcessCategoryOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Category not found.' });

    const src = BOM_LEVEL_SOURCES[option.bomLevel];
    const usageCount = await src.Model.countDocuments({
      [src.companyField]: companyId, ...src.extraMatch,
      [src.path]: { $elemMatch: { label: option.label } },
    });
    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${option.label}" — still used by ${usageCount} BOM${usageCount > 1 ? 's' : ''}. Remove it from those first.`,
        usageCount,
      });
    }

    await option.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/process-category-options/:id/internal-processes — { name }
export const addInternalProcessOption = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Internal process name cannot be empty.' });
    const trimmed = name.trim();

    const option = await ProcessCategoryOption.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Category not found.' });

    if (option.internalProcesses.some(p => p === trimmed)) {
      return res.status(400).json({ success: false, message: 'This internal process already exists under this category.' });
    }
    option.internalProcesses.push(trimmed);
    await option.save();
    res.status(201).json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/rd/process-category-options/:id/internal-processes/rename —
// { oldName, newName } — renames one internal process under this category
// and cascades into every BOM at this level that already references it
// (scoped to this category's own label, so a same-named process under a
// different category is left alone).
export const renameInternalProcessOption = async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!newName || !newName.trim()) return res.status(400).json({ success: false, message: 'Internal process name cannot be empty.' });
    const trimmedNew = newName.trim();
    const companyId = req.user.companyId;

    const option = await ProcessCategoryOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Category not found.' });
    if (!option.internalProcesses.includes(oldName)) return res.status(404).json({ success: false, message: 'Internal process not found.' });
    if (oldName === trimmedNew) return res.json({ success: true, data: option });
    if (option.internalProcesses.includes(trimmedNew)) {
      return res.status(400).json({ success: false, message: 'This internal process already exists under this category.' });
    }

    option.internalProcesses = option.internalProcesses.map(p => (p === oldName ? trimmedNew : p));
    await option.save();

    const src = BOM_LEVEL_SOURCES[option.bomLevel];
    await src.Model.updateMany(
      {
        [src.companyField]: companyId, ...src.extraMatch,
        [`${src.path}.label`]: option.label, [`${src.path}.internalProcesses.name`]: oldName,
      },
      { $set: { [`${src.path}.$[cat].internalProcesses.$[proc].name`]: trimmedNew } },
      { arrayFilters: [{ 'cat.label': option.label }, { 'proc.name': oldName }] }
    );

    res.json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/process-category-options/:id/internal-processes/:name —
// blocked while any BOM at this level still has this internal process
// (under this category) in its own processDefinition.
export const deleteInternalProcessOption = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const name = decodeURIComponent(req.params.name);
    const option = await ProcessCategoryOption.findOne({ _id: req.params.id, companyId });
    if (!option) return res.status(404).json({ success: false, message: 'Category not found.' });
    if (!option.internalProcesses.includes(name)) return res.status(404).json({ success: false, message: 'Internal process not found.' });

    const src = BOM_LEVEL_SOURCES[option.bomLevel];
    const usageCount = await src.Model.countDocuments({
      [src.companyField]: companyId, ...src.extraMatch,
      [src.path]: { $elemMatch: { label: option.label, internalProcesses: { $elemMatch: { name } } } },
    });
    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${name}" — still used by ${usageCount} BOM${usageCount > 1 ? 's' : ''}. Remove it from those first.`,
        usageCount,
      });
    }

    option.internalProcesses = option.internalProcesses.filter(p => p !== name);
    await option.save();
    res.json({ success: true, data: option });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
