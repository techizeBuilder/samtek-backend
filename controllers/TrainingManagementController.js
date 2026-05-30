import bcrypt from 'bcryptjs';
import { TrainingProfile, Module, Question, Progress, TestAttempt } from '../models/TrainingmanagementModel.js';
import { sendTrainingEmail, TrainingEmailType } from '../utils/trainingEmail.js';
import User from '../models/User.js';
import fs from 'fs';
import path from 'path';

// --- ROLE HIERARCHY HELPERS ---
const TOP_LEVEL_ADMINS = ['HR-Admin', 'Super Admin', 'Admin', 'Company Admin'];
const DEPT_HEADS = [
    'Production Head', 'Packing Head', 'Dispatch Head',
    'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
    'Unit Head', 'Unit Manager',
    // New Departments
    'Research & Development Head', 'Store Head', 'QC Head'
];

// Resolves module creation departments
const getDepartmentFromRole = (role) => {
    if (!role) return "General";
    const lower = role.toLowerCase();
    if (lower.includes('production')) return 'Production';
    if (lower.includes('packing')) return 'Packing';
    if (lower.includes('dispatch')) return 'Dispatch';
    if (lower.includes('account') || lower.includes('finance')) return 'Accounts';
    if (lower.includes('sales')) return 'Sales';
    if (lower.includes('research') || lower.includes('r&d')) return 'Research & Development';
    if (lower.includes('store')) return 'Store';
    if (lower.includes('qc') || lower.includes('quality')) return 'QC';

    return role.replace(/(Head|Manager|Employee)/gi, '').trim() || "General";
};

// 🔥 THE FIX: Normalizes the search prefix to prevent mismatches (e.g., "Research & Development" vs "Research Development")
const getNormalizedDeptPrefix = (role) => {
    let deptPrefix = role.replace(/(Head|Manager)/gi, '').trim();
    const lower = deptPrefix.toLowerCase();

    if (lower === 'accounts' || lower === 'finance') return 'Account';
    if (lower.includes('research') || lower === 'r&d') return 'Research';
    if (lower.includes('quality') || lower === 'qc') return 'QC';
    if (lower.includes('store')) return 'Store';

    return deptPrefix;
};

// --- CONTROLLER: GET AVAILABLE TRAINEES ---
export const getAvailableTrainees = async (req, res) => {
    try {
        const { companyId, role: managerRole } = req.user;

        let query = {
            companyId,
            isActive: true,
            isTrainee: true
        };

        // Department Filtering Logic
        if (!TOP_LEVEL_ADMINS.includes(managerRole)) {
            // Use the new normalizer to fetch the core department word
            const deptPrefix = getNormalizedDeptPrefix(managerRole);

            if (deptPrefix) {
                // Will match "^Research" against "Research Development Employee"
                query.role = { $regex: new RegExp(`^${deptPrefix}`, 'i') };
            }
        }

        const potentialTrainees = await User.find(query).select('fullName email role username employeeId isTrainee');

        const existingProfiles = await TrainingProfile.find({ companyId }).select('user');
        const existingUserIds = existingProfiles.map(profile => profile.user.toString());

        const availableToStage = potentialTrainees.filter(
            trainee => !existingUserIds.includes(trainee._id.toString())
        );

        res.status(200).json({
            success: true,
            count: availableToStage.length,
            data: availableToStage
        });

    } catch (error) {
        console.error("Error fetching available trainees:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// --- CONTROLLER: CREATE TRAINEE ---
export const stageCandidate = async (req, res) => {
    try {
        const { _id: managerId, companyId } = req.user;
        const { userId, assignedModules } = req.body;

        if (!userId || !Array.isArray(assignedModules) || assignedModules.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User ID and at least one Assigned Module are required."
            });
        }

        const traineeUser = await User.findOne({
            _id: userId,
            companyId,
            isActive: true
        });

        if (!traineeUser || !traineeUser.isTrainee) {
            return res.status(404).json({
                success: false,
                message: "Valid Trainee account not found."
            });
        }

        const existingProfile = await TrainingProfile.findOne({ user: userId });
        if (existingProfile) {
            return res.status(400).json({
                success: false,
                message: "This candidate has already been staged for training."
            });
        }

        const extractedDepartment = traineeUser.role.replace(/(Employee|Head|Manager)/gi, '').trim();

        const newProfile = await TrainingProfile.create({
            companyId,
            user: userId,
            assignedDepartment: extractedDepartment || 'General',
            assignedModules: assignedModules,
            status: 'In-Training',
            isEligible: true,
            stagedBy: managerId
        });

        sendTrainingEmail(traineeUser.email, TrainingEmailType.CANDIDATE_STAGED, {
            fullName: traineeUser.fullName,
            department: extractedDepartment || 'General'
        });

        res.status(201).json({
            success: true,
            message: `${traineeUser.fullName} has been successfully staged for training.`,
            data: newProfile
        });

    } catch (error) {
        console.error("Error staging candidate:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// --- CONTROLLER: UPDATE TRAINEE MODULES ---
export const updateTraineeModules = async (req, res) => {
    try {
        const { id } = req.params;
        const { assignedModules } = req.body;
        const { companyId, role } = req.user;

        if (!TOP_LEVEL_ADMINS.includes(role) && !DEPT_HEADS.includes(role)) {
            return res.status(403).json({ success: false, message: "Unauthorized." });
        }

        if (!Array.isArray(assignedModules) || assignedModules.length === 0) {
            return res.status(400).json({ success: false, message: "Must provide at least one module." });
        }

        const profile = await TrainingProfile.findOneAndUpdate(
            { _id: id, companyId },
            { assignedModules },
            { new: true }
        ).populate('assignedModules', 'title category');

        if (!profile) {
            return res.status(404).json({ success: false, message: "Profile not found." });
        }

        res.status(200).json({ success: true, message: "Trainee courses updated.", data: profile });
    } catch (error) {
        console.error("Error updating trainee modules:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// --- CONTROLLER: GET ACTIVE TRAINEES ---
export const getActiveTrainees = async (req, res) => {
    try {
        const { companyId, role: managerRole } = req.user;

        let query = { companyId };

        if (TOP_LEVEL_ADMINS.includes(managerRole)) {
            if (req.query.department) {
                query.assignedDepartment = req.query.department;
            }
        } else {
            // Use normalizer to fetch candidates
            const deptPrefix = getNormalizedDeptPrefix(managerRole);
            if (deptPrefix) {
                query.assignedDepartment = new RegExp(deptPrefix, 'i');
            }
        }

        if (req.query.status) query.status = req.query.status;
        if (req.query.isEligible !== undefined) query.isEligible = req.query.isEligible === 'true';

        if (req.query.search) {
            const searchRegex = new RegExp(req.query.search, 'i');
            const matchingUsers = await User.find({
                companyId,
                $or: [
                    { fullName: searchRegex },
                    { email: searchRegex }
                ]
            }).select('_id');
            const matchingUserIds = matchingUsers.map(user => user._id);
            query.user = { $in: matchingUserIds };
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const profiles = await TrainingProfile.find(query)
            .populate('user', 'fullName email role employeeId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const totalDocuments = await TrainingProfile.countDocuments(query);

        res.status(200).json({
            success: true,
            count: profiles.length,
            total: totalDocuments,
            currentPage: page,
            totalPages: Math.ceil(totalDocuments / limit),
            data: profiles
        });

    } catch (error) {
        console.error("Error fetching active trainees:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

import PDFDocument from 'pdfkit';

// --- CONTROLLER: GENERATE & DOWNLOAD CERTIFICATE ---
export const downloadCertificate = async (req, res) => {
    try {
        const { id } = req.params;
        const { companyId } = req.user;

        const profile = await TrainingProfile.findOne({ _id: id, companyId }).populate('user', 'fullName').lean();
        if (!profile) return res.status(404).json({ success: false, message: "Profile not found." });
        if (profile.status !== 'Passed' && profile.status !== 'Completed_Onboarding') {
            return res.status(400).json({ success: false, message: "Candidate has not completed training yet." });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Certificate_${profile.user.fullName.replace(/\s+/g, '_')}.pdf`);

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
        doc.pipe(res);

        // A. Draw Border
        doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(3).stroke('#1e3a8a');

        // B. Add Samtek Logo
        const logoPath = path.resolve(process.cwd(), 'assets', 'logo Semtek.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, (doc.page.width - 250) / 2, 60, { width: 250 });
        } else {
            console.log("❌ LOGO NOT FOUND! Path searched:", logoPath);
        }

        // C. Certificate Title
        doc.y = 145;
        doc.font('Helvetica-Bold').fontSize(36).fillColor('#f97316').text('CERTIFICATE OF COMPLETION', { align: 'center' });

        // D. Subtitle
        doc.moveDown(1);
        doc.font('Helvetica').fontSize(16).fillColor('#4b5563').text('This is to certify that', { align: 'center' });

        // E. Candidate Name
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(42).fillColor('#1e3a8a').text(profile.user.fullName.toUpperCase(), { align: 'center' });

        // F. Achievement Text
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(14).fillColor('#4b5563').text(`has successfully completed all mandatory system-driven training modules, standard operating procedures, and evaluation criteria for the`, { align: 'center' });
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#1e3a8a').text(`${profile.assignedDepartment.toUpperCase()} DEPARTMENT`, { align: 'center' });

        // G. Signatory Area
        const bottomY = doc.page.height - 130;
        const completionDate = new Date(profile.updatedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text(`Date: ${completionDate}`, 100, bottomY + 30);
        doc.fontSize(8).font('Helvetica').fillColor('#9ca3af').text(`Certificate ID: ${profile._id}`, 100, bottomY + 50);

        doc.moveTo(doc.page.width - 270, bottomY + 45).lineTo(doc.page.width - 80, bottomY + 45).lineWidth(1).stroke('#000000');
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text('Authorized Signatory', doc.page.width - 250, bottomY + 55);

        doc.end();
    } catch (error) {
        console.error("Certificate Generation Error:", error);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Failed to generate certificate." });
    }
};

// --- CONTROLLER: GET TRAINEE DETAILS ---
export const getTraineeDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const { companyId } = req.user;

        const profile = await TrainingProfile.findOne({ _id: id, companyId })
            .populate('user', 'fullName email role employeeId mobile')
            .populate({
                path: 'assignedModules',
                select: 'title category sequenceOrder contents',
            })
            .lean();

        if (!profile) {
            return res.status(404).json({ success: false, message: "Profile not found" });
        }

        const userProgress = await Progress.find({ user: profile.user._id }).lean();

        const testAttempts = await TestAttempt.find({ user: profile.user._id })
            .populate('randomizedQuestionSet', 'questionText options correctOption')
            .sort({ createdAt: -1 })
            .lean();

        let completedCount = 0;
        const detailedModules = profile.assignedModules.map(module => {

            const modProgress = userProgress.find(p => p.module.toString() === module._id.toString());

            const modTests = testAttempts
                .filter(t => t.module.toString() === module._id.toString())
                .map(t => {
                    let timeTakenFormatted = "N/A";
                    if (t.startedAt && t.finishedAt) {
                        const diffMs = new Date(t.finishedAt).getTime() - new Date(t.startedAt).getTime();
                        const mins = Math.floor(diffMs / 60000);
                        const secs = Math.floor((diffMs % 60000) / 1000);
                        timeTakenFormatted = `${mins}m ${secs}s`;
                    }

                    const totalQuestions = t.randomizedQuestionSet ? t.randomizedQuestionSet.length : 0;
                    const correctAnswers = t.submittedAnswers ? t.submittedAnswers.filter(a => a.isCorrect).length : 0;
                    const wrongAnswers = totalQuestions - correctAnswers;

                    const reviewData = t.randomizedQuestionSet ? t.randomizedQuestionSet.map(q => {
                        const userAns = t.submittedAnswers?.find(a => a.questionId.toString() === q._id.toString());

                        let selectedAnswerText = 'Skipped / No Answer';
                        if (userAns && userAns.selectedOptionId) {
                            const selectedOpt = q.options.find(o => o._id.toString() === userAns.selectedOptionId.toString());
                            if (selectedOpt) selectedAnswerText = selectedOpt.text;
                        }

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
                            selectedAnswerText,
                            correctAnswerText: correctOpt ? correctOpt.text : 'Unknown',
                            isCorrect: userAns ? userAns.isCorrect : false
                        };
                    }) : [];

                    return {
                        ...t,
                        timeTakenFormatted,
                        totalQuestions,
                        correctAnswers,
                        wrongAnswers,
                        reviewData
                    };
                });

            const status = modProgress ? modProgress.status : 'Pending';
            if (status === 'Completed') completedCount++;

            return {
                ...module,
                progressStatus: status,
                isTestUnlocked: modProgress ? modProgress.isTestUnlocked : false,
                testAttempts: modTests
            };
        });

        const totalAssigned = profile.assignedModules.length;
        const progressPercentage = totalAssigned === 0 ? 0 : Math.round((completedCount / totalAssigned) * 100);

        res.status(200).json({
            success: true,
            data: {
                ...profile,
                assignedModules: detailedModules,
                analytics: {
                    totalAssigned,
                    completedCount,
                    progressPercentage
                }
            }
        });

    } catch (error) {
        console.error("Error fetching trainee details:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};


// --- CONTROLLER: FINALIZE TRAINEE (Hire or Reject) ---
export const finalizeTrainee = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;

        const profile = await TrainingProfile.findById(id).populate('user');
        if (!profile || !profile.user) {
            return res.status(404).json({ success: false, message: "Trainee profile not found." });
        }

        if (action === 'hire') {
            await User.findByIdAndUpdate(profile.user._id, {
                isTrainee: false,
                isActive: true
            });

            profile.status = 'Completed_Onboarding';
            await profile.save();

            sendTrainingEmail(profile.user.email, TrainingEmailType.TRAINING_PASSED, {
                fullName: profile.user.fullName,
                department: profile.assignedDepartment,
                role: profile.user.role
            });

            return res.status(200).json({
                success: true,
                message: `${profile.user.fullName} has successfully completed onboarding and is now active!`
            });

        } else if (action === 'reject') {
            await User.findByIdAndUpdate(profile.user._id, { isActive: false });

            profile.status = 'Rejected';
            profile.isEligible = false;
            await profile.save();

            sendTrainingEmail(profile.user.email, TrainingEmailType.TRAINING_REJECTED, {
                fullName: profile.user.fullName,
                department: profile.assignedDepartment
            });

            return res.status(200).json({
                success: true,
                message: `${profile.user.fullName}'s training has been terminated and access revoked.`
            });

        } else {
            return res.status(400).json({ success: false, message: "Invalid action. Use 'hire' or 'reject'." });
        }
    } catch (error) {
        console.error("Error finalizing trainee:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// --- CONTROLLER: GET ADMIN DASHBOARD ANALYTICS ---
export const getDashboardAnalytics = async (req, res) => {
    try {
        const { companyId, role } = req.user;

        const isTopAdmin = TOP_LEVEL_ADMINS.includes(role);

        let profileQuery = { companyId };
        if (!isTopAdmin) {
            // Use normalizer
            const deptPrefix = getNormalizedDeptPrefix(role);
            if (deptPrefix) {
                profileQuery.assignedDepartment = new RegExp(`^${deptPrefix}`, 'i');
            }
        }

        const profiles = await TrainingProfile.find(profileQuery).populate('user', 'fullName').lean();

        const totalTrainees = profiles.length;
        const passedCount = profiles.filter(p => p.status === 'Passed' || p.status === 'Completed_Onboarding').length;
        const failedCount = profiles.filter(p => p.status === 'Failed' || p.status === 'Rejected').length;
        const inTrainingCount = profiles.filter(p => p.status === 'In-Training' || p.status === 'Pending_2nd_Attempt').length;
        const pendingDecisionCount = profiles.filter(p => p.status === 'Passed' || p.status === 'Failed').length;

        const departmentStats = {};
        const userDeptMap = {};

        profiles.forEach(p => {
            const dept = p.assignedDepartment;
            if (!departmentStats[dept]) departmentStats[dept] = { total: 0, passed: 0 };
            departmentStats[dept].total += 1;
            if (p.status === 'Passed' || p.status === 'Completed_Onboarding') departmentStats[dept].passed += 1;

            if (p.user) userDeptMap[p.user._id.toString()] = dept;
        });

        const validUserIds = profiles.map(p => p.user?._id).filter(Boolean);
        const attempts = await TestAttempt.find({ companyId, user: { $in: validUserIds } })
            .populate('user', 'fullName')
            .populate('module', 'title department')
            .lean();

        const userScores = {};
        attempts.forEach(attempt => {
            if (!attempt.user) return;
            const uid = attempt.user._id.toString();
            if (!userScores[uid]) {
                userScores[uid] = {
                    name: attempt.user.fullName,
                    department: userDeptMap[uid] || 'Unknown',
                    totalScore: 0,
                    testsTaken: 0
                };
            }
            userScores[uid].totalScore += attempt.scorePercentage || 0;
            userScores[uid].testsTaken += 1;
        });

        const performers = Object.values(userScores).map(u => ({
            name: u.name,
            department: u.department,
            averageScore: Math.round(u.totalScore / u.testsTaken)
        })).sort((a, b) => b.averageScore - a.averageScore);

        const topPerformers = performers.slice(0, 5);
        const lowPerformers = performers.filter(p => p.averageScore < 80).reverse().slice(0, 5);

        const failedQuestionsTracker = {};
        attempts.forEach(attempt => {
            if (attempt.submittedAnswers && attempt.submittedAnswers.length > 0) {
                attempt.submittedAnswers.forEach(ans => {
                    if (ans.isCorrect === false) {
                        const qId = ans.questionId.toString();
                        if (!failedQuestionsTracker[qId]) {
                            failedQuestionsTracker[qId] = {
                                count: 0,
                                module: attempt.module?.title || 'Unknown',
                                department: attempt.module?.department || 'Unknown'
                            };
                        }
                        failedQuestionsTracker[qId].count += 1;
                    }
                });
            }
        });

        const topFailedIds = Object.keys(failedQuestionsTracker)
            .sort((a, b) => failedQuestionsTracker[b].count - failedQuestionsTracker[a].count)
            .slice(0, 5);

        const failedQuestionsData = await Question.find({ _id: { $in: topFailedIds } }).select('questionText').lean();

        const failAnalysis = failedQuestionsData.map(q => ({
            questionText: q.questionText,
            moduleTitle: failedQuestionsTracker[q._id.toString()].module,
            department: failedQuestionsTracker[q._id.toString()].department,
            failCount: failedQuestionsTracker[q._id.toString()].count
        })).sort((a, b) => b.failCount - a.failCount);

        res.status(200).json({
            success: true,
            data: {
                kpis: { totalTrainees, passedCount, failedCount, inTrainingCount, pendingDecisionCount },
                departmentStats,
                topPerformers,
                lowPerformers,
                failAnalysis
            }
        });

    } catch (error) {
        console.error("Dashboard Analytics Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// --- CONTROLLER: DELETE TRAINEE (Permanent Data Wipe) ---
export const deleteTraineeRecord = async (req, res) => {
    try {
        const { id } = req.params;

        const profile = await TrainingProfile.findById(id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Profile not found." });
        }

        const userId = profile.user;

        await Progress.deleteMany({ user: userId });
        await TestAttempt.deleteMany({ user: userId });
        await TrainingProfile.findByIdAndDelete(id);
        await User.findByIdAndDelete(userId);

        res.status(200).json({
            success: true,
            message: "Candidate and all associated training records have been permanently deleted."
        });

    } catch (error) {
        console.error("Error deleting trainee:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// --- CONTROLLER: CREATE TRAINING MODULE ---
export const createTrainingModule = async (req, res) => {
    try {
        const { title, description, category, sequenceOrder, assignedDepartment } = req.body;
        const { role, companyId, _id: authorityId } = req.user;

        const isTopAdmin = TOP_LEVEL_ADMINS.includes(role);
        const isDeptHead = DEPT_HEADS.includes(role);

        if (!isTopAdmin && !isDeptHead) {
            return res.status(403).json({ success: false, message: "Unauthorized to create modules." });
        }

        let finalDepartment;
        if (isTopAdmin) {
            if (!assignedDepartment) return res.status(400).json({ success: false, message: "Department is required." });
            finalDepartment = assignedDepartment;
        } else {
            finalDepartment = getDepartmentFromRole(role);
        }

        const contents = [];
        if (req.files && req.files.length > 0) {
            let watchTimes = [];
            if (req.body.minWatchTimes) {
                try {
                    watchTimes = JSON.parse(req.body.minWatchTimes);
                } catch (e) {
                    watchTimes = req.body.minWatchTimes.split(',').map(val => parseInt(val.trim()) || 0);
                }
            }

            req.files.forEach((file, index) => {
                let contentType = 'Video';
                if (file.mimetype === 'application/pdf') contentType = 'PDF';
                else if (file.mimetype.includes('powerpoint') || file.mimetype.includes('presentation')) contentType = 'PPT';

                const normalizedPath = file.path.replace(/\\/g, "/");
                contents.push({
                    contentType: contentType,
                    mediaUrl: normalizedPath,
                    minWatchTime: watchTimes[index] || 0
                });
            });
        }

        const newModule = await Module.create({
            companyId,
            title,
            description,
            department: finalDepartment,
            category,
            sequenceOrder: parseInt(sequenceOrder),
            contents,
            createdBy: authorityId
        });

        res.status(201).json({
            success: true,
            message: "Training module created successfully.",
            data: newModule
        });

    } catch (error) {
        console.error("Error creating module:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const getModules = async (req, res) => {
    try {
        const { role, companyId } = req.user;
        const isTopAdmin = TOP_LEVEL_ADMINS.includes(role);

        let query = { companyId };

        if (!isTopAdmin) {
            query.department = getDepartmentFromRole(role);
        } else if (req.query.department) {
            query.department = req.query.department;
        }

        if (req.query.status === 'Archived') {
            query.isActive = false;
        } else if (req.query.status === 'All') {
            // Fetch all
        } else {
            query.isActive = true;
        }

        const modules = await Module.find(query).sort({ sequenceOrder: 1 });
        res.status(200).json({ success: true, count: modules.length, data: modules });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const deactivateModule = async (req, res) => {
    try {
        const updatedModule = await Module.findOneAndUpdate(
            { _id: req.params.id, companyId: req.user.companyId },
            { isActive: false }, { new: true }
        );
        if (!updatedModule) return res.status(404).json({ success: false, message: "Module not found." });
        res.status(200).json({ success: true, message: "Module deactivated." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const updateTrainingModule = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, sequenceOrder } = req.body;
        const { companyId, role } = req.user;

        if (!TOP_LEVEL_ADMINS.includes(role) && !DEPT_HEADS.includes(role)) {
            return res.status(403).json({ success: false, message: "Unauthorized to edit modules." });
        }

        const updatedModule = await Module.findOneAndUpdate(
            { _id: id, companyId },
            { title, description, category, sequenceOrder: parseInt(sequenceOrder) },
            { new: true, runValidators: true }
        );

        if (!updatedModule) {
            return res.status(404).json({ success: false, message: "Module not found." });
        }

        res.status(200).json({ success: true, message: "Module updated successfully.", data: updatedModule });
    } catch (error) {
        console.error("Error updating module:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const addMediaToModule = async (req, res) => {
    try {
        const { id } = req.params;
        const { companyId, role } = req.user;

        if (!TOP_LEVEL_ADMINS.includes(role) && !DEPT_HEADS.includes(role)) {
            return res.status(403).json({ success: false, message: "Unauthorized to edit modules." });
        }

        const module = await Module.findOne({ _id: id, companyId });
        if (!module) {
            return res.status(404).json({ success: false, message: "Module not found." });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No files provided." });
        }

        let watchTimes = [];
        if (req.body.minWatchTimes) {
            try {
                watchTimes = JSON.parse(req.body.minWatchTimes);
            } catch (e) {
                watchTimes = req.body.minWatchTimes.split(',').map(val => parseInt(val.trim()) || 0);
            }
        }

        const newContents = [];
        req.files.forEach((file, index) => {
            let contentType = 'Video';
            if (file.mimetype === 'application/pdf') contentType = 'PDF';
            else if (file.mimetype.includes('powerpoint') || file.mimetype.includes('presentation')) contentType = 'PPT';

            const normalizedPath = file.path.replace(/\\/g, "/");
            newContents.push({
                contentType: contentType,
                mediaUrl: normalizedPath,
                minWatchTime: watchTimes[index] || 0
            });
        });

        module.contents.push(...newContents);
        await module.save();

        res.status(200).json({
            success: true,
            message: "Media added successfully.",
            data: module
        });

    } catch (error) {
        console.error("Error adding media:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const removeMediaFromModule = async (req, res) => {
    try {
        const { moduleId, contentId } = req.params;
        const { companyId, role } = req.user;

        if (!TOP_LEVEL_ADMINS.includes(role) && !DEPT_HEADS.includes(role)) {
            return res.status(403).json({ success: false, message: "Unauthorized to edit modules." });
        }

        const module = await Module.findOne({ _id: moduleId, companyId });
        if (!module) {
            return res.status(404).json({ success: false, message: "Module not found." });
        }

        const mediaItem = module.contents.id(contentId);
        if (!mediaItem) {
            return res.status(404).json({ success: false, message: "Media item not found in this module." });
        }

        try {
            const filePath = path.resolve(mediaItem.mediaUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (fileError) {
            console.error("Could not delete physical file, but continuing database removal:", fileError);
        }

        module.contents.pull(contentId);
        await module.save();

        res.status(200).json({
            success: true,
            message: "Media removed successfully.",
            data: module
        });

    } catch (error) {
        console.error("Error removing media:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// --- CONTROLLER: ADD QUESTION TO MODULE ---
export const addQuestionToModule = async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { questionText, options, correctOption } = req.body;
        const { companyId, _id: authorityId } = req.user;

        const parentModule = await Module.findOne({ _id: moduleId, companyId });
        if (!parentModule) {
            return res.status(404).json({ success: false, message: "Module not found or unauthorized." });
        }

        if (!options || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({ success: false, message: "Please provide valid MCQ options." });
        }

        const newQuestion = await Question.create({
            companyId,
            module: moduleId,
            questionText,
            options,
            correctOption,
            createdBy: authorityId
        });

        res.status(201).json({
            success: true,
            message: "Question added to bank successfully.",
            data: newQuestion
        });

    } catch (error) {
        console.error("Error adding question:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const getQuestions = async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { companyId } = req.user;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        const query = { module: moduleId, companyId };

        const questions = await Question.find(query).skip(skip).limit(limit);
        const totalDocuments = await Question.countDocuments(query);

        res.status(200).json({
            success: true, count: questions.length, total: totalDocuments, currentPage: page,
            totalPages: Math.ceil(totalDocuments / limit), data: questions
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const deleteQuestion = async (req, res) => {
    try {
        const deletedQuestion = await Question.findOneAndDelete({ _id: req.params.questionId, companyId: req.user.companyId });
        if (!deletedQuestion) return res.status(404).json({ success: false, message: "Question not found." });
        res.status(200).json({ success: true, message: "Question removed." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const updateQuestion = async (req, res) => {
    try {
        const { questionId } = req.params;
        const { questionText, options, correctOption } = req.body;
        const { companyId } = req.user;

        if (options && (!Array.isArray(options) || options.length < 2)) {
            return res.status(400).json({ success: false, message: "Please provide valid MCQ options." });
        }

        const updatedQuestion = await Question.findOneAndUpdate(
            { _id: questionId, companyId },
            { questionText, options, correctOption },
            { new: true, runValidators: true }
        );

        if (!updatedQuestion) {
            return res.status(404).json({ success: false, message: "Question not found." });
        }

        res.status(200).json({ success: true, message: "Question updated successfully.", data: updatedQuestion });
    } catch (error) {
        console.error("Error updating question:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};