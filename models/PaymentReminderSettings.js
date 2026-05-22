import mongoose from 'mongoose';

/**
 * Payment Reminder Settings — Per Company config
 * Account Head ye settings configure karta hai
 */
const paymentReminderSettingsSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        unique: true
    },
    // Kitne din baad invoice pe pehla reminder bhejein
    firstReminderDays: {
        type: Number,
        default: 7  // Invoice banne ke 7 din baad
    },
    // Dusra reminder
    secondReminderDays: {
        type: Number,
        default: 15 // 15 din baad
    },
    // Overdue threshold — kitne din baad "Overdue" mark karein
    overdueAfterDays: {
        type: Number,
        default: 30 // Due date ke 30 din baad = Overdue
    },
    // Auto email on/off
    autoEmailEnabled: {
        type: Boolean,
        default: false  // Default off — jab tak SMTP set na ho
    },
    // Email reminder frequency (in days) — har X din pe reminder
    reminderFrequencyDays: {
        type: Number,
        default: 7
    }
}, { timestamps: true });

export default mongoose.model('PaymentReminderSettings', paymentReminderSettingsSchema);
