export const USER_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  SUPER_USER: 'super_user',
  UNIT_HEAD: 'Unit Head',
  UNIT_MANAGER: 'Unit Manager',
  PRODUCTION: 'Production',
  PACKING: 'Packing',
  DISPATCH: 'Dispatch',
  ACCOUNTS: 'Accounts',
  SALES: 'Sales',
  HR_ADMIN: 'HR-Admin',
  // HRMS Employee Roles
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  FINANCE_MANAGER: 'Finance Manager',
  AUDITOR: 'Auditor',
  ADMIN: 'Admin',
  IT_ADMIN: 'IT Admin',
};

export const MODULES = {
  DASHBOARD: 'Dashboard',
  ORDERS: 'Orders',
  MANUFACTURING: 'Manufacturing',
  DISPATCHES: 'Dispatches',
  SALES: 'Sales',
  ACCOUNTS: 'Accounts',
  INVENTORY: 'Inventory',
  CUSTOMERS: 'Customers',
  SUPPLIERS: 'Suppliers',
  PURCHASES: 'Purchases',
  SETTINGS: 'Settings',
  HRMS: 'hrms'
};

export const PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ALTER: 'alter'
};

export const ORDER_STATUS = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  DISPATCHED: 'Dispatched'
};

export const PRODUCTION_STATUS = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold'
};

export const DISPATCH_STATUS = {
  PENDING: 'Pending',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled'
};

export const PAYMENT_STATUS = {
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled'
};
