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
exports.seedRDProduction = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const RDMachine_js_1 = __importDefault(require("../models/RDMachine.js"));
const RDBOM_js_1 = __importDefault(require("../models/RDBOM.js"));
const RDPrototype_js_1 = __importDefault(require("../models/RDPrototype.js"));
const RDChangeRequest_js_1 = __importDefault(require("../models/RDChangeRequest.js"));
const RDToolProcess_js_1 = __importDefault(require("../models/RDToolProcess.js"));
const RDQualityParam_js_1 = __importDefault(require("../models/RDQualityParam.js"));
const RDDocument_js_1 = __importDefault(require("../models/RDDocument.js"));
const ProductionTeam_js_1 = __importDefault(require("../models/ProductionTeam.js"));
const ProductionOrder_js_1 = __importDefault(require("../models/ProductionOrder.js"));
const today = () => new Date().toISOString().split('T')[0];
const daysFrom = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
};
const daysAgo = (n) => daysFrom(-n);
const tryOp = (label, fn) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield fn();
        return { ok: true, label, result };
    }
    catch (err) {
        console.error(`  ✗ ${label}: ${err.message}`);
        return { ok: false, label, error: err.message };
    }
});
const seedRDProduction = () => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield User_js_1.default.findOne({ companyId: { $exists: true, $ne: null } }).lean();
    if (!user) {
        return { success: false, message: 'No user with companyId found. Please register/login first.' };
    }
    const companyId = user.companyId;
    const userId = user._id;
    const results = [];
    // ── Clear existing data (silently ignore if collection doesn't exist) ──────
    yield Promise.all([
        RDMachine_js_1.default, RDBOM_js_1.default, RDPrototype_js_1.default, RDChangeRequest_js_1.default, RDToolProcess_js_1.default,
        RDQualityParam_js_1.default, RDDocument_js_1.default, ProductionTeam_js_1.default, ProductionOrder_js_1.default,
    ].map(M => M.deleteMany({ company: companyId }).catch(() => { })));
    // ── R&D Machines ──────────────────────────────────────────────────────────
    let machines = [];
    const r0 = yield tryOp('RD Machines (5)', () => RDMachine_js_1.default.insertMany([
        {
            code: 'SAM-001',
            name: 'High Speed Packaging Machine',
            category: 'Packaging',
            description: 'Automated high-speed pouch packaging machine with servo-driven sealing',
            designStatus: 'Approved',
            releaseStatus: 'Released',
            isDiscontinued: false,
            company: companyId, createdBy: userId,
        },
        {
            code: 'SAM-002',
            name: 'Pneumatic Conveyor System',
            category: 'Material Handling',
            description: 'Compressed air-driven conveyor for bulk powder transfer',
            designStatus: 'Testing',
            releaseStatus: 'Not Released',
            isDiscontinued: false,
            company: companyId, createdBy: userId,
        },
        {
            code: 'SAM-003',
            name: 'Rotary Sealer Unit',
            category: 'Sealing',
            description: 'Continuous rotary heat sealer for flexible packaging',
            designStatus: 'Approved',
            releaseStatus: 'Not Released',
            isDiscontinued: false,
            company: companyId, createdBy: userId,
        },
        {
            code: 'SAM-004',
            name: 'Industrial Ribbon Blender',
            category: 'Mixing',
            description: 'Heavy-duty ribbon blender for dry powder mixing applications',
            designStatus: 'Draft',
            releaseStatus: 'Not Released',
            isDiscontinued: false,
            company: companyId, createdBy: userId,
        },
        {
            code: 'SAM-005',
            name: 'Pneumatic Labeling Applicator',
            category: 'Labeling',
            description: 'Automatic label applicator — rejected due to poor sensor accuracy',
            designStatus: 'Rejected',
            releaseStatus: 'Not Released',
            isDiscontinued: true,
            rejectionNote: 'Optical sensor accuracy fell below 97% threshold during stress test',
            company: companyId, createdBy: userId,
        },
    ]));
    results.push(r0);
    if (r0.ok)
        machines = r0.result;
    const [m1, m2, m3, m4] = machines;
    // ── BOMs ──────────────────────────────────────────────────────────────────
    if (m1) {
        results.push(yield tryOp('BOMs (4)', () => RDBOM_js_1.default.insertMany([
            {
                machine: m1._id,
                version: 'v2.1', isLocked: true, lockedAt: daysAgo(15),
                materials: [
                    { code: 'SS-304-2MM', name: 'SS 304 Sheet 2mm', quantity: 8, unit: 'kg', grade: 'SS304', specification: 'IS:6911' },
                    { code: 'BRG-6205', name: 'Deep Groove Ball Bearing 6205', quantity: 4, unit: 'pcs', specification: 'NSK / SKF' },
                    { code: 'SERVO-750W', name: 'Servo Motor 750W', quantity: 2, unit: 'pcs', specification: 'Delta ECMA-C21807ES' },
                    { code: 'PLC-S7-200', name: 'PLC Controller S7-200', quantity: 1, unit: 'pcs', specification: 'Siemens S7-200 SMART' },
                    { code: 'TEFLON-TAPE', name: 'PTFE Teflon Sealing Tape 20mm', quantity: 10, unit: 'm', grade: 'Food Grade' },
                ],
                company: companyId, createdBy: userId,
            },
            {
                machine: m2._id,
                version: 'v1.2', isLocked: false,
                materials: [
                    { code: 'MS-PIPE-2IN', name: 'MS Pipe 2 inch SCH40', quantity: 12, unit: 'm', grade: 'IS 1239' },
                    { code: 'COMP-FITTING', name: 'Compression Fitting 2" SS', quantity: 8, unit: 'pcs', specification: 'Parker' },
                    { code: 'SOL-VALVE-24V', name: 'Solenoid Valve 24VDC 2"', quantity: 3, unit: 'pcs', specification: 'Festo VUVG' },
                    { code: 'AIR-FILTER', name: 'Air Filter Regulator 1/2"', quantity: 2, unit: 'pcs' },
                ],
                company: companyId, createdBy: userId,
            },
            {
                machine: m3._id,
                version: 'v1.0', isLocked: false,
                materials: [
                    { code: 'HEATER-BAND', name: 'Nichrome Heater Band 300W', quantity: 6, unit: 'pcs', specification: '220V AC' },
                    { code: 'TEMP-CTRL', name: 'Digital Temperature Controller', quantity: 2, unit: 'pcs', specification: 'Autonics TZ4M' },
                    { code: 'SS-ROLLER', name: 'SS Sealing Roller 80mm dia', quantity: 4, unit: 'pcs', grade: 'SS304' },
                    { code: 'GEAR-BOX', name: 'Worm Gear Box 1:40', quantity: 1, unit: 'pcs', specification: '0.37kW motor' },
                ],
                company: companyId, createdBy: userId,
            },
            {
                machine: m4._id,
                version: 'v1.0', isLocked: false,
                materials: [
                    { code: 'SS-TROUGH', name: 'SS 316 Trough 1500L', quantity: 1, unit: 'pcs', grade: 'SS316' },
                    { code: 'RIBBON-AGIT', name: 'Ribbon Agitator Assembly', quantity: 1, unit: 'set', specification: '3kW geared motor' },
                    { code: 'SS-BOLT-M12', name: 'SS M12 Hex Bolt & Nut', quantity: 40, unit: 'pcs', grade: 'SS304' },
                ],
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Prototypes ────────────────────────────────────────────────────────────
    if (m1 && m2 && m3) {
        results.push(yield tryOp('Prototypes (3)', () => RDPrototype_js_1.default.insertMany([
            {
                machine: m1._id, machineCode: m1.code, machineName: m1.name,
                prototypeName: 'Proto-SAM001-Rev2',
                performanceTest: 'Pass', outputTest: 'Pass', durabilityTest: 'Pass',
                status: 'Passed',
                testNotes: 'All tests passed at 120 pouches/min. Seal integrity maintained for 72hr soak test.',
                testedBy: 'R&D Team - Arun Kumar', passedDate: daysAgo(10),
                company: companyId, createdBy: userId,
            },
            {
                machine: m2._id, machineCode: m2.code, machineName: m2.name,
                prototypeName: 'Proto-SAM002-Rev1',
                performanceTest: 'Pass', outputTest: 'In Progress', durabilityTest: 'Pending',
                status: 'In Progress',
                testNotes: 'Performance test passed at 500kg/hr throughput. Output consistency test ongoing.',
                testedBy: 'R&D Team - Priya Menon',
                company: companyId, createdBy: userId,
            },
            {
                machine: m3._id, machineCode: m3.code, machineName: m3.name,
                prototypeName: 'Proto-SAM003-Rev1',
                performanceTest: 'Pass', outputTest: 'Pass', durabilityTest: 'Pending',
                status: 'In Progress',
                testNotes: 'Temperature uniformity confirmed. Durability test running — 200hr continuous operation scheduled.',
                testedBy: 'R&D Team - Rajan S',
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Change Requests ───────────────────────────────────────────────────────
    if (m1 && m2 && m3) {
        results.push(yield tryOp('Change Requests (3)', () => RDChangeRequest_js_1.default.insertMany([
            {
                changeId: 'CR-2026-001', machine: m1._id, machineName: m1.name, machineCode: m1.code,
                raisedBy: 'Production - Vikram Singh', department: 'Production',
                changeType: 'Design',
                description: 'Request to increase sealing jaw width from 8mm to 12mm to accommodate wider pouch formats',
                status: 'Approved',
                rdNotes: 'Approved. Jaw redesign added to v2.2 BOM revision. New heater bands ordered.',
                raisedAt: daysAgo(20), resolvedAt: daysAgo(12),
                company: companyId, createdBy: userId,
            },
            {
                changeId: 'CR-2026-002', machine: m2._id, machineName: m2.name, machineCode: m2.code,
                raisedBy: 'QC - Nalini R', department: 'Quality Control',
                changeType: 'Material',
                description: 'Current MS pipe causing corrosion after 3 months. Request to replace with SS 304 pipe for food-grade compliance.',
                status: 'Pending',
                raisedAt: daysAgo(5),
                company: companyId, createdBy: userId,
            },
            {
                changeId: 'CR-2026-003', machine: m3._id, machineName: m3.name, machineCode: m3.code,
                raisedBy: 'Engineering - Deepak P', department: 'Engineering',
                changeType: 'Other',
                description: 'Add emergency stop guard rail and interlocked safety door around sealing rollers per new factory safety norms.',
                status: 'Pending',
                raisedAt: daysAgo(2),
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Tool Processes ────────────────────────────────────────────────────────
    if (m1 && m2) {
        results.push(yield tryOp('Tool Processes (2)', () => RDToolProcess_js_1.default.insertMany([
            {
                machine: m1._id,
                tools: [
                    { code: 'TL-001', name: 'Plasma Cutting Machine', specification: 'Hypertherm Powermax 45', quantity: 1, unit: 'pcs' },
                    { code: 'TL-002', name: 'TIG Welding Set', specification: '200A ESAB', quantity: 2, unit: 'pcs' },
                    { code: 'TL-003', name: 'Press Brake 80T', specification: 'Hydraulic, 2500mm bed', quantity: 1, unit: 'pcs' },
                ],
                processes: [
                    { step: 1, type: 'In-House', description: 'Sheet metal cutting and forming', duration: '4 hrs', tool: 'TL-001, TL-003' },
                    { step: 2, type: 'In-House', description: 'Frame welding and assembly', duration: '8 hrs', tool: 'TL-002' },
                    { step: 3, type: 'Outsourcing', description: 'Powder coating — RAL 9003', duration: '2 days', tool: '' },
                    { step: 4, type: 'In-House', description: 'Electrical wiring and PLC programming', duration: '6 hrs', tool: '' },
                    { step: 5, type: 'In-House', description: 'Trial run and calibration', duration: '3 hrs', tool: '' },
                ],
                company: companyId, createdBy: userId,
            },
            {
                machine: m2._id,
                tools: [
                    { code: 'TL-005', name: 'Pipe Threading Machine', specification: 'Ridgid 300', quantity: 1, unit: 'pcs' },
                    { code: 'TL-006', name: 'Pipe Bending Machine', specification: 'Hydraulic 2" cap', quantity: 1, unit: 'pcs' },
                ],
                processes: [
                    { step: 1, type: 'In-House', description: 'Pipe cutting and threading', duration: '3 hrs', tool: 'TL-005' },
                    { step: 2, type: 'In-House', description: 'Pipe bending and fitting assembly', duration: '4 hrs', tool: 'TL-006' },
                    { step: 3, type: 'In-House', description: 'Pressure testing at 8 bar', duration: '2 hrs', tool: '' },
                ],
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Quality Params ────────────────────────────────────────────────────────
    if (m1 && m2) {
        results.push(yield tryOp('Quality Params (2)', () => RDQualityParam_js_1.default.insertMany([
            {
                machine: m1._id, machineName: m1.name,
                parameters: [
                    { parameter: 'Sealing Temperature', tolerance: '160°C ± 5°C', performanceStandard: 'Consistent across all 6 heater zones' },
                    { parameter: 'Pouch Fill Weight', tolerance: '100g ± 2g', performanceStandard: 'Checkweigher inline, reject if out of spec' },
                    { parameter: 'Machine Speed', tolerance: '≥ 100 pouches/min', performanceStandard: 'Sustained for 4hr without stoppage' },
                    { parameter: 'Seal Peel Strength', tolerance: '≥ 8 N/15mm', performanceStandard: 'ASTM F88 tensile test' },
                ],
                qcChecklist: [
                    { item: 'All heater bands energize correctly', checked: true },
                    { item: 'Servo drive parameters programmed per specification', checked: true },
                    { item: 'Emergency stop tested from all positions', checked: true },
                    { item: 'Film tracking alignment verified', checked: true },
                    { item: 'Seal integrity tested with water immersion', checked: false },
                    { item: 'Speed ramp-up test performed', checked: false },
                ],
                company: companyId, createdBy: userId,
            },
            {
                machine: m2._id, machineName: m2.name,
                parameters: [
                    { parameter: 'Operating Air Pressure', tolerance: '5–7 bar', performanceStandard: 'Pressure relief valve set at 8 bar' },
                    { parameter: 'Conveying Capacity', tolerance: '≥ 500 kg/hr', performanceStandard: 'Measured with calibrated load cell' },
                    { parameter: 'Pipe Joint Leak Test', tolerance: '0 leaks at 8 bar, 30 min', performanceStandard: 'Soap bubble + pressure gauge method' },
                ],
                qcChecklist: [
                    { item: 'All solenoid valves actuate on command', checked: true },
                    { item: 'Air filter element inspected and replaced', checked: true },
                    { item: 'All pipe joints leak-tested at 8 bar', checked: false },
                    { item: 'Flow rate verified with anemometer', checked: false },
                ],
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Documents ─────────────────────────────────────────────────────────────
    if (m1 && m3) {
        results.push(yield tryOp('Documents (6)', () => RDDocument_js_1.default.insertMany([
            {
                machine: m1._id, machineCode: m1.code, machineName: m1.name,
                name: 'SAM-001 Design Assembly Drawing Rev2.1', type: 'Design Files',
                version: 'v2.1', size: '4.2 MB',
                notes: 'Complete 3D CAD assembly. Updated jaw width to 12mm per CR-2026-001.',
                uploadedBy: 'R&D - Arun Kumar', uploadedAt: daysAgo(10),
                company: companyId, createdBy: userId,
            },
            {
                machine: m1._id, machineCode: m1.code, machineName: m1.name,
                name: 'SAM-001 BOM v2.1', type: 'BOM',
                version: 'v2.1', size: '85 KB',
                notes: 'Excel BOM with supplier references and lead times.',
                uploadedBy: 'R&D - Arun Kumar', uploadedAt: daysAgo(10),
                company: companyId, createdBy: userId,
            },
            {
                machine: m1._id, machineCode: m1.code, machineName: m1.name,
                name: 'SAM-001 Test Report Proto-Rev2', type: 'Test Report',
                version: 'v1.0', size: '1.1 MB',
                notes: 'Full test report: performance, output, durability. All criteria passed.',
                uploadedBy: 'R&D - Priya Menon', uploadedAt: daysAgo(9),
                company: companyId, createdBy: userId,
            },
            {
                machine: m1._id, machineCode: m1.code, machineName: m1.name,
                name: 'SAM-001 Process Sheet v2.1', type: 'Process Sheet',
                version: 'v2.1', size: '220 KB',
                notes: 'Step-by-step manufacturing and assembly process.',
                uploadedBy: 'R&D Team', uploadedAt: daysAgo(8),
                company: companyId, createdBy: userId,
            },
            {
                machine: m3._id, machineCode: m3.code, machineName: m3.name,
                name: 'SAM-003 Design Drawing v1.0', type: 'Design Files',
                version: 'v1.0', size: '2.8 MB',
                notes: 'Initial design — pending safety door revision from CR-2026-003.',
                uploadedBy: 'R&D - Rajan S', uploadedAt: daysAgo(30),
                company: companyId, createdBy: userId,
            },
            {
                machine: m3._id, machineCode: m3.code, machineName: m3.name,
                name: 'SAM-003 QC Checklist v1.0', type: 'QC Checklist',
                version: 'v1.0', size: '65 KB',
                notes: 'Pre-dispatch QC checklist for sealer units.',
                uploadedBy: 'QC - Nalini R', uploadedAt: daysAgo(25),
                company: companyId, createdBy: userId,
            },
        ])));
    }
    // ── Production Teams ──────────────────────────────────────────────────────
    let teams = [];
    const rTeams = yield tryOp('Production Teams (4)', () => ProductionTeam_js_1.default.insertMany([
        {
            name: 'Assembly Team Alpha',
            supervisor: 'Ramesh Kumar',
            members: ['Suresh B', 'Mahesh R', 'Ganesh P', 'Rajesh T'],
            skills: ['Mechanical Assembly', 'Welding', 'Alignment & Calibration'],
            efficiency: 92, isActive: true,
            company: companyId, createdBy: userId,
        },
        {
            name: 'Fabrication Team Beta',
            supervisor: 'Anand Sharma',
            members: ['Kiran V', 'Srinivas D', 'Mohan L'],
            skills: ['Sheet Metal Fabrication', 'CNC Operation', 'Plasma Cutting'],
            efficiency: 88, isActive: true,
            company: companyId, createdBy: userId,
        },
        {
            name: 'Painting & Finishing Team',
            supervisor: 'Venkat Rao',
            members: ['Prasad K', 'Naveen G'],
            skills: ['Powder Coating', 'Surface Preparation', 'Quality Inspection'],
            efficiency: 95, isActive: true,
            company: companyId, createdBy: userId,
        },
        {
            name: 'QC & Testing Team',
            supervisor: 'Nalini R',
            members: ['Deepak M', 'Swathi J', 'Hari K'],
            skills: ['Pressure Testing', 'Electrical Testing', 'Final Inspection'],
            efficiency: 97, isActive: true,
            company: companyId, createdBy: userId,
        },
    ]));
    results.push(rTeams);
    if (rTeams.ok)
        teams = rTeams.result;
    const [tAlpha, tBeta, tPaint, tQC] = teams;
    // ── Production Orders ─────────────────────────────────────────────────────
    results.push(yield tryOp('Production Orders (5)', () => ProductionOrder_js_1.default.insertMany([
        {
            orderId: 'ORD-2026-001',
            machineCode: 'SAM-001', machineName: 'High Speed Packaging Machine',
            priority: 'Urgent', status: 'Completed',
            receivedDate: daysAgo(30), deliveryDate: daysAgo(5),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: [
                { step: 'Job Work', type: 'Outsourcing', status: 'Completed', assignedTeam: null, startDate: daysAgo(28), endDate: daysAgo(22), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(22), notes: 'Laser cutting outsourced to M/s Prism Fab', reworks: [] },
                { step: 'Fabrication', type: 'In-House', status: 'Completed', assignedTeam: (tBeta === null || tBeta === void 0 ? void 0 : tBeta._id) || null, startDate: daysAgo(22), endDate: daysAgo(16), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(16), notes: '', reworks: [] },
                { step: 'Assembly', type: 'In-House', status: 'Completed', assignedTeam: (tAlpha === null || tAlpha === void 0 ? void 0 : tAlpha._id) || null, startDate: daysAgo(15), endDate: daysAgo(10), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(10), notes: '', reworks: [] },
                { step: 'Painting', type: 'In-House', status: 'Completed', assignedTeam: (tPaint === null || tPaint === void 0 ? void 0 : tPaint._id) || null, startDate: daysAgo(9), endDate: daysAgo(7), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(7), notes: 'RAL 9003 powder coat applied', reworks: [] },
                { step: 'Re-Assembly', type: 'In-House', status: 'Completed', assignedTeam: (tAlpha === null || tAlpha === void 0 ? void 0 : tAlpha._id) || null, startDate: daysAgo(6), endDate: daysAgo(6), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(6), notes: '', reworks: [] },
                { step: 'Final Testing', type: 'In-House', status: 'Completed', assignedTeam: (tQC === null || tQC === void 0 ? void 0 : tQC._id) || null, startDate: daysAgo(5), endDate: daysAgo(5), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(5), notes: 'All parameters within spec. Speed: 118 pouches/min', reworks: [] },
            ],
            materialDemands: [
                { materialCode: 'SS-304-2MM', materialName: 'SS 304 Sheet 2mm', quantity: 8, unit: 'kg', status: 'Issued' },
                { materialCode: 'SERVO-750W', materialName: 'Servo Motor 750W', quantity: 2, unit: 'pcs', status: 'Issued' },
            ],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-002',
            machineCode: 'SAM-003', machineName: 'Rotary Sealer Unit',
            priority: 'Normal', status: 'In Progress',
            receivedDate: daysAgo(15), deliveryDate: daysFrom(10),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: [
                { step: 'Job Work', type: 'Outsourcing', status: 'Completed', assignedTeam: null, startDate: daysAgo(14), endDate: daysAgo(10), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(10), notes: 'Roller machining outsourced', reworks: [] },
                { step: 'Fabrication', type: 'In-House', status: 'Completed', assignedTeam: (tBeta === null || tBeta === void 0 ? void 0 : tBeta._id) || null, startDate: daysAgo(9), endDate: daysAgo(5), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(5), notes: '', reworks: [] },
                { step: 'Assembly', type: 'In-House', status: 'In Progress', assignedTeam: (tAlpha === null || tAlpha === void 0 ? void 0 : tAlpha._id) || null, startDate: daysAgo(4), endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: 'Heater band installation in progress', reworks: [] },
                { step: 'Painting', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Re-Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Final Testing', type: 'In-House', status: 'Pending', assignedTeam: (tQC === null || tQC === void 0 ? void 0 : tQC._id) || null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
            ],
            materialDemands: [
                { materialCode: 'HEATER-BAND', materialName: 'Nichrome Heater Band 300W', quantity: 6, unit: 'pcs', status: 'Issued' },
                { materialCode: 'TEMP-CTRL', materialName: 'Digital Temperature Controller', quantity: 2, unit: 'pcs', status: 'Issued' },
            ],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-003',
            machineCode: 'SAM-002', machineName: 'Pneumatic Conveyor System',
            priority: 'Normal', status: 'In Progress',
            receivedDate: daysAgo(8), deliveryDate: daysFrom(20),
            bomVerified: true, designVerified: false, rdRequestRaised: true, materialIssued: false,
            processes: [
                { step: 'Job Work', type: 'Outsourcing', status: 'Completed', assignedTeam: null, startDate: daysAgo(7), endDate: daysAgo(3), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(3), notes: 'Pipe cutting outsourced', reworks: [] },
                { step: 'Fabrication', type: 'In-House', status: 'In Progress', assignedTeam: (tBeta === null || tBeta === void 0 ? void 0 : tBeta._id) || null, startDate: daysAgo(2), endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: 'Awaiting SS pipe arrival (CR-2026-002)', reworks: [] },
                { step: 'Assembly', type: 'In-House', status: 'Pending', assignedTeam: (tAlpha === null || tAlpha === void 0 ? void 0 : tAlpha._id) || null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Painting', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Re-Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Final Testing', type: 'In-House', status: 'Pending', assignedTeam: (tQC === null || tQC === void 0 ? void 0 : tQC._id) || null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
            ],
            materialDemands: [
                { materialCode: 'MS-PIPE-2IN', materialName: 'MS Pipe 2 inch SCH40', quantity: 12, unit: 'm', status: 'Requested' },
                { materialCode: 'SOL-VALVE-24V', materialName: 'Solenoid Valve 24VDC 2"', quantity: 3, unit: 'pcs', status: 'Pending Purchase' },
            ],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-004',
            machineCode: 'SAM-001', machineName: 'High Speed Packaging Machine',
            priority: 'Urgent', status: 'Pending',
            receivedDate: today(), deliveryDate: daysFrom(25),
            bomVerified: false, designVerified: false, rdRequestRaised: false, materialIssued: false,
            processes: [
                { step: 'Job Work', type: 'Outsourcing', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Fabrication', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Painting', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Re-Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Final Testing', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
            ],
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-005',
            machineCode: 'SAM-004', machineName: 'Industrial Ribbon Blender',
            priority: 'Normal', status: 'BOM Pending',
            receivedDate: daysAgo(3), deliveryDate: daysFrom(40),
            bomVerified: false, designVerified: false, rdRequestRaised: true, materialIssued: false,
            processes: [
                { step: 'Job Work', type: 'Outsourcing', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Fabrication', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Painting', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Re-Assembly', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
                { step: 'Final Testing', type: 'In-House', status: 'Pending', assignedTeam: null, startDate: null, endDate: null, qcStatus: 'Pending', qcBy: null, qcDate: null, notes: '', reworks: [] },
            ],
            materialDemands: [
                { materialCode: 'SS-TROUGH', materialName: 'SS 316 Trough 1500L', quantity: 1, unit: 'pcs', status: 'Requested' },
            ],
            company: companyId, createdBy: userId,
        },
    ])));
    const succeeded = results.filter(r => r.ok).map(r => r.label);
    const failed = results.filter(r => !r.ok).map(r => `${r.label}: ${r.error}`);
    return {
        success: succeeded.length > 0,
        message: failed.length > 0
            ? `Partial seed — ${failed.length} collection(s) failed (likely Atlas 500-collection limit). Succeeded: ${succeeded.length}/${results.length}`
            : 'All R&D and Production test data seeded successfully',
        succeeded,
        failed: failed.length > 0 ? failed : undefined,
        company: String(companyId),
        user: user.email,
    };
});
exports.seedRDProduction = seedRDProduction;
