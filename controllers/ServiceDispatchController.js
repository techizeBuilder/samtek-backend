import DispatchOrder from '../models/DispatchOrder.js';

export const getDispatchedOrders = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        
        // Fetch orders that have been Dispatched, In Transit, Delivered, or Closed
        const orders = await DispatchOrder.find({
            company: req.user.companyId,
            status: { $in: ['Dispatched', 'In Transit', 'Delivered', 'Closed'] }
        }).sort({ createdAt: -1 });
        
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching dispatched orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateCustomerConfirmation = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        
        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { 
                $set: { 
                    'customerConfirmation.status': status,
                    'customerConfirmation.remarks': remarks || '',
                    'customerConfirmation.confirmedAt': new Date()
                } 
            },
            { new: true }
        );
        
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error updating confirmation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateInstallationSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, scheduledDate, technicianName, remarks } = req.body;
        
        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { 
                $set: { 
                    'installation.status': status,
                    'installation.scheduledDate': scheduledDate ? new Date(scheduledDate) : null,
                    'installation.technicianName': technicianName || '',
                    'installation.remarks': remarks || ''
                } 
            },
            { new: true }
        );
        
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error updating installation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateFeedbackAndRatings = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comments } = req.body;
        
        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { 
                $set: { 
                    'feedback.rating': rating,
                    'feedback.comments': comments || '',
                    'feedback.collectedAt': new Date()
                } 
            },
            { new: true }
        );
        
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error updating feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
