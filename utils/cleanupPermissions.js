import User from '../models/User.js';

// Function to clean up permissions - remove Production module from non-Production roles
export const cleanupUserPermissions = async () => {
  try {
    console.log('Starting to clean up user permissions...');
    
    // Remove Production module permissions from Super Admin users
    // Super Admin should only have superAdmin module permissions
    const superAdminResult = await User.updateMany(
      { 
        role: 'Super Admin',
        'permissions.modules.name': 'production'
      },
      { 
        $pull: { 
          'permissions.modules': { name: 'production' }
        }
      }
    );

    // Remove Production module permissions from Unit Head users
    // Unit Head should only have unitHead module permissions
    const unitHeadResult = await User.updateMany(
      { 
        role: 'Unit Head',
        'permissions.modules.name': 'production'
      },
      { 
        $pull: { 
          'permissions.modules': { name: 'production' }
        }
      }
    );

    // Ensure Production role users ONLY have Production module permissions
    const productionUsers = await User.find({ role: 'Production' });
    
    for (const user of productionUsers) {
      // Remove all non-production modules
      user.permissions.modules = user.permissions.modules.filter(module => 
        module.name === 'production'
      );
      
      // Ensure they have production module if missing
      const hasProductionModule = user.permissions.modules.some(module => module.name === 'production');
      if (!hasProductionModule) {
        user.permissions.modules.push({
          name: 'production',
          dashboard: true,
          features: [
            { key: 'productionDashboard', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'batchPlanning', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'productionExecution', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'productionRegister', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'verificationApproval', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'productionReports', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'quantityBatch', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'productionSheet', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        });
      }
      
      await user.save();
    }

    console.log('Permission cleanup results:');
    console.log('- Super Admin users cleaned:', superAdminResult.modifiedCount);
    console.log('- Unit Head users cleaned:', unitHeadResult.modifiedCount);
    console.log('- Production users processed:', productionUsers.length);
    
    return {
      success: true,
      message: 'User permissions cleaned successfully',
      details: {
        superAdminCleaned: superAdminResult.modifiedCount,
        unitHeadCleaned: unitHeadResult.modifiedCount,
        productionUsersProcessed: productionUsers.length
      }
    };

  } catch (error) {
    console.error('Error cleaning up permissions:', error);
    throw new Error('Failed to clean up permissions: ' + error.message);
  }
};