import mongoose from 'mongoose';

// Reusable, R&D-maintained catalog of Category -> Internal Process names
// that BOM authors pick from when building a Process Definition (see
// ProcessDefinitionSchema.js and server/docs/process-inhouse-outsource-
// redesign-discussion-2026-09.md). Scoped per bomLevel since the same label
// (e.g. "Fabrication") can mean different things — or simply not apply — at
// Sub Child Part vs. Child Part vs. Machine level.
//
// Deliberately a new, separate model rather than extending
// InventoryMasterOption — that catalog is flat {field,value} with no
// hierarchy, and its existing 'JobWorkType' field is a different concept
// (Item's own itemType classification for purchased job-work items), not
// this BOM Management-specific structure.
const ProcessCategoryOptionSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  bomLevel: { type: String, enum: ['SubChildPart', 'ChildPart', 'Machine'], required: true },
  label: { type: String, required: true, trim: true },
  internalProcesses: { type: [String], default: [] },
}, { timestamps: true });

ProcessCategoryOptionSchema.index({ companyId: 1, bomLevel: 1, label: 1 }, { unique: true });

export default mongoose.model('ProcessCategoryOption', ProcessCategoryOptionSchema);
