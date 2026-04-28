/** @format */

export const CommonEmailType = {
  PAYSLIP_GENERATED: "PAYSLIP_GENERATED",
  LEAVE_APPROVED: "LEAVE_APPROVED",
  LEAVE_REJECTED: "LEAVE_REJECTED",
  INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED",
};

/**
 * 📧 Mock Email Sender
 */
export const sendCommonEmail = async ({ type, to, name, data }) => {
  console.log(`[MOCK EMAIL] Sending ${type} to ${name} <${to}>`, data);
  return { success: true };
};
