import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { USER_ROLES } from '../shared/schema.js';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: false,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    trim: true
  },
  profilePicture: {
    type: String
  },
  // Not enum-restricted to USER_ROLES — Company Admin can add custom roles
  // via Admin Settings > HRMS Setting > Role Setting (see AdminSettings.roles).
  role: {
    type: String,
    required: true,
    default: USER_ROLES.PRODUCTION
  },
  unit: {
    type: String,
    required: false
  },
  // New field to identify trainees for LMS module
  isTrainee: {
    type: Boolean,
    default: false
  },

  // --- 🔥 NEW: TECHNICIAN / SERVICE FIELDS ---
  technicianSkills: [{
    type: String,
    enum: ['Breakdown', 'Performance Issue', 'Installation', 'Training']
  }],
  serviceZone: {
    type: String,
    trim: true
  },
  currentStatus: {
    type: String,
    enum: ['Available', 'On Job', 'Off Duty'],
    default: 'Available'
  },
  // -------------------------------------------

  // HRMS Fields
  employeeId: {
    type: String,
    unique: true,
    sparse: true
  },
  mobile: {
    type: String,
    trim: true
  },
  // Acefone IVR extension number for click-to-call
  ivrNumber: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other', 'Select', '']
  },
  dob: {
    type: Date
  },
  joiningDate: {
    type: Date
  },
  reportingManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  employeeType: {
    type: String,
    required: false
  },

  // Company assignment for location-specific access
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: false
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: false
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: false
  },
  designationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Designation',
    required: false
  },

  permissions: {
    role: {
      type: String,
      required: true
    },
    canAccessAllUnits: {
      type: Boolean,
      default: false
    },
    modules: [{
      name: {
        type: String,
        required: true
      },
      dashboard: {
        type: Boolean,
        default: true
      },
      features: [{
        key: {
          type: String,
          required: true
        },
        view: {
          type: Boolean,
          default: false
        },
        add: {
          type: Boolean,
          default: false
        },
        edit: {
          type: Boolean,
          default: false
        },
        delete: {
          type: Boolean,
          default: false
        },
        alter: {
          type: Boolean,
          default: false
        }
      }]
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error;
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

export default mongoose.model('User', userSchema);
