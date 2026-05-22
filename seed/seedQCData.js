import mongoose from 'mongoose';
import QCJob from '../models/QCJob.js';
import User from '../models/User.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

const checklist = {
  Machine: [
    { parameter: 'Visual Inspection', standardValue: 'No damage, dents or scratches' },
    { parameter: 'Dimensional Check', standardValue: 'As per drawing' },
    { parameter: 'Electrical Safety', standardValue: 'No exposed wiring, proper earthing' },
    { parameter: 'Performance Test', standardValue: 'As per specification' },
    { parameter: 'Noise & Vibration', standardValue: 'Within acceptable limits' },
  ],
  'Raw Material': [
    { parameter: 'Visual Inspection', standardValue: 'No damage, corrosion or contamination' },
    { parameter: 'Dimensions / Weight', standardValue: 'As per order specification' },
    { parameter: 'Material Certificate', standardValue: 'Certificate present and valid' },
    { parameter: 'Quantity Verification', standardValue: 'Matches purchase order' },
  ],
  Tool: [
    { parameter: 'Visual Inspection', standardValue: 'No damage or wear' },
    { parameter: 'Calibration Check', standardValue: 'Valid calibration certificate' },
    { parameter: 'Functional Test', standardValue: 'Operates as expected' },
  ],
  'Finished Good': [
    { parameter: 'Visual / Cosmetic Check', standardValue: 'No defects, proper finish' },
    { parameter: 'Dimensional Check', standardValue: 'Within tolerance' },
    { parameter: 'Performance Test', standardValue: 'Meets all specs' },
    { parameter: 'Documentation', standardValue: 'Manual & invoice copy present' },
    { parameter: 'Safety Check', standardValue: 'Guards, labels, warnings in place' },
  ],
};

const run = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.\n');

    // Get QC head user to get company + userId
    const qcUser = await User.findOne({ email: 'qchead@gmail.com' }).lean();
    if (!qcUser) {
      console.error('QC Head user not found. Run seedQCUser first.');
      process.exit(1);
    }

    const { _id: userId, companyId: company } = qcUser;
    console.log(`Using QC user: ${qcUser.email}, company: ${company}`);

    // Clear old QC seed data
    const deleted = await QCJob.deleteMany({ company });
    console.log(`Deleted ${deleted.deletedCount} existing QC jobs.\n`);

    const today = new Date();
    const dateStr = (daysAgo = 0) => {
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split('T')[0];
    };

    const jobs = [
      // 1. Pending - Raw Material from Purchase
      {
        qcJobId: 'QC-2026-0001',
        source: 'Purchase',
        sourceRefId: 'PO-2026-011',
        sourceDepartment: 'Purchase',
        sentBy: 'Ravi Kumar',
        itemName: 'MS Flat Bar 50x10mm',
        itemCode: 'RM-FB-5010',
        category: 'Raw Material',
        quantity: 200,
        unit: 'kg',
        receivedDate: dateStr(2),
        status: 'Pending',
        checklist: checklist['Raw Material'].map(c => ({ ...c, status: 'Pending', actualValue: '', remarks: '' })),
        notes: 'Urgent — production line waiting',
        company, createdBy: userId,
      },

      // 2. Pending - Machine from Production
      {
        qcJobId: 'QC-2026-0002',
        source: 'Production',
        sourceRefId: 'WO-2026-034',
        sourceDepartment: 'Production',
        sentBy: 'Suresh Patil',
        itemName: 'CNC Lathe Machine #3',
        itemCode: 'MCH-CNC-003',
        category: 'Machine',
        quantity: 1,
        unit: 'pcs',
        receivedDate: dateStr(1),
        status: 'Pending',
        checklist: checklist['Machine'].map(c => ({ ...c, status: 'Pending', actualValue: '', remarks: '' })),
        notes: 'Post-maintenance check required',
        company, createdBy: userId,
      },

      // 3. In Progress - Tool from Store
      {
        qcJobId: 'QC-2026-0003',
        source: 'Store',
        sourceRefId: 'STOCK-2026-088',
        sourceDepartment: 'Store',
        sentBy: 'Mohan Das',
        itemName: 'Torque Wrench Set',
        itemCode: 'TL-TW-15',
        category: 'Tool',
        quantity: 3,
        unit: 'set',
        receivedDate: dateStr(3),
        inspector: 'Anjali Singh',
        inspectionStartDate: dateStr(2),
        status: 'In Progress',
        checklist: [
          { parameter: 'Visual Inspection', standardValue: 'No damage or wear', actualValue: 'Minor surface scratches on handle', status: 'Pass', remarks: '' },
          { parameter: 'Calibration Check', standardValue: 'Valid calibration certificate', actualValue: 'Cert expires 2026-12-31', status: 'Pass', remarks: 'Certificate verified' },
          { parameter: 'Functional Test', standardValue: 'Operates as expected', actualValue: '', status: 'Pending', remarks: '' },
        ],
        notes: '',
        company, createdBy: userId,
      },

      // 4. In Progress - Finished Good
      {
        qcJobId: 'QC-2026-0004',
        source: 'Production',
        sourceRefId: 'WO-2026-041',
        sourceDepartment: 'Production',
        sentBy: 'Priya Sharma',
        itemName: 'Hydraulic Cylinder Assembly',
        itemCode: 'FG-HCA-07',
        category: 'Finished Good',
        quantity: 5,
        unit: 'pcs',
        receivedDate: dateStr(4),
        inspector: 'Rahul Mehta',
        inspectionStartDate: dateStr(3),
        status: 'In Progress',
        checklist: [
          { parameter: 'Visual / Cosmetic Check', standardValue: 'No defects, proper finish', actualValue: 'All units clean, no visible defects', status: 'Pass', remarks: '' },
          { parameter: 'Dimensional Check', standardValue: 'Within tolerance', actualValue: '±0.05mm — within spec', status: 'Pass', remarks: '' },
          { parameter: 'Performance Test', standardValue: 'Meets all specs', actualValue: 'Pressure tested at 300 bar — OK', status: 'Pass', remarks: '' },
          { parameter: 'Documentation', standardValue: 'Manual & invoice copy present', actualValue: '', status: 'Pending', remarks: '' },
          { parameter: 'Safety Check', standardValue: 'Guards, labels, warnings in place', actualValue: '', status: 'Pending', remarks: '' },
        ],
        notes: 'High-priority order for client Tata Motors',
        company, createdBy: userId,
      },

      // 5. Approved - Raw Material
      {
        qcJobId: 'QC-2026-0005',
        source: 'Purchase',
        sourceRefId: 'PO-2026-009',
        sourceDepartment: 'Purchase',
        sentBy: 'Dinesh Gupta',
        itemName: 'Stainless Steel Sheet 2mm',
        itemCode: 'RM-SS-200',
        category: 'Raw Material',
        quantity: 500,
        unit: 'kg',
        receivedDate: dateStr(7),
        inspector: 'Anjali Singh',
        inspectionStartDate: dateStr(6),
        inspectionEndDate: dateStr(5),
        status: 'Approved',
        decision: 'Pass',
        inspectorRemarks: 'All parameters within acceptable range. Material certified and quantity verified.',
        transferredToStore: true,
        checklist: [
          { parameter: 'Visual Inspection', standardValue: 'No damage, corrosion or contamination', actualValue: 'No corrosion, clean surface', status: 'Pass', remarks: '' },
          { parameter: 'Dimensions / Weight', standardValue: 'As per order specification', actualValue: '2.01mm avg — within ±0.05mm', status: 'Pass', remarks: '' },
          { parameter: 'Material Certificate', standardValue: 'Certificate present and valid', actualValue: 'Mill test certificate present', status: 'Pass', remarks: 'Cert No. MTC-2026-4421' },
          { parameter: 'Quantity Verification', standardValue: 'Matches purchase order', actualValue: '498 kg received (2 kg variance — OK)', status: 'Pass', remarks: '' },
        ],
        notes: '',
        company, createdBy: userId,
      },

      // 6. Approved - Finished Good
      {
        qcJobId: 'QC-2026-0006',
        source: 'Production',
        sourceRefId: 'WO-2026-029',
        sourceDepartment: 'Production',
        sentBy: 'Suresh Patil',
        itemName: 'Gear Box Assembly B-Type',
        itemCode: 'FG-GB-B02',
        category: 'Finished Good',
        quantity: 10,
        unit: 'pcs',
        receivedDate: dateStr(10),
        inspector: 'Rahul Mehta',
        inspectionStartDate: dateStr(9),
        inspectionEndDate: dateStr(8),
        status: 'Approved',
        decision: 'Pass',
        inspectorRemarks: 'All 10 units passed full inspection.',
        transferredToStore: true,
        checklist: checklist['Finished Good'].map(c => ({
          ...c, actualValue: 'As per spec', status: 'Pass', remarks: ''
        })),
        notes: '',
        company, createdBy: userId,
      },

      // 7. Rejected - Raw Material
      {
        qcJobId: 'QC-2026-0007',
        source: 'Purchase',
        sourceRefId: 'PO-2026-007',
        sourceDepartment: 'Purchase',
        sentBy: 'Ravi Kumar',
        itemName: 'Copper Wire 1.5mm',
        itemCode: 'RM-CW-15',
        category: 'Raw Material',
        quantity: 100,
        unit: 'kg',
        receivedDate: dateStr(12),
        inspector: 'Anjali Singh',
        inspectionStartDate: dateStr(11),
        inspectionEndDate: dateStr(10),
        status: 'Rejected',
        decision: 'Fail',
        failReason: 'Material does not meet conductivity standards. Wire gauge inconsistent.',
        inspectorRemarks: '3 samples tested — all failed conductivity test. Vendor notified.',
        returnedToSource: true,
        checklist: [
          { parameter: 'Visual Inspection', standardValue: 'No damage, corrosion or contamination', actualValue: 'Surface oxidation on 30% of batch', status: 'Fail', remarks: 'Visible oxidation — unacceptable' },
          { parameter: 'Dimensions / Weight', standardValue: 'As per order specification', actualValue: 'Gauge varies from 1.3mm to 1.6mm', status: 'Fail', remarks: 'Tolerance exceeded' },
          { parameter: 'Material Certificate', standardValue: 'Certificate present and valid', actualValue: 'No certificate provided', status: 'Fail', remarks: 'Vendor failed to provide MTR' },
          { parameter: 'Quantity Verification', standardValue: 'Matches purchase order', actualValue: '97 kg received', status: 'Pass', remarks: '3 kg shortage — acceptable' },
        ],
        notes: 'Return to vendor for replacement',
        company, createdBy: userId,
      },

      // 8. Rejected - Machine
      {
        qcJobId: 'QC-2026-0008',
        source: 'Production',
        sourceRefId: 'WO-2026-022',
        sourceDepartment: 'Production',
        sentBy: 'Mohan Das',
        itemName: 'Drilling Machine #7',
        itemCode: 'MCH-DRL-007',
        category: 'Machine',
        quantity: 1,
        unit: 'pcs',
        receivedDate: dateStr(15),
        inspector: 'Rahul Mehta',
        inspectionStartDate: dateStr(14),
        inspectionEndDate: dateStr(13),
        status: 'Rejected',
        decision: 'Fail',
        failReason: 'Excessive vibration and electrical safety concern — bare wiring detected.',
        inspectorRemarks: 'Machine must be sent for full overhaul before re-inspection.',
        returnedToSource: true,
        checklist: [
          { parameter: 'Visual Inspection', standardValue: 'No damage, dents or scratches', actualValue: 'Minor dent on motor housing', status: 'Pass', remarks: '' },
          { parameter: 'Dimensional Check', standardValue: 'As per drawing', actualValue: 'Spindle runout 0.12mm (spec: <0.05mm)', status: 'Fail', remarks: 'Runout exceeds tolerance' },
          { parameter: 'Electrical Safety', standardValue: 'No exposed wiring, proper earthing', actualValue: 'Bare wire found near motor terminal', status: 'Fail', remarks: 'Safety hazard — machine condemned' },
          { parameter: 'Performance Test', standardValue: 'As per specification', actualValue: 'RPM inconsistent', status: 'Fail', remarks: '' },
          { parameter: 'Noise & Vibration', standardValue: 'Within acceptable limits', actualValue: 'Vibration level 8.2 mm/s (limit: 4.5)', status: 'Fail', remarks: 'Exceeds limit by ~82%' },
        ],
        notes: 'Send to maintenance department',
        company, createdBy: userId,
      },
    ];

    const inserted = await QCJob.insertMany(jobs);
    console.log(`Created ${inserted.length} QC jobs:\n`);
    inserted.forEach(j => console.log(`  ${j.qcJobId} | ${j.status.padEnd(12)} | ${j.source.padEnd(12)} | ${j.itemName}`));

    await mongoose.disconnect();
    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
};

run();
