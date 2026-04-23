import User from '../models/User.js';

// Function to update existing users with Production module permissions
export const updateUsersWithProductionPermissions = async () => {
  try {
    console.log('Starting to update users with Production module permissions...');
    
    // Define the new Production module permissions
    const productionModule = {
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
    };

    // Update Super Admin users
    const superAdminResult = await User.updateMany(
      { 
        role: 'Super Admin',
        'permissions.modules.name': { $ne: 'production' }
      },
      { 
        $addToSet: { 
          'permissions.modules': productionModule 
        }
      }
    );

    // Update Unit Head users
    const unitHeadResult = await User.updateMany(
      { 
        role: 'Unit Head',
        'permissions.modules.name': { $ne: 'production' }
      },
      { 
        $addToSet: { 
          'permissions.modules': productionModule 
        }
      }
    );

    // Update Production role users (if any exist)
    const productionRoleResult = await User.updateMany(
      { 
        role: 'Production',
        'permissions.modules.name': { $ne: 'production' }
      },
      { 
        $addToSet: { 
          'permissions.modules': productionModule 
        }
      }
    );

    console.log('Production permissions update results:');
    console.log(`Super Admin users updated: ${superAdminResult.modifiedCount}`);
    console.log(`Unit Head users updated: ${unitHeadResult.modifiedCount}`);
    console.log(`Production role users updated: ${productionRoleResult.modifiedCount}`);

    return {
      success: true,
      message: 'Production permissions updated successfully',
      results: {
        superAdmin: superAdminResult.modifiedCount,
        unitHead: unitHeadResult.modifiedCount,
        production: productionRoleResult.modifiedCount
      }
    };

  } catch (error) {
    console.error('Error updating Production permissions:', error);
    return {
      success: false,
      message: 'Failed to update Production permissions',
      error: error.message
    };
  }
};

// Function to update users with old production features to new ones
export const migrateOldProductionPermissions = async () => {
  try {
    console.log('Migrating old production permissions to new structure...');
    
    // Find users who have the old production module structure
    const usersWithOldProduction = await User.find({
      'permissions.modules.name': 'production',
      'permissions.modules.features.key': { $in: ['todaysIndents', 'summaryPanel', 'submitData', 'submissionHistory'] }
    });

    const newProductionModule = {
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
    };

    let migratedCount = 0;
    for (const user of usersWithOldProduction) {
      // Remove old production module
      user.permissions.modules = user.permissions.modules.filter(
        module => module.name !== 'production'
      );
      
      // Add new production module
      user.permissions.modules.push(newProductionModule);
      
      await user.save();
      migratedCount++;
    }

    console.log(`Migrated ${migratedCount} users from old to new production permissions`);

    return {
      success: true,
      message: `Successfully migrated ${migratedCount} users`,
      migratedCount
    };

  } catch (error) {
    console.error('Error migrating production permissions:', error);
    return {
      success: false,
      message: 'Failed to migrate production permissions',
      error: error.message
    };
  }
};