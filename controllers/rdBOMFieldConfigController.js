import RDBOMFieldConfig, { BOM_FIELD_CATALOG } from '../models/RDBOMFieldConfig.js';

export const getBOMFieldConfig = async (req, res) => {
  try {
    const config = await RDBOMFieldConfig.findOne({ company: req.user.companyId }).lean();
    res.json({
      success: true,
      data: {
        catalog: BOM_FIELD_CATALOG,
        enabledFields: config?.enabledFields || ['code', 'name', 'category', 'unit', 'purchaseCost'],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const saveBOMFieldConfig = async (req, res) => {
  try {
    const { enabledFields } = req.body;
    if (!Array.isArray(enabledFields)) {
      return res.status(400).json({ success: false, message: 'enabledFields must be an array' });
    }
    const validKeys = new Set(BOM_FIELD_CATALOG.map(f => f.key));
    const invalid = enabledFields.filter(k => !validKeys.has(k));
    if (invalid.length) {
      return res.status(400).json({ success: false, message: `Unknown field key(s): ${invalid.join(', ')}` });
    }
    const config = await RDBOMFieldConfig.findOneAndUpdate(
      { company: req.user.companyId },
      { $set: { enabledFields, updatedBy: req.user._id } },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: { catalog: BOM_FIELD_CATALOG, enabledFields: config.enabledFields } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
