import mongoose from 'mongoose';

// ==========================================
// 1. TRAINING PROFILE SCHEMA - The Lifecycle Manager
// Replaces the old "Trainee" schema. Identity is handled by User.
// ==========================================
const trainingProfileSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  
  // THE CRITICAL LINK: Connects to the permanent HRMS User
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  
  assignedDepartment: { type: String, required: true }, 
  
  // Modules assigned by the Department Head
  assignedModules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }],
  
  // Requirement #6 & #15: Pass/Fail Workflow Tracking
  status: { 
    type: String, 
    enum: ['Pending_Assignment', 'In-Training', 'Pending_2nd_Attempt', 'Passed', 'Failed', 'Completed_Onboarding', 'Rejected'], 
    default: 'Pending_Assignment' 
  },
  
  // Requirement #6: Becomes false after 2nd failure
  isEligible: { type: Boolean, default: true }, 
  
  stagedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // HR/Manager who staged them
}, { 
  timestamps: true,
  collection: 'lms_training_profiles' 
});


// ==========================================
// 2. TRAINING MODULE SCHEMA
// ==========================================
const moduleSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  department: { type: String, required: true }, 
  
  // Requirement #3: Training Categories
  category: { 
    type: String, 
    enum: ['Induction', 'SOP', 'Reporting', 'ERP Usage', 'Professional / Behavioral', 'Task Management', 'Skill', 'Safety', 'Customer Relationship', 'Sales', 'Product', 'Demo'],
    required: true
  },
  sequenceOrder: { type: Number, required: true },

  // Requirement #4 & #13: Content Format & Watch Requirements
  contents: [{
    contentType: { type: String, enum: ['Video', 'PDF', 'PPT'], required: true },
    mediaUrl: { type: String, required: true },
    minWatchTime: { type: Number, default: 0 } // Video skip control
  }],

  // Per-module test duration, set by whoever authors the module instead of
  // the old hardcoded 20-minute limit every module previously shared.
  testDurationMinutes: { type: Number, default: 20, min: 1 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true }
}, { 
  timestamps: true,
  collection: 'lms_training_modules' 
});


// ==========================================
// 3. QUESTION BANK SCHEMA
// ==========================================
const questionSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  questionText: { type: String, required: true },
  
  // Requirement #7: Objective Questions (MCQ)
  options: [{
    label: { type: String, required: true }, 
    text: { type: String, required: true }
  }],
  correctOption: { type: String, required: true }, 
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { 
  timestamps: true,
  collection: 'lms_question_bank' 
});


// ==========================================
// 4. PROGRESS TRACKING SCHEMA
// ==========================================
const progressSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  
  // SIMPLIFIED: Every learner is just a User now!
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  
  status: { type: String, enum: ['Pending', 'In-Progress', 'Completed'], default: 'Pending' },
  
  completedContents: [{ type: mongoose.Schema.Types.ObjectId }], 
  
  // Requirement #13: Test unlock only after module completion
  isTestUnlocked: { type: Boolean, default: false } 
}, { 
  timestamps: true,
  collection: 'lms_progress_tracking' 
});


// ==========================================
// 5. TEST ATTEMPT & TIMER SCHEMA
// ==========================================
const testAttemptSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  
  attemptNumber: { type: Number, required: true, enum: [1, 2], default: 1 }, 
  scorePercentage: { type: Number }, 
  isPassed: { type: Boolean }, 
  
  randomizedQuestionSet: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],

  // Snapshotted from Module.testDurationMinutes when the attempt starts, so
  // a later change to the module's duration never affects an attempt that's
  // already running. Seconds, to match the frontend countdown timer.
  testDurationSeconds: { type: Number, default: 1200 },

  // 🔥 NEW: Track exactly what they answered for the Fail Analysis Dashboard
  submittedAnswers: [{
      questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
      selectedOptionId: { type: String },
      isCorrect: { type: Boolean }
  }],
  
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date } 
}, { 
  timestamps: true,
  collection: 'lms_test_attempts' 
});


// ==========================================
// EXPORT MODELS
// ==========================================
export const TrainingProfile = mongoose.model('TrainingProfile', trainingProfileSchema);
export const Module = mongoose.model('Module', moduleSchema);
export const Question = mongoose.model('Question', questionSchema);
export const Progress = mongoose.model('Progress', progressSchema);
export const TestAttempt = mongoose.model('TestAttempt', testAttemptSchema);