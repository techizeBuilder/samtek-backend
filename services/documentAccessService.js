// Who may see or change a person's Aadhaar, PAN and other documents (2026-11-06).
// actor: req.user. target: the person the documents belong to, with companyId and
// reportingManager.
//
// canView:   the person; a platform admin; anyone in the same company with
//            Employee Management view (HR); the person's Manager.
// canUpload: the person; a platform admin; anyone in the same company with
//            Employee Management edit (HR).
// actsAsHr:  uploading for someone else. HR has seen the original, so the document
//            is Verified at once and HR can replace a Verified one.
import { userHasPermission } from '../middleware/permissions.js';

const PLATFORM_ROLES = ['Superadmin', 'Super Admin', 'super_user'];
const same = (a, b) => !!a && !!b && String(a) === String(b);

export function documentAccess(actor, target) {
  const isSelf = same(actor?._id, target?._id);
  const isPlatform = PLATFORM_ROLES.includes(actor?.role);
  const inCompany = same(actor?.companyId, target?.companyId);
  const hr = (action) => isPlatform || (inCompany && userHasPermission(actor, 'hrms', 'employeeManagement', action));
  const hrEdit = hr('edit');
  return {
    canView: isSelf || hr('view') || same(target?.reportingManager, actor?._id),
    canUpload: isSelf || hrEdit,
    actsAsHr: !isSelf && hrEdit,
  };
}
