import User from '../models/User.js';
import { Company } from '../models/Company.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import { USER_ROLES } from '../shared/schema.js';
import bcrypt from 'bcryptjs';
import { generateEmployeeId } from '../utils/employeeUtils.js';
import UserDocument from '../models/UserDocument.js';
import { cleanDeviceCode, deviceCodeTaken } from '../services/peopleService.js';
import { applyCodeQuietly } from '../services/deviceSync/deviceProcess.js';
import fs from 'fs';
// Feature 27 (24 Nov 2026): company boundaries, who may edit whom, who may give which role.
import { isSuperAdmin, isAdminTier as adminTier, sameCompany, roleRefusal, isLastCompanyAdmin, LAST_CA_MESSAGE, seedCompanyAdminPermissions, COMPANY_ADMIN } from '../services/access/companyAccess.js';
import mongoose from 'mongoose';
// Feature 31 (25 Nov 2026): a Department Head role given by HR waits for the Company Admin.
import {
  needsHeadApproval, isPending, pendingRequest, notifyCompanyAdmin, listPending, decide,
  SENT_MESSAGE, WAITING_MESSAGE,
} from '../services/access/headApproval.js';
// Feature 34 (26 Nov 2026): custom roles = a cut-down version of one built-in role.
import { resolveRole, trimToAllowed, defaultsFor, needsCustomApproval, customRoleFields, customRolesOf } from '../services/access/customRoles.js';
import { applyRoleLimits, exceedsRoleLimits } from '../services/access/roleLimits.js'; // 26 Nov: Store's R&D views

// Security re-check M4 (27 Nov 2026): what a colleague may see of someone they don't manage: who they are,
// not their contact details, date of birth, device code, permissions or HR notes.
const USER_CARD_FIELDS = '_id fullName username employeeId role customRoleName departmentId designationId companyId profilePicture isActive';
const userCard = (u) => Object.fromEntries(USER_CARD_FIELDS.split(' ').filter((k) => u?.[k] !== undefined).map((k) => [k, u[k]]));

// Feature 30 (24 Nov 2026): a user's department and designation must be their own company's.
// Returns why not, or null. Blank values are fine (nothing to check); so is a user with no company.
async function orgRefusal(companyId, departmentId, designationId) {
  const cid = companyId?._id || companyId;
  if (!cid) return null;
  const checks = [[departmentId, Department, 'department'], [designationId, Designation, 'designation']];
  for (const [id, Model, what] of checks) {
    if (!id) continue;
    if (!mongoose.isValidObjectId(id) || !(await Model.exists({ _id: id, companyId: cid }))) {
      return `That ${what} isn't in this company.`;
    }
  }
  return null;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "01/2024" or "2024-01" style free-text → a [start, end) month range for
// matching a Date field. Returns null if it can't be parsed, so the filter
// is safely skipped rather than crashing.
const parseMonthYearRange = (value) => {
  const mmYYYY = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYYYY) {
    const month = parseInt(mmYYYY[1], 10) - 1;
    const year = parseInt(mmYYYY[2], 10);
    return { $gte: new Date(year, month, 1), $lt: new Date(year, month + 1, 1) };
  }
  const yyyyMM = value.match(/^(\d{4})-(\d{1,2})$/);
  if (yyyyMM) {
    const year = parseInt(yyyyMM[1], 10);
    const month = parseInt(yyyyMM[2], 10) - 1;
    return { $gte: new Date(year, month, 1), $lt: new Date(year, month + 1, 1) };
  }
  const asDate = new Date(value);
  if (!isNaN(asDate.getTime())) {
    const start = new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { $gte: start, $lt: end };
  }
  return null;
};

export const getNextEmployeeId = async (req, res) => {
  try {
    const { companyId } = req.query;
    const nextId = await generateEmployeeId(companyId);
    return res.json({ employeeId: nextId });
  } catch (error) {
    console.error("Generate Employee ID error:", error);
    return res.status(500).json({ message: "Failed to generate employee ID" });
  }
};

export const getUsers = async (req, res) => {
  try {
    const currentUser = req.user;
    const {
      page = 1,
      limit = 15,
      role,
      unit,
      search,
      status,
      companyId, // Extract companyId from frontend
      sortBy = 'createdAt',
      sortOrder = 'desc',
      // Employee.tsx filter panel — wired to existing User/Company/Branch/
      // Department/Designation fields (see Employee.tsx filters state)
      designation,
      company,
      branch,
      department,
      manager,
      joiningDate,
      employmentType,
      contact,
      gender,
      login,
      deviceCode
    } = req.query;

    const skip = (page - 1) * parseInt(limit);
    let query = {};

    // 1. Enforce Role-Based Data Isolation
    if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin') {
      // Non-super admins MUST be restricted to their own company
      if (currentUser.companyId) {
        query.companyId = currentUser.companyId;
      } else {
        // If an HR-Admin somehow lacks a companyId, prevent them from seeing ALL companies!
        // We set it to a non-existent value so they don't leak other companies' users.
        query.companyId = null;
      }

      // If role is Manager, only show users reporting to them
      if (currentUser.role === 'Manager') {
        query.reportingManager = currentUser._id;
      }

      // Filter by unit only if the current user has a specific unit assigned in the DB
      if (currentUser.unit && currentUser.unit !== currentUser.company?.unitName) {
        query.unit = currentUser.unit;
      }
    } else {
      // If Super Admin, they can filter by companyId from frontend
      if (companyId && companyId !== 'all') {
        query.companyId = companyId;
      }
    }

    // 2. Apply Frontend Filters
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { deviceCode: { $regex: search, $options: 'i' } }
      ];
    }

    // People with no login (2026-11-06). Older records have no canLogin: they can.
    if (login === 'no') query.canLogin = false;
    else if (login === 'yes') query.canLogin = { $ne: false };
    // Roles & Permissions' role filter (2026-11-14): every role among the people
    // this list can show (same company / manager / unit / login scope), before
    // the search, role and status filters narrow it.
    const roleScope = { ...query };
    delete roleScope.$or;
    // Attendance Device's person picker: people still without a code.
    if (deviceCode === 'none') query.deviceCode = { $in: [null, ''] };

    if (role && role !== 'all') {
      // Feature 34: a custom role's name filters on it. A built-in role still includes the custom
      // roles based on it, so pickers such as "every Manager" keep finding them.
      if (currentUser.companyId && (await customRolesOf(currentUser.companyId)).some((r) => r.name === role)) query.customRoleName = role;
      else query.role = role;
    }

    if (unit && unit !== 'all') {
      query.unit = unit;
    }

    if (status && status !== 'all') {
      query.isActive = status === 'active';
    }

    // 2b. Employee.tsx filter panel — designation/branch/department/manager/
    // company are ObjectId refs but the filter panel is free-text, so we
    // resolve name → ids first. An empty match array correctly yields zero
    // results (the filter really doesn't match anything) rather than being
    // silently ignored.
    if (gender) {
      query.gender = new RegExp(`^${escapeRegex(gender)}$`, 'i');
    }

    if (contact) {
      const contactRe = new RegExp(escapeRegex(contact), 'i');
      query.$and = (query.$and || []).concat([{ $or: [{ mobile: contactRe }, { email: contactRe }] }]);
    }

    if (employmentType) {
      query.employeeType = new RegExp(escapeRegex(employmentType), 'i');
    }

    if (joiningDate) {
      const range = parseMonthYearRange(joiningDate);
      if (range) query.joiningDate = range;
    }

    if (designation) {
      const ids = await Designation.find({ name: new RegExp(escapeRegex(designation), 'i') }).distinct('_id');
      query.designationId = { $in: ids };
    }

    // Note: no separate `branch` handling here — the "Unit" filter is
    // already served by the pre-existing `unit` (plain string) match above.
    // User.branchId isn't a real Branch document (AddUser.tsx sets it to the
    // selected Company's own _id) and User.unit is never populated by the
    // current employee-creation flow either, so we can't safely tell which
    // one is reliably populated across existing records — stacking an
    // additional branchId condition on top of the existing `unit` match
    // risks AND-ing together two filters that disagree and silently zeroing
    // out results for a filter that already works today.

    if (department) {
      const ids = await Department.find({ name: new RegExp(escapeRegex(department), 'i') }).distinct('_id');
      query.departmentId = { $in: ids };
    }

    // Only apply the manager-name filter if the role-isolation block above
    // didn't already pin reportingManager to the current Manager's own id.
    if (manager && !query.reportingManager) {
      const managerRe = new RegExp(escapeRegex(manager), 'i');
      const ids = await User.find({ $or: [{ fullName: managerRe }, { username: managerRe }] }).distinct('_id');
      query.reportingManager = { $in: ids };
    }

    // Only apply the free-text company-name filter if companyId isn't
    // already pinned to one value (own-company scoping, or the Super Admin
    // company dropdown) — narrowing an already-exact match further by name
    // would rarely be intentional and risks an impossible AND.
    if (company && !query.companyId) {
      const ids = await Company.find({
        $or: [{ name: new RegExp(escapeRegex(company), 'i') }, { unitName: new RegExp(escapeRegex(company), 'i') }]
      }).distinct('_id');
      query.companyId = { $in: ids };
    }

    // 3. Execute Query
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Use mongoose.Types.ObjectId for aggregation match if it's a string
    const aggregateQuery = { ...query };
    if (aggregateQuery.companyId && typeof aggregateQuery.companyId === 'string') {
      try {
        const mongoose = await import('mongoose');
        aggregateQuery.companyId = new mongoose.default.Types.ObjectId(aggregateQuery.companyId);
      } catch (e) {
        console.error('ObjectId casting error:', e);
      }
    }

    console.log('=== getUsers Query ===', JSON.stringify(query));

    // Security re-check M4 (27 Nov 2026): full records for HR, the Company Admin, the Super Admin and a
    // Manager (whose list is their own team, above); anyone else gets the short card.
    const fullView = isSuperAdmin(currentUser) || adminTier(currentUser) || currentUser.role === 'Manager';
    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select(fullView ? '-password' : USER_CARD_FIELDS)
        .populate('companyId', 'name unitName city state displayName')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(query)
    ]);

    // 4. Get Summary for the restricted scope
    const stats = await User.aggregate([
      { $match: aggregateQuery }, // Use the casted query for aggregate!
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          roleBreakdown: { $push: '$role' }
        }
      }
    ]);

    const roles = req.query.withRoles === 'yes'
      ? [...new Set([...(await User.distinct('role', roleScope)), ...(await User.distinct('customRoleName', roleScope))])] // feature 34
        .filter(Boolean).sort((a, b) => a.localeCompare(b))
      : undefined;

    const summaryData = stats[0] || { totalUsers: 0, activeUsers: 0, roleBreakdown: [] };
    const roleStats = {};
    if (summaryData.roleBreakdown) {
      summaryData.roleBreakdown.forEach(r => {
        roleStats[r] = (roleStats[r] || 0) + 1;
      });
    }

    // 5. Return Response
    res.status(200).json({
      success: true,
      users,
      ...(roles && { roles }),
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalUsers,
          pages: Math.ceil(totalUsers / limit)
        }
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalUsers,
        pages: Math.ceil(totalUsers / limit)
      },
      summary: {
        totalUsers: summaryData.totalUsers,
        activeUsers: summaryData.activeUsers,
        inactiveUsers: summaryData.totalUsers - summaryData.activeUsers,
        roleStats
      }
    });

  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id)
      .select('-password')
      .populate('companyId', 'name unitName city state displayName')
      .populate('branchId', 'name')
      .populate('departmentId', 'name')
      .populate('designationId', 'name')
      .populate('reportingManager', 'fullName name email profilePicture');

    // Feature 27 (24 Nov 2026): another company's user reads as not found.
    if (!user || (!isSuperAdmin(req.user) && !sameCompany(req.user, user.companyId))) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Security re-check M4 (27 Nov 2026): the full record (mobile, address, date of birth, device code,
    // permissions, probation / termination notes) only for the person themselves, HR, the Company Admin,
    // the Super Admin and the person's own Manager; anyone else in the company gets the short card.
    const self = String(user._id) === String(req.user._id);
    const ownManager = String(user.reportingManager?._id || user.reportingManager || '') === String(req.user._id);
    if (!self && !ownManager && !isSuperAdmin(req.user) && !adminTier(req.user)) {
      return res.json({ user: userCard(user.toObject ? user.toObject() : user) });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createUser = async (req, res) => {
  try {
    const {
      username, email, password, fullName, role: roleSent, unit, companyId, branchId, departmentId, designationId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId,
      isTrainee, ivrNumber, address,
      technicianSkills, serviceZone // 🔥 NEW: Added Technician Fields
    } = req.body;
    let role = roleSent; // feature 34: a custom role becomes its base role below

    if (!email || !password || (!role && !req.body.customRoleId)) {
      return res.status(400).json({ message: 'Email, password, and role are required', success: false });
    }
    if (role === USER_ROLES.MANPOWER) {
      return res.status(400).json({ message: 'Manpower has no login: add them with Gets a login: No.', success: false });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists', success: false });
    }

    let finalCompanyId = companyId;
    let finalUnit = unit;
    if (req.user && (req.user.role === 'HR-Admin' || req.user.role === 'Hr Admin' || req.user.role === 'Company Admin')) {
      finalCompanyId = req.user.companyId || finalCompanyId;
      finalUnit = req.user.unit || finalUnit;
    }

    // Feature 34 (26 Nov 2026): a custom role (by id, or by its name) is saved as its base role.
    const resolved = await resolveRole(finalCompanyId, { role, customRoleId: req.body.customRoleId });
    if (resolved.error) return res.status(400).json({ message: resolved.error, success: false });
    role = resolved.role;
    const customRole = resolved.customRole;

    let parsedPermissions = permissions;
    if (permissions) {
      try {
        if (typeof permissions === 'string') parsedPermissions = JSON.parse(permissions);
        if (typeof parsedPermissions === 'string') parsedPermissions = JSON.parse(parsedPermissions);
      } catch (e) {
        parsedPermissions = { role: role, canAccessAllUnits: false, modules: [] };
      }
    }

    // Feature 27 (24 Nov 2026): who may give which role (HR can't make a Company Admin or Super Admin).
    const roleWhy = roleRefusal(req.user, role, finalCompanyId);
    if (roleWhy) return res.status(403).json({ message: roleWhy, success: false });

    let defaultPermissions = parsedPermissions
      || (role === COMPANY_ADMIN ? seedCompanyAdminPermissions() : { role: role, canAccessAllUnits: false, modules: [] });
    // Feature 34: never beyond the custom role's list; nothing sent = everything it allows.
    if (customRole) defaultPermissions = parsedPermissions ? trimToAllowed(parsedPermissions, customRole.allowed, role) : defaultsFor(customRole);
    defaultPermissions = applyRoleLimits(role, defaultPermissions); // 26 Nov: e.g. Store gets R&D views only
    // Feature 30 (24 Nov 2026): the hidden permission role is always the real role, never what was
    // sent (it was read as "Super Admin" when it said super_admin).
    defaultPermissions.role = role;
    const orgWhy = await orgRefusal(finalCompanyId, departmentId, designationId);
    if (orgWhy) return res.status(400).json({ message: orgWhy, success: false });

    // 🔥 AUTOMATIC LMS FEATURE INJECTION (FRONTEND FIX)
    const finalIsTrainee = isTrainee === true || isTrainee === 'true';
    if (finalIsTrainee) {
      if (defaultPermissions.modules && defaultPermissions.modules.length > 0) {
        const primaryModule = defaultPermissions.modules[0];

        if (!primaryModule.features) {
          primaryModule.features = [];
        }

        const hasLmsFeature = primaryModule.features.some(f => f.key === 'traineeDashboard');

        if (!hasLmsFeature) {
          primaryModule.features.push({
            key: "traineeDashboard",
            view: true,
            add: false,
            edit: false,
            delete: false,
            alter: false
          });
        }
      }
    }

    const finalDeviceCode = cleanDeviceCode(req.body.deviceCode);
    if (finalDeviceCode && await deviceCodeTaken(finalCompanyId, finalDeviceCode)) {
      return res.status(400).json({ message: `Device code ${finalDeviceCode} is already given to someone in this company.`, success: false });
    }

    let finalEmployeeId = employeeId;
    if (!finalEmployeeId && finalCompanyId) {
      // Ensure generateEmployeeId is imported
      finalEmployeeId = await generateEmployeeId(finalCompanyId);
    }

    // 🔥 PARSE TECHNICIAN SKILLS
    // Safely handles arrays, JSON strings, or comma-separated strings from the frontend
    let finalSkills = [];
    if (technicianSkills) {
      if (Array.isArray(technicianSkills)) {
        finalSkills = technicianSkills;
      } else if (typeof technicianSkills === 'string') {
        try {
          finalSkills = JSON.parse(technicianSkills);
        } catch (e) {
          finalSkills = technicianSkills.split(',').map(s => s.trim());
        }
      }
    }

    const userData = {
      username: username || email.toLowerCase(),
      email: email.toLowerCase(),
      password,
      fullName: fullName || '',
      role,
      unit: finalUnit || '',
      companyId: finalCompanyId || null,
      branchId: branchId || null,
      departmentId: departmentId || null,
      designationId: designationId || null,
      isActive: isActive !== undefined ? isActive : true,
      isTrainee: finalIsTrainee,
      permissions: defaultPermissions,
      employeeId: finalEmployeeId,
      mobile: mobile || '',
      gender: gender || '',
      dob: dob || null,
      joiningDate: joiningDate || new Date(),
      reportingManager: reportingManager || managerId || null,
      employeeType: employeeType || employmentType || '',
      ivrNumber: ivrNumber || '',
      address: address || '',

      // 🔥 INJECT TECHNICIAN FIELDS
      // Only attach these if the user is actually a Complaint Management Employee
      technicianSkills: role === 'Complaint Management Employee' ? finalSkills : [],
      serviceZone: role === 'Complaint Management Employee' ? (serviceZone || finalUnit || '') : '',
      ...(finalDeviceCode ? { deviceCode: finalDeviceCode } : {}),
      ...customRoleFields(customRole).set, // feature 34
    };

    // Feature 31: a Department Head added by HR is saved inactive and waits for the Company Admin.
    // Feature 34: so does a custom role with the approval flag on.
    const waits = needsHeadApproval(req.user, role) || needsCustomApproval(req.user, customRole);
    if (waits) {
      userData.isActive = false;
      userData.headApproval = pendingRequest('new', role, defaultPermissions, req.user, undefined, customRole);
    }

    const user = new User(userData);
    await user.save();
    await applyCodeQuietly(finalCompanyId, finalDeviceCode);
    if (waits) await notifyCompanyAdmin(user, req.user);
    const { password: _, ...userWithoutPassword } = user.toObject();
    if (userWithoutPassword.headApproval?.login) delete userWithoutPassword.headApproval.login;

    res.status(201).json({
      message: waits ? SENT_MESSAGE : 'User created successfully',
      success: true, pendingApproval: waits, user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Create user error:', error);

    // Mongoose validation error (e.g. role not in enum, required field missing)
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({ message: messages, success: false });
    }

    // Duplicate key (email or username already exists)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({ message: `${field} already exists`, success: false });
    }

    res.status(500).json({
      message: error.message || 'Internal server error',
      success: false
    });
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const removeFiles = (files) => files.forEach((f) => { if (f?.path) fs.unlink(f.path, () => {}); });

// POST /api/users/manpower (2026-11-06,
// docs/client-features-2026-11/02a-people-no-login-logic.md). All the same
// details as Add Employee, no login, email optional. Device code and Aadhaar are
// required: attendance is why they're here, and they can't upload anything
// themselves. Other documents are optional. HR has seen the originals, so all of
// them are Verified by HR at once. All or nothing: a refusal or failure leaves no
// person, document or file behind.
export const createManpower = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const refuse = (message, errors) => {
    removeFiles(files);
    return res.status(400).json({ success: false, message, ...(errors ? { errors } : {}) });
  };
  let created = null;
  try {
    const b = req.body || {};
    const aadhaar = files.find((f) => f.fieldname === 'aadhaar');
    const picture = files.find((f) => f.fieldname === 'profilePicture');
    const otherDocuments = files.filter((f) => f.fieldname.startsWith('doc_'));
    const isCompanyScoped = ['HR-Admin', 'Hr Admin', 'Company Admin'].includes(req.user.role);
    const companyId = (isCompanyScoped && req.user.companyId) || b.companyId;
    const unit = (isCompanyScoped && req.user.unit) || b.unit || '';
    const reportingManager = b.reportingManager || b.managerId;
    const email = String(b.email || '').trim().toLowerCase();
    const deviceCode = cleanDeviceCode(b.deviceCode);

    const errors = {};
    const need = { fullName: b.fullName, gender: b.gender, dob: b.dob, joiningDate: b.joiningDate, companyId, branchId: b.branchId, departmentId: b.departmentId, designationId: b.designationId, reportingManager };
    for (const [field, value] of Object.entries(need)) if (!String(value ?? '').trim()) errors[field] = 'Required';
    if (!/^\d{10}$/.test(String(b.mobile || '').trim())) errors.mobile = 'Mobile must be exactly 10 digits';
    if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';
    if (!deviceCode) errors.deviceCode = 'Device code is required for someone with no login';
    if (!aadhaar) errors.aadhaar = 'Aadhaar is required for someone with no login';
    if (Object.keys(errors).length) {
      return refuse(errors.aadhaar || errors.deviceCode || 'Please fill in all the required details.', errors);
    }

    const [department, designation, manager] = await Promise.all([
      Department.exists({ _id: b.departmentId, companyId }),
      Designation.exists({ _id: b.designationId, companyId }),
      User.exists({ _id: reportingManager, companyId }),
    ]);
    if (!department) return refuse('That department is not in this company.');
    if (!designation) return refuse('That designation is not in this company.');
    if (!manager) return refuse('That reporting manager is not in this company.');
    if (email && await User.exists({ email })) return refuse('Email already exists');
    if (await deviceCodeTaken(companyId, deviceCode)) {
      return refuse(`Device code ${deviceCode} is already given to someone in this company.`);
    }

    const employeeId = await generateEmployeeId(companyId);
    created = await User.create({
      canLogin: false,
      username: employeeId,
      ...(email ? { email } : {}),
      deviceCode,
      fullName: b.fullName,
      role: USER_ROLES.MANPOWER,
      permissions: { role: USER_ROLES.MANPOWER, canAccessAllUnits: false, modules: [] },
      unit,
      companyId,
      branchId: b.branchId,
      departmentId: b.departmentId,
      designationId: b.designationId,
      employeeId,
      mobile: String(b.mobile).trim(),
      gender: b.gender,
      dob: b.dob,
      joiningDate: b.joiningDate,
      reportingManager,
      employeeType: b.employeeType || b.employmentType || '',
      address: b.address || '',
      isActive: true,
      ...(picture ? { profilePicture: picture.filename } : {}),
    });

    for (const [type, file] of [['AADHAAR', aadhaar], ...otherDocuments.map((f) => [f.fieldname.slice(4), f])]) {
      await UserDocument.create({
        userId: created._id,
        companyId,
        type,
        fileUrl: `uploads/documents/${file.filename}`,
        status: 'VERIFIED',
        verifiedBy: req.user._id,
        verifiedAt: new Date(),
      });
    }

    await applyCodeQuietly(companyId, deviceCode);
    return res.status(201).json({ success: true, message: 'Person added with no login.', user: created });
  } catch (error) {
    console.error('Create manpower error:', error.message);
    if (created) {
      await UserDocument.deleteMany({ userId: created._id }).catch(() => {});
      await User.deleteOne({ _id: created._id }).catch(() => {});
    }
    removeFiles(files);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {}).pop() || 'value';
      return res.status(400).json({ success: false, message: `That ${field} is already in use.` });
    }
    return res.status(500).json({ success: false, message: 'Could not add this person. Please try again.' });
  }
};

// Roles Give Login can't hand out: they run the company, not a department.
const NOT_FROM_GIVE_LOGIN = ['Super Admin', 'Superadmin', 'super_user', 'Admin', 'Company Admin', USER_ROLES.MANPOWER];

// POST /api/users/:id/give-login: a worker promoted to staff. The same record, so
// department, documents, attendance and history stay with them.
// Feature 31: the Company Admin's waiting list of Head roles from HR (an open-work queue, unpaged).
export const listHeadApprovals = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user) && req.user.role !== COMPANY_ADMIN) {
      return res.status(403).json({ success: false, message: 'Only the Company Admin approves a Head role.' });
    }
    const requests = await listPending(req.user, req.query.companyId);
    return res.json({ success: true, requests });
  } catch (error) {
    console.error('List head approvals error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the waiting list.' });
  }
};

// Feature 31: approve or reject ({ approve: true|false, reason }).
export const decideHeadApproval = async (req, res) => {
  try {
    const { approve, reason } = req.body || {};
    const out = await decide(req.params.id, req.user, approve === true || approve === 'true', reason);
    return res.json({ success: true, message: out.message, user: out.user });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Decide head approval error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the decision.' });
  }
};

export const giveLogin = async (req, res) => {
  try {
    const { email, password, permissions } = req.body || {};
    let { role } = req.body || {};
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const isPlatform = ['Superadmin', 'Super Admin'].includes(req.user.role);
    if (!isPlatform && String(user.companyId) !== String(req.user.companyId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (user.canLogin !== false) return res.status(400).json({ success: false, message: 'This person already has a login.' });
    // Feature 34: a custom role is given as its base role.
    const resolved = await resolveRole(user.companyId, { role, customRoleId: req.body?.customRoleId });
    if (resolved.error) return res.status(400).json({ success: false, message: resolved.error });
    role = resolved.role;
    const customRole = resolved.customRole;

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (!password || String(password).length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    if (!role || NOT_FROM_GIVE_LOGIN.includes(role)) return res.status(400).json({ success: false, message: 'Pick a role for this person.' });
    const roleWhy = roleRefusal(req.user, role, user.companyId); // feature 27
    if (roleWhy) return res.status(403).json({ success: false, message: roleWhy });
    if (await User.exists({ _id: { $ne: user._id }, email: cleanEmail })) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    let perms = permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch { perms = null; }
    }
    if (customRole) perms = perms && typeof perms === 'object' ? trimToAllowed(perms, customRole.allowed, role) : defaultsFor(customRole);
    perms = applyRoleLimits(role, perms); // 26 Nov: e.g. Store gets R&D views only

    // Feature 31: a Head login from HR waits for the Company Admin; the person stays without a login.
    // Feature 34: so does a custom role with the approval flag on.
    if (isPending(user)) return res.status(409).json({ success: false, message: WAITING_MESSAGE });
    if (needsHeadApproval(req.user, role) || needsCustomApproval(req.user, customRole)) {
      user.headApproval = pendingRequest('login', role, perms, req.user, {
        email: cleanEmail, passwordHash: await bcrypt.hash(String(password), 12),
      }, customRole);
      await user.save();
      await notifyCompanyAdmin(user, req.user);
      return res.json({ success: true, pendingApproval: true, message: SENT_MESSAGE, user });
    }

    user.canLogin = true;
    user.email = cleanEmail;
    user.username = cleanEmail;
    user.password = password; // hashed when saved
    user.role = role;
    user.permissions = { canAccessAllUnits: false, modules: [], ...(perms || {}), role };
    user.customRoleId = customRole ? customRole._id : undefined; // feature 34
    user.customRoleName = customRole ? customRole.name : undefined;
    await user.save();

    return res.json({ success: true, message: 'Login given.', user });
  } catch (error) {
    console.error('Give login error:', error.message);
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'Email already exists' });
    return res.status(500).json({ success: false, message: 'Could not give this person a login.' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    // Never log a new password (feature 27).
    console.log('Update user request:', id, { ...req.body, ...(req.body?.password ? { password: '***' } : {}) });
    const {
      username, email, password, fullName, role: roleSent, unit, companyId, branchId, departmentId, designationId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId, address
    } = req.body;
    let role = roleSent; // feature 34: a custom role becomes its base role below

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found',
        success: false
      });
    }

    // Prevent a user from escalating/altering their own access
    const isSelfUpdate = user._id.toString() === req.user._id.toString();
    if (isSelfUpdate) {
      if (role !== undefined && role !== user.role) {
        return res.status(400).json({
          message: 'You cannot change your own role',
          success: false
        });
      }
      if (permissions !== undefined) {
        return res.status(400).json({
          message: 'You cannot change your own module permissions',
          success: false
        });
      }
    }

    // Feature 27 (24 Nov 2026): company boundaries and who may edit whom. Before this, anyone
    // logged in could change anyone's name, email, password or company.
    const has = (v) => v !== undefined;
    const actorIsSA = isSuperAdmin(req.user);
    if (!actorIsSA && !sameCompany(req.user, user.companyId)) {
      return res.status(404).json({ message: 'User not found', success: false });
    }

    // Feature 34 (26 Nov 2026): custom roles. `customRoleId` (or a custom role's name sent as the role)
    // means a custom role, saved as its base role. No customRoleId and the same role = the person keeps
    // the custom role they're on; customRoleId null / '' = off it. Their permissions are trimmed to the
    // role's list below, whoever saves them.
    const curCustomId = user.customRoleId ? String(user.customRoleId) : null;
    const sentCustom = !!req.body && Object.prototype.hasOwnProperty.call(req.body, 'customRoleId');
    let customRole = null;
    if ((sentCustom && req.body.customRoleId) || (has(roleSent) && roleSent && roleSent !== user.role)) {
      const r = await resolveRole(user.companyId, { role: roleSent, customRoleId: sentCustom && req.body.customRoleId ? req.body.customRoleId : undefined });
      if (r.error) return res.status(400).json({ message: r.error, success: false });
      role = r.role;
      customRole = r.customRole;
    } else if (curCustomId && !(sentCustom && !req.body.customRoleId)) {
      customRole = (await customRolesOf(user.companyId)).find((x) => String(x._id) === curCustomId) || null;
    }
    const changesCustom = (customRole ? String(customRole._id) : null) !== curCustomId;
    if (isSelfUpdate && changesCustom) {
      return res.status(400).json({ message: 'You cannot change your own role', success: false });
    }

    const wantsStatus = has(req.body.status) || has(isActive);
    const nextActive = has(req.body.status)
      ? (req.body.status === 'ACTIVE' || req.body.status === 'active' || req.body.status === true)
      : isActive;
    const movesCompany = has(companyId) && String(companyId || '') !== String(user.companyId?._id || user.companyId || '');
    if (!actorIsSA) {
      if (isSelfUpdate) {
        if (movesCompany || (wantsStatus && nextActive !== (user.isActive !== false))) {
          return res.status(400).json({ message: 'You cannot change your own company or active status.', success: false });
        }
      } else if (!adminTier(req.user)) {
        // A manager may update the people who report to them: personal and job details only.
        if (String(user.reportingManager || '') !== String(req.user._id)) {
          return res.status(403).json({ message: 'You can only edit your own profile.', success: false });
        }
        const changes = (has(email) && String(email || '').trim().toLowerCase() !== String(user.email || '').toLowerCase())
          || (has(username) && username && username !== user.username)
          || (has(password) && String(password || '').trim() !== '')
          || movesCompany || (wantsStatus && nextActive !== (user.isActive !== false))
          || (has(role) && role !== user.role) || changesCustom || has(permissions) || has(req.body.deviceCode);
        if (changes) {
          return res.status(403).json({ message: 'A manager can change personal and job details only.', success: false });
        }
      }
      if (movesCompany && adminTier(req.user) && !isSelfUpdate) {
        return res.status(403).json({ message: 'You cannot move someone to another company.', success: false });
      }
    }
    if (has(role) && role !== user.role) {
      const why = roleRefusal(req.user, role, user.companyId);
      if (why) return res.status(403).json({ message: why, success: false });
    }
    const leavesCompanyAdmin = user.role === COMPANY_ADMIN
      && ((has(role) && role !== COMPANY_ADMIN) || (wantsStatus && nextActive === false) || movesCompany);
    if (leavesCompanyAdmin && await isLastCompanyAdmin(user)) {
      return res.status(400).json({ message: LAST_CA_MESSAGE, success: false });
    }

    // Changing ANYONE's role or module permissions is an admin-only action —
    // without this, any authenticated user (e.g. a Sales Employee) could
    // PATCH a colleague's account to role: 'Superadmin' with full access.
    const ADMIN_TIER_ROLES = ['Superadmin', 'Super Admin', 'HR-Admin', 'Company Admin'];
    const isAdminTier = ADMIN_TIER_ROLES.includes(req.user.role);
    if (!isAdminTier && ((role !== undefined && role !== user.role) || changesCustom || permissions !== undefined)) {
      return res.status(403).json({
        message: 'Access denied. Only an admin can change a user\'s role or module permissions.',
        success: false
      });
    }

    // 25 Nov 2026: employment status (Probation & Confirmation, Resigned / Terminated) — saved at
    // last. Only HR / the Company Admin / a Super Admin set it, and never on their own record.
    const employment = {};
    const employmentUnset = {};
    {
      const b = req.body || {};
      const day = (v) => { if (v === '' || v === null) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };
      const sameDay = (a, d) => (a ? new Date(a).toISOString().slice(0, 10) : '') === (d ? d.toISOString().slice(0, 10) : '');
      const want = {};
      if (has(b.employmentStatus)) {
        const s = String(b.employmentStatus || '').trim().toUpperCase();
        if (s && !['PROBATION', 'CONFIRMED'].includes(s)) return res.status(400).json({ message: 'Employment status is PROBATION or CONFIRMED.', success: false });
        want.employmentStatus = s || null;
      }
      for (const k of ['probationEndDate', 'confirmationDate', 'terminationDate']) {
        if (!has(b[k])) continue;
        const d = day(b[k]);
        if (d === undefined) return res.status(400).json({ message: `${k === 'terminationDate' ? 'The resignation / termination date' : k === 'confirmationDate' ? 'The confirmation date' : 'The probation end date'} isn't a valid date.`, success: false });
        want[k] = d;
      }
      for (const k of ['probationJustification', 'terminationReason']) if (has(b[k])) want[k] = String(b[k] ?? '').trim();
      for (const k of ['isResigned', 'isTerminated']) if (has(b[k])) want[k] = b[k] === true || b[k] === 'true';
      if ((want.isResigned ?? user.isResigned) && (want.isTerminated ?? user.isTerminated)) {
        return res.status(400).json({ message: 'Someone is either resigned or terminated, not both.', success: false });
      }
      if (want.employmentStatus === 'CONFIRMED' && !want.confirmationDate && !user.confirmationDate) want.confirmationDate = new Date();
      // Only the fields that actually change count (a manager's job edit re-sends the current ones).
      const changed = Object.keys(want).filter((k) => (want[k] instanceof Date || want[k] === null) && /Date$/.test(k)
        ? !sameDay(user[k], want[k])
        : String(want[k] ?? '') !== String(user[k] ?? ''));
      if (changed.length && (isSelfUpdate || !adminTier(req.user))) {
        return res.status(403).json({ message: 'Only HR or the Company Admin can change probation, confirmation or resignation details.', success: false });
      }
      for (const k of changed) {
        if (want[k] === null || want[k] === '') employmentUnset[k] = '';
        else employment[k] = want[k];
      }
    }

    // Feature 31: a Head role from HR waits for the Company Admin. While a request waits, nobody
    // makes the person active by hand, and HR can't change their role or permissions; a Company
    // Admin's / Super Admin's own role change replaces the request.
    const changesRole = has(role) && !!role && role !== user.role;
    let headRequest = null;
    let clearsHeadRequest = false;
    if (isPending(user)) {
      if (wantsStatus && nextActive === true && user.isActive === false) {
        return res.status(409).json({ message: `${WAITING_MESSAGE} Approve or reject it first.`, success: false });
      }
      if (changesRole || changesCustom || has(permissions)) {
        if (!isSuperAdmin(req.user) && req.user.role !== COMPANY_ADMIN) {
          return res.status(409).json({ message: `A ${user.headApproval.role} role is ${WAITING_MESSAGE.toLowerCase()}`, success: false });
        }
        clearsHeadRequest = changesRole || changesCustom;
      }
    }
    // Feature 34: a move onto a custom role with the flag (or a Head base) waits too.
    if ((changesRole && needsHeadApproval(req.user, role)) || ((changesRole || changesCustom) && needsCustomApproval(req.user, customRole))) {
      let wanted = permissions;
      try { if (typeof wanted === 'string') wanted = JSON.parse(wanted); } catch { wanted = null; }
      wanted = wanted && typeof wanted === 'object' ? wanted : null;
      if (customRole) wanted = wanted ? trimToAllowed(wanted, customRole.allowed, role) : defaultsFor(customRole);
      wanted = applyRoleLimits(role, wanted);
      headRequest = pendingRequest('roleChange', role, wanted, req.user, undefined, customRole);
    }

    // Manpower (2026-11-06): no login to change here; Give Login does that.
    const noLogin = user.canLogin === false;
    if (noLogin && ((role !== undefined && role !== user.role) || changesCustom)) {
      return res.status(400).json({ message: 'This person has no login. Use Give Login to give them a role.', success: false });
    }
    if (noLogin && password && password.trim() !== '') {
      return res.status(400).json({ message: 'This person has no login. Use Give Login to set a password.', success: false });
    }
    if (!noLogin && email !== undefined && !String(email || '').trim()) {
      return res.status(400).json({ message: 'Email is required for someone with a login.', success: false });
    }

    // The device code decides whose attendance a punch becomes, so it's an admin's to set.
    const unset = {};
    let newDeviceCode;
    if (req.body.deviceCode !== undefined) {
      if (!isAdminTier) {
        return res.status(403).json({ message: 'Access denied. Only an admin can change a device code.', success: false });
      }
      newDeviceCode = cleanDeviceCode(req.body.deviceCode);
      if (noLogin && !newDeviceCode) {
        return res.status(400).json({ message: 'Device code is required for someone with no login.', success: false });
      }
      if (newDeviceCode && await deviceCodeTaken(user.companyId, newDeviceCode, user._id)) {
        return res.status(400).json({ message: `Device code ${newDeviceCode} is already given to someone in this company.`, success: false });
      }
    }

    // Feature 30: a department / designation from another company can't be given.
    const orgWhy = await orgRefusal(user.companyId, departmentId, designationId);
    if (orgWhy) return res.status(400).json({ message: orgWhy, success: false });

    // Validate fields ONLY if they are provided
    if (email) {
      // Check for duplicate email (excluding current user)
      const existingUser = await User.findOne({
        _id: { $ne: id },
        email: email.toLowerCase()
      });

      if (existingUser) {
        return res.status(400).json({
          message: 'Email already exists',
          success: false
        });
      }
    }

    const updateData = {};

    // Map status to isActive
    if (req.body.status !== undefined) {
      updateData.isActive = req.body.status === 'ACTIVE' || req.body.status === 'active' || req.body.status === true;
    } else if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    if (username !== undefined && !noLogin) updateData.username = username || email?.toLowerCase();
    if (email !== undefined) {
      // A blank must be removed, not saved: blank is still a value to the unique rule.
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (cleanEmail) updateData.email = cleanEmail;
      else unset.email = '';
    }
    if (req.body.deviceCode !== undefined) {
      if (newDeviceCode) updateData.deviceCode = newDeviceCode;
      else unset.deviceCode = '';
    }
    if (fullName !== undefined) updateData.fullName = fullName;
    if (role !== undefined) updateData.role = role;
    if (unit !== undefined) updateData.unit = unit;
    if (companyId !== undefined) updateData.companyId = companyId || null;
    if (branchId !== undefined) updateData.branchId = branchId || null;
    if (departmentId !== undefined) updateData.departmentId = departmentId || null;
    if (designationId !== undefined) updateData.designationId = designationId || null;
    if (employeeId !== undefined) updateData.employeeId = employeeId;
    if (permissions !== undefined && !noLogin) {
      let parsedPermissions = permissions;
      try {
        if (typeof permissions === 'string') {
          parsedPermissions = JSON.parse(permissions);
        }
        if (typeof parsedPermissions === 'string') {
          parsedPermissions = JSON.parse(parsedPermissions);
        }
      } catch (e) {
        console.error('Failed to parse permissions:', e);
      }
      // Feature 30: the hidden permission role is the real role (the new one, or the current one).
      if (parsedPermissions && typeof parsedPermissions === 'object') {
        parsedPermissions = { ...parsedPermissions, role: role || user.role };
        // Feature 34: never beyond the custom role's list, whoever sends it.
        if (customRole) parsedPermissions = trimToAllowed(parsedPermissions, customRole.allowed, role || user.role);
        parsedPermissions = applyRoleLimits(role || user.role, parsedPermissions); // 26 Nov: e.g. Store gets R&D views only
      }
      updateData.permissions = parsedPermissions;
    } else if (changesCustom && customRole && !noLogin) {
      updateData.permissions = defaultsFor(customRole); // feature 34: onto a custom role = everything it allows
    } else if (role !== undefined && role && role !== user.role && !noLogin) {
      // 26 Nov: a move onto a limited role (e.g. Store) cuts what was held of the limited module.
      if (exceedsRoleLimits(role, user.permissions)) updateData.permissions = applyRoleLimits(role, { ...(user.permissions?.toObject ? user.permissions.toObject() : user.permissions), role });
      else updateData['permissions.role'] = role;
    }
    // Feature 34: on / off a custom role.
    if (changesCustom) {
      if (customRole) Object.assign(updateData, customRoleFields(customRole).set);
      else Object.assign(unset, customRoleFields(null).unset);
    }

    // HRMS fields
    if (mobile !== undefined) updateData.mobile = mobile;
    if (gender !== undefined) updateData.gender = gender;
    if (dob !== undefined) updateData.dob = dob || null;
    if (joiningDate !== undefined) updateData.joiningDate = joiningDate || null;
    if (reportingManager !== undefined || managerId !== undefined) {
      updateData.reportingManager = reportingManager || managerId || null;
    }
    if (employeeType !== undefined || employmentType !== undefined) {
      updateData.employeeType = employeeType || employmentType || '';
    }
    if (address !== undefined) updateData.address = address;

    // Profile Picture
    if (req.file) {
      updateData.profilePicture = req.file.filename;
    }

    // Hash password if provided
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 12);
      updateData.password = hashedPassword;
    }

    // 25 Nov 2026: the employment status fields that changed (see above).
    Object.assign(updateData, employment);
    Object.assign(unset, employmentUnset);

    // Feature 31: the Head role and its permissions wait; everything else in this edit saves.
    if (headRequest) {
      delete updateData.role;
      delete updateData.permissions;
      delete updateData['permissions.role'];
      for (const k of ['customRoleId', 'customRoleName']) { delete updateData[k]; delete unset[k]; } // feature 34: applied on approval
      updateData.headApproval = headRequest;
    } else if (clearsHeadRequest) {
      unset.headApproval = '';
    }

    if (Object.keys(unset).length) updateData.$unset = unset;

    console.log('Updating user with data:', { ...updateData, ...(updateData.password ? { password: '***' } : {}) });

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    console.log('User updated successfully:', updatedUser);
    if (newDeviceCode) await applyCodeQuietly(updatedUser.companyId, newDeviceCode);
    if (headRequest) await notifyCompanyAdmin(updatedUser, req.user);

    res.json({
      message: headRequest ? `Saved. The ${customRole?.name || role} role was ${SENT_MESSAGE.charAt(0).toLowerCase()}${SENT_MESSAGE.slice(1)}` : 'User updated successfully',
      success: true,
      pendingApproval: !!headRequest,
      user: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      message: 'Internal server error',
      success: false,
      error: error.message
    });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Feature 27 (24 Nov 2026): only within the caller's company; never the last Company Admin.
    if (!isSuperAdmin(req.user) && !sameCompany(req.user, user.companyId)) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (await isLastCompanyAdmin(user)) {
      return res.status(400).json({ message: LAST_CA_MESSAGE });
    }

    // Prevent deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    await User.findByIdAndDelete(id);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    console.log('Reset password request:', { id, newPassword: newPassword ? '***' : 'missing' });

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Found user for password reset:', { username: user.username, role: user.role });

    if (user.canLogin === false) {
      return res.status(400).json({ message: 'This person has no login. Use Give Login to set a password.' });
    }

    // Feature 27 (24 Nov 2026): only within the caller's company (it compared the unit name before,
    // which two companies can share).
    if (!isSuperAdmin(req.user) && !sameCompany(req.user, user.companyId)) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash the new password using the pre-save middleware
    user.password = newPassword;
    await user.save();

    console.log('Password reset successful for user:', user.username);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update user password - specific endpoint for password updates with encryption
export const updateUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    console.log('=== UPDATE PASSWORD ROUTE HIT ===');
    console.log('User ID:', id);
    console.log('Has newPassword:', !!newPassword);

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const target = await User.findById(id).select('canLogin companyId').lean();
    // Feature 27 (24 Nov 2026): only within the caller's company.
    if (!target || (!isSuperAdmin(req.user) && !sameCompany(req.user, target.companyId))) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (target?.canLogin === false) {
      return res.status(400).json({
        success: false,
        message: 'This person has no login. Use Give Login to set a password.'
      });
    }

    // Hash the new password with bcrypt for encryption
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    console.log('Password hashed successfully with bcrypt');

    const user = await User.findByIdAndUpdate(
      id,
      {
        password: hashedPassword,
        updatedAt: new Date()
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Password updated successfully for user:', user.username);

    res.json({
      success: true,
      message: 'Password updated successfully',
      user
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password update'
    });
  }
};
