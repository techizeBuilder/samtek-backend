import RDBOMFieldConfig, { BOM_FIELD_CATALOG } from '../models/RDBOMFieldConfig.js';

export const getBOMFieldConfig = async (req, res) => {
  try {
    const config = await RDBOMFieldConfig.findOne({ company: req.user.companyId }).lean();
    res.json({
      success: true,
      data: {
        catalog: BOM_FIELD_CATALOG,
        enabledFields: config?.enabledFields || ['code', 'name', 'itemType', 'unit'],
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
    // A key can be "unknown" here for exactly one legitimate reason: an
    // older saved selection referenced a field BOM_FIELD_CATALOG has since
    // dropped (e.g. removed from Inventory's own form) — the picker UI never
    // offers those as checkboxes, so a well-behaved client can't actually
    // construct a request with a genuinely new/bogus key. Silently drop
    // anything not in the catalog rather than rejecting the whole save.
    const filteredFields = enabledFields.filter(k => validKeys.has(k));
    const config = await RDBOMFieldConfig.findOneAndUpdate(
      { company: req.user.companyId },
      { $set: { enabledFields: filteredFields, updatedBy: req.user._id } },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: { catalog: BOM_FIELD_CATALOG, enabledFields: config.enabledFields } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
