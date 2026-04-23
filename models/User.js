import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { USER_ROLES } from '../../shared/schema.js';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
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
  role: {
    type: String,
    required: true,
    enum: Object.values(USER_ROLES),
    default: USER_ROLES.PRODUCTION
  },
  unit: {
    type: String,
    required: false
  },
  
  // Company assignment for location-specific access
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
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

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

export default mongoose.model('User', userSchema);
