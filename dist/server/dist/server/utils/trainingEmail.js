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
exports.sendTrainingEmail = exports.TrainingEmailType = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
// --- DEFINED EMAIL TYPES ---
exports.TrainingEmailType = {
    CANDIDATE_STAGED: 'CANDIDATE_STAGED',
    TRAINING_PASSED: 'TRAINING_PASSED',
    TRAINING_REJECTED: 'TRAINING_REJECTED'
};
// --- CONFIGURE TRANSPORTER ---
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
// --- MAIN EMAIL FUNCTION ---
const sendTrainingEmail = (to, type, data) => __awaiter(void 0, void 0, void 0, function* () {
    let subject = '';
    let htmlContent = '';
    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173/login';
    switch (type) {
        case exports.TrainingEmailType.CANDIDATE_STAGED:
            subject = 'Action Required: Your Samtek Training Modules are Ready';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #1e3a8a; padding: 20px; text-align: center;">
                        <h2 style="color: white; margin: 0;">Welcome to Samtek Machinery</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p>Dear <strong>${data.fullName}</strong>,</p>
                        <p>Welcome! You have been successfully staged for the <strong>${data.department}</strong> department.</p>
                        <p>Your mandatory training modules and Standard Operating Procedures (SOPs) have been assigned to your profile. You must complete these modules and pass the associated evaluations before you can be fully onboarded.</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${loginUrl}" style="background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log in to LMS Dashboard</a>
                        </div>
                        <p>If you have any issues accessing your account, please contact HR.</p>
                        <p>Best regards,<br><strong>The Samtek HR Team</strong></p>
                    </div>
                </div>
            `;
            break;
        case exports.TrainingEmailType.TRAINING_PASSED:
            subject = 'Congratulations! Onboarding Completed';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #16a34a; padding: 20px; text-align: center;">
                        <h2 style="color: white; margin: 0;">Training Completed Successfully!</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p>Dear <strong>${data.fullName}</strong>,</p>
                        <p>Congratulations! You have successfully passed your training requirements for the <strong>${data.department}</strong> department.</p>
                        <p>Your account has been fully activated with the role of <strong>${data.role}</strong>. You can now log in and access your standard employee dashboard.</p>
                        <p>Your Certificate of Completion is also available for download in your profile.</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${loginUrl}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Dashboard</a>
                        </div>
                        <p>Best regards,<br><strong>The Samtek HR Team</strong></p>
                    </div>
                </div>
            `;
            break;
        case exports.TrainingEmailType.TRAINING_REJECTED:
            subject = 'Update on your Samtek Application';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #dc2626; padding: 20px; text-align: center;">
                        <h2 style="color: white; margin: 0;">Application Update</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p>Dear <strong>${data.fullName}</strong>,</p>
                        <p>This email is to inform you that your training access has been revoked and your onboarding process for the ${data.department} department has been terminated.</p>
                        <p>We thank you for your time and wish you the best in your future endeavors.</p>
                        <p>Best regards,<br><strong>The Samtek HR Team</strong></p>
                    </div>
                </div>
            `;
            break;
        default:
            console.error('Invalid Email Type Provided');
            return false;
    }
    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
        to: to,
        subject: subject,
        html: htmlContent
    };
    try {
        yield transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to ${to} [${type}]`);
        return true;
    }
    catch (error) {
        console.error('❌ Error sending email:', error);
        return false;
    }
});
exports.sendTrainingEmail = sendTrainingEmail;
