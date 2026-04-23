// Admin endpoint to check and fix user company assignments

import express from 'express';
import User from '../models/User.js';
import { Company } from '../models/Company.js';

const router = express.Router();

// Check user company assignment
router.get('/check-user-company/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    console.log(`=== CHECKING COMPANY ASSIGNMENT FOR ${username} ===`);
    
    // Find user with populated company
    const user = await User.findOne({ username }).populate('companyId');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        username
      });
    }
    
    // Get all companies for reference
    const companies = await Company.find({}).select('name unitName city state');
    
    const response = {
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        companyId: user.companyId?._id || null,
        company: user.companyId ? {
          id: user.companyId._id,
          name: user.companyId.name,
          unitName: user.companyId.unitName,
          location: `${user.companyId.city}, ${user.companyId.state}`
        } : null
      },
      hasCompany: !!user.companyId,
      availableCompanies: companies.map(c => ({
        id: c._id,
        name: c.name,
        unitName: c.unitName,
        location: `${c.city}, ${c.state}`
      }))
    };
    
    console.log('User company status:', {
      username: user.username,
      hasCompany: !!user.companyId,
      companyName: user.companyId?.name || 'None'
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('Error checking user company:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Assign company to user
router.post('/assign-company/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { companyId } = req.body;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required'
      });
    }
    
    console.log(`=== ASSIGNING COMPANY TO ${username} ===`);
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Find company
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }
    
    // Assign company
    user.companyId = companyId;
    await user.save();
    
    console.log('Company assigned successfully:', {
      username: user.username,
      companyName: company.name,
      location: `${company.city}, ${company.state}`
    });
    
    res.json({
      success: true,
      message: 'Company assigned successfully',
      user: {
        username: user.username,
        role: user.role,
        companyId: company._id,
        companyName: company.name,
        location: `${company.city}, ${company.state}`
      }
    });
    
  } catch (error) {
    console.error('Error assigning company:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

export default router;