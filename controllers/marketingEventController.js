import EventFlyer, { EVENT_TYPES } from '../models/EventFlyer.js';
import fs from 'fs';
import path from 'path';

const cid = (req) => req.user.companyId;

// Marketing Head (or Superadmin) can manage everyone's flyers; Marketing
// Employee can only manage their own — mirrors marketingExpenseController's canManage.
const canManage = (req, flyer) => {
  const role = req.user.role;
  if (role === 'Marketing Head' || role === 'Superadmin' || role === 'Super Admin') return true;
  return flyer.addedBy.toString() === req.user._id.toString();
};

// Best-effort disk cleanup, restricted to the event flyer upload folder to
// prevent path traversal via a crafted URL.
const deleteUploadedEventFile = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/marketing/events/')) return;
  try {
    const filePath = path.join(process.cwd(), fileUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Failed to delete event flyer image:', fileUrl, err.message);
  }
};

// ─── GET /api/marketing/events/types ───────────────────────────────────────
export const getEventTypes = async (req, res) => {
  res.json({ success: true, data: EVENT_TYPES });
};

// ─── GET /api/marketing/events ──────────────────────────────────────────────
export const getEventFlyers = async (req, res) => {
  try {
    const { eventType, search, upcoming, page = 1, limit = 12 } = req.query;
    const query = { companyId: cid(req) };

    if (eventType) query.eventType = eventType;
    if (search) query.eventName = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (upcoming === 'true') query.eventDate = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 12);
    const skip = (pageNum - 1) * limitNum;

    const [flyers, total] = await Promise.all([
      EventFlyer.find(query)
        .populate('addedBy', 'fullName username')
        .sort({ eventDate: -1, createdAt: -1 })
        .skip(skip).limit(limitNum).lean(),
      EventFlyer.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: flyers,
      pagination: { currentPage: pageNum, totalPages: Math.max(1, Math.ceil(total / limitNum)), totalRecords: total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/marketing/events ─────────────────────────────────────────────
export const createEventFlyer = async (req, res) => {
  const imageUrl = req.file ? `/uploads/marketing/events/${req.file.filename}` : null;
  try {
    const { eventName, eventType, eventDate } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Event image is required' });
    }
    if (!eventName?.trim()) {
      deleteUploadedEventFile(imageUrl);
      return res.status(400).json({ success: false, message: 'Event name is required' });
    }
    if (!eventType || !EVENT_TYPES.includes(eventType)) {
      deleteUploadedEventFile(imageUrl);
      return res.status(400).json({ success: false, message: 'Please select a valid event type' });
    }
    const parsedDate = new Date(eventDate);
    if (!eventDate || isNaN(parsedDate.getTime())) {
      deleteUploadedEventFile(imageUrl);
      return res.status(400).json({ success: false, message: 'A valid event date is required' });
    }

    const flyer = await EventFlyer.create({
      companyId: cid(req),
      eventName: eventName.trim(),
      eventType,
      eventDate: parsedDate,
      imageUrl,
      addedBy: req.user._id,
    });

    const populated = await flyer.populate('addedBy', 'fullName username');
    res.status(201).json({ success: true, data: populated, message: 'Event flyer added successfully' });
  } catch (err) {
    deleteUploadedEventFile(imageUrl);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/marketing/events/:id ──────────────────────────────────────────
export const updateEventFlyer = async (req, res) => {
  const newImageUrl = req.file ? `/uploads/marketing/events/${req.file.filename}` : null;
  try {
    const flyer = await EventFlyer.findOne({ _id: req.params.id, companyId: cid(req) });
    if (!flyer) {
      deleteUploadedEventFile(newImageUrl);
      return res.status(404).json({ success: false, message: 'Event flyer not found' });
    }
    if (!canManage(req, flyer)) {
      deleteUploadedEventFile(newImageUrl);
      return res.status(403).json({ success: false, message: 'You can only edit your own event flyers' });
    }

    const { eventName, eventType, eventDate } = req.body;
    if (eventName !== undefined) {
      if (!eventName.trim()) {
        deleteUploadedEventFile(newImageUrl);
        return res.status(400).json({ success: false, message: 'Event name is required' });
      }
      flyer.eventName = eventName.trim();
    }
    if (eventType !== undefined) {
      if (!EVENT_TYPES.includes(eventType)) {
        deleteUploadedEventFile(newImageUrl);
        return res.status(400).json({ success: false, message: 'Please select a valid event type' });
      }
      flyer.eventType = eventType;
    }
    if (eventDate !== undefined) {
      const parsedDate = new Date(eventDate);
      if (isNaN(parsedDate.getTime())) {
        deleteUploadedEventFile(newImageUrl);
        return res.status(400).json({ success: false, message: 'Invalid event date' });
      }
      flyer.eventDate = parsedDate;
    }

    const previousImage = flyer.imageUrl;
    if (newImageUrl) flyer.imageUrl = newImageUrl;

    await flyer.save();

    // Replaced with a new image — clean up the orphaned old file.
    if (newImageUrl && previousImage && previousImage !== newImageUrl) deleteUploadedEventFile(previousImage);

    const populated = await flyer.populate('addedBy', 'fullName username');
    res.json({ success: true, data: populated, message: 'Event flyer updated successfully' });
  } catch (err) {
    deleteUploadedEventFile(newImageUrl);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/marketing/events/:id ───────────────────────────────────────
export const deleteEventFlyer = async (req, res) => {
  try {
    const flyer = await EventFlyer.findOne({ _id: req.params.id, companyId: cid(req) });
    if (!flyer) return res.status(404).json({ success: false, message: 'Event flyer not found' });
    if (!canManage(req, flyer)) {
      return res.status(403).json({ success: false, message: 'You can only delete your own event flyers' });
    }

    await flyer.deleteOne();
    deleteUploadedEventFile(flyer.imageUrl);

    res.json({ success: true, message: 'Event flyer deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
