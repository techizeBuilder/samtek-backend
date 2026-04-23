import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getUserModules } from '../middleware/permissions.js';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/profiles/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Get current user's profile
export const getProfile = async (req, res) => {
  try {
    console.log('=== GET PROFILE ROUTE HIT ===');
    console.log('User from request:', req.user);
    
    // Handle different user ID formats from auth middleware
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    console.log('Looking for user ID:', userId);
    
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    const user = await User.findById(userId)
      .select('-password')
      .populate('companyId', 'name city state');
    console.log('Found user:', user ? 'Yes' : 'No');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get simple module names for the user's role
    const userModules = getUserModules(user.role);

    const profileData = {
      id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
      role: user.role,
      unit: user.unit,
      companyId: user.companyId?._id,
      company: user.companyId ? {
        id: user.companyId._id,
        name: user.companyId.name,
        location: user.companyId.location
      } : null,
      permissions: userModules, // Use simple module names instead of complex DB permissions
      profile: user.profile
    };
    
    console.log('Returning profile data:', profileData);
    res.json(profileData);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update profile (fullName and email)
export const updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    
    // Handle different user ID formats from auth middleware
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    
    // Check if email is already taken by another user
    if (email) {
      const existingUser = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
        role: user.role,
        unit: user.unit,
        permissions: user.permissions,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Old password and new password are required' });
    }

    // Handle different user ID formats from auth middleware
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify old password
    const isValidPassword = await bcrypt.compare(oldPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password
    await User.findByIdAndUpdate(userId, {
      password: hashedNewPassword
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Upload profile picture
export const uploadProfilePicture = [
  upload.single('picture'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Handle different user ID formats from auth middleware
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Delete old profile picture if exists
      if (user.profilePicture) {
        const oldImagePath = path.join('uploads/profiles/', user.profilePicture);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      // Update user with new profile picture filename
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { profilePicture: req.file.filename },
        { new: true }
      ).select('-password');

      res.json({
        message: 'Profile picture uploaded successfully',
        profilePicture: `/uploads/profiles/${req.file.filename}`,
        user: {
          id: updatedUser._id,
          username: updatedUser.username,
          email: updatedUser.email,
          fullName: updatedUser.fullName,
          profilePicture: `/uploads/profiles/${updatedUser.profilePicture}`,
          role: updatedUser.role,
          unit: updatedUser.unit,
          permissions: updatedUser.permissions,
          profile: updatedUser.profile
        }
      });
    } catch (error) {
      console.error('Upload profile picture error:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
];