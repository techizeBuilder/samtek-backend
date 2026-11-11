import mongoose from 'mongoose';

// A regular vehicle Dispatch uses for vendor trips (outsource-v2 slice 6,
// 2026-10-20 — docs/outsource-v2/dispatch-design-2026-10.md T7). A one-time
// vehicle is typed on the trip itself (DispatchTrip.oneTimeVehicle) and only
// lands here when Dispatch ticks "save as regular".
const VehicleSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  // Upper-cased, spaces removed (UK07AB1234) — unique per company.
  number: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Tempo', 'Pickup', 'Truck', 'Other'], default: 'Tempo' },
  // Own: no freight on a trip. Hired: the trip asks for the freight (T3).
  ownership: { type: String, enum: ['Own', 'Hired'], default: 'Own' },
  transporterName: { type: String, default: '', trim: true },
  transporterPhone: { type: String, default: '', trim: true },
  driverName: { type: String, default: '', trim: true },
  driverPhone: { type: String, default: '', trim: true },
  capacityKg: { type: Number, default: null, min: 0 },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

VehicleSchema.index({ company: 1, number: 1 }, { unique: true });

export const normaliseVehicleNumber = (n) => String(n || '').toUpperCase().replace(/[\s-]+/g, '');

export default mongoose.models.Vehicle || mongoose.model('Vehicle', VehicleSchema);
