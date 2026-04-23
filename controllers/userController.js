import User from '../models/User.js';
import { USER_ROLES } from '../../shared/schema.js';

import bcrypt from 'bcryptjs';

export const getUsers = async (req, res) => {
  try {
    console.log('=== getUsers API called ===');
    console.log('Query parameters:', req.query);
    console.log('User role:', req.user?.role);
    
    const { 
      page = 1, 
      limit = 10, // Changed default limit to 10 for better pagination
      role, 
      unit, 
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      status
    } = req.query;
    
    const skip = (page - 1) * limit;

    let query = {};

    // Non-super users can only see users from their unit
    if (req.user.role !== USER_ROLES.SUPER_USER && req.user.role !== 'Super Admin') {
      query.unit = req.user.unit;
    }

    // Filter by role
    if (role && role !== 'all') {
      query.role = role;
    }

    // Filter by unit
    if (unit && unit !== 'all') {
      query.unit = unit;
    }

    // Filter by status
    if (status && status !== 'all') {
      query.isActive = status === 'active';
    }

    // Search functionality
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch users with pagination
    const users = await User.find(query)
      .select('-password')
      .populate('companyId', 'name unitName city state displayName') // Populate company info
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Get summary statistics
    const stats = await User.aggregate([
      { $match: {} }, // Get all users for stats
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

    const summary = stats[0] || { totalUsers: 0, activeUsers: 0, roleBreakdown: [] };

    // Process role breakdown
    const roleStats = {};
    if (summary.roleBreakdown) {
      summary.roleBreakdown.forEach(role => {
        roleStats[role] = (roleStats[role] || 0) + 1;
      });
    }

    console.log('=== getUsers response ===');
    console.log('Total users found:', total);
    console.log('Users count:', users.length);
    console.log('Sample user:', users[0] ? { id: users[0]._id, username: users[0].username, role: users[0].role } : 'No users');

    // Format response to maintain frontend compatibility
    res.json({
      success: true,
      users, // Keep this for backward compatibility
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      summary: {
        totalUsers: summary.totalUsers,
        activeUsers: summary.activeUsers,
        inactiveUsers: summary.totalUsers - summary.activeUsers,
        roleStats
      },
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        summary: {
          totalUsers: summary.totalUsers,
          activeUsers: summary.activeUsers,
          inactiveUsers: summary.totalUsers - summary.activeUsers,
          roleStats
        }
      }
    });

  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
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
    const { username, email, password, fullName, role, unit, companyId, permissions, isActive } = req.body;

    // Validate required fields (unit and companyId are optional)
    if (!username || !email || !password || !role) {
      console.log('Validation failed - missing required fields');
      return res.status(400).json({ 
        message: 'Username, email, password, and role are required',
        success: false 
      });
    }

    // Check if username or email already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      console.log('User already exists:', username, email);
      return res.status(400).json({ 
        message: 'Username or email already exists',
        success: false 
      });
    }

    const userData = {
      username,
      email: email.toLowerCase(),
      password,
      fullName: fullName || '',
      role,
      unit: unit || '',
      companyId: companyId || null, // Add company assignment
      isActive: isActive !== undefined ? isActive : true,
      permissions: permissions || {}
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
    const { username, email, password, fullName, role, unit, companyId, permissions, isActive } = req.body;

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        success: false 
      });
    }

    // Validate required fields
    if (!username || !email || !role) {
      return res.status(400).json({ 
        message: 'Username, email, and role are required',
        success: false 
      });
    }

    // Check for duplicate username/email (excluding current user)
    const existingUser = await User.findOne({
      _id: { $ne: id },
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(400).json({ 
        message: 'Username or email already exists',
        success: false 
      });
    }

    const updateData = {
      username,
      email: email.toLowerCase(),
      fullName: fullName || '',
      role,
      unit: unit || '',
      companyId: companyId || null, // Add company assignment
      isActive: isActive !== undefined ? isActive : true,
      permissions: permissions || {}
    };

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
