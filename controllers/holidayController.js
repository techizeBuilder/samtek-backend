/** @format */

import Holiday from "../models/Holiday.js";

/**
 * ➕ Add Holiday
 */
/**
 * ➕ Add Holiday
 */
export const addHoliday = async (req, res) => {
    try {
        const { title, date, companyId } = req.body;
        const currentUser = req.user;

        // Prevent Manager from adding holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot add holidays." });
        }

        if (!title || !date) {
            return res.status(400).json({
                message: "Holiday title and date are required",
            });
        }

        const holidayDate = new Date(date);
        const day = holidayDate.toLocaleDateString("en-US", {
            weekday: "long",
        });

        const holiday = await Holiday.create({
            title,
            date: holidayDate,
            day,
            companyId: currentUser.role === 'Superadmin' ? companyId : currentUser.companyId,
        });

        res.status(201).json({
            message: "Holiday added successfully",
            holiday,
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
        const { month } = req.query;
        if (month) {
            const [y, m] = month.split('-').map(Number);
            filter.date = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) };
        }

        const holidays = await Holiday.find(filter).sort({ date: 1 });
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
        const { title, date } = req.body;
        const currentUser = req.user;

        // Prevent Manager from updating holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot edit holidays." });
        }

        const updateData = {};
        if (title) updateData.title = title;
        if (date) {
            updateData.date = date;
            updateData.day = new Date(date).toLocaleDateString("en-US", {
                weekday: "long",
            });
        }

        const holiday = await Holiday.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
        });

        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }

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

        // Prevent Manager from deleting holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot delete holidays." });
        }

        const holiday = await Holiday.findByIdAndDelete(req.params.id);

        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }

        res.json({ message: "Holiday deleted successfully" });
    } catch (error) {
        res.status(500).json({
            message: "Failed to delete holiday",
            error: error.message,
        });
    }
};
