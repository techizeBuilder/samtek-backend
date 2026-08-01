import User from '../models/User.js';
import { USER_ROLES } from '../shared/schema.js';
import { Company } from '../models/Company.js';
import bcrypt from 'bcryptjs';

// Get all Unit Managers under the current Unit Head
export const getUnitManagers = async (req, res) => {
  try {
    console.log('=== getUnitManagers API called ===');
    console.log('Query parameters:', req.query);
    console.log('Unit Head user:', req.user?.username, 'Unit:', req.user?.unit, 'CompanyId:', req.user?.companyId);

    // Debug: Check if companyId exists
    if (!req.user?.companyId) {
      console.log('🚨 WARNING: Unit Head has no companyId assigned!');
      return res.status(400).json({
        success: false,
        message: 'Unit Head must be assigned to a company. Please contact administrator.',
        debug: {
          user: req.user?.username,
          unit: req.user?.unit,
          companyId: req.user?.companyId
        }
      });
    }

    const {
      page = 1,
      limit = 100,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      status = 'all'
    } = req.query;

    const skip = (page - 1) * limit;

    // Unit Head can only see Unit Managers from their own unit AND company
    let query = {
      role: 'Unit Manager',
      unit: req.user.unit, // Only show users from the same unit
      companyId: req.user.companyId // Only show users from the same company
    };

    console.log('Filtering query:', query);
    console.log('Unit Head companyId:', req.user.companyId);

    // Filter by status
    if (status !== 'all') {
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

    // Fetch unit managers with pagination
    const unitManagers = await User.find(query)
      .select('-password')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Get summary statistics for this unit and company
    const stats = await User.aggregate([
      {
        $match: {
          unit: req.user.unit,
          role: 'Unit Manager',
          companyId: req.user.companyId // Filter by company
        }
      },
      {
        $group: {
          _id: null,
          totalManagers: { $sum: 1 },
          activeManagers: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          inactiveManagers: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
          }
        }
      }
    ]);

    const summary = stats[0] || {
      totalManagers: 0,
      activeManagers: 0,
      inactiveManagers: 0
    };

    console.log('=== getUnitManagers response ===');
    console.log('Total unit managers found:', total);
    console.log('Unit managers count:', unitManagers.length);
    console.log('Unit managers sample:', unitManagers.slice(0, 2).map(u => ({
      username: u.username,
      unit: u.unit,
      companyId: u.companyId
    })));

    res.json({
      success: true,
      data: {
        users: unitManagers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        summary,
        unit: req.user.unit
      }
    });
  } catch (error) {
    console.error('Get unit managers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unit managers',
      error: error.message
    });
  }
};

// Create a new Unit Manager (only Unit Heads can do this)
export const createUnitManager = async (req, res) => {
  try {
    console.log('=== createUnitManager API called ===');
    console.log('Request body:', req.body);
    console.log('Unit Head user:', req.user.username, 'Company ID:', req.user.companyId);

    const { username, email, password, fullName, permissions, isActive = true } = req.body;

    // Check if Unit Head has company assignment
    if (!req.user.companyId) {
      return res.status(400).json({
        success: false,
        message: 'Unit Head must be assigned to a company/location before creating Unit Managers. Please contact system administrator.'
      });
    }

    // Get Unit Head's company information
    const unitHeadCompany = await Company.findById(req.user.companyId);
    if (!unitHeadCompany) {
      return res.status(400).json({
        success: false,
        message: 'Unit Head company assignment not found. Please contact system administrator.'
      });
    }

    // Validation
    if (!username || !email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, password, and full name are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or username already exists'
      });
    }

    // Create new unit manager under the same unit and company as the Unit Head
    const newUser = new User({
      username,
      email,
      password,
      fullName,
      role: 'Unit Manager', // Fixed role
      unit: req.user.unit, // Same unit as the Unit Head
      companyId: req.user.companyId, // Same company as the Unit Head
      permissions: {
        role: 'unit_manager', // Required permissions.role field
        canAccessAllUnits: false,
        modules: permissions?.modules || [],
        ...permissions
      },
      isActive
    });

    await newUser.save();

    // Remove password from response
    const userResponse = newUser.toObject();
    delete userResponse.password;

    console.log('=== Unit Manager created successfully ===');
    console.log('New user:', { id: newUser._id, username, role: 'Unit Manager', unit: req.user.unit });

    res.status(201).json({
      success: true,
      message: 'Unit Manager created successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Create unit manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create unit manager',
      error: error.message
    });
  }
};

// Update Unit Manager details and permissions
export const updateUnitManager = async (req, res) => {
  try {
    console.log('=== updateUnitManager API called ===');
    console.log('User ID:', req.params.userId);
    console.log('Request body:', req.body);

    const { userId } = req.params;
    const { username, email, fullName, permissions, isActive } = req.body;

    // Find the user and ensure they are a Unit Manager in the same unit AND company
    const user = await User.findOne({
      _id: userId,
      role: 'Unit Manager',
      unit: req.user.unit,
      companyId: req.user.companyId // Ensure same company
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Unit Manager not found or not in your unit'
      });
    }

    // Check if email/username is already taken by another user
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ username, _id: { $ne: userId } });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }
    }

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email, _id: { $ne: userId } });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already taken'
        });
      }
    }

    // Update user fields
    if (username) user.username = username;
    if (email) user.email = email;
    if (fullName) user.fullName = fullName;
    if (permissions) {
      user.permissions = {
        role: 'unit_manager', // Required permissions.role field
        canAccessAllUnits: false,
        modules: permissions?.modules || [],
        ...permissions
      };
    }
    if (typeof isActive === 'boolean') user.isActive = isActive;

    await user.save();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    console.log('=== Unit Manager updated successfully ===');

    res.json({
      success: true,
      message: 'Unit Manager updated successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Update unit manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update unit manager',
      error: error.message
    });
  }
};

// Update Unit Manager password
export const updateUnitManagerPassword = async (req, res) => {
  try {
    console.log('=== updateUnitManagerPassword API called ===');
    console.log('User ID:', req.params.userId);
    console.log('Unit Head:', req.user.username, 'Unit:', req.user.unit);

    const { userId } = req.params;
    const { newPassword } = req.body;

    console.log('Has newPassword:', !!newPassword);
    console.log('Password length:', newPassword ? newPassword.length : 0);

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find the user and ensure they are a Unit Manager in the same unit AND company
    const user = await User.findOne({
      _id: userId,
      role: 'Unit Manager',
      unit: req.user.unit,
      companyId: req.user.companyId // Ensure same company
    });

    if (!user) {
      console.log('Unit Manager not found or not in unit');
      return res.status(404).json({
        success: false,
        message: 'Unit Manager not found or not in your unit'
      });
    }

    console.log('Found Unit Manager:', user.username, 'Email:', user.email);

    // Update password (using .save() to trigger User model's pre-save middleware for hashing)
    user.password = newPassword;
    user.updatedAt = new Date();
    await user.save();

    console.log('=== Unit Manager password updated successfully ===');
    console.log('Updated user:', user.username);

    res.json({
      success: true,
      message: 'Password updated successfully',
      data: {
        _id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Update unit manager password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update password',
      error: error.message
    });
  }
};

// Delete/Deactivate Unit Manager
export const deleteUnitManager = async (req, res) => {
  try {
    console.log('=== deleteUnitManager API called ===');
    console.log('User ID:', req.params.userId);

    const { userId } = req.params;
    const { permanent = false } = req.body;

    // Find the user and ensure they are a Unit Manager in the same unit AND company
    const user = await User.findOne({
      _id: userId,
      role: 'Unit Manager',
      unit: req.user.unit,
      companyId: req.user.companyId // Ensure same company
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Unit Manager not found or not in your unit'
      });
    }

    if (permanent) {
      // Permanently delete the user
      await User.findByIdAndDelete(userId);
      console.log('=== Unit Manager deleted permanently ===');

      res.json({
        success: true,
        message: 'Unit Manager deleted permanently'
      });
    } else {
      // Just deactivate the user
      user.isActive = false;
      await user.save();

      console.log('=== Unit Manager deactivated ===');

      res.json({
        success: true,
        message: 'Unit Manager deactivated successfully',
        data: {
          _id: user._id,
          username: user.username,
          isActive: user.isActive
        }
      });
    }
  } catch (error) {
    console.error('Delete unit manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete unit manager',
      error: error.message
    });
  }
};

// Get Unit Manager by ID
export const getUnitManagerById = async (req, res) => {
  try {
    console.log('=== getUnitManagerById API called ===');
    console.log('User ID:', req.params.userId);

    const { userId } = req.params;

    // Find the user and ensure they are a Unit Manager in the same unit AND company
    const user = await User.findOne({
      _id: userId,
      role: 'Unit Manager',
      unit: req.user.unit,
      companyId: req.user.companyId // Ensure same company
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Unit Manager not found or not in your unit'
      });
    }

    console.log('=== Unit Manager found ===');

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get unit manager by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unit manager',
      error: error.message
    });
  }
};

// Get available modules and permissions for Unit Manager role
export const getUnitManagerModules = async (req, res) => {
  try {
    console.log('=== getUnitManagerModules API called ===');

    // Define modules that Unit Managers can access
    const availableModules = [
      {
        name: 'sales',
        label: 'Sales',
        features: [
          { key: 'orders', label: 'View Orders' },
          { key: 'myOrders', label: 'My Orders' },
          { key: 'myCustomers', label: 'My Customers' },
          { key: 'salesApproval', label: 'Sales Approval' },
          { key: 'salesOrderList', label: 'Sales Order List' }
        ]
      },
      {
        name: 'production',
        label: 'Production',
        features: [
          { key: 'view', label: 'View Production' },
          { key: 'schedule', label: 'Production Schedule' },
          { key: 'quality', label: 'Quality Control' }
        ]
      },
      {
        name: 'inventory',
        label: 'Inventory',
        features: [
          { key: 'view', label: 'View Inventory' },
          { key: 'update', label: 'Update Stock' }
        ]
      },
      {
        name: 'reports',
        label: 'Reports',
        features: [
          { key: 'salesReport', label: 'Sales Reports' },
          { key: 'productionReport', label: 'Production Reports' }
        ]
      }
    ];

    res.json({
      success: true,
      data: {
        modules: availableModules,
        roles: ['Unit Manager'], // Only Unit Manager role for this context
        units: [req.user.unit] // Only current unit
      }
    });
  } catch (error) {
    console.error('Get unit manager modules error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch modules',
      error: error.message
    });
  }
};

// Get Unit Head's company information for form pre-population
export const getUnitHeadCompanyInfo = async (req, res) => {
  try {
    console.log('=== getUnitHeadCompanyInfo API called ===');
    console.log('Unit Head user:', req.user.username, 'Company ID:', req.user.companyId);

    // Check if Unit Head has company assignment
    if (!req.user.companyId) {
      return res.status(400).json({
        success: false,
        message: 'Unit Head is not assigned to any company/location. Please contact system administrator.'
      });
    }

    // Get Unit Head's company information
    const company = await Company.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company information not found. Please contact system administrator.'
      });
    }

    // Return company info for form pre-population
    res.json({
      success: true,
      data: {
        companyId: company._id,
        companyName: company.name,
        unitName: company.unitName,
        location: `${company.name}, ${company.city}`,
        city: company.city,
        address: company.address
      }
    });
  } catch (error) {
    console.error('Get unit head company info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company information',
      error: error.message
    });
  }
};

// ============ NEW FUNCTIONS FOR ALL UNIT USERS ============

// Unit Head manageable roles
const UNIT_HEAD_MANAGEABLE_ROLES = [
  'Unit Manager',
  'Sales',
  'Production',
  'Accounts',
  'Dispatch',
  'Packing'
];

// Get all unit users (Unit Manager, Sales, Production, Accounts, Dispatch, Packing)
export const getUnitUsers = async (req, res) => {
  try {
    console.log('=== getUnitUsers API called ===');
    console.log('Unit Head user:', req.user?.username, 'Unit:', req.user?.unit, 'CompanyId:', req.user?.companyId);

    if (!req.user?.companyId) {
      return res.status(400).json({
        success: false,
        message: 'Unit Head must be assigned to a company. Please contact administrator.',
      });
    }

    const {
      page = 1,
      limit = 100,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      status = 'all'
    } = req.query;

    const skip = (page - 1) * limit;

    // Unit Head can only see users from their unit, company, and manageable roles
    let query = {
      role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
      unit: req.user.unit,
      companyId: req.user.companyId
    };

    // Filter by status
    if (status !== 'all') {
      query.isActive = status === 'active';
    }

    // Search functionality
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } }
      ];
    }

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch unit users with pagination
    const unitUsers = await User.find(query)
      .select('-password')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('companyId', 'name city state unitName');

    console.log('=== Unit Users Debug ===');
    console.log('Total users found:', unitUsers.length);
    console.log('Query used:', JSON.stringify(query, null, 2));

    if (unitUsers.length > 0) {
      console.log('First user sample:', {
        username: unitUsers[0].username,
        companyId: unitUsers[0].companyId,
        companyIdType: typeof unitUsers[0].companyId,
        companyIdValue: JSON.stringify(unitUsers[0].companyId)
      });
    }

    // Convert to JSON to ensure proper serialization
    const formattedUsers = unitUsers.map(user => {
      const userObj = user.toObject();
      console.log('User company after toObject:', userObj.companyId);
      return userObj;
    });

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Get summary statistics by role
    const stats = await User.aggregate([
      {
        $match: {
          unit: req.user.unit,
          role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
          companyId: req.user.companyId
        }
      },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } }
        }
      }
    ]);

    const summary = {
      totalUsers: total,
      activeUsers: formattedUsers.filter(u => u.isActive).length,
      inactiveUsers: formattedUsers.filter(u => !u.isActive).length,
      byRole: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          total: stat.total,
          active: stat.active,
          inactive: stat.inactive
        };
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: {
        users: formattedUsers,
        summary,
        unit: req.user.unit,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: total,
          hasNext: skip + formattedUsers.length < total,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Get unit users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unit users',
      error: error.message
    });
  }
};

// Get unit user by ID
export const getUnitUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({
      _id: userId,
      role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
      unit: req.user.unit,
      companyId: req.user.companyId
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found or access denied'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get unit user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
};

// Create new unit user
export const createUnitUser = async (req, res) => {
  try {
    const { username, email, fullName, role, password, permissions } = req.body;

    // Validate required fields
    if (!username || !email || !fullName || !role || !password) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Validate role
    if (!UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
      });
    }

    // Check if username or email already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.username === username
          ? 'Username already exists'
          : 'Email already exists'
      });
    }

    // Create user with Unit Head's company and unit info (User model will handle password hashing automatically)
    const newUser = new User({
      username,
      email,
      fullName,
      role,
      password,
      unit: req.user.unit,
      companyId: req.user.companyId,
      permissions: {
        role: role.toLowerCase().replace(' ', '_'), // Set a default permission role based on user role
        ...permissions
      },
      isActive: true
    });

    await newUser.save();

    // Return user without password
    const { password: _, ...userResponse } = newUser.toObject();

    res.status(201).json({
      success: true,
      message: `${role} created successfully`,
      data: userResponse
    });
  } catch (error) {
    console.error('Create unit user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
};

// Update unit user
export const updateUnitUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, fullName, role, permissions, isActive } = req.body;

    // Find user and verify access
    const user = await User.findOne({
      _id: userId,
      role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
      unit: req.user.unit,
      companyId: req.user.companyId
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found or access denied'
      });
    }

    // Validate role if provided
    if (role && !UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
      });
    }

    // Check for duplicate username/email (excluding current user)
    if (username || email) {
      const duplicateQuery = { _id: { $ne: userId } };
      if (username) duplicateQuery.username = username;
      if (email) duplicateQuery.email = email;

      const existingUser = await User.findOne({
        $or: [
          ...(username ? [{ username, _id: { $ne: userId } }] : []),
          ...(email ? [{ email, _id: { $ne: userId } }] : [])
        ]
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: existingUser.username === username
            ? 'Username already exists'
            : 'Email already exists'
        });
      }
    }

    // Update user fields
    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (fullName) updateData.fullName = fullName;
    if (role) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = permissions;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update unit user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
};

// Update unit user password
export const updateUnitUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user and verify access
    const user = await User.findOne({
      _id: userId,
      role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
      unit: req.user.unit,
      companyId: req.user.companyId
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found or access denied'
      });
    }

    // Update password (using .save() to trigger User model's pre-save middleware for hashing)
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Update unit user password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update password',
      error: error.message
    });
  }
};

// Delete unit user
export const deleteUnitUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user and verify access
    const user = await User.findOne({
      _id: userId,
      role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
      unit: req.user.unit,
      companyId: req.user.companyId
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found or access denied'
      });
    }

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: `${user.role} deleted successfully`
    });
  } catch (error) {
    console.error('Delete unit user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
};

// Helper function to get default permissions based on role
const getDefaultPermissionsByRole = (role) => {
  const defaultPermissions = {
    role: role, // Required field in User model
    canAccessAllUnits: false,
    modules: []
  };

  switch (role) {
    case 'Unit Manager':
      defaultPermissions.modules = [{
        name: 'unitManager',
        dashboard: true,
        features: [
          { key: 'salesApproval', view: true, add: true, edit: true, delete: false },
          { key: 'salesOrderList', view: true, add: false, edit: true, delete: false },
          { key: 'productionGroup', view: true, add: true, edit: true, delete: false },
          { key: 'returns', view: true, add: true, edit: true, delete: false }
        ]
      }];
      break;

    case 'Sales':
      defaultPermissions.modules = [{
        name: 'sales',
        dashboard: true,
        features: [
          { key: 'orders', view: true, add: true, edit: true, delete: false },
          { key: 'leads', view: true, add: true, edit: true, delete: false },
          { key: 'paymentRequests', view: true, add: true, edit: true, delete: false },
          { key: 'myCustomers', view: true, add: true, edit: true, delete: false },
          { key: 'myDeliveries', view: true, add: false, edit: false, delete: false },
          { key: 'myInvoices', view: true, add: false, edit: false, delete: false },
          { key: 'returns', view: true, add: true, edit: true, delete: false }
        ]
      }];
      break;

    case 'Production':
      defaultPermissions.modules = [{
        name: 'production',
        dashboard: true,
        features: [
          { key: 'productionDashboard', view: true, add: false, edit: false, delete: false },
          { key: 'productionReports', view: true, add: false, edit: false, delete: false },
          { key: 'productionSheet', view: true, add: true, edit: true, delete: false },
          { key: 'orders', view: true, add: true, edit: true, delete: false },
          { key: 'repairProduction', view: true, add: true, edit: true, delete: false },
          { key: 'workPlanning', view: true, add: true, edit: true, delete: false },
          { key: 'processQc', view: true, add: true, edit: true, delete: false },
          { key: 'jobCards', view: true, add: true, edit: true, delete: false },
          { key: 'manpower', view: true, add: true, edit: true, delete: false },
          { key: 'expenses', view: true, add: true, edit: true, delete: false }
        ]
      }];
      break;

    case 'Packing':
      defaultPermissions.modules = [{
        name: 'packing',
        dashboard: true,
        features: [
          { key: 'dashboard', view: true, add: false, edit: false, delete: false },
          { key: 'packingSheet', view: true, add: true, edit: true, delete: false },
          { key: 'packingHistory', view: true, add: false, edit: false, delete: false }
        ]
      }];
      break;

    case 'Accounts':
      defaultPermissions.modules = [{
        name: 'accounts',
        dashboard: true,
        features: [
          { key: 'transactions', view: true, add: true, edit: true, delete: false },
          { key: 'balanceSheet', view: true, add: false, edit: false, delete: false },
          { key: 'reports', view: true, add: false, edit: false, delete: false },
          { key: 'payments', view: true, add: true, edit: true, delete: false }
        ]
      }];
      break;

    case 'Dispatch':
      defaultPermissions.modules = [{
        name: 'dispatches',
        dashboard: true,
        features: [
          { key: 'dashboard', view: true, add: false, edit: false, delete: false },
          { key: 'deliveryChallan', view: true, add: true, edit: true, delete: false },
          { key: 'packagingQueue', view: true, add: true, edit: true, delete: false },
          { key: 'packagingJobs', view: true, add: true, edit: true, delete: false },
          { key: 'dispatchPlanning', view: true, add: true, edit: true, delete: false },
          { key: 'activeDispatches', view: true, add: true, edit: true, delete: false },
          { key: 'dispatchHistory', view: true, add: false, edit: false, delete: false }
        ]
      }];
      break;

    default:
      break;
  }

  return defaultPermissions;
};

// Bulk import unit users
export const bulkImportUnitUsers = async (req, res) => {
  try {
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Users array is required and must not be empty'
      });
    }

    const results = {
      success: [],
      failed: [],
      skipped: [],
      total: users.length
    };

    for (let i = 0; i < users.length; i++) {
      const userData = users[i];
      const rowNumber = i + 2; // Excel row number (accounting for header)

      try {
        // Validate required fields
        const username = userData.username?.toString().trim();
        const email = userData.email?.toString().trim();
        const role = userData.role?.toString().trim();
        const fullName = userData.fullName?.toString().trim() || username;

        // Check for missing required fields
        if (!username || !email || !role) {
          results.failed.push({
            row: rowNumber,
            username: username || 'N/A',
            email: email || 'N/A',
            error: 'Missing required fields (username, email, or role)'
          });
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          results.failed.push({
            row: rowNumber,
            username,
            email,
            error: 'Invalid email format'
          });
          continue;
        }

        // Validate role
        if (!UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
          results.failed.push({
            row: rowNumber,
            username,
            email,
            error: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
          });
          continue;
        }

        // Check for duplicate username or email in database
        const existingUser = await User.findOne({
          $or: [{ username }, { email }],
          unit: req.user.unit,
          companyId: req.user.companyId
        });

        if (existingUser) {
          results.skipped.push({
            row: rowNumber,
            username,
            email,
            reason: existingUser.username === username
              ? 'Username already exists'
              : 'Email already exists'
          });
          continue;
        }

        // Get default permissions based on role
        const defaultPermissions = getDefaultPermissionsByRole(role);

        // Create new user with default password
        const newUser = new User({
          username,
          email,
          fullName,
          role,
          password: 'Welcome@123', // Default password
          unit: req.user.unit,
          companyId: req.user.companyId,
          permissions: defaultPermissions,
          isActive: userData.status?.toString().toLowerCase() !== 'inactive'
        });

        await newUser.save();

        results.success.push({
          row: rowNumber,
          username,
          email,
          role,
          fullName
        });

      } catch (error) {
        results.failed.push({
          row: rowNumber,
          username: userData.username || 'N/A',
          email: userData.email || 'N/A',
          error: error.message || 'Unknown error occurred'
        });
      }
    }

    // Prepare response message
    const message = `Import completed: ${results.success.length} created, ${results.skipped.length} skipped (duplicates), ${results.failed.length} failed`;

    res.status(200).json({
      success: true,
      message,
      data: {
        summary: {
          total: results.total,
          successful: results.success.length,
          skipped: results.skipped.length,
          failed: results.failed.length
        },
        details: results
      }
    });

  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import users',
      error: error.message
    });
  }
};