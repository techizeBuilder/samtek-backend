import mongoose from 'mongoose';

// Feature 25, slice 2: the limits that size a task from its planned effort (decision F) and cap a
// long task's steps (decision G). One per company; defaults when missing.
const KraTaskSettingsSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  shortMaxHours: { type: Number, default: 4 }, // up to this = short
  mediumMaxDays: { type: Number, default: 5 }, // up to this many working days = medium; more = long
  hoursPerDay: { type: Number, default: 8 }, // a working day's hours
  stepMaxDays: { type: Number, default: 2 }, // a long task's step: at most this many working days
  // Slice 4: No delay counts a task on time up to its due date + this grace, by size.
  graceShortMinutes: { type: Number, default: 30 },
  graceMediumHours: { type: Number, default: 2 },
  graceLongDays: { type: Number, default: 1 },
  savedByName: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.KraTaskSettings || mongoose.model('KraTaskSettings', KraTaskSettingsSchema);
