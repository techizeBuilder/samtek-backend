import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Company } from '../models/Company.js';
import CashAccessRequest from '../models/CashAccessRequest.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import OrderForm from '../models/OrderForm.js';
import Customer from '../models/Customer.js';
import { sendOtpEmail } from '../services/emailService.js';
import { decryptCashPassword } from '../utils/cashCrypto.js';

const OTP_TTL_MS = 10 * 60 * 1000;      // 10 minutes to enter the OTP
const VIEW_TTL_MS = 5 * 60 * 1000;      // 5 minutes to actually view cash after verifying

// ─── POST /api/cash-access/verify-password ─────────────────────────────────
// First factor: the company-wide 6-digit Cash Password set by the Company
// Admin. On success, generates + emails an OTP to that company's Company
// Admin and opens a CashAccessRequest for the second factor.
export const verifyPassword = async (req, res) => {
  try {
    const { customerId, password } = req.body;
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Cash Password is required' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User is not assigned to any company' });
    }

    const customer = await Customer.findById(customerId).select('companyId name');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (customer.companyId.toString() !== companyId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const company = await Company.findById(companyId).select('+cashPasswordEnc name');
    const storedPassword = decryptCashPassword(company?.cashPasswordEnc);
    if (!storedPassword) {
      return res.status(400).json({
        success: false,
        message: 'Your Company Admin has not set a Cash Password yet. Ask them to set one in My Company.'
      });
    }

    if (String(password) !== storedPassword) {
      return res.status(401).json({ success: false, message: 'Incorrect Cash Password' });
    }

    const admin = await User.findOne({ companyId, role: 'Company Admin' }).select('fullName email');
    if (!admin?.email) {
      return res.status(400).json({
        success: false,
        message: 'No Company Admin with an email address was found for your company. Cannot send OTP.'
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));

    const request = await CashAccessRequest.create({
      companyId,
      requestedBy: req.user._id,
      customerId,
      otpHash,
      otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      status: 'otp_pending',
    });

    try {
      await sendOtpEmail({
        to: admin.email,
        otp,
        requestedByName: req.user.fullName || req.user.username,
        customerName: customer.name,
        companyId,
      });
    } catch (e) {
      console.error('Failed to send Cash Access OTP email:', e);
      return res.status(500).json({ success: false, message: 'Password verified, but the OTP email could not be sent. Please try again.' });
    }

    res.json({ success: true, requestId: request._id, message: `OTP sent to Company Admin (${admin.email})` });
  } catch (error) {
    console.error('Cash Access verify-password error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── POST /api/cash-access/verify-otp ──────────────────────────────────────
export const verifyOtp = async (req, res) => {
  try {
    const { requestId, otp } = req.body;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID' });
    }

    const request = await CashAccessRequest.findById(requestId);
    if (!request || request.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Access request not found' });
    }
    if (request.status === 'verified') {
      return res.status(400).json({ success: false, message: 'OTP already verified for this request' });
    }
    if (request.otpExpiresAt < new Date()) {
      return res.status(410).json({ success: false, message: 'OTP has expired. Please start again.' });
    }

    const match = await bcrypt.compare(String(otp || ''), request.otpHash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect OTP' });
    }

    request.status = 'verified';
    request.verifiedAt = new Date();
    await request.save();

    res.json({ success: true, requestId: request._id, message: 'OTP verified' });
  } catch (error) {
    console.error('Cash Access verify-otp error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/cash-access/:requestId/view ──────────────────────────────────
// Requires a request that's been OTP-verified within the last few minutes —
// re-authentication (from scratch) is required after that, no long-lived unlock.
export const viewCash = async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID' });
    }

    const request = await CashAccessRequest.findById(requestId);
    if (!request || request.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Access request not found' });
    }
    if (request.status !== 'verified' || !request.verifiedAt) {
      return res.status(403).json({ success: false, message: 'OTP not verified for this request' });
    }
    if (Date.now() - new Date(request.verifiedAt).getTime() > VIEW_TTL_MS) {
      return res.status(410).json({ success: false, message: 'Verification expired. Please start again.' });
    }

    const customer = await Customer.findById(request.customerId).select('name mobile email');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const orders = await Order.find({ customer: customer._id }).select('_id orderCode');
    const orderIds = orders.map(o => o._id);
    const forms = orderIds.length
      ? await OrderForm.find({ orderId: { $in: orderIds }, status: 'Submitted' }).select('orderId totals.cashAmount')
      : [];

    const orderCodeById = new Map(orders.map(o => [o._id.toString(), o.orderCode]));
    const breakdown = forms.map(f => ({
      orderCode: orderCodeById.get(f.orderId.toString()) || 'N/A',
      cashAmount: f.totals?.cashAmount || 0,
    }));
    const totalCash = breakdown.reduce((sum, b) => sum + b.cashAmount, 0);

    res.json({
      success: true,
      customerName: customer.name,
      customerId: customer._id,
      totalCash,
      breakdown,
    });
  } catch (error) {
    console.error('Cash Access view error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
