import { Partner } from '../models/Partner.js';

export const getPartners = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID required' });

        const partners = await Partner.find({ companyId, isActive: true });
        res.json({ success: true, partners });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createPartner = async (req, res) => {
    try {
        const { name, percentage } = req.body;
        const companyId = req.user.companyId;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID required' });

        // Check if total percentage exceeds 100
        const existingPartners = await Partner.find({ companyId, isActive: true });
        const totalPct = existingPartners.reduce((sum, p) => sum + p.percentage, 0);

        if (totalPct + percentage > 100) {
            return res.status(400).json({ 
                success: false, 
                message: `Total percentage cannot exceed 100%. Current total: ${totalPct}%` 
            });
        }

        const partner = new Partner({
            companyId,
            name,
            percentage
        });

        await partner.save();
        res.status(201).json({ success: true, partner });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updatePartner = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, percentage, isActive } = req.body;
        const companyId = req.user.companyId;

        const partner = await Partner.findOne({ _id: id, companyId });
        if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

        if (percentage !== undefined) {
            const otherPartners = await Partner.find({ companyId, isActive: true, _id: { $ne: id } });
            const totalPct = otherPartners.reduce((sum, p) => sum + p.percentage, 0);
            if (totalPct + percentage > 100) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Total percentage cannot exceed 100%. Current others: ${totalPct}%` 
                });
            }
            partner.percentage = percentage;
        }

        if (name) partner.name = name;
        if (isActive !== undefined) partner.isActive = isActive;

        await partner.save();
        res.json({ success: true, partner });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deletePartner = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const partner = await Partner.findOneAndDelete({ _id: id, companyId });
        if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

        res.json({ success: true, message: 'Partner deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
