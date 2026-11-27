import mongoose from 'mongoose';

// Feature 25, slice 2 (client, 23 Nov 2026): a task, always under one of the person's KRA items.
// docs/client-features-2026-11/25-kra-tasks-logic.md. One person per task (several people =
// one task each, sharing a batchId). Size comes from the planned effort; long work is split
// into steps of at most 2 working days. Reviews: Accepted with a rating, or Rework (Minor /
// Major). The due date only moves through dueChanges (the giver, with a reason).
const StepSchema = new mongoose.Schema({
  stepId: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  effortHours: { type: Number, required: true },
  dueAt: { type: Date, required: true },
  done: { type: Boolean, default: false },
  doneAt: { type: Date, default: null },
  doneByName: { type: String, default: '' },
}, { _id: false });

const FileSchema = new mongoose.Schema({ file: String, name: String, at: Date, byName: String }, { _id: false });

const KraTaskSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  personName: { type: String, default: '' },
  department: { _id: { type: mongoose.Schema.Types.ObjectId, default: null }, name: { type: String, default: '' } },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = made by the system (a routine item)
  assignedByName: { type: String, default: '' },
  batchId: { type: mongoose.Schema.Types.ObjectId, default: null },
  kra: {
    setId: { type: mongoose.Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
  },
  type: { type: String, enum: ['oneTime', 'surprise', 'routine'], required: true },
  surpriseReason: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' }, // planning only
  effortHours: { type: Number, required: true },
  size: { type: String, enum: ['short', 'medium', 'long'], required: true },
  startDate: { type: Date, default: null },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['Assigned', 'InProgress', 'Submitted', 'Rework', 'Accepted', 'Cancelled', 'Missed'], default: 'Assigned' }, // Missed: a routine item not done by its day's end
  givenDay: { type: String, default: '' }, // 'YYYY-MM-DD' India: no daily update is due on this day
  // Slice 3: a routine item made from a KRA duty HR tracks (one per person, duty and day).
  routine: { dutyId: { type: mongoose.Schema.Types.ObjectId, default: null }, day: { type: String, default: null }, needsFile: { type: Boolean, default: false }, redoBy: { type: String, default: null } }, // redoBy: a sent-back item is ticked again by this day
  doneAt: { type: Date, default: null }, // routine: ticked done (late when after dueAt)
  firstDoneAt: { type: Date, default: null }, // routine: the first tick (No delay counts this one)
  doneFile: { type: FileSchema, default: null },
  // Slice 3: daily updates (medium / long work; not scored) and blockers (the clock does not stop).
  updates: { type: [{ _id: false, day: String, at: Date, text: String, percent: { type: Number, default: null }, byName: String }], default: [] },
  lastUpdateDay: { type: String, default: '' },
  lastPercent: { type: Number, default: null }, // the latest % written (a task without steps)
  blocker: { open: { type: Boolean, default: false }, reason: { type: String, default: '' }, at: { type: Date, default: null }, byName: { type: String, default: '' } },
  blockers: { type: [{ _id: false, reason: String, at: Date, byName: String, clearedAt: Date, clearedByName: String, clearNote: String }], default: [] },
  steps: { type: [StepSchema], default: [] },
  dueChanges: { type: [{ _id: false, from: Date, to: Date, reason: String, byName: String, at: Date }], default: [] },
  reviews: { type: [{ _id: false, at: Date, byName: String, decision: String, rating: String, severity: String, note: String }], default: [] },
  startedAt: { type: Date, default: null },
  firstSubmittedAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  acceptedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: '' },
  brief: { type: FileSchema, default: null },
  submissions: { type: [{ _id: false, at: Date, note: String, file: FileSchema }], default: [] },
  comments: { type: [{ _id: false, at: Date, byName: String, by: mongoose.Schema.Types.ObjectId, text: String }], default: [] },
  activity: { type: [{ _id: false, at: Date, byName: String, text: String }], default: [] },
}, { timestamps: true });

KraTaskSchema.index({ company: 1, person: 1, status: 1, dueAt: 1 });
KraTaskSchema.index({ company: 1, assignedBy: 1, status: 1, dueAt: 1 });
KraTaskSchema.index({ company: 1, 'department._id': 1, status: 1, dueAt: 1 });
KraTaskSchema.index({ company: 1, status: 1, dueAt: 1 });
KraTaskSchema.index({ company: 1, createdAt: -1 });
KraTaskSchema.index({ company: 1, person: 1, acceptedAt: 1 }); // slice 4: tasks accepted in a period
KraTaskSchema.index({ company: 1, person: 1, 'routine.dutyId': 1, 'routine.day': 1 }, { unique: true, partialFilterExpression: { type: 'routine' } });
KraTaskSchema.index({ company: 1, type: 1, 'routine.day': 1, status: 1 });

export default mongoose.models.KraTask || mongoose.model('KraTask', KraTaskSchema);
