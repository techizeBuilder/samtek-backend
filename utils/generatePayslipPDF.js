/** @format */

/**
 * 📄 Payslip PDF Generator
 * Streams a real PDF (built with pdfkit) directly to the given Express
 * response — same convention as utils/invoicePdf.js — so there's no
 * intermediate file on disk that can be served before it's fully written.
 */
const generatePayslipPDF = async (res, payslip) => {
  const PDFDocument = (await import("pdfkit")).default;

  const user = payslip.user || {};
  const company = user.companyId || {};

  const fmtMoney = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
  const nameOf = (ref) => (ref && typeof ref === "object" ? ref.name : ref) || "N/A";

  const [year, monthNum] = String(payslip.month || "").split("-");
  const monthLabel = monthNum
    ? new Date(Number(year), Number(monthNum) - 1, 1).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : payslip.month || "-";

  const employeeName = user.fullName || user.username || "Unknown Employee";
  const fileSafeMonth = monthLabel.replace(/\s+/g, "_");

  const L = 40;
  const R = 555;
  const W = R - L;

  const doc = new PDFDocument({ margin: 0, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${employeeName.replace(/\s+/g, "_")}_${fileSafeMonth}.pdf"`
  );
  doc.pipe(res);

  const BLACK = "#1a1a1a";
  const GREY = "#666666";
  const LGREY = "#f5f5f5";
  const BORDER = "#dddddd";
  const ORANGE = "#e07b1a";
  const GREEN = "#1f9254";
  const RED = "#c0392b";

  const drawLine = (x1, y1, x2, y2) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.6).strokeColor(BORDER).stroke();

  let y = 40;

  /* ── COMPANY HEADER ── */
  doc.font("Helvetica-Bold").fontSize(15).fillColor(BLACK)
    .text(company.name || "Company", L, y, { width: W });
  y += 20;
  if (company.address) {
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY)
      .text(company.address, L, y, { width: W });
    y += 14;
  }

  y += 6;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(ORANGE)
    .text(`Payslip for ${monthLabel}`, L, y, { width: W, align: "center" });
  y += 24;

  drawLine(L, y, R, y);
  y += 14;

  /* ── EMPLOYEE INFO ── */
  const infoRow = (label, value, x, w) => {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREY)
      .text(label.toUpperCase(), x, y, { width: w });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(BLACK)
      .text(String(value || "N/A"), x, y + 10, { width: w });
  };

  const halfW = W / 2 - 10;
  infoRow("Employee Name", employeeName, L, W);
  y += 28;

  infoRow("Employee ID", user.employeeId, L, halfW);
  infoRow("Designation", nameOf(user.designationId), L + halfW + 20, halfW);
  y += 28;

  infoRow("Department", nameOf(user.departmentId), L, halfW);
  infoRow("Location", nameOf(user.branchId), L + halfW + 20, halfW);
  y += 28;

  infoRow("Date of Joining", fmtDate(user.joiningDate), L, halfW);
  infoRow("Pay Days / LOP", `${payslip.payDays ?? "-"} / ${payslip.lopDays ?? 0}`, L + halfW + 20, halfW);
  y += 30;

  drawLine(L, y, R, y);
  y += 16;

  /* ── EARNINGS & DEDUCTIONS ── */
  const colW = W / 2 - 10;
  const startY = y;

  const renderTable = (title, rows, x, color) => {
    let ty = startY;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK)
      .text(title, x, ty, { width: colW });
    ty += 16;
    drawLine(x, ty, x + colW, ty);
    ty += 8;

    let total = 0;
    rows.forEach(([label, value]) => {
      total += Number(value || 0);
      doc.font("Helvetica").fontSize(9).fillColor(GREY).text(label, x, ty, { width: colW * 0.6 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
        .text(fmtMoney(value), x, ty, { width: colW, align: "right" });
      ty += 16;
    });

    ty += 4;
    drawLine(x, ty, x + colW, ty);
    ty += 8;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(color)
      .text(`Total ${title}`, x, ty, { width: colW * 0.6 });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(color)
      .text(fmtMoney(total), x, ty, { width: colW, align: "right" });
    ty += 20;

    return { total, endY: ty };
  };

  const earnings = renderTable(
    "Earnings",
    [
      ["Basic Salary", payslip.basic],
      ["HRA", payslip.hra],
      ["Other Allowance", payslip.otherAllowance],
    ],
    L,
    GREEN
  );

  const deductions = renderTable(
    "Deductions",
    [
      ["Employee PF", payslip.pf],
      ["Professional Tax", payslip.professionalTax],
      ["Income Tax (TDS)", payslip.tds],
      ["Advance", payslip.advance],
      ["Others", payslip.others],
    ],
    L + colW + 20,
    RED
  );

  y = Math.max(earnings.endY, deductions.endY) + 10;

  /* ── NET PAY ── */
  const netSalary = payslip.netSalary ?? (earnings.total - deductions.total);
  drawLine(L, y, R, y);
  y += 4;
  doc.rect(L, y, W, 40).fillColor(LGREY).fill();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(BLACK)
    .text("Net Salary Payable", L + 15, y + 13, { width: W / 2 });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(ORANGE)
    .text(fmtMoney(netSalary), L, y + 11, { width: W - 15, align: "right" });
  y += 55;

  /* ── FOOTER ── */
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
    .text("This is a computer-generated payslip and does not require a signature.", L, y, {
      width: W,
      align: "center",
    });

  doc.end();
};

export default generatePayslipPDF;
