// Feature 31 (25 Nov 2026): a Department Head role given by HR waits for the Company Admin.
// docs/client-features-2026-11/31-head-approval-logic.md
//
// Three ways HR gives a Head role, each held here until the Company Admin decides:
//   new        Add User: the person is saved inactive; approve = active, reject = removed
//   roleChange an edit of the role: the role waits; approve = switched, reject = as was
//   login      Give Login: the login waits (password stored hashed); approve = login given
// The Company Admin and the Super Admin give Head roles directly.
import mongoose from 'mongoose';
import User from '../../models/User.js';
import UserDocument from '../../models/UserDocument.js';
import notificationService from '../notificationService.js';
import { isSuperAdmin, COMPANY_ADMIN } from './companyAccess.js';

export const HEAD_ROLES = [
  'Sales Head', 'Production Head', 'Dispatch Head', 'Packing Head', 'Accounts Head',
  'Research & Development Head', 'Complaint Management Head', 'Store Head', 'QC Head', 'Marketing Head',
];
export const SENT_MESSAGE = 'Sent to the Company Admin for approval.';
export const WAITING_MESSAGE = "Waiting for the Company Admin's approval.";

const KIND_LABEL = { new: 'New user', roleChange: 'Role change', login: 'Login' };
const nameOf = (u) => u?.fullName || u?.username || u?.email || 'someone';

/** Does giving this role need the Company Admin's approval when this actor gives it? */
export const needsHeadApproval = (actor, role) =>
  HEAD_ROLES.includes(role) && !isSuperAdmin(actor) && actor?.role !== COMPANY_ADMIN;

export const isPending = (user) => user?.headApproval?.status === 'pending';

/** May this actor approve or reject requests for this company? */
export const canDecide = (actor, companyId) => isSuperAdmin(actor)
  || (actor?.role === COMPANY_ADMIN && String(actor.companyId?._id || actor.companyId) === String(companyId?._id || companyId));

/** The headApproval block for a new request. */
// Feature 34: a custom role (from services/access/customRoles.js) waits the same way; `role` is its base role.
export const pendingRequest = (kind, role, permissions, actor, login = undefined, customRole = null) => ({
  status: 'pending', kind, role,
  ...(customRole ? { customRoleId: customRole._id, customRoleName: customRole.name } : {}),
  permissions: permissions ? { ...permissions, role } : { role, canAccessAllUnits: false, modules: [] },
  ...(login ? { login } : {}),
  requestedBy: actor?._id, requestedAt: new Date(),
});
const roleShown = (r) => r?.customRoleName || r?.role;

export async function notifyCompanyAdmin(user, actor) {
  try {
    const r = user.headApproval || {};
    await notificationService.createNotification({
      title: `${roleShown(r)} for ${nameOf(user)} needs your approval`,
      message: `${KIND_LABEL[r.kind] || 'Request'} · asked by ${nameOf(actor)}. Open Roles & Permissions to approve or reject.`,
      type: 'hrms',
      targetRole: COMPANY_ADMIN,
      targetCompanyId: user.companyId?._id || user.companyId,
      data: { userId: String(user._id), kind: r.kind, role: r.role, headApproval: true },
    });
  } catch (err) {
    console.error('[headApproval] notify Company Admin failed:', err.message);
  }
}

async function notifyRequester(snapshot) {
  if (!snapshot.requestedBy) return;
  try {
    const verdict = snapshot.approved ? 'approved' : 'rejected';
    await notificationService.createNotification({
      title: `${snapshot.role} for ${snapshot.name} ${verdict}`,
      message: snapshot.approved
        ? `The Company Admin approved the ${(KIND_LABEL[snapshot.kind] || 'request').toLowerCase()}.`
        : `The Company Admin rejected it: ${snapshot.reason}${snapshot.kind === 'new' ? ' The new user was removed.' : ''}`,
      type: 'hrms',
      targetUserId: snapshot.requestedBy,
      targetCompanyId: snapshot.companyId,
      data: { userId: String(snapshot.userId), kind: snapshot.kind, role: snapshot.role, headApproval: true, approved: snapshot.approved },
    });
  } catch (err) {
    console.error('[headApproval] notify requester failed:', err.message);
  }
}

/** The Company Admin's waiting list: one company (a Super Admin: any, or the one asked for). */
export async function listPending(actor, companyId = null) {
  const filter = { 'headApproval.status': 'pending' };
  if (!isSuperAdmin(actor)) filter.companyId = actor.companyId?._id || actor.companyId;
  else if (companyId && mongoose.isValidObjectId(companyId)) filter.companyId = companyId;
  return User.find(filter)
    .select('fullName username email role customRoleName employeeId companyId departmentId designationId isActive canLogin headApproval createdAt')
    .populate('departmentId', 'name').populate('designationId', 'name')
    .populate('headApproval.requestedBy', 'fullName username role')
    .sort({ 'headApproval.requestedAt': -1 })
    .lean();
}

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Approve or reject. Returns { user (null when a new user was removed), message }. */
export async function decide(userId, actor, approve, reason = '') {
  if (!mongoose.isValidObjectId(userId)) throw fail(404, 'User not found');
  const user = await User.findById(userId).select('+headApproval.login.passwordHash');
  if (!user) throw fail(404, 'User not found');
  if (!canDecide(actor, user.companyId)) throw fail(403, 'Only the Company Admin approves a Head role.');
  if (!isPending(user)) throw fail(409, 'Nothing is waiting for approval for this person.');
  const why = String(reason || '').trim();
  if (!approve && !why) throw fail(400, 'Write why it is rejected.');

  const r = user.headApproval;
  const snapshot = {
    userId: user._id, name: nameOf(user), role: roleShown(r), kind: r.kind, reason: why, approved: !!approve,
    requestedBy: r.requestedBy, companyId: user.companyId,
  };
  const stamp = { 'headApproval.decidedBy': actor._id, 'headApproval.decidedAt': new Date(), ...(why ? { 'headApproval.reason': why } : {}) };

  if (!approve && r.kind === 'new') {
    await UserDocument.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    await notifyRequester(snapshot);
    return { user: null, message: `Rejected. ${snapshot.name} was not added.` };
  }

  const set = { ...stamp, 'headApproval.status': approve ? 'approved' : 'rejected' };
  const unset = { 'headApproval.login.passwordHash': '' };
  if (approve) {
    const permissions = { ...(r.permissions || {}), role: r.role };
    // Feature 34: the custom role goes on with the role (or comes off, for a built-in one).
    const custom = () => {
      if (r.customRoleId) Object.assign(set, { customRoleId: r.customRoleId, customRoleName: r.customRoleName });
      else Object.assign(unset, { customRoleId: '', customRoleName: '' });
    };
    if (r.kind === 'new') {
      set.isActive = true;
    } else if (r.kind === 'roleChange') {
      set.role = r.role;
      set.permissions = permissions;
      custom();
    } else if (r.kind === 'login') {
      const email = r.login?.email;
      if (!email || !r.login?.passwordHash) throw fail(409, 'The login details are missing. Ask HR to give the login again.');
      if (await User.exists({ _id: { $ne: user._id }, email })) {
        throw fail(409, `${email} is now used by someone else. Reject this and ask HR to give the login with another email.`);
      }
      Object.assign(set, { canLogin: true, email, username: email, password: r.login.passwordHash, role: r.role, permissions });
      custom();
    }
  }
  // updateOne, not save(): the password is already hashed and must not be hashed again.
  await User.updateOne({ _id: user._id }, { $set: set, $unset: unset });
  await notifyRequester(snapshot);
  const updated = await User.findById(user._id);
  return { user: updated, message: approve ? `Approved. ${snapshot.name} is now ${roleShown(r)}.` : 'Rejected. Nothing changed for this person.' };
}
