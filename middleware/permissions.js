// Find a module in a user's permissions, tolerating the same naming
// variance the frontend's usePermissions.hasFeatureAccess already tolerates
// (case, e.g. 'Store' vs 'store', and singular/plural, e.g. 'dispatch' vs
// 'dispatches') so this check doesn't 403 a legitimately-permissioned user
// over a naming mismatch between how a role was provisioned and how a route
// was wired up.
const findUserModule = (modules, moduleName) => {
  if (!Array.isArray(modules) || !moduleName) return null;

  const exact = modules.find(m => m.name === moduleName);
  if (exact) return exact;

  const lower = moduleName.toLowerCase();
  const caseInsensitive = modules.find(m => (m.name || '').toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive;

  const alternate = lower.endsWith('s') ? lower.slice(0, -1) : lower + 's';
  return modules.find(m => (m.name || '').toLowerCase() === alternate) || null;
};

// Middleware to check action-level permissions
export const checkPermission = (module, feature, action) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          message: 'Authentication required',
          success: false
        });
      }

      // Super Admin has all permissions (both variants)
      if (user.role === 'Superadmin' || user.role === 'Super Admin' || user.permissions?.role === 'super_admin') {
        return next();
      }

      // Unit Head has access to userManagement for managing Unit Managers
      if (user.role === 'Unit Head' && module === 'unitHead' && feature === 'userManagement') {
        return next();
      }

      // Check if user has permissions structure
      if (!user.permissions || !user.permissions.modules) {
        return res.status(403).json({
          message: 'Access denied - No permissions configured',
          success: false
        });
      }

      // Find the module in user permissions
      const userModule = findUserModule(user.permissions.modules, module);

      if (!userModule) {
        return res.status(403).json({
          message: `Access denied - No access to ${module} module`,
          success: false
        });
      }

      // Find the feature in module
      const userFeature = userModule.features.find(f => f.key === feature);
      
      if (!userFeature) {
        return res.status(403).json({ 
          message: `Access denied - No access to ${feature} feature`,
          success: false 
        });
      }

      // Check if user has the required action permission
      if (!userFeature[action]) {
        return res.status(403).json({ 
          message: `Access denied - No ${action} permission for ${feature}`,
          success: false 
        });
      }

      // Permission granted
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ 
        message: 'Internal server error during permission check',
        success: false 
      });
    }
  };
};

// Like checkPermission, but for routes shared across roles that store their
// grant under different module/feature keys (e.g. Accounts' purchases vs
// Store's purchaseOrders both cover Purchase Requests) — passes if the user
// has the given action on ANY of the provided [module, feature] pairs.
// Fine-grained role restrictions within a shared route (e.g. "only Store can
// approve") stay in the controller, same as they already do today.
export const checkAnyPermission = (moduleFeaturePairs, action) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          message: 'Authentication required',
          success: false
        });
      }

      // Super Admin has all permissions (both variants)
      if (user.role === 'Superadmin' || user.role === 'Super Admin' || user.permissions?.role === 'super_admin') {
        return next();
      }

      if (!user.permissions || !user.permissions.modules) {
        return res.status(403).json({
          message: 'Access denied - No permissions configured',
          success: false
        });
      }

      for (const [module, feature] of moduleFeaturePairs) {
        const userModule = findUserModule(user.permissions.modules, module);
        const userFeature = userModule?.features?.find(f => f.key === feature);
        if (userFeature && userFeature[action]) {
          return next();
        }
      }

      return res.status(403).json({
        message: `Access denied - No ${action} permission for this resource`,
        success: false
      });
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        message: 'Internal server error during permission check',
        success: false
      });
    }
  };
};

// Like checkPermission, but for a feature (e.g. 'lms') that's duplicated
// across most — but not all — modules in roleModulesConfig.js rather than
// owned by one module. Passes if ANY of the user's assigned modules that
// actually define this feature key grants the action on it. If NONE of a
// user's assigned modules even define the feature (e.g. HR-Admin/Company
// Admin's only module is 'hrms', which has no 'lms' entry because they
// oversee training company-wide rather than through one department's
// checkbox), the catalog doesn't offer this checkbox to that role at all —
// fall through to whatever role-based access the route already enforces.
export const checkAnyModuleFeature = (featureKey, action) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          message: 'Authentication required',
          success: false
        });
      }

      if (user.role === 'Superadmin' || user.role === 'Super Admin' || user.permissions?.role === 'super_admin') {
        return next();
      }

      const modules = user.permissions?.modules;
      if (!Array.isArray(modules)) {
        return next();
      }

      const relevantFeatures = modules
        .map((m) => m.features?.find((f) => f.key === featureKey))
        .filter(Boolean);

      if (relevantFeatures.length === 0) {
        return next();
      }

      const hasAccess = relevantFeatures.some((f) => f[action]);

      if (!hasAccess) {
        return res.status(403).json({
          message: `Access denied - No ${action} permission for ${featureKey}`,
          success: false
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        message: 'Internal server error during permission check',
        success: false
      });
    }
  };
};

// Get user modules based on role
export const getUserModules = (role) => {
  const moduleMap = {
    'Superadmin': ['Dashboard', 'Manufacturing', 'Dispatches', 'Sales', 'Accounts', 'Inventory', 'Customers', 'Suppliers', 'Purchases', 'Settings'],
    'Super Admin': ['Dashboard', 'Manufacturing', 'Dispatches', 'Sales', 'Accounts', 'Inventory', 'Customers', 'Suppliers', 'Purchases', 'Settings'],
    'Unit Head': ['Dashboard', 'Manufacturing', 'Dispatches', 'Sales', 'Accounts', 'Inventory', 'Customers', 'userManagement'],
    'Unit Manager': ['Dashboard', 'Sales Approval', 'Manufacturing', 'Dispatches', 'Inventory'],
    'Production': ['Dashboard', 'Manufacturing'],
    'Packing': ['Dashboard', 'Manufacturing', 'Dispatches'],
    'Dispatch': ['Dashboard', 'Dispatches'],
    'Accounts': ['Dashboard', 'Accounts', 'Sales'],
    'Sales': ['Dashboard', 'Sales', 'Customers', 'Marketing'],
    'Sales Employee': ['Dashboard', 'Sales', 'Customers', 'Marketing'],
    'Sales Head': ['Dashboard', 'Sales', 'Customers', 'Marketing'],
    'Marketing Head': ['Dashboard', 'Marketing', 'Customers'],
    'Marketing Employee': ['Dashboard', 'Marketing'],
    'MIS Admin': ['Dashboard', 'MIS']
  };
  
  return moduleMap[role] || ['Dashboard'];
};

// Helper function to check if user can access all units
export const checkUnitAccess = (req, res, next) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({ 
      message: 'Authentication required',
      success: false 
    });
  }

  // Super Admin can access all units (both variants)
  if (user.role === 'Superadmin' || user.role === 'Super Admin' || user.permissions?.canAccessAllUnits) {
    return next();
  }

  // For unit-specific access, you can add unit filtering logic here
  // For now, we'll allow access but you can implement unit-based filtering
  next();
};

// Get user permissions for frontend
export const getUserPermissions = (user) => {
  if (!user) return null;

  // Super Admin gets all permissions (both variants)
  if (user.role === 'Superadmin' || user.role === 'Super Admin') {
    return {
      role: 'super_admin',
      canAccessAllUnits: true,
      modules: [
        {
          name: 'dashboard',
          dashboard: true,
          features: [
            { key: 'overview', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'analytics', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'orders',
          dashboard: true,
          features: [
            { key: 'allOrders', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'orderReport', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'sales',
          dashboard: true,
          features: [
            { key: 'myIndent', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'myCustomers', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'myDeliveries', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'myInvoices', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'myLedger', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'dispatches',
          dashboard: true,
          features: [
            // Only dashboard access - removed all other features
          ]
        },
        {
          name: 'accounts',
          dashboard: true,
          features: [
            { key: 'paymentRegister', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'creditNotes', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'ledgerReport', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'inventory',
          dashboard: true,
          features: [
            { key: 'items', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'categories', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'customers',
          dashboard: true,
          features: [
            { key: 'addEditView', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'suppliers',
          dashboard: true,
          features: [
            { key: 'addEditView', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'purchases',
          dashboard: true,
          features: [
            { key: 'allPurchases', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'manufacturing',
          dashboard: true,
          features: [
            { key: 'allJobs', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        }
      ]
    };
  }

  // Unit Manager gets permissions for sales management and production oversight
  if (user.role === 'Unit Manager') {
    return {
      role: 'unit_manager',
      canAccessAllUnits: true,
      modules: [
        {
          name: 'dashboard',
          dashboard: true,
          features: [
            { key: 'overview', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'analytics', view: true, add: false, edit: false, delete: false, alter: false }
          ]
        },
        {
          name: 'unitManager',
          dashboard: true,
          features: [
            { key: 'salesApproval', view: true, add: false, edit: true, delete: false, alter: true },
            { key: 'salesOrderList', view: true, add: false, edit: true, delete: false, alter: true },
            { key: 'productionGroup', view: true, add: true, edit: true, delete: true, alter: false }
          ]
        },
        {
          name: 'sales_approval',
          dashboard: true,
          features: [
            { key: 'orders', view: true, add: false, edit: true, delete: false, alter: true },
            { key: 'approval_workflow', view: true, add: false, edit: true, delete: false, alter: true }
          ]
        },
        {
          name: 'manufacturing',
          dashboard: true,
          features: [
            { key: 'allJobs', view: true, add: false, edit: true, delete: false, alter: true }
          ]
        },
        {
          name: 'dispatches',
          dashboard: true,
          features: [
            // Only dashboard access - removed all other features for Unit Head
          ]
        },
        {
          name: 'inventory',
          dashboard: true,
          features: [
            { key: 'items', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'categories', view: true, add: false, edit: false, delete: false, alter: false }
          ]
        }
      ]
    };
  }

  // Marketing Head — full access to marketing module; view-only on customers
  if (user.role === 'Marketing Head') {
    return {
      role: 'marketing_head',
      canAccessAllUnits: false,
      modules: [
        {
          name: 'dashboard',
          dashboard: true,
          features: [
            { key: 'overview', view: true, add: false, edit: false, delete: false, alter: false }
          ]
        },
        {
          name: 'marketing',
          dashboard: true,
          features: [
            { key: 'library', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'upload', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'categories', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'reports', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'auditLogs', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'notifications', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'expenses', view: true, add: true, edit: true, delete: true, alter: true }
          ]
        },
        {
          name: 'customers',
          dashboard: false,
          features: [
            { key: 'addEditView', view: true, add: false, edit: false, delete: false, alter: false }
          ]
        }
      ]
    };
  }

  // Marketing Employee — logs marketing expenses only; no access to library/uploads/categories
  if (user.role === 'Marketing Employee') {
    return {
      role: 'marketing_employee',
      canAccessAllUnits: false,
      modules: [
        {
          name: 'dashboard',
          dashboard: true,
          features: [
            { key: 'overview', view: true, add: false, edit: false, delete: false, alter: false }
          ]
        },
        {
          name: 'marketing',
          dashboard: false,
          features: [
            { key: 'expenses', view: true, add: true, edit: true, delete: true, alter: false }
          ]
        }
      ]
    };
  }

  // Sales roles — view/share only on marketing library
  if (user.role === 'Sales' || user.role === 'Sales Employee' || user.role === 'Sales Head') {
    const basePermissions = user.permissions || { role: user.role.toLowerCase().replace(/ /g, '_'), canAccessAllUnits: false, modules: [] };
    const hasMarketingModule = basePermissions.modules?.some(m => m.name === 'marketing');
    if (!hasMarketingModule) {
      basePermissions.modules = [
        ...(basePermissions.modules || []),
        {
          name: 'marketing',
          dashboard: false,
          features: [
            { key: 'library', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'share', view: true, add: true, edit: false, delete: false, alter: false }
          ]
        }
      ];
    }
    return basePermissions;
  }

  // Return user's specific permissions for other roles
  return user.permissions || {
    role: user.role.toLowerCase().replace(' ', '_'),
    canAccessAllUnits: false,
    modules: []
  };
};