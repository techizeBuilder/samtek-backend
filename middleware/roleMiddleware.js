// Role-based middleware for authentication and authorization

// Simple role check middleware
export const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No user found.'
      });
    }

    // If allowedRoles is an array, check if user's role is included
    if (Array.isArray(allowedRoles)) {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}. Your role: ${req.user.role}`
        });
      }
    } 
    // If allowedRoles is a string, check exact match
    else if (typeof allowedRoles === 'string') {
      if (req.user.role !== allowedRoles) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required role: ${allowedRoles}. Your role: ${req.user.role}`
        });
      }
    }

    next();
  };
};

// Module permission check middleware
export const checkModulePermission = (moduleName, permission = 'view') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No user found.'
      });
    }

    // Super Admin has access to everything
    if (req.user.role === 'Super Admin') {
      return next();
    }

    // Check if user has permissions object
    if (!req.user.permissions || !req.user.permissions.modules) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. No permissions found.'
      });
    }

    // Find the module in user permissions
    const modulePermission = req.user.permissions.modules.find(
      module => module.name === moduleName
    );

    if (!modulePermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. No permission for ${moduleName} module.`
      });
    }

    // Check if module dashboard access is required
    if (permission === 'dashboard' && !modulePermission.dashboard) {
      return res.status(403).json({
        success: false,
        message: `Access denied. No dashboard access for ${moduleName} module.`
      });
    }

    // Check specific feature permission
    if (permission !== 'dashboard') {
      const hasPermission = modulePermission.features?.some(feature => 
        feature[permission] === true
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: `Access denied. No ${permission} permission for ${moduleName} module.`
        });
      }
    }

    next();
  };
};

// Feature-specific permission check
export const checkFeaturePermission = (moduleName, featureKey, permission = 'view') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No user found.'
      });
    }

    // Super Admin has access to everything
    if (req.user.role === 'Super Admin') {
      return next();
    }

    // Check if user has permissions
    if (!req.user.permissions || !req.user.permissions.modules) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. No permissions found.'
      });
    }

    // Find the module
    const modulePermission = req.user.permissions.modules.find(
      module => module.name === moduleName
    );

    if (!modulePermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. No permission for ${moduleName} module.`
      });
    }

    // Find the specific feature
    const featurePermission = modulePermission.features?.find(
      feature => feature.key === featureKey
    );

    if (!featurePermission || !featurePermission[permission]) {
      return res.status(403).json({
        success: false,
        message: `Access denied. No ${permission} permission for ${featureKey} in ${moduleName} module.`
      });
    }

    next();
  };
};