"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSLAMonitor = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const ComplaintServiceModel_js_1 = __importDefault(require("../models/ComplaintServiceModel.js")); // Adjust extension if using JS paths
const User_js_1 = __importDefault(require("../models/User.js"));
const serviceEmail_js_1 = require("./serviceEmail.js"); // Importing from the same utils folder
const startSLAMonitor = () => {
    // Runs every 1 hour. 
    node_cron_1.default.schedule('0 * * * *', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        console.log(`[CRON] ${new Date().toISOString()} - Running SLA Breach Monitor...`);
        try {
            const now = new Date();
            // 1. Find tickets that are active, NOT currently breached, and past their deadline
            // We populate the technician so we can include their name in the email alert
            const breachedTickets = yield ComplaintServiceModel_js_1.default.find({
                status: { $nin: ['Resolved', 'Closed', 'Cancelled'] },
                'sla.isBreached': false,
                'sla.resolutionDeadline': { $lt: now }
            }).populate('assignment.technicianId', 'fullName username email');
            if (breachedTickets.length === 0) {
                return; // Nothing to flag
            }
            console.log(`[CRON] Found ${breachedTickets.length} newly breached tickets. Flagging and alerting...`);
            // 2. Loop through and flag them
            for (const ticket of breachedTickets) {
                ticket.sla.isBreached = true;
                // Add an automated audit log entry
                ticket.auditLog.push({
                    action: 'AUTOMATED ALERT: Ticket SLA Resolution Deadline Breached.',
                    performedBy: {
                        role: 'System'
                    },
                    previousStatus: ticket.status,
                    newStatus: ticket.status
                });
                yield ticket.save();
                // 3. Send Email Alert to the Complaint Management Heads of that company
                const managers = yield User_js_1.default.find({
                    companyId: ticket.companyId,
                    role: 'Complaint Management Head',
                    isActive: true
                });
                // Safely grab the technician's name if one is assigned
                const techObj = (_a = ticket.assignment) === null || _a === void 0 ? void 0 : _a.technicianId;
                const techName = techObj ? (techObj.fullName || techObj.username) : 'Unassigned';
                for (const manager of managers) {
                    if (manager.email) {
                        yield (0, serviceEmail_js_1.sendSupportEmail)({
                            type: 'SLA_BREACH',
                            to: manager.email,
                            name: manager.fullName || manager.username || 'Manager',
                            data: {
                                ticketId: ticket.tokenId,
                                priority: ((_b = ticket.priority) === null || _b === void 0 ? void 0 : _b.level) || 'Standard',
                                techName: techName
                            }
                        });
                    }
                }
            }
            console.log(`[CRON] Successfully flagged and alerted managers for ${breachedTickets.length} tickets.`);
        }
        catch (error) {
            console.error('[CRON ERROR] Failed to run SLA Monitor:', error);
        }
    }));
};
exports.startSLAMonitor = startSLAMonitor;
