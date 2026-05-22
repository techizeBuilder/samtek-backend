import mongoose from 'mongoose';

const MaterialSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  grade: { type: String, default: '' },
  specification: { type: String, default: '' },
  isDiscontinued: { type: Boolean, default: false },
});

const RDBOMSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  version: { type: String, default: 'v1.0' },
  isLocked: { type: Boolean, default: false },
  lockedAt: { type: String, default: null },
  materials: { type: [MaterialSchema], default: [] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDBOMSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('RDBOM', RDBOMSchema);
