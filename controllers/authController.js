import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';
import { getUserPermissions, getUserModules } from '../middleware/permissions.js';
import bcrypt from 'bcryptjs';

const login = async (req, res) => {
  try {
    console.log('=== LOGIN CONTROLLER EXECUTING ===');
    console.log('Request body:', req.body);

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      isActive: true
    });

    console.log('=== USER LOOKUP RESULT ===');
    console.log('Search username/email:', username);
    console.log('User found:', !!user);
    if (user) {
      console.log('Found user details:', {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        unit: user.unit,
        isActive: user.isActive,
        hasPassword: !!user.password,
        passwordLength: user.password ? user.password.length : 0
      });
    } else {
      // Check if user exists but is inactive
      const inactiveUser = await User.findOne({
        $or: [{ username }, { email: username }]
      });
      if (inactiveUser) {
        console.log('User exists but is INACTIVE:', {
          username: inactiveUser.username,
          email: inactiveUser.email,
          isActive: inactiveUser.isActive
        });
        return res.status(401).json({ message: 'Account is deactivated. Please contact administrator.' });
      }
    }

    if (!user) {
      console.log('No user found with username/email:', username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('=== PASSWORD VERIFICATION ===');
    console.log('Provided password:', password);
    console.log('Stored password hash:', user.password);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('Password validation result:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('Password mismatch for user:', username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);
    const userModules = getUserModules(user.role);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      unit: user.unit,
      isActive: user.isActive,
      modules: userModules,
      lastLogin: user.lastLogin,
      permissions: userModules // Always return simple module names array
    };

    const response = {
      message: 'Login successful',
      success: true,
      user: userResponse,
      token
    };

    console.log('=== LOGIN SUCCESS - SENDING RESPONSE ===');
    console.log('User modules for role', user.role, ':', userModules);
    console.log('Response user permissions:', userResponse.permissions);
    console.log('User:', userResponse.username, 'Role:', userResponse.role);

    res.status(200).json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const logout = async (req, res) => {
  try {
    res.clearCookie('token');
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const userModulesForCurrentUser = getUserModules(user.role);

    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      profilePicture: user.profilePicture,
      role: user.role,
      unit: user.unit || user.companyId?.unitName || 'Main Unit',
      companyId: user.companyId?._id || user.companyId,
      company: user.companyId ? {
        id: user.companyId._id || user.companyId,
        name: user.companyId.name,
        unitName: user.companyId.unitName,
        location: user.companyId.city && user.companyId.state ? `${user.companyId.city}, ${user.companyId.state}` : user.companyId.location
      } : null,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      permissions: userModulesForCurrentUser
    };

    res.json(userResponse);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(req.user._id);
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export {
  login,
  logout,
  getCurrentUser,
  changePassword
};
