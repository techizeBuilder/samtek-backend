import mongoose from 'mongoose';

const ParameterSchema = new mongoose.Schema({
  parameter: { type: String, required: true, trim: true },
  tolerance: { type: String, default: '' },
  performanceStandard: { type: String, default: '' },
});

const QCItemSchema = new mongoose.Schema({
  item: { type: String, required: true, trim: true },
  checked: { type: Boolean, default: false },
});

const RDQualityParamSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  machineName: { type: String, required: true },
  parameters: { type: [ParameterSchema], default: [] },
  qcChecklist: { type: [QCItemSchema], default: [] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDQualityParamSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('RDQualityParam', RDQualityParamSchema);
