import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { USER_ROLES } from '../shared/schema.js';

// Manpower (2026-11-06, docs/client-features-2026-11/02a-people-no-login-logic.md):
// someone in the system for work only has no login, so no password, and email
// is optional. Only a real document can answer this; on an update the
// controller decides (userController.updateUser).
const needsLogin = function () {
  return this instanceof mongoose.Document ? this.canLogin !== false : false;
};

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: false,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  // Unique only when filled in: see the index at the end of this file.
  email: {
    type: String,
    required: needsLogin,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: needsLogin,
    minlength: 6
  },
  // false = no login (role Manpower). Missing on everyone older, which means yes.
  canLogin: {
    type: Boolean,
    default: true
  },
  // The person's employee code on the attendance device, kept as text so 0005
  // stays 0005. One person per code per company.
  deviceCode: {
    type: String,
    trim: true
  },
  // Production steps this person can do (2026-11-12): Process Template step
  // names, set by Production on the Manpower page. Separate from the service
  // technicians' own skills.
  productionSkills: {
    type: [String],
    default: []
  },
  // When each skill was added (feature 13, 2026-11-17): the scorecard's Learning
  // counts a new skill in the last 3 months. Skills from before have no entry.
  productionSkillsAdded: {
    type: [{ _id: false, skill: String, at: Date, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
    default: []
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
  },
  // 25 Nov 2026: the employment status HR keeps on a person's profile (Probation & Confirmation,
  // Resigned / Terminated). The profile screens always sent these, but nothing stored them, so
  // every person read PROBATION and the Save buttons did nothing. Missing = on probation.
  employmentStatus: { type: String, enum: ['PROBATION', 'CONFIRMED'] },
  probationEndDate: Date,
  confirmationDate: Date,
  probationJustification: String,
  isResigned: Boolean,
  isTerminated: Boolean,
  terminationDate: Date,
  terminationReason: String,
  // Feature 31 (25 Nov 2026): a Department Head role given by HR waits for the Company Admin
  // (services/access/headApproval.js). kind: new = a new user (saved inactive), roleChange = an
  // existing person's role, login = Give Login. The waiting role / permissions / login live here
  // and only reach the person on approval.
  // Feature 34 (26 Nov 2026): the custom role this person is on (their `role` is its base role).
  // customRoleName is shown everywhere and kept in step on a rename. services/access/customRoles.js
  customRoleId: { type: mongoose.Schema.Types.ObjectId },
  customRoleName: { type: String },
  headApproval: {
    status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    kind: { type: String, enum: ['new', 'roleChange', 'login'] },
    role: String,
    customRoleId: mongoose.Schema.Types.ObjectId, // feature 34: the custom role the request is for
    customRoleName: String,
    permissions: mongoose.Schema.Types.Mixed,
    login: {
      email: String,
      passwordHash: { type: String, select: false },
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    reason: String,
  }
}, {
  timestamps: true
});
userSchema.index({ companyId: 1, 'headApproval.status': 1 }); // the Company Admin's waiting list
userSchema.index({ companyId: 1, customRoleId: 1 }, { partialFilterExpression: { customRoleId: { $type: 'objectId' } } }); // feature 34

userSchema.index({ email: 1 }, {
  name: 'email_unique_when_set', unique: true, partialFilterExpression: { email: { $type: 'string' } },
});
userSchema.index({ companyId: 1, deviceCode: 1 }, {
  name: 'deviceCode_unique_per_company', unique: true, partialFilterExpression: { deviceCode: { $type: 'string' } },
});

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

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
  if (user.headApproval?.login) delete user.headApproval.login.passwordHash; // feature 31
  return user;
};

export default mongoose.model('User', userSchema);
