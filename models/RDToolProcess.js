import mongoose from 'mongoose';

const ToolSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  specification: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 0 },
  unit: { type: String, default: 'pcs' },
  isDiscontinued: { type: Boolean, default: false },
});

const ProcessSchema = new mongoose.Schema({
  step: { type: Number, required: true },
  type: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  duration: { type: String, default: '' },
  tool: { type: String, default: '' },
});

const RDToolProcessSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  tools: { type: [ToolSchema], default: [] },
  processes: { type: [ProcessSchema], default: [] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDToolProcessSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('RDToolProcess', RDToolProcessSchema);
