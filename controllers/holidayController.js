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

        // Only HR-Admin (and platform-wide Superadmin) can add holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can add holidays." });
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

        // Only HR-Admin (and platform-wide Superadmin) can edit holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can edit holidays." });
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

        // Only HR-Admin (and platform-wide Superadmin) can delete holidays
        if (!['HR-Admin', 'Hr Admin', 'Superadmin', 'Super Admin'].includes(currentUser.role)) {
            return res.status(403).json({ message: "Access denied. Only HR-Admin can delete holidays." });
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
