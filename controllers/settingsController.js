import Settings from '../models/Settings.js';
import { USER_ROLES } from '../../shared/schema.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for logo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'company-logo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Check if the file is an image
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

export const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

export const getSettings = async (req, res) => {
  try {
    // Only super users can access settings
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied. Only super users can access settings.' });
    }

    const settings = await Settings.getSettings();
    res.json({ data: settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    // Only super users can update settings
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied. Only super users can update settings.' });
    }

    const updateData = req.body;
    
    // Get existing settings
    let settings = await Settings.getSettings();
    
    // Update the settings
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        settings[key] = updateData[key];
      }
    });

    await settings.save();

    res.json({
      message: 'Settings updated successfully',
      settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateCompanySettings = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    console.log('Received company settings update request:', req.body);
    
    const { name, address, contact, gstNumber, panNumber, email, logo, phone, website } = req.body;

    const settings = await Settings.getSettings();
    
    console.log('Before update - settings.company:', JSON.stringify(settings.company, null, 2));
    
    // Initialize company object if it doesn't exist
    if (!settings.company) {
      settings.company = {
        name: 'ManuERP Industries',
        contact: {},
        address: {}
      };
    }
    
    if (!settings.company.contact) settings.company.contact = {};
    if (!settings.company.address) settings.company.address = {};
    
    // Update fields
    if (name !== undefined) {
      console.log('Updating name:', name);
      settings.company.name = name;
    }
    
    // Handle address field directly (map to address.street)
    if (address !== undefined) {
      console.log('Updating address:', address);
      settings.company.address.street = address;
      // Mark the path as modified to ensure Mongoose saves it
      settings.markModified('company.address');
    }
    
    // Handle nested contact object
    if (contact) {
      console.log('Updating contact object:', contact);
      settings.company.contact = { ...settings.company.contact, ...contact };
      settings.markModified('company.contact');
    }
    
    // Handle email field directly (map to contact.email)
    if (email !== undefined) {
      console.log('Updating email:', email);
      settings.company.contact.email = email;
      settings.markModified('company.contact');
    }
    
    // Handle phone field directly (map to contact.phone)
    if (phone !== undefined) {
      console.log('Updating phone:', phone);
      settings.company.contact.phone = phone;
      settings.markModified('company.contact');
    }
    
    // Handle website field directly (map to contact.website)
    if (website !== undefined) {
      console.log('Updating website:', website);
      settings.company.contact.website = website;
      settings.markModified('company.contact');
    }
    
    // Handle logo field directly
    if (logo !== undefined) {
      console.log('Updating logo:', logo);
      settings.company.logo = logo;
    }
    
    if (gstNumber !== undefined) {
      console.log('Updating GST number:', gstNumber);
      settings.company.gstNumber = gstNumber;
    }
    
    if (panNumber !== undefined) {
      console.log('Updating PAN number:', panNumber);
      settings.company.panNumber = panNumber;
    }

    // Mark the entire company object as modified to ensure it saves
    settings.markModified('company');
    
    console.log('Before save - settings.company:', JSON.stringify(settings.company, null, 2));
    
    await settings.save();

    console.log('After save - settings.company:', JSON.stringify(settings.company, null, 2));

    res.json({
      message: 'Company settings updated successfully',
      company: settings.company
    });
  } catch (error) {
    console.error('Update company settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateSystemSettings = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { currency, timezone, dateFormat, timeFormat, language } = req.body;

    const settings = await Settings.getSettings();
    
    if (currency) settings.system.currency = currency;
    if (timezone) settings.system.timezone = timezone;
    if (dateFormat) settings.system.dateFormat = dateFormat;
    if (timeFormat) settings.system.timeFormat = timeFormat;
    if (language) settings.system.language = language;

    await settings.save();

    res.json({
      message: 'System settings updated successfully',
      system: settings.system
    });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateNotificationSettings = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { roleNotifications } = req.body;
    console.log('Received roleNotifications:', JSON.stringify(roleNotifications, null, 2));

    const settings = await Settings.getSettings();
    console.log('Current settings before update:', JSON.stringify(settings.notifications, null, 2));
    
    // Update role-based notification settings
    if (roleNotifications) {
      if (!settings.notifications) settings.notifications = {};
      if (!settings.notifications.roleSettings) settings.notifications.roleSettings = {};
      
      Object.keys(roleNotifications).forEach(role => {
        settings.notifications.roleSettings[role] = {
          ...settings.notifications.roleSettings[role],
          ...roleNotifications[role]
        };
      });
      
      // Mark the nested object as modified for MongoDB
      settings.markModified('notifications.roleSettings');
    }

    await settings.save();

    console.log('Settings after save:', JSON.stringify(settings.notifications, null, 2));

    res.json({
      message: 'Notification settings updated successfully',
      data: settings.notifications
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateBackupSettings = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { enabled, frequency, time } = req.body;

    const settings = await Settings.getSettings();
    
    if (typeof enabled === 'boolean') settings.backup.enabled = enabled;
    if (frequency) settings.backup.frequency = frequency;
    if (time) settings.backup.time = time;

    await settings.save();

    res.json({
      message: 'Backup settings updated successfully',
      backup: settings.backup
    });
  } catch (error) {
    console.error('Update backup settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateThemeSettings = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { defaultTheme, allowUserThemeChange } = req.body;

    const settings = await Settings.getSettings();
    
    if (defaultTheme) settings.theme.defaultTheme = defaultTheme;
    if (typeof allowUserThemeChange === 'boolean') settings.theme.allowUserThemeChange = allowUserThemeChange;

    await settings.save();

    res.json({
      message: 'Theme settings updated successfully',
      theme: settings.theme
    });
  } catch (error) {
    console.error('Update theme settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const uploadCompanyLogo = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const settings = await Settings.getSettings();
    
    // Delete old logo if exists
    if (settings.company.logo) {
      const oldLogoPath = path.join(process.cwd(), settings.company.logo.substring(1)); // Remove leading slash
      console.log('Checking old logo path:', oldLogoPath);
      if (fs.existsSync(oldLogoPath)) {
        fs.unlinkSync(oldLogoPath);
        console.log('Deleted old logo');
      }
    }
    
    // Save new logo path - store the web-accessible path
    const logoWebPath = `/uploads/${req.file.filename}`;
    settings.company.logo = logoWebPath;
    await settings.save();

    console.log('Logo saved to settings:', logoWebPath);
    console.log('=== LOGO UPLOAD COMPLETE ===');

    res.json({
      message: 'Company logo updated successfully',
      logoPath: logoWebPath
    });
  } catch (error) {
    console.error('Upload company logo error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
