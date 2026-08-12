import User from '../models/User.js';
import { Company } from '../models/Company.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import { USER_ROLES } from '../shared/schema.js';
import bcrypt from 'bcryptjs';
import { generateEmployeeId } from '../utils/employeeUtils.js';

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
      gender
    } = req.query;

    const skip = (page - 1) * parseInt(limit);
    let query = {};

    // 1. Enforce Role-Based Data Isolation
    if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin' && currentUser.role !== 'super_user') {
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
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role;
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

    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select('-password')
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

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Allow access (unit restrictions removed)

    res.json({ user });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createUser = async (req, res) => {
  try {
    const {
      username, email, password, fullName, role, unit, companyId, branchId, departmentId, designationId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId,
      isTrainee, ivrNumber, address,
      technicianSkills, serviceZone // 🔥 NEW: Added Technician Fields
    } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required', success: false });
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

    let parsedPermissions = permissions;
    if (permissions) {
      try {
        if (typeof permissions === 'string') parsedPermissions = JSON.parse(permissions);
        if (typeof parsedPermissions === 'string') parsedPermissions = JSON.parse(parsedPermissions);
      } catch (e) {
        parsedPermissions = { role: role, canAccessAllUnits: false, modules: [] };
      }
    }

    const defaultPermissions = parsedPermissions || { role: role, canAccessAllUnits: false, modules: [] };
    if (!defaultPermissions.role) defaultPermissions.role = role;

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
      serviceZone: role === 'Complaint Management Employee' ? (serviceZone || finalUnit || '') : ''
    };

    const user = new User(userData);
    await user.save();
    const { password: _, ...userWithoutPassword } = user.toObject();

    res.status(201).json({ message: 'User created successfully', success: true, user: userWithoutPassword });
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

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Update user request:', id, req.body);
    const {
      username, email, password, fullName, role, unit, companyId, branchId, departmentId, designationId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId, address
    } = req.body;

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

    // Changing ANYONE's role or module permissions is an admin-only action —
    // without this, any authenticated user (e.g. a Sales Employee) could
    // PATCH a colleague's account to role: 'Superadmin' with full access.
    const ADMIN_TIER_ROLES = ['Superadmin', 'Super Admin', 'HR-Admin', 'Company Admin'];
    const isAdminTier = ADMIN_TIER_ROLES.includes(req.user.role);
    if (!isAdminTier && ((role !== undefined && role !== user.role) || permissions !== undefined)) {
      return res.status(403).json({
        message: 'Access denied. Only an admin can change a user\'s role or module permissions.',
        success: false
      });
    }

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

    if (username !== undefined) updateData.username = username || email?.toLowerCase();
    if (email !== undefined) updateData.email = email.toLowerCase();
    if (fullName !== undefined) updateData.fullName = fullName;
    if (role !== undefined) updateData.role = role;
    if (unit !== undefined) updateData.unit = unit;
    if (companyId !== undefined) updateData.companyId = companyId || null;
    if (branchId !== undefined) updateData.branchId = branchId || null;
    if (departmentId !== undefined) updateData.departmentId = departmentId || null;
    if (designationId !== undefined) updateData.designationId = designationId || null;
    if (employeeId !== undefined) updateData.employeeId = employeeId;
    if (permissions !== undefined) {
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
      updateData.permissions = parsedPermissions;
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

    console.log('Updating user with data:', updateData);

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    console.log('User updated successfully:', updatedUser);

    res.json({
      message: 'User updated successfully',
      success: true,
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

    // Allow deletion (unit restrictions removed)

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

    // Non-super users can only reset passwords for users from their unit
    if (req.user.role !== USER_ROLES.SUPER_USER && user.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
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
