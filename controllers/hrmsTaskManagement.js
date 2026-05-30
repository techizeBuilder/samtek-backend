import Task from "../models/taskManagement.js";
import fs from "fs";
import path from "path";
import { sendTaskEmail } from "../utils/taskEmail.js";

// --- ROLE HIERARCHY & HELPERS ---
const TOP_LEVEL_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin'];

// 🔥 ADDED NEW DEPARTMENT HEADS HERE
const DEPT_HEADS = [
  'Production Head', 'Packing Head', 'Dispatch Head',
  'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
  'Unit Head', 'Unit Manager',
  'Research & Development Head', 'Store Head', 'QC Head'
];

// Dynamically extracts department name from the user's role
const getDepartmentFromRole = (role) => {
  if (!role) return "General";

  if (role.includes('Production')) return 'Production';
  if (role.includes('Packing')) return 'Packing';
  if (role.includes('Dispatch')) return 'Dispatch';
  if (role.includes('Account') || role.includes('Finance')) return 'Accounts';
  if (role.includes('Sales')) return 'Sales';

  // 🔥 ADDED NEW DEPARTMENTS HERE
  if (role.includes('Research') || role.includes('R&D')) return 'R&D';
  if (role.includes('Store')) return 'Store';
  if (role.includes('QC')) return 'QC';

  // Fallback: Removes " Head", " Manager", or " Employee" to get the base department
  return role.replace(/(Head|Manager|Employee)/gi, '').trim() || "General";
};
// -------------------------------------

//create task
export const createTask = async (req, res) => {
  try {
    const { title, description, assignedTo, priority, dueDate, taskType, reminder, department } = req.body;

    if (!title || !description || !taskType || !dueDate) {
      return res.status(400).json({
        success: false,
        message: "Title, description, task type, and due date are mandatory."
      });
    }

    const assignedUsers = Array.isArray(assignedTo) ? assignedTo : [assignedTo];

    if (assignedUsers.length === 0 || !assignedUsers[0]) {
      return res.status(400).json({
        success: false,
        message: "At least one user must be assigned."
      });
    }

    const filePath = req.file
      ? req.file.path.replace(/\\/g, "/")
      : null;

    // Determine the department based on the 3-Tier Roles
    let taskDepartment;
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role);

    if (isTopAdmin) {
      // Top admins can pick any department
      taskDepartment = req.body.department;
      if (!taskDepartment) {
        return res.status(400).json({ message: "Department selection is required for Top Admins." });
      }
    } else if (isDeptHead) {
      // Force the department to match the Head's role automatically
      taskDepartment = getDepartmentFromRole(req.user.role);
    } else {
      // Normal employees cannot create tasks
      return res.status(403).json({ message: "Employees are not authorized to assign tasks." });
    }

    const task = new Task({
      title,
      description,
      assignedTo: assignedUsers,
      priority: priority || "Medium",
      status: "Pending",
      dueDate,
      taskType,
      file: filePath,
      reminder: reminder === 'true' || reminder === true,
      createdBy: req.user._id,
      department: taskDepartment,
      companyId: req.user.companyId,

      // Initialize Activity Log
      activityLog: [{
        action: "Task Created",
        performedBy: req.user._id,
        timestamp: new Date()
      }]
    });

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate("assignedTo", "username email")
      .populate("createdBy", "username role")
      .populate({
        path: "activityLog.performedBy",
        select: "username role"
      })
      .populate({
        path: "comments.user",
        select: "username role"
      });

    if (populatedTask.assignedTo && populatedTask.assignedTo.length > 0) {
      const emailPromises = populatedTask.assignedTo.map(assignee => {
        if (assignee.email) {
          return sendTaskEmail({
            to: assignee.email,
            userName: assignee.username,
            subject: `New Task Assigned: ${populatedTask.title}`,
            title: "New Task Assigned",
            message: `You have been assigned a new task by <strong>${populatedTask.createdBy.username}</strong>.`,
            taskDetails: {
              title: populatedTask.title,
              type: populatedTask.taskType,
              priority: populatedTask.priority,
              status: populatedTask.status,
              dueDate: populatedTask.dueDate
            }
          });
        }
        return Promise.resolve();
      });

      Promise.allSettled(emailPromises);
    }

    return res.status(201).json({
      success: true,
      message: "Task created and locked successfully",
      data: populatedTask
    });
  } catch (error) {
    console.error("Create Task Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message.includes("locked")
        ? "Validation Error: " + error.message
        : "Server error while creating task",
      error: error.message
    });
  }
};

// get all tasks with pagination, search, and filters
export const getAllTasks = async (req, res) => {
  try {
    const {
      page = "1", limit = "10", search, status,
      priority, taskType, assignedTo, date, department
    } = req.query;

    const query = {};

    if (!req.user.permissions?.canAccessAllUnits) {
      query.companyId = req.user.companyId;
    }

    // --- 3-TIER RBAC FILTER ---
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role);

    if (!isTopAdmin) {
      if (isDeptHead) {
        // Dept Heads are strictly locked to their department, they cannot use the filter
        query.department = getDepartmentFromRole(req.user.role);
      } else {
        // Employees are locked to their own tasks
        query.assignedTo = req.user._id;
      }
    } else {
      // Top Admins have no locks, so if they pass a department filter, apply it!
      if (department) {
        query.department = department;
      }
    }
    // -------------------------------

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (taskType) query.taskType = taskType;
    if (assignedTo) query.assignedTo = assignedTo;

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.dueDate = { $gte: start, $lte: end };
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const tasks = await Task.find(query)
      .populate("assignedTo", "username email")
      .populate("createdBy", "username role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Task.countDocuments(query);

    return res.status(200).json({
      success: true,
      page: Number(page),
      totalPages: Math.ceil(total / limitNum),
      totalTasks: total,
      data: tasks
    });

  } catch (error) {
    console.error("Get Tasks Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching tasks",
      error: error.message
    });
  }
};

// get task by id with RBAC
export const getTaskById = async (req, res) => {
  try {
    const { taskId } = req.params;

    let query = { _id: taskId };

    if (!req.user.permissions?.canAccessAllUnits) {
      query.companyId = req.user.companyId;
    }

    // --- 3-TIER RBAC FILTER ---
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role);

    if (!isTopAdmin) {
      if (isDeptHead) {
        query.department = getDepartmentFromRole(req.user.role);
      } else {
        query.assignedTo = req.user._id;
      }
    }
    // -------------------------------

    const task = await Task.findOne(query)
      .populate("assignedTo", "username email")
      .populate("createdBy", "username role")
      .populate({
        path: "comments.user",
        select: "username role"
      })
      .populate({
        path: "activityLog.performedBy",
        select: "username role"
      });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or access denied"
      });
    }

    return res.status(200).json({
      success: true,
      data: task
    });

  } catch (error) {
    console.error("Get Task Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching task",
      error: error.message
    });
  }
};

// delete task
export const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    // find task by id
    const task = await Task.findById(taskId)
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // delete file if exists
    if (task.file) {
      try {
        fs.unlinkSync(task.file);
      } catch (err) {
        console.log("File delete error: ", err.message);
      }
    }

    // delete task
    await Task.findByIdAndDelete(taskId)

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully"
    });
  } catch (error) {
    console.error("Delete Task Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting task",
      error: error.message
    });

  }
}

// update task status (only status can be updated as per flow)
export const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // --- 3-TIER ROLE-BASED ACCESS CONTROL CHECK ---
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role) && task.department === getDepartmentFromRole(req.user.role);

    // Convert MongoDB ObjectIds to strings for accurate comparison
    const isAssigned = task.assignedTo.some(assignedId =>
      assignedId.toString() === req.user._id.toString()
    );

    if (!isTopAdmin && !isDeptHead && !isAssigned) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Only assigned users or admins can update this task's status."
      });
    }
    // ---------------------------------------------------

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Only status update is allowed"
      });
    }

    if (task.status === status) {
      return res.status(400).json({
        success: false,
        message: "Status is already the same"
      });
    }

    task.status = status;

    task.activityLog.push({
      action: `Status changed to ${status}`,
      performedBy: req.user._id,
      timestamp: new Date()
    });

    await task.save();

    const updatedTask = await Task.findById(task._id)
      .populate("assignedTo", "username email")
      .populate("createdBy", "username role")
      .populate({
        path: "activityLog.performedBy",
        select: "username role"
      });

    return res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      data: updatedTask
    });

  } catch (error) {
    console.error("Update Task Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while updating task",
      error: error.message
    });
  }
};

// Dashboard statistics endpoint
export const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const upcomingRange = new Date(endOfToday);
    upcomingRange.setDate(upcomingRange.getDate() + 3);

    let query = {};

    if (!req.user.permissions?.canAccessAllUnits) {
      query.companyId = req.user.companyId;
    }

    // --- 3-TIER RBAC FILTER ---
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role);

    if (!isTopAdmin) {
      if (isDeptHead) {
        query.department = getDepartmentFromRole(req.user.role);
      } else {
        query.assignedTo = req.user._id;
      }
    }
    // -------------------------------

    const [
      statusStats, priorityStats, todayTasks, upcomingTasks, totalCount, overdueCount, departmentStats
    ] = await Promise.all([
      Task.aggregate([{ $match: query }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: query }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Task.countDocuments({ ...query, dueDate: { $gte: startOfToday, $lte: endOfToday } }),
      Task.countDocuments({ ...query, dueDate: { $gt: endOfToday, $lte: upcomingRange }, status: { $ne: "Completed" } }),
      Task.countDocuments(query),
      Task.countDocuments({ ...query, status: { $ne: "Completed" }, dueDate: { $lt: startOfToday } }),
      Task.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$department",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            _id: 0, department: "$_id", total: 1, completed: 1,
            completionRate: {
              $cond: [
                { $gt: ["$total", 0] },
                { $round: [{ $multiply: [{ $divide: ["$completed", "$total"] }, 100] }, 2] },
                0
              ]
            }
          }
        }
      ])
    ]);

    const statusMap = {};
    statusStats.forEach(s => (statusMap[s._id] = s.count));

    const priorityMap = {};
    priorityStats.forEach(p => (priorityMap[p._id] = p.count));

    const stats = {
      totalTasks: totalCount,
      statusBreakdown: {
        pending: statusMap["Pending"] || 0,
        inProgress: statusMap["In Progress"] || 0,
        completed: statusMap["Completed"] || 0,
        hold: statusMap["Hold"] || 0,
        overdue: overdueCount
      },
      priorityDistribution: {
        high: priorityMap["High"] || 0,
        medium: priorityMap["Medium"] || 0,
        low: priorityMap["Low"] || 0
      },
      deadlines: {
        today: todayTasks,
        upcoming: upcomingTasks
      },
      performance: {
        completionRate: totalCount > 0 ? Number((((statusMap["Completed"] || 0) / totalCount) * 100).toFixed(2)) : 0,
        departmentPerformance: !isTopAdmin && !isDeptHead ? [] : departmentStats
      }
    };

    return res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching dashboard statistics",
      error: error.message
    });
  }
};

export const addComment = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Comment text is required"
      });
    }

    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // --- 3-TIER ROLE-BASED ACCESS CONTROL CHECK ---
    const isTopAdmin = TOP_LEVEL_ADMINS.includes(req.user.role);
    const isDeptHead = DEPT_HEADS.includes(req.user.role) && task.department === getDepartmentFromRole(req.user.role);

    // Convert MongoDB ObjectIds to strings for accurate comparison
    const isAssigned = task.assignedTo.some(assignedId =>
      assignedId.toString() === req.user._id.toString()
    );

    if (!isTopAdmin && !isDeptHead && !isAssigned) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to comment on this task"
      });
    }
    // ---------------------------------------------------

    const newComment = {
      user: req.user._id,
      text,
      createdAt: new Date()
    };

    task.comments.push(newComment);

    task.activityLog.push({
      action: "Comment added",
      performedBy: req.user._id,
      timestamp: new Date()
    });

    await task.save();

    const updatedTask = await Task.findById(task._id)
      .populate("assignedTo", "username email")
      .populate("createdBy", "username role")
      .populate({
        path: "comments.user",
        select: "username role"
      })
      .populate({
        path: "activityLog.performedBy",
        select: "username role"
      });

    return res.status(200).json({
      success: true,
      message: "Comment added successfully",
      data: updatedTask
    });

  } catch (error) {
    console.error("Add Comment Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while adding comment",
      error: error.message
    });
  }
};