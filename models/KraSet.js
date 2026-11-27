import mongoose from 'mongoose';

// Feature 25 (client, 23 Nov 2026): KRAs (Key Result Areas). docs/client-features-2026-11/25-kra-tasks-logic.md
// A role's KRA set, or one person's own set, versioned: every save is a new version applying
// from a date (never earlier than today), so a task keeps the KRA it was given under and a past
// month never changes. A person's KRA on a date = their latest own version in force (unless it
// says "follows the role"), else their role's latest version in force.
// Item and routine-duty ids stay the same across versions (and from a role's set into a
// person's own copy), so tasks link to them for good.
const RoutineDutySchema = new mongoose.Schema({
  dutyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true }, // daily = working days
  weekday: { type: Number, default: null }, // weekly: 0 Sunday … 6 Saturday
  monthDay: { type: Number, default: null }, // monthly: 1–31 (a short month uses its last day)
  dueTime: { type: String, default: '18:00' }, // 'HH:mm', India time
  // HR's switch (23 Nov): on = the system creates this duty's item in My tasks and it's scored;
  // off = it's only written on the KRA as part of the job.
  track: { type: Boolean, default: false },
  needsFile: { type: Boolean, default: false },
}, { _id: false });

const KraItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  kpi: { type: String, default: '' }, // what good looks like, in words (decision B)
  weight: { type: Number, required: true }, // whole %, the items add up to 100
  builtIn: { type: String, enum: [null, 'stepWork'], default: null }, // decision E: measured from Process Execution
  endsOn: { type: String, default: null }, // a temporary item: 'YYYY-MM-DD', India
  routine: { type: [RoutineDutySchema], default: [] },
}, { _id: false });

const KraSetSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  scope: { type: String, enum: ['role', 'person'], required: true },
  role: { type: String, default: null }, // scope 'role'
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // scope 'person'
  version: { type: Number, required: true },
  effectiveFrom: { type: String, required: true }, // 'YYYY-MM-DD', India
  followsRole: { type: Boolean, default: false }, // a person's version meaning "back to the role's set"
  items: { type: [KraItemSchema], default: [] },
  note: { type: String, default: '' }, // why it changed
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  savedByName: { type: String, default: '' },
}, { timestamps: true });

KraSetSchema.index({ company: 1, scope: 1, role: 1, effectiveFrom: -1, version: -1 });
KraSetSchema.index({ company: 1, scope: 1, person: 1, effectiveFrom: -1, version: -1 });

export default mongoose.models.KraSet || mongoose.model('KraSet', KraSetSchema);
