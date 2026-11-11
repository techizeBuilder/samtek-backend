/** @format */

import Holiday from "../models/Holiday.js";
import { indiaDate } from "../services/deviceSync/deviceProcess.js";

// A holiday is one date; HR may enter a range, saved one holiday per date (2026-11-11).
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
const dayName = (d) => DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()];
const nextDate = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const asDate = (v) => (v ? String(v).slice(0, 10) : "");
const isPlatform = (u) => ["Superadmin", "Super Admin"].includes(u.role);
// Another company's holiday is "not found" for HR.
const holidayInScope = (holiday, user) => isPlatform(user) || String(holiday.companyId || "") === String(user.companyId || "");

/**
 * ➕ Add Holiday
 */
/**
 * ➕ Add Holiday
 */
export const addHoliday = async (req, res) => {
    try {
        const { title, date, fromDate, toDate, paid, companyId } = req.body;
        const currentUser = req.user;

        // Only HR-Admin (and platform-wide Superadmin) can add holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can add holidays." });
        }

        const from = asDate(fromDate || date);
        const to = asDate(toDate) || from;
        if (!title || !String(title).trim() || !from) {
            return res.status(400).json({
                message: "Holiday title and date are required",
            });
        }
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
            return res.status(400).json({ message: "Dates must look like 2026-11-24" });
        }
        if (to < from) {
            return res.status(400).json({ message: "The To date is before the From date" });
        }
        const dates = [];
        for (let d = from; d <= to && dates.length <= MAX_RANGE_DAYS; d = nextDate(d)) dates.push(d);
        if (dates.length > MAX_RANGE_DAYS) {
            return res.status(400).json({ message: `A range can be at most ${MAX_RANGE_DAYS} days` });
        }

        const cid = isPlatform(currentUser) ? companyId : currentUser.companyId;
        // Dates this company already has as a holiday are skipped, not doubled.
        const around = await Holiday.find({
            companyId: cid ?? null,
            date: { $gte: new Date(Date.parse(`${from}T00:00:00Z`) - 86400000), $lte: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) },
        }).select("date").lean();
        const taken = new Set(around.map((h) => indiaDate(h.date)));
        const fresh = dates.filter((d) => !taken.has(d));
        const skipped = dates.filter((d) => taken.has(d));
        if (!fresh.length) {
            return res.status(409).json({ message: dates.length === 1 ? "That date is already a holiday" : "All these dates are already holidays", created: 0, skipped });
        }

        const created = await Holiday.insertMany(fresh.map((d) => ({
            title: String(title).trim(),
            date: new Date(`${d}T00:00:00Z`),
            day: dayName(d),
            paid: paid !== false && paid !== "false",
            companyId: cid,
        })));

        res.status(201).json({
            message: created.length === 1 ? "Holiday added successfully" : `${created.length} holidays added${skipped.length ? `, ${skipped.length} already there` : ""}`,
            holiday: created[0],
            created: created.length,
            skipped,
        });
    } catch (error) {
        console.error("Add holiday error:", error);
        res.status(500).json({
            message: "Failed to add holiday",
            error: error.message,
        });
    }
};

/**
 * 📋 Get All Holidays
 */
export const getAllHolidays = async (req, res) => {
    try {
        const currentUser = req.user;
        let filter = {};

        // Enforce Company Isolation
        if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin') {
            if (currentUser.companyId) {
                filter.companyId = currentUser.companyId;
            }
        } else {
            // Superadmins can filter by companyId from query
            const { companyId } = req.query;
            if (companyId) filter.companyId = companyId;
        }

        // Opt-in month filter ("YYYY-MM") — only narrows the query when a
        // caller (e.g. the attendance calendar) explicitly asks for one
        // month; other consumers of this endpoint keep getting the full list.
        const { month, search, page, limit } = req.query;
        if (month) {
            const [y, m] = month.split('-').map(Number);
            filter.date = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) };
        }

        if (search) {
            filter.title = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const query = Holiday.find(filter).sort({ date: 1 });

        // Pagination is opt-in via `page` — AttendanceReport.tsx/WorkingDays.tsx
        // need the full holiday list and call this with no params.
        if (page) {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.max(1, parseInt(limit) || 15);
            const total = await Holiday.countDocuments(filter);
            const holidays = await query.skip((pageNum - 1) * limitNum).limit(limitNum);
            return res.json({
                data: holidays,
                pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
            });
        }

        const holidays = await query;
        res.json(holidays);
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch holidays",
            error: error.message,
        });
    }
};

/**
 * 🔍 Get Holiday By ID
 */
export const getHolidayById = async (req, res) => {
    try {
        const holiday = await Holiday.findById(req.params.id);

        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }

        res.json(holiday);
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch holiday",
            error: error.message,
        });
    }
};

/**
 * ✏️ Update Holiday
 */
export const updateHoliday = async (req, res) => {
    try {
        const { title, date, paid } = req.body;
        const currentUser = req.user;

        // Only HR-Admin (and platform-wide Superadmin) can edit holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can edit holidays." });
        }

        const current = await Holiday.findById(req.params.id).catch(() => null);
        if (!current || !holidayInScope(current, currentUser)) {
            return res.status(404).json({ message: "Holiday not found" });
        }

        const updateData = {};
        if (title) updateData.title = title;
        if (date) {
            const d = asDate(date);
            if (!DATE_RE.test(d)) return res.status(400).json({ message: "Dates must look like 2026-11-24" });
            updateData.date = new Date(`${d}T00:00:00Z`);
            updateData.day = dayName(d);
        }
        if (paid !== undefined) updateData.paid = paid !== false && paid !== "false";

        const holiday = await Holiday.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
        });

        res.json({
            message: "Holiday updated successfully",
            holiday,
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to update holiday",
            error: error.message,
        });
    }
};

/**
 * 🗑️ Delete Holiday By ID
 */
export const deleteHolidayById = async (req, res) => {
    try {
        const currentUser = req.user;

        // Only HR-Admin (and platform-wide Superadmin) can delete holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can delete holidays." });
        }

        const current = await Holiday.findById(req.params.id).catch(() => null);
        if (!current || !holidayInScope(current, currentUser)) {
            return res.status(404).json({ message: "Holiday not found" });
        }
        await Holiday.deleteOne({ _id: current._id });

        res.json({ message: "Holiday deleted successfully" });
    } catch (error) {
        res.status(500).json({
            message: "Failed to delete holiday",
            error: error.message,
        });
    }
};
