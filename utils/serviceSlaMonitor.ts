import cron from 'node-cron';
import ServiceTicket from '../models/ComplaintServiceModel.js'; // Adjust extension if using JS paths
import User from '../models/User.js';
import { sendSupportEmail } from './serviceEmail.js'; // Importing from the same utils folder

export const startSLAMonitor = (): void => {
    // Runs every 1 hour. 
    cron.schedule('0 * * * *', async () => {
        console.log(`[CRON] ${new Date().toISOString()} - Running SLA Breach Monitor...`);

        try {
            const now = new Date();

            // 1. Find tickets that are active, NOT currently breached, and past their deadline
            // We populate the technician so we can include their name in the email alert
            const breachedTickets = await ServiceTicket.find({
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

                await ticket.save();

                // 3. Send Email Alert to the Complaint Management Heads of that company
                const managers = await User.find({
                    companyId: ticket.companyId,
                    role: 'Complaint Management Head',
                    isActive: true
                });

                // Safely grab the technician's name if one is assigned
                const techObj = ticket.assignment?.technicianId as any;
                const techName = techObj ? (techObj.fullName || techObj.username) : 'Unassigned';

                for (const manager of managers) {
                    if (manager.email) {
                        await sendSupportEmail({
                            type: 'SLA_BREACH',
                            to: manager.email,
                            name: manager.fullName || manager.username || 'Manager',
                            data: {
                                ticketId: ticket.tokenId,
                                priority: ticket.priority?.level || 'Standard',
                                techName: techName
                            }
                        });
                    }
                }
            }

            console.log(`[CRON] Successfully flagged and alerted managers for ${breachedTickets.length} tickets.`);

        } catch (error) {
            console.error('[CRON ERROR] Failed to run SLA Monitor:', error);
        }
    });
};