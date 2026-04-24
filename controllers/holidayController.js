/** @format */

import Holiday from "../models/Holiday.js";

/**
 * ➕ Add Holiday
 */
export const addHoliday = async (req, res) => {
    try {
        const { title, date } = req.body;

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
export const getAllHolidays = async (_req, res) => {
    try {
        const holidays = await Holiday.find().sort({ date: 1 });

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
