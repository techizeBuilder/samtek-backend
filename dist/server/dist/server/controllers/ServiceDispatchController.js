"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFeedbackAndRatings = exports.updateInstallationSchedule = exports.updateCustomerConfirmation = exports.getDispatchedOrders = void 0;
const DispatchOrder_js_1 = __importDefault(require("../models/DispatchOrder.js"));
const getDispatchedOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        // Fetch orders that have been Dispatched, In Transit, Delivered, or Closed
        const orders = yield DispatchOrder_js_1.default.find({
            company: req.user.companyId,
            status: { $in: ['Dispatched', 'In Transit', 'Delivered', 'Closed'] }
        }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: orders });
    }
    catch (error) {
        console.error('Error fetching dispatched orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.getDispatchedOrders = getDispatchedOrders;
const updateCustomerConfirmation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        const order = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: id, company: req.user.companyId }, {
            $set: {
                'customerConfirmation.status': status,
                'customerConfirmation.remarks': remarks || '',
                'customerConfirmation.confirmedAt': new Date()
            }
        }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    }
    catch (error) {
        console.error('Error updating confirmation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.updateCustomerConfirmation = updateCustomerConfirmation;
const updateInstallationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, scheduledDate, technicianName, remarks } = req.body;
        const order = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: id, company: req.user.companyId }, {
            $set: {
                'installation.status': status,
                'installation.scheduledDate': scheduledDate ? new Date(scheduledDate) : null,
                'installation.technicianName': technicianName || '',
                'installation.remarks': remarks || ''
            }
        }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    }
    catch (error) {
        console.error('Error updating installation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.updateInstallationSchedule = updateInstallationSchedule;
const updateFeedbackAndRatings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { rating, comments } = req.body;
        const order = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: id, company: req.user.companyId }, {
            $set: {
                'feedback.rating': rating,
                'feedback.comments': comments || '',
                'feedback.collectedAt': new Date()
            }
        }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    }
    catch (error) {
        console.error('Error updating feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.updateFeedbackAndRatings = updateFeedbackAndRatings;
