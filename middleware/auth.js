import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const token = authHeader.slice(7);

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      // Handle different token structures for backward compatibility
      const userId = decoded.userId?.userId || decoded.userId || decoded.id;

      if (!userId) {
        return res.status(401).json({ message: 'Invalid token structure.' });
      }

      const user = await User.findById(userId).select('-password').populate('companyId', 'name unitName city state');

      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'Invalid token or user not active.' });
      }

      req.user = {
        _id: user._id,
        userId: user._id,
        username: user.username,
        role: user.role,
        unit: user.unit || user.companyId?.unitName || 'Main Unit', // Use company unit name as fallback
        companyId: user.companyId?._id || user.companyId, // Handle both populated and non-populated cases
        company: user.companyId ? {
          id: user.companyId._id || user.companyId,
          name: user.companyId.name,
          unitName: user.companyId.unitName,
          location: `${user.companyId.city}, ${user.companyId.state}`
        } : null,
        permissions: user.permissions || []
      };

      console.log('🔑 Auth - User object created:', {
        username: req.user.username,
        role: req.user.role,
        unit: req.user.unit,
        companyId: req.user.companyId,
        permissions: req.user.permissions?.length || 0
      });

      next();
    } catch (jwtError) {
      return res.status(401).json({ message: 'Invalid or expired token.' });
    }
  } catch (error) {
    return res.status(401).json({ message: 'Authentication failed.' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      console.log('❌ Auth - No user in request');
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    // Case-insensitive role matching with group expansion
    const userRoleLower = (req.user.role || '').toLowerCase().trim();
    
    // Expand route-required roles to their department, in ONE direction only.
    // Security re-check M1 (27 Nov 2026, docs/security-checks/2026-11-26-recheck-company-admin-hr.md): a
    // Head role used to bring in the whole department, so every route meant for e.g. the Sales Head also
    // let Sales Employees in. Now:
    // - a department name ("Sales", "Accounts", ...) still means the whole department
    // - an Employee role also lets that department's Head in (a Head can do their people's work)
    // - a Head role means only the Head
    const DEPARTMENT_ROLES = [
      { names: ['sales', 'sales person', 'salesman'], head: 'sales head', employees: ['sales employee', 'sales person', 'salesman'] },
      { names: ['accounts'], head: 'accounts head', employees: ['accounts employee', 'account employee'] },
      { names: ['production'], head: 'production head', employees: ['production employee'] },
      { names: ['packing'], head: 'packing head', employees: ['packing employee'] },
      { names: ['dispatch'], head: 'dispatch head', employees: ['dispatch employee'] },
    ];
    const expandedRoles = new Set();
    roles.forEach(role => {
      const rLower = role.toLowerCase().trim();
      expandedRoles.add(rLower);
      for (const d of DEPARTMENT_ROLES) {
        if (d.names.includes(rLower)) [...d.names, d.head, ...d.employees].forEach((r) => expandedRoles.add(r));
        else if (d.employees.includes(rLower)) [d.head, ...d.employees].forEach((r) => expandedRoles.add(r));
      }
    });

    if (!expandedRoles.has(userRoleLower)) {
      console.log(`❌ Auth - Role mismatch! User role: "${req.user.role}", Required roles: [${roles.join(', ')}]`);
      // M1: no longer sends back the required roles and the path.
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    console.log(`✅ Auth - Role authorized: "${req.user.role}"`);
    next();
  };
};

const checkUnitAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  // Super Admins have access to all units (support both variants)
  if (req.user.role === 'Superadmin' || req.user.role === 'Super Admin') {
    return next();
  }

  // Check if the requested resource belongs to user's unit
  const requestedUnit = req.body.unit || req.query.unit || req.params.unit;

  if (requestedUnit && req.user.unit !== requestedUnit) {
    return res.status(403).json({ message: 'Access denied. Unit access restriction.' });
  }

  next();
};

const generateToken = (payload) => {
  // Ensure we have a plain object for JWT signing
  let tokenPayload = {};

  if (typeof payload === 'string') {
    tokenPayload.userId = payload;
  } else if (payload && typeof payload === 'object') {
    // Handle ObjectId or plain object
    if (payload._id) {
      tokenPayload.userId = payload._id.toString();
    } else if (payload.userId) {
      tokenPayload.userId = payload.userId.toString();
    } else {
      // Copy all enumerable properties to plain object
      tokenPayload = JSON.parse(JSON.stringify(payload));
    }
  }

  return jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
};

export {
  authenticateToken,
  authenticateToken as authMiddleware, // Alias for backward compatibility
  authorizeRoles,
  checkUnitAccess,
  generateToken
};