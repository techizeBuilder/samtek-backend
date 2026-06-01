"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitTest = exports.startTest = exports.markContentCompleted = exports.getModuleLearningView = exports.getMyDashboard = void 0;
const TrainingmanagementModel_js_1 = require("../models/TrainingmanagementModel.js"); // Adjust your import path
// ==========================================
// 1. GET TRAINEE DASHBOARD
// Fetches assigned modules and cross-references them with progress/test statuses
// ==========================================
const getMyDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const profile = yield TrainingmanagementModel_js_1.TrainingProfile.findOne({ user: userId })
            .populate({
            path: 'assignedModules',
            select: 'title description category sequenceOrder contents',
            match: { isActive: true }
        }).lean();
        if (!profile)
            return res.status(404).json({ success: false, message: "No training profile found." });
        const progressRecords = yield TrainingmanagementModel_js_1.Progress.find({ user: userId }).lean();
        const testAttempts = yield TrainingmanagementModel_js_1.TestAttempt.find({ user: userId }).lean();
        let passedModulesCount = 0;
        // 1. Sort the modules strictly by sequence order FIRST
        profile.assignedModules.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        // 2. Track sequential locking
        let previousModulePassed = true; // The very first module is always unlocked
        const dashboardData = profile.assignedModules.map(module => {
            const progress = progressRecords.find(p => p.module.toString() === module._id.toString()) || null;
            const tests = testAttempts.filter(t => t.module.toString() === module._id.toString());
            const attemptsUsed = tests.length;
            const isPassed = tests.some(t => t.isPassed);
            const bestScore = attemptsUsed > 0 ? Math.max(...tests.map(t => t.scorePercentage)) : null;
            if (isPassed)
                passedModulesCount++;
            // --- NEW: Apply the lock based on the previous module's status ---
            const isLockedBySequence = !previousModulePassed;
            // Update the tracker for the NEXT module in the loop
            previousModulePassed = isPassed;
            return Object.assign(Object.assign({}, module), { totalContents: module.contents.length, progressStatus: progress ? progress.status : 'Pending', completedContentsCount: progress ? progress.completedContents.length : 0, isTestUnlocked: progress ? progress.isTestUnlocked : false, attemptsUsed,
                isPassed,
                bestScore,
                isLockedBySequence // <-- Sends the lock status to the frontend UI
             });
        });
        const totalAssigned = profile.assignedModules.length;
        const overallProgressPercentage = totalAssigned > 0
            ? Math.round((passedModulesCount / totalAssigned) * 100)
            : 0;
        res.status(200).json({
            success: true,
            profileStatus: profile.status,
            isEligible: profile.isEligible,
            overallProgressPercentage,
            modules: dashboardData
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});
exports.getMyDashboard = getMyDashboard;
// ==========================================
// 2. INITIATE / GET MODULE LEARNING
// Creates a Progress tracking doc if it's their first time opening the course
// ==========================================
const getModuleLearningView = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { moduleId } = req.params;
        const userId = req.user._id;
        // 1. Fetch the user's assigned modules to check sequence
        const profile = yield TrainingmanagementModel_js_1.TrainingProfile.findOne({ user: userId }).populate('assignedModules').lean();
        if (!profile)
            return res.status(403).json({ success: false, message: "Access denied." });
        // Sort them to establish the official sequence
        const sortedModules = profile.assignedModules.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        const targetModuleIndex = sortedModules.findIndex(m => m._id.toString() === moduleId);
        if (targetModuleIndex === -1) {
            return res.status(403).json({ success: false, message: "This module is not assigned to you." });
        }
        // --- NEW: STRICT BACKEND SEQUENCE ENFORCEMENT ---
        // If this is NOT the first module, ensure the previous one was passed
        if (targetModuleIndex > 0) {
            const previousModuleId = sortedModules[targetModuleIndex - 1]._id;
            const previousTest = yield TrainingmanagementModel_js_1.TestAttempt.findOne({
                user: userId,
                module: previousModuleId,
                isPassed: true
            });
            if (!previousTest) {
                return res.status(403).json({
                    success: false,
                    message: "SEQUENCE_LOCKED: You must pass the previous training module before unlocking this one."
                });
            }
        }
        // 2. Fetch the requested module
        const module = yield TrainingmanagementModel_js_1.Module.findById(moduleId).lean();
        if (!module || !module.isActive) {
            return res.status(404).json({ success: false, message: "Module not found or inactive." });
        }
        // 3. Find or Create Progress Tracker
        let progress = yield TrainingmanagementModel_js_1.Progress.findOne({ user: userId, module: moduleId });
        if (!progress) {
            progress = yield TrainingmanagementModel_js_1.Progress.create({
                companyId: module.companyId,
                user: userId,
                module: moduleId,
                status: 'In-Progress'
            });
        }
        res.status(200).json({ success: true, module, progress });
    }
    catch (error) {
        console.error("Learning View Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});
exports.getModuleLearningView = getModuleLearningView;
// ==========================================
// 3. MARK CONTENT COMPLETED (Video/PDF Finished)
// Unlocks the test if all videos/PDFs are marked done
// ==========================================
const markContentCompleted = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { moduleId, contentId } = req.body;
        const userId = req.user._id;
        const module = yield TrainingmanagementModel_js_1.Module.findById(moduleId);
        const progress = yield TrainingmanagementModel_js_1.Progress.findOne({ user: userId, module: moduleId });
        if (!progress || !module) {
            return res.status(404).json({ success: false, message: "Progress or Module not found." });
        }
        // Add to completed array if not already there
        if (!progress.completedContents.includes(contentId)) {
            progress.completedContents.push(contentId);
        }
        // Check if ALL contents in the module are now completed
        const isAllCompleted = module.contents.every(content => progress.completedContents.includes(content._id.toString()));
        if (isAllCompleted) {
            progress.status = 'Completed';
            progress.isTestUnlocked = true; // REQUIREMENT #13: Unlock Test
        }
        yield progress.save();
        res.status(200).json({ success: true, isTestUnlocked: progress.isTestUnlocked, completedContents: progress.completedContents });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});
exports.markContentCompleted = markContentCompleted;
// ==========================================
// 4. START TEST (Anti-Cheat & Timer Setup)
// ==========================================
// ==========================================
// 4. START TEST
// ==========================================
const startTest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { moduleId } = req.params;
        const userId = req.user._id;
        const progress = yield TrainingmanagementModel_js_1.Progress.findOne({ user: userId, module: moduleId });
        if (!progress || !progress.isTestUnlocked) {
            return res.status(403).json({ success: false, message: "Test is locked. Complete all module content first." });
        }
        const previousAttempts = yield TrainingmanagementModel_js_1.TestAttempt.find({ user: userId, module: moduleId });
        if (previousAttempts.some(t => t.isPassed)) {
            return res.status(400).json({ success: false, message: "You have already passed this test." });
        }
        if (previousAttempts.length >= 2) {
            return res.status(403).json({ success: false, message: "Maximum attempts reached. You are not eligible to retake this test." });
        }
        const questions = yield TrainingmanagementModel_js_1.Question.find({ module: moduleId }).lean();
        const TEST_QUESTION_LIMIT = 10;
        if (questions.length === 0) {
            return res.status(400).json({ success: false, message: "No questions configured for this module." });
        }
        if (questions.length < TEST_QUESTION_LIMIT) {
            return res.status(400).json({
                success: false,
                message: `System Error: The Question Bank for this module only has ${questions.length} questions. It requires at least ${TEST_QUESTION_LIMIT}. Please contact HR.`
            });
        }
        const shuffledQuestions = questions.sort(() => 0.5 - Math.random());
        const selectedQuestions = shuffledQuestions.slice(0, TEST_QUESTION_LIMIT);
        const sanitizedQuestions = selectedQuestions.map(q => ({
            _id: q._id,
            questionText: q.questionText,
            options: q.options
        }));
        const attemptNumber = previousAttempts.length + 1;
        const newAttempt = yield TrainingmanagementModel_js_1.TestAttempt.create({
            companyId: progress.companyId,
            user: userId,
            module: moduleId,
            attemptNumber,
            startedAt: Date.now(),
            randomizedQuestionSet: selectedQuestions.map(q => q._id)
        });
        res.status(200).json({
            success: true,
            testAttemptId: newAttempt._id,
            attemptNumber,
            questions: sanitizedQuestions
        });
    }
    catch (error) {
        console.error("Start Test Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});
exports.startTest = startTest;
// ==========================================
// 5. SUBMIT & GRADE TEST (WITH FAIL ANALYSIS TRACKING)
// ==========================================
const submitTest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { testAttemptId, answers } = req.body;
        const userId = req.user._id;
        const attempt = yield TrainingmanagementModel_js_1.TestAttempt.findById(testAttemptId);
        if (!attempt || attempt.finishedAt) {
            return res.status(400).json({ success: false, message: "Invalid or already submitted test." });
        }
        const TEST_TIME_LIMIT_MS = 20 * 60 * 1000;
        const GRACE_PERIOD_MS = 60 * 1000;
        const timeTakenMs = Date.now() - new Date(attempt.startedAt).getTime();
        let isTimeExpired = timeTakenMs > (TEST_TIME_LIMIT_MS + GRACE_PERIOD_MS);
        const questions = yield TrainingmanagementModel_js_1.Question.find({ _id: { $in: attempt.randomizedQuestionSet } }).lean();
        let correctAnswersCount = 0;
        const gradedAnswers = [];
        if (!isTimeExpired) {
            answers.forEach(ans => {
                const actualQuestion = questions.find(q => q._id.toString() === ans.questionId);
                let isCorrect = false;
                if (actualQuestion) {
                    const selectedOpt = actualQuestion.options.find(o => o._id.toString() === ans.selectedOption.toString());
                    if (selectedOpt) {
                        const correctVal = actualQuestion.correctOption.toString().trim().toLowerCase();
                        const selectedId = selectedOpt._id.toString().trim().toLowerCase();
                        const selectedText = selectedOpt.text.toString().trim().toLowerCase();
                        const selectedLabel = selectedOpt.label ? selectedOpt.label.toString().trim().toLowerCase() : "";
                        if (correctVal === selectedId || correctVal === selectedText || correctVal === selectedLabel) {
                            correctAnswersCount++;
                            isCorrect = true;
                        }
                    }
                }
                gradedAnswers.push({
                    questionId: ans.questionId,
                    selectedOptionId: ans.selectedOption,
                    isCorrect: isCorrect
                });
            });
        }
        const totalQuestions = attempt.randomizedQuestionSet.length;
        const scorePercentage = (totalQuestions > 0 && !isTimeExpired)
            ? Math.round((correctAnswersCount / totalQuestions) * 100)
            : 0;
        const isPassed = scorePercentage >= 80;
        attempt.scorePercentage = scorePercentage;
        attempt.isPassed = isPassed;
        attempt.submittedAnswers = gradedAnswers;
        attempt.finishedAt = Date.now();
        yield attempt.save();
        // 🔥 THE FIX: 1. Calculate formatted time for the Trainee UI
        const timeTakenMins = Math.floor(timeTakenMs / 60000);
        const timeTakenSecs = Math.floor((timeTakenMs % 60000) / 1000);
        const timeTakenFormatted = `${timeTakenMins}m ${timeTakenSecs}s`;
        // 🔥 THE FIX: 2. Generate a detailed Review Object for the frontend
        const reviewData = questions.map(q => {
            const userAns = answers.find(a => a.questionId === q._id.toString());
            const selectedOpt = userAns ? q.options.find(o => o._id.toString() === userAns.selectedOption.toString()) : null;
            const correctOpt = q.options.find(o => {
                const correctVal = q.correctOption.toString().trim().toLowerCase();
                const optId = o._id.toString().trim().toLowerCase();
                const optLabel = (o.label || "").toString().trim().toLowerCase();
                return correctVal === optId || correctVal === optLabel;
            });
            return {
                questionId: q._id,
                questionText: q.questionText,
                options: q.options,
                selectedAnswerText: selectedOpt ? selectedOpt.text : 'Skipped / No Answer',
                correctAnswerText: correctOpt ? correctOpt.text : 'Unknown',
                isCorrect: userAns ? gradedAnswers.find(ga => ga.questionId === q._id.toString()).isCorrect : false
            };
        });
        const profile = yield TrainingmanagementModel_js_1.TrainingProfile.findOne({ user: userId });
        if (profile) {
            if (isPassed) {
                const allUserAttempts = yield TrainingmanagementModel_js_1.TestAttempt.find({ user: userId, isPassed: true }).lean();
                const passedModuleIds = allUserAttempts.map(a => a.module.toString());
                const hasPassedEverything = profile.assignedModules.every(modId => passedModuleIds.includes(modId.toString()));
                if (hasPassedEverything) {
                    profile.status = 'Passed';
                }
                else if (profile.status === 'Pending_Assignment') {
                    profile.status = 'In-Training';
                }
            }
            else {
                if (attempt.attemptNumber === 1) {
                    profile.status = 'Pending_2nd_Attempt';
                }
                else if (attempt.attemptNumber >= 2) {
                    profile.status = 'Failed';
                    profile.isEligible = false;
                }
            }
            yield profile.save();
        }
        res.status(200).json({
            success: true,
            scorePercentage,
            isPassed,
            isTimeExpired,
            timeTakenFormatted, // 🔥 Sent to frontend
            attemptNumber: attempt.attemptNumber,
            profileStatus: profile === null || profile === void 0 ? void 0 : profile.status,
            reviewData // 🔥 Sent to frontend for the Review UI
        });
    }
    catch (error) {
        console.error("Submit Test Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});
exports.submitTest = submitTest;
