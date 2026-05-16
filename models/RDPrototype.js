import mongoose from 'mongoose';

const TEST_RESULT = ['Pass', 'Fail', 'Pending', 'In Progress'];

const RDPrototypeSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  machineName: { type: String, required: true },
  machineCode: { type: String, required: true },
  prototypeName: { type: String, required: true, trim: true },
  performanceTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
  outputTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
  durabilityTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
  status: { type: String, enum: ['In Progress', 'Passed', 'Failed'], default: 'In Progress' },
  testNotes: { type: String, default: '' },
  passedDate: { type: String, default: null },
  testedBy: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDPrototypeSchema.index({ company: 1, machine: 1 });
RDPrototypeSchema.index({ company: 1, status: 1 });

export default mongoose.model('RDPrototype', RDPrototypeSchema);
