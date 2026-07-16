import mongoose from 'mongoose';

const RDCustomFieldTemplateSchema = new mongoose.Schema({
  // The exact classification combo this template applies to
  pType: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  pSourceType: { type: String, required: true, trim: true },

  // Parent label -> sub-field names
  groups: [{
    label: { type: String, required: true, trim: true },
    fields: [{
      name: { type: String, required: true, trim: true }
    }]
  }],

  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDCustomFieldTemplateSchema.index(
  { company: 1, pType: 1, category: 1, pSourceType: 1 },
  { unique: true }
);

export default mongoose.model('RDCustomFieldTemplate', RDCustomFieldTemplateSchema);
