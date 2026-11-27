/** @format */

import { Router } from "express";
import {
  createDesignation,
  getDesignations,
  getDesignationById,
  updateDesignation,
  deleteDesignation,
} from "../controllers/designationController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
// Feature 29 (24 Nov 2026): HR sets designations (a Company Admin only while the company has no HR-Admin).
import { canManageDesignations } from "../services/access/companyAccess.js";

const DesignationRouter = Router();

DesignationRouter.use(authMiddleware);

const designationsView = checkPermission("hrms", "designations", "view");
const designationsAdd = checkPermission("hrms", "designations", "add");
const designationsEdit = checkPermission("hrms", "designations", "edit");
const designationsDelete = checkPermission("hrms", "designations", "delete");
// Who may write: checked first, so the refusal says why. HR also keeps its saved checkbox; the
// Super Admin and a Company Admin in the no-HR-Admin fallback need none.
const designationWrite = (permission) => async (req, res, next) => {
  try {
    const r = await canManageDesignations(req.user);
    if (!r.ok) return res.status(403).json({ success: false, message: r.reason || "Designations are set by HR." });
    if (req.user?.role === "HR-Admin") return permission(req, res, next);
    next();
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// Whether this user may add / edit / delete here (the page shows or hides its buttons).
DesignationRouter.get("/manage-rights", async (req, res) => {
  try { const r = await canManageDesignations(req.user); res.json({ success: true, canManage: r.ok, reason: r.reason }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

DesignationRouter.post("/", designationWrite(designationsAdd), createDesignation);
DesignationRouter.get("/", designationsView, getDesignations);
DesignationRouter.get("/:id", designationsView, getDesignationById);
DesignationRouter.put("/:id", designationWrite(designationsEdit), updateDesignation);
DesignationRouter.delete("/:id", designationWrite(designationsDelete), deleteDesignation);

export default DesignationRouter;
