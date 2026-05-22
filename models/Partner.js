import mongoose from 'mongoose';

const partnerSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    percentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Ensure unique partner names per company
partnerSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const Partner = mongoose.model('Partner', partnerSchema);
