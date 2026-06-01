"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const schema_js_1 = require("../shared/schema.js");
const userSchema = new mongoose_1.default.Schema({
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
    role: {
        type: String,
        required: true,
        enum: Object.values(schema_js_1.USER_ROLES),
        default: schema_js_1.USER_ROLES.PRODUCTION
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
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    employeeType: {
        type: String,
        required: false
    },
    // Company assignment for location-specific access
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: false
    },
    branchId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Branch',
        required: false
    },
    departmentId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Department',
        required: false
    },
    designationId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
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
userSchema.pre('save', function () {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.isModified('password'))
            return;
        try {
            const salt = yield bcryptjs_1.default.genSalt(12);
            this.password = yield bcryptjs_1.default.hash(this.password, salt);
        }
        catch (error) {
            throw error;
        }
    });
});
userSchema.methods.comparePassword = function (candidatePassword) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield bcryptjs_1.default.compare(candidatePassword, this.password);
        }
        catch (error) {
            throw error;
        }
    });
};
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};
exports.default = mongoose_1.default.model('User', userSchema);
