import mongoose from "mongoose";
import Task from "../models/taskManagement.js";
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit-table';

// ==========================================
// ROLE HIERARCHY & HELPERS
// ==========================================
const TOP_LEVEL_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin'];
const DEPT_HEADS = [
    'Production Head', 'Packing Head', 'Dispatch Head',
    'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
    'Unit Head', 'Unit Manager',
    'Research & Development Head', 'Store Head', 'QC Head'
];

// JS helper - used for req.user.role on the JS side
const getDepartmentFromRole = (role) => {
    if (!role) return "General";
    if (role.includes('Production')) return 'Production';
    if (role.includes('Packing')) return 'Packing';
    if (role.includes('Dispatch')) return 'Dispatch';
    if (role.includes('Account') || role.includes('Finance')) return 'Accounts';
    if (role.includes('Sales')) return 'Sales';
    if (role.includes('Research') || role.includes('R&D')) return 'R&D';
    if (role.includes('Store')) return 'Store';
    if (role.includes('QC')) return 'QC';
    return role.replace(/(Head|Manager|Employee)/gi, '').trim() || "General";
};

// MongoDB $switch equivalent of getDepartmentFromRole
// roleField = aggregation field ref e.g. "$user.role"
const roleToDeptSwitch = (roleField) => ({
    $switch: {
        branches: [
            { case: { $regexMatch: { input: roleField, regex: 'Production', options: 'i' } }, then: 'Production' },
            { case: { $regexMatch: { input: roleField, regex: 'Packing', options: 'i' } }, then: 'Packing' },
            { case: { $regexMatch: { input: roleField, regex: 'Dispatch', options: 'i' } }, then: 'Dispatch' },
            { case: { $regexMatch: { input: roleField, regex: 'Account', options: 'i' } }, then: 'Accounts' },
            { case: { $regexMatch: { input: roleField, regex: 'Finance', options: 'i' } }, then: 'Accounts' },
            { case: { $regexMatch: { input: roleField, regex: 'Sales', options: 'i' } }, then: 'Sales' },
            { case: { $regexMatch: { input: roleField, regex: 'Research', options: 'i' } }, then: 'R&D' },
            { case: { $regexMatch: { input: roleField, regex: 'Store', options: 'i' } }, then: 'Store' },
            { case: { $regexMatch: { input: roleField, regex: 'QC', options: 'i' } }, then: 'QC' },
        ],
        default: 'General'
    }
});

// ==========================================
// DATE RANGE HELPER
// ==========================================
// period=today|week|month  OR  startDate+endDate
const buildDateRange = (req, dateField = 'dueDate') => {
    const { period, startDate, endDate } = req.query;
    const now = new Date();
    if (period === 'today') {
        const s = new Date(now); s.setHours(0, 0, 0, 0);
        const e = new Date(now); e.setHours(23, 59, 59, 999);
        return { [dateField]: { $gte: s, $lte: e } };
    }
    if (period === 'week') {
        const s = new Date(now); s.setDate(now.getDate() - 6); s.setHours(0, 0, 0, 0);
        const e = new Date(now); e.setHours(23, 59, 59, 999);
        return { [dateField]: { $gte: s, $lte: e } };
    }
    if (period === 'month') {
        const s = new Date(now); s.setDate(now.getDate() - 29); s.setHours(0, 0, 0, 0);
        const e = new Date(now); e.setHours(23, 59, 59, 999);
        return { [dateField]: { $gte: s, $lte: e } };
    }
    if (startDate || endDate) {
        const range = {};
        if (startDate) range.$gte = new Date(startDate);
        if (endDate) { const e = new Date(endDate); e.setHours(23, 59, 59, 999); range.$lte = e; }
        return { [dateField]: range };
    }
    return null;
};

// ==========================================
// CENTRALIZED RBAC MATCH BUILDER
// ==========================================
const buildReportQuery = (req) => {
    const query = {};
    if (!req.user.permissions?.canAccessAllUnits) {
        query.companyId = req.user.companyId;
    }
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role);
    if (!isTopAdmin && !isDeptHead) return null;
    if (isTopAdmin) {
        if (req.query.department && req.query.department !== 'All') {
            query.department = req.query.department;
        }
    } else if (isDeptHead) {
        query.department = getDepartmentFromRole(req.user.role);
    }
    return query;
};

// ==========================================
// EMPLOYEE REPORT PIPELINE (shared by UI + Exports)
// ==========================================
const buildEmployeeReportPipeline = (req) => {
    const matchStage = buildReportQuery(req);
    if (!matchStage) return null;
    const { assignedTo, search } = req.query;
    const dateRange = buildDateRange(req, 'dueDate');
    if (dateRange) Object.assign(matchStage, dateRange);
    if (assignedTo) matchStage.assignedTo = new mongoose.Types.ObjectId(assignedTo);

    const pipeline = [
        { $match: matchStage },
        { $unwind: '$assignedTo' }
    ];
    if (assignedTo) {
        pipeline.push({ $match: { assignedTo: new mongoose.Types.ObjectId(assignedTo) } });
    }
    pipeline.push({
        $group: {
            _id: '$assignedTo',
            totalAssigned: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
            overdue: {
                $sum: {
                    $cond: [{ $and: [{ $lt: ['$dueDate', new Date()] }, { $ne: ['$status', 'Completed'] }] }, 1, 0]
                }
            }
        }
    });
    pipeline.push(
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' }
    );
    if (search) {
        pipeline.push({ $match: { 'user.username': { $regex: search, $options: 'i' } } });
    }
    // Department from role via $switch - no user.department field needed
    pipeline.push(
        {
            $project: {
                _id: 1,
                employeeName: '$user.username',
                role: '$user.role',
                department: roleToDeptSwitch('$user.role'),
                totalAssigned: 1,
                completed: 1,
                pending: 1,
                inProgress: 1,
                overdue: 1,
                completionRate: {
                    $round: [{ $multiply: [{ $divide: ['$completed', { $max: ['$totalAssigned', 1] }] }, 100] }, 2]
                }
            }
        },
        { $sort: { completionRate: -1, employeeName: 1 } }
    );
    return pipeline;
};

// ==========================================
// REPORT 1: EMPLOYEE-WISE TASK COMPLETION (With Pagination)
// ==========================================
export const getEmployeePerformance = async (req, res) => {
    try {
        const pipeline = buildEmployeeReportPipeline(req);
        if (!pipeline) return res.status(403).json({ message: 'Unauthorized to view reports.' });
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        pipeline.push({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [{ $skip: skip }, { $limit: limit }]
            }
        });
        const reportData = await Task.aggregate(pipeline);
        const total = reportData[0].metadata[0]?.total || 0;
        return res.status(200).json({
            success: true,
            data: reportData[0].data,
            page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// REPORT 2: OVERDUE REPORT (With Pagination + Date Filter)
// ==========================================
export const getOverdueTasks = async (req, res) => {
    try {
        const matchStage = buildReportQuery(req);
        if (!matchStage) return res.status(403).json({ message: 'Unauthorized' });

        matchStage.status = { $ne: 'Completed' };
        matchStage.dueDate = { $lt: new Date() };

        // Optionally narrow the overdue window by period/startDate/endDate
        const dateRange = buildDateRange(req, 'dueDate');
        if (dateRange?.dueDate) {
            matchStage.dueDate = { ...dateRange.dueDate, $lt: new Date() };
        }
        if (req.query.assignedTo) {
            matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search;

        const pipeline = [
            { $match: matchStage },
            {
                $addFields: {
                    daysOverdue: { $dateDiff: { startDate: '$dueDate', endDate: new Date(), unit: 'day' } }
                }
            },
            { $sort: { daysOverdue: -1 } },
            { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedUsers' } },
            {
                $project: {
                    title: 1, priority: 1, dueDate: 1, taskType: 1, department: 1, daysOverdue: 1,
                    // Department per assigned user from role
                    assignedUsers: {
                        $map: {
                            input: '$assignedUsers', as: 'u',
                            in: {
                                username: '$$u.username',
                                department: roleToDeptSwitch('$$u.role')
                            }
                        }
                    }
                }
            }
        ];

        if (search) {
            pipeline.splice(1, 0, { $match: { title: { $regex: search, $options: 'i' } } });
        }

        pipeline.push({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [{ $skip: skip }, { $limit: limit }]
            }
        });

        const result = await Task.aggregate(pipeline);
        const total = result[0].metadata[0]?.total || 0;
        return res.status(200).json({
            success: true,
            data: result[0].data,
            page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// REPORT 3: EMPLOYEE-WISE TASK TYPE EFFICIENCY (With Pagination)
// Groups: Employee -> TaskType breakdown with completion stats
// Top Admin: all employees (dept filter optional)
// Dept Head: locked to their department
// ==========================================
export const getTaskTypeEfficiency = async (req, res) => {
    try {
        const matchStage = buildReportQuery(req);
        if (!matchStage) return res.status(403).json({ message: 'Unauthorized' });

        const dateRange = buildDateRange(req, 'dueDate');
        if (dateRange) Object.assign(matchStage, dateRange);

        if (req.query.assignedTo) {
            matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const pipeline = [
            { $match: matchStage },
            { $unwind: '$assignedTo' },
            // Group by Employee + TaskType
            {
                $group: {
                    _id: { employee: '$assignedTo', taskType: '$taskType' },
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } }
                }
            },
            { $lookup: { from: 'users', localField: '_id.employee', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            // Re-group by Employee to build taskTypes array
            {
                $group: {
                    _id: '$_id.employee',
                    employeeName: { $first: '$user.username' },
                    role: { $first: '$user.role' },
                    taskTypes: {
                        $push: {
                            taskType: '$_id.taskType',
                            total: '$total',
                            completed: '$completed',
                            efficiencyRate: {
                                $round: [{ $multiply: [{ $divide: ['$completed', { $max: ['$total', 1] }] }, 100] }, 2]
                            }
                        }
                    },
                    grandTotal: { $sum: '$total' },
                    grandCompleted: { $sum: '$completed' }
                }
            },
            // Department from role via $switch
            {
                $project: {
                    _id: 1,
                    employeeName: 1,
                    role: 1,
                    department: roleToDeptSwitch('$role'),
                    taskTypes: 1,
                    grandTotal: 1,
                    grandCompleted: 1,
                    overallEfficiency: {
                        $round: [{ $multiply: [{ $divide: ['$grandCompleted', { $max: ['$grandTotal', 1] }] }, 100] }, 2]
                    }
                }
            },
            { $sort: { overallEfficiency: -1, employeeName: 1 } }
        ];

        if (req.query.search) {
            pipeline.push({ $match: { employeeName: { $regex: req.query.search, $options: 'i' } } });
        }

        pipeline.push({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [{ $skip: skip }, { $limit: limit }]
            }
        });

        const result = await Task.aggregate(pipeline);
        const total = result[0].metadata[0]?.total || 0;
        return res.status(200).json({
            success: true,
            data: result[0].data,
            page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// REPORT 4: DAILY / WEEKLY PRODUCTIVITY
// groupBy=daily (default) or groupBy=weekly
// Uses activityLog timestamps for precise completion date
// ==========================================
export const getProductivityTrends = async (req, res) => {
    try {
        const matchStage = buildReportQuery(req);
        if (!matchStage) return res.status(403).json({ message: 'Unauthorized' });

        const { groupBy = 'daily' } = req.query;

        // Default range: last 30 days. Override with period or startDate/endDate.
        let effectiveEnd = new Date(); effectiveEnd.setHours(23, 59, 59, 999);
        let effectiveStart = new Date(effectiveEnd); effectiveStart.setDate(effectiveStart.getDate() - 29); effectiveStart.setHours(0, 0, 0, 0);

        const dateRange = buildDateRange(req, 'completionDate');
        if (dateRange?.completionDate) {
            if (dateRange.completionDate.$gte) effectiveStart = dateRange.completionDate.$gte;
            if (dateRange.completionDate.$lte) effectiveEnd = dateRange.completionDate.$lte;
        } else if (req.query.startDate || req.query.endDate) {
            if (req.query.startDate) effectiveStart = new Date(req.query.startDate);
            if (req.query.endDate) { effectiveEnd = new Date(req.query.endDate); effectiveEnd.setHours(23, 59, 59, 999); }
        }

        if (req.query.assignedTo) {
            matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);
        }

        matchStage.status = 'Completed';

        const dateGroupFormat = groupBy === 'weekly'
            ? { year: { $isoWeekYear: '$completionDate' }, week: { $isoWeek: '$completionDate' } }
            : { $dateToString: { format: '%Y-%m-%d', date: '$completionDate' } };

        const productivityData = await Task.aggregate([
            { $match: matchStage },
            { $unwind: '$activityLog' },
            {
                $match: {
                    'activityLog.action': { $regex: '^Status changed to Completed$', $options: 'i' },
                    'activityLog.timestamp': { $gte: effectiveStart, $lte: effectiveEnd }
                }
            },
            { $addFields: { completionDate: '$activityLog.timestamp' } },
            {
                $group: {
                    _id: dateGroupFormat,
                    tasksCompleted: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        return res.status(200).json({
            success: true,
            groupBy,
            period: { startDate: effectiveStart, endDate: effectiveEnd },
            data: productivityData
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// EXPORT HELPERS
// ==========================================
const sendExcel = (res, rows, sheetName, fileName) => {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
    return res.send(buffer);
};

const sendPDF = async (res, title, tableArray, fileName) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown(1.5);
    await doc.table(tableArray, {
        prepareHeader: () => doc.font('Helvetica-Bold').fontSize(9),
        prepareRow: () => doc.font('Helvetica').fontSize(9)
    });
    doc.end();
};

// ==========================================
// EXPORT 1: EMPLOYEE REPORT - EXCEL
// ==========================================
export const exportEmployeeReportExcel = async (req, res) => {
    try {
        const pipeline = buildEmployeeReportPipeline(req);
        if (!pipeline) return res.status(403).json({ message: 'Unauthorized' });
        const reportData = await Task.aggregate(pipeline);
        const rows = reportData.map(r => ({
            'Employee Name': r.employeeName,
            'Role': r.role,
            'Department': r.department || 'General',
            'Total Tasks': r.totalAssigned,
            'Completed': r.completed,
            'Pending': r.pending,
            'In Progress': r.inProgress,
            'Overdue': r.overdue,
            'Completion Rate (%)': `${r.completionRate}%`
        }));
        return sendExcel(res, rows, 'Employee Performance', 'Employee_Performance_Report');
    } catch (error) {
        console.error('Excel Export Error:', error);
        return res.status(500).json({ success: false, message: 'Error generating Excel file.' });
    }
};

// ==========================================
// EXPORT 2: EMPLOYEE REPORT - PDF
// ==========================================
export const exportEmployeeReportPDF = async (req, res) => {
    try {
        const pipeline = buildEmployeeReportPipeline(req);
        if (!pipeline) return res.status(403).json({ message: 'Unauthorized' });
        const reportData = await Task.aggregate(pipeline);
        const tableArray = {
            headers: ['Employee Name', 'Department', 'Total', 'Completed', 'Pending', 'Overdue', 'Rate (%)'],
            rows: reportData.map(r => [
                r.employeeName, r.department || 'General',
                String(r.totalAssigned), String(r.completed),
                String(r.pending), String(r.overdue),
                `${r.completionRate}%`
            ])
        };
        return await sendPDF(res, 'Employee Performance Report', tableArray, 'Employee_Performance_Report');
    } catch (error) {
        console.error('PDF Export Error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF.' });
    }
};

// ==========================================
// OVERDUE PIPELINE HELPER (shared by UI and export)
// ==========================================
const buildOverduePipeline = (req) => {
    const matchStage = buildReportQuery(req);
    if (!matchStage) return null;
    matchStage.status = { $ne: 'Completed' };
    matchStage.dueDate = { $lt: new Date() };
    const dateRange = buildDateRange(req, 'dueDate');
    if (dateRange?.dueDate) matchStage.dueDate = { ...dateRange.dueDate, $lt: new Date() };
    if (req.query.assignedTo) matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);
    return [
        { $match: matchStage },
        { $addFields: { daysOverdue: { $dateDiff: { startDate: '$dueDate', endDate: new Date(), unit: 'day' } } } },
        { $sort: { daysOverdue: -1 } },
        { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedUsers' } }
    ];
};

// ==========================================
// EXPORT 3: OVERDUE REPORT - EXCEL
// ==========================================
export const exportOverdueReportExcel = async (req, res) => {
    try {
        const pipeline = buildOverduePipeline(req);
        if (!pipeline) return res.status(403).json({ message: 'Unauthorized' });
        const data = await Task.aggregate(pipeline);
        const rows = data.map(r => ({
            'Task Title': r.title,
            'Task Type': r.taskType,
            'Priority': r.priority,
            'Department': r.department,
            'Due Date': new Date(r.dueDate).toLocaleDateString(),
            'Days Overdue': r.daysOverdue,
            'Assigned To': r.assignedUsers.map(u => u.username).join(', ')
        }));
        return sendExcel(res, rows, 'Overdue Tasks', 'Overdue_Tasks_Report');
    } catch (error) {
        console.error('Overdue Excel Error:', error);
        return res.status(500).json({ success: false, message: 'Error generating Excel file.' });
    }
};

// ==========================================
// EXPORT 4: OVERDUE REPORT - PDF
// ==========================================
export const exportOverdueReportPDF = async (req, res) => {
    try {
        const pipeline = buildOverduePipeline(req);
        if (!pipeline) return res.status(403).json({ message: 'Unauthorized' });
        const data = await Task.aggregate(pipeline);
        const tableArray = {
            headers: ['Task Title', 'Type', 'Priority', 'Dept', 'Due Date', 'Days Overdue', 'Assigned To'],
            rows: data.map(r => [
                r.title, r.taskType, r.priority, r.department,
                new Date(r.dueDate).toLocaleDateString(),
                String(r.daysOverdue),
                r.assignedUsers.map(u => u.username).join(', ')
            ])
        };
        return await sendPDF(res, 'Overdue Tasks Report', tableArray, 'Overdue_Tasks_Report');
    } catch (error) {
        console.error('Overdue PDF Error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF.' });
    }
};

// ==========================================
// TASK TYPE EFFICIENCY PIPELINE HELPER (shared)
// ==========================================
const buildEfficiencyData = async (req) => {
    const matchStage = buildReportQuery(req);
    if (!matchStage) return null;
    const dateRange = buildDateRange(req, 'dueDate');
    if (dateRange) Object.assign(matchStage, dateRange);
    if (req.query.assignedTo) matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);

    return Task.aggregate([
        { $match: matchStage },
        { $unwind: '$assignedTo' },
        {
            $group: {
                _id: { employee: '$assignedTo', taskType: '$taskType' },
                total: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } }
            }
        },
        { $lookup: { from: 'users', localField: '_id.employee', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        {
            $group: {
                _id: '$_id.employee',
                employeeName: { $first: '$user.username' },
                role: { $first: '$user.role' },
                taskTypes: { $push: { taskType: '$_id.taskType', total: '$total', completed: '$completed' } }
            }
        }
    ]);
};

// ==========================================
// EXPORT 5: TASK TYPE EFFICIENCY - EXCEL
// ==========================================
export const exportTaskTypeEfficiencyExcel = async (req, res) => {
    try {
        const data = await buildEfficiencyData(req);
        if (!data) return res.status(403).json({ message: 'Unauthorized' });
        const rows = [];
        data.forEach(emp => {
            const dept = getDepartmentFromRole(emp.role);
            emp.taskTypes.forEach(tt => {
                rows.push({
                    'Employee Name': emp.employeeName,
                    'Department': dept,
                    'Task Type': tt.taskType,
                    'Total Tasks': tt.total,
                    'Completed': tt.completed,
                    'Efficiency Rate (%)': `${Math.round((tt.completed / Math.max(tt.total, 1)) * 100)}%`
                });
            });
        });
        return sendExcel(res, rows, 'Task Type Efficiency', 'Task_Type_Efficiency_Report');
    } catch (error) {
        console.error('Task Type Excel Error:', error);
        return res.status(500).json({ success: false, message: 'Error generating Excel file.' });
    }
};

// ==========================================
// EXPORT 6: TASK TYPE EFFICIENCY - PDF
// ==========================================
export const exportTaskTypeEfficiencyPDF = async (req, res) => {
    try {
        const data = await buildEfficiencyData(req);
        if (!data) return res.status(403).json({ message: 'Unauthorized' });
        const rows = [];
        data.forEach(emp => {
            const dept = getDepartmentFromRole(emp.role);
            emp.taskTypes.forEach(tt => {
                rows.push([
                    emp.employeeName, dept, tt.taskType,
                    String(tt.total), String(tt.completed),
                    `${Math.round((tt.completed / Math.max(tt.total, 1)) * 100)}%`
                ]);
            });
        });
        const tableArray = {
            headers: ['Employee Name', 'Department', 'Task Type', 'Total', 'Completed', 'Efficiency (%)'],
            rows
        };
        return await sendPDF(res, 'Task Type Efficiency Report', tableArray, 'Task_Type_Efficiency_Report');
    } catch (error) {
        console.error('Task Type PDF Error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF.' });
    }
};

// ==========================================
// PRODUCTIVITY PIPELINE HELPER (shared)
// ==========================================
const buildProductivityData = async (req) => {
    const matchStage = buildReportQuery(req);
    if (!matchStage) return null;

    const { groupBy = 'daily' } = req.query;
    let effectiveEnd = new Date(); effectiveEnd.setHours(23, 59, 59, 999);
    let effectiveStart = new Date(effectiveEnd); effectiveStart.setDate(effectiveStart.getDate() - 29); effectiveStart.setHours(0, 0, 0, 0);
    if (req.query.startDate) effectiveStart = new Date(req.query.startDate);
    if (req.query.endDate) { effectiveEnd = new Date(req.query.endDate); effectiveEnd.setHours(23, 59, 59, 999); }

    if (req.query.assignedTo) matchStage.assignedTo = new mongoose.Types.ObjectId(req.query.assignedTo);
    matchStage.status = 'Completed';

    const dateGroupFormat = groupBy === 'weekly'
        ? { year: { $isoWeekYear: '$completionDate' }, week: { $isoWeek: '$completionDate' } }
        : { $dateToString: { format: '%Y-%m-%d', date: '$completionDate' } };

    return { groupBy, effectiveStart, effectiveEnd, data: await Task.aggregate([
        { $match: matchStage },
        { $unwind: '$activityLog' },
        {
            $match: {
                'activityLog.action': { $regex: '^Status changed to Completed$', $options: 'i' },
                'activityLog.timestamp': { $gte: effectiveStart, $lte: effectiveEnd }
            }
        },
        { $addFields: { completionDate: '$activityLog.timestamp' } },
        { $group: { _id: dateGroupFormat, tasksCompleted: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]) };
};

// ==========================================
// EXPORT 7: PRODUCTIVITY - EXCEL
// ==========================================
export const exportProductivityExcel = async (req, res) => {
    try {
        const result = await buildProductivityData(req);
        if (!result) return res.status(403).json({ message: 'Unauthorized' });
        const { groupBy, data } = result;
        const rows = data.map(r => ({
            'Period': groupBy === 'weekly' ? `Week ${r._id.week}, ${r._id.year}` : r._id,
            'Tasks Completed': r.tasksCompleted
        }));
        return sendExcel(res, rows, 'Productivity', 'Productivity_Report');
    } catch (error) {
        console.error('Productivity Excel Error:', error);
        return res.status(500).json({ success: false, message: 'Error generating Excel file.' });
    }
};

// ==========================================
// EXPORT 8: PRODUCTIVITY - PDF
// ==========================================
export const exportProductivityPDF = async (req, res) => {
    try {
        const result = await buildProductivityData(req);
        if (!result) return res.status(403).json({ message: 'Unauthorized' });
        const { groupBy, data } = result;
        const tableArray = {
            headers: ['Period', 'Tasks Completed'],
            rows: data.map(r => [
                groupBy === 'weekly' ? `Week ${r._id.week}, ${r._id.year}` : String(r._id),
                String(r.tasksCompleted)
            ])
        };
        return await sendPDF(res, 'Productivity Report', tableArray, 'Productivity_Report');
    } catch (error) {
        console.error('Productivity PDF Error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF.' });
    }
};
