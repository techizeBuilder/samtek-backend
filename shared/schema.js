export const USER_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  SUPER_USER: 'super_user',
  PRODUCTION: 'Production',
  PACKING: 'Packing',
  DISPATCH: 'Dispatch',
  ACCOUNTS: 'Accounts',
  SALES: 'Sales',
  PRODUCTION_HEAD: 'Production Head',
  PACKING_HEAD: 'Packing Head',
  DISPATCH_HEAD: 'Dispatch Head',
  ACCOUNTS_HEAD: 'Accounts Head',
  SALES_HEAD: 'Sales Head',
  HR_ADMIN: 'HR-Admin',
  // HRMS Employee Roles
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  SALES_EMPLOYEE: 'Sales Employee',
  PRODUCTION_EMPLOYEE: 'Production Employee',
  PACKING_EMPLOYEE: 'Packing Employee',
  DISPATCH_EMPLOYEE: 'Dispatch Employee',
  ACCOUNT_EMPLOYEE: 'Account Employee',
  FINANCE_MANAGER: 'Finance Manager',
  AUDITOR: 'Auditor',
  ADMIN: 'Admin',
  COMPANY_ADMIN: 'Company Admin',
  RESEARCH_DEVELOPMENT_HEAD: 'Research & Development Head',
  RESEARCH_DEVELOPMENT_EMPLOYEE: 'Research Development Employee',
  COMPLAINT_MANAGEMENT_HEAD: 'Complaint Management Head',
  COMPLAINT_MANAGEMENT_EMPLOYEE: 'Complaint Management Employee',
  STORE_HEAD: 'Store Head',
  STORE_EMPLOYEE: 'Store Employee',
  QC_HEAD: 'QC Head',
  QC_EMPLOYEE: 'QC Employee',
  MARKETING_HEAD: 'Marketing Head',
  MARKETING_EMPLOYEE: 'Marketing Employee',
  MIS_ADMIN: 'MIS Admin',
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
  HRMS: 'hrms',
  STORE: 'Store'
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
