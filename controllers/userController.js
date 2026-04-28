import User from '../models/User.js';
import { USER_ROLES } from '../shared/schema.js';

import bcrypt from 'bcryptjs';

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
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (page - 1) * parseInt(limit);
    let query = {};

    // 1. Enforce Role-Based Data Isolation
    if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin' && currentUser.role !== 'super_user') {
      // Non-super admins must be restricted to their own company
      if (currentUser.companyId) {
        query.companyId = currentUser.companyId;
      }

      // If role is Manager, only show users reporting to them
      if (currentUser.role === 'Manager') {
        query.reportingManager = currentUser._id;
      }

      // Filter by unit only if the current user has a specific unit assigned in the DB
      if (currentUser.unit && currentUser.unit !== currentUser.company?.unitName) {
        query.unit = currentUser.unit;
      }
    }

    // 2. Apply Frontend Filters
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } }
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
      .populate('companyId', 'name unitName city state displayName'); // Populate company info

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
    console.log('Create user request body:', req.body);
    const {
      username, email, password, fullName, role, unit, companyId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType
    } = req.body;

    // Validate required fields
    if (!email || !password || !role) {
      console.log('Validation failed - missing required fields');
      return res.status(400).json({
        message: 'Email, password, and role are required',
        success: false
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      console.log('User already exists with email:', email);
      return res.status(400).json({
        message: 'Email already exists',
        success: false
      });
    }

    // Auto-inherit company and unit for HR-Admin
    let finalCompanyId = companyId;
    let finalUnit = unit;

    if (req.user && (req.user.role === 'HR-Admin' || req.user.role === 'Hr Admin')) {
      finalCompanyId = req.user.companyId || finalCompanyId;
      finalUnit = req.user.unit || finalUnit;
    }

    // Build default permissions object - permissions.role is required by User model
    const defaultPermissions = permissions || {
      role: role,
      canAccessAllUnits: false,
      modules: []
    };
    if (!defaultPermissions.role) {
      defaultPermissions.role = role;
    }

    const userData = {
      username: username || email.toLowerCase(),
      email: email.toLowerCase(),
      password,
      fullName: fullName || '',
      role,
      unit: finalUnit || '',
      companyId: finalCompanyId || null,
      isActive: isActive !== undefined ? isActive : true,
      permissions: defaultPermissions,
      // HRMS fields
      mobile: mobile || '',
      gender: gender || '',
      dob: dob || null,
      joiningDate: joiningDate || null,
      reportingManager: reportingManager || managerId || null,
      employeeType: employeeType || employmentType || ''
    };

    console.log('Creating user with data:', userData);

    const user = new User(userData);
    await user.save();

    const { password: _, ...userWithoutPassword } = user.toObject();

    console.log('User created successfully:', userWithoutPassword);

    res.status(201).json({
      message: 'User created successfully',
      success: true,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      message: 'Internal server error',
      success: false,
      error: error.message
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Update user request:', id, req.body);
    const {
      username, email, password, fullName, role, unit, companyId, permissions, isActive,
      mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType
    } = req.body;

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found',
        success: false
      });
    }

    // Validate required fields
    if (!email || !role) {
      return res.status(400).json({
        message: 'Email and role are required',
        success: false
      });
    }

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
    if (permissions !== undefined) updateData.permissions = permissions;

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
