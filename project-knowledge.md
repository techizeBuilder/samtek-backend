R&D Module
Module Name
Research & Development (R&D) Management System
________________________________________
1. Objective
Develop an R&D Management System inside ERP to fully control product design, quality standardization, and continuous improvement.
Main objectives:
•	Product design and development management 
•	Quality standardization 
•	Controlled production release 
•	Continuous product improvement 
•	Standardized manufacturing system 
________________________________________
2. Core Role of R&D Department
R&D department responsibilities:
•	Product design 
•	Product development 
•	Product improvement 
•	Machine quality standard definition 
•	Production standardization 
________________________________________
3. Product Master Creation
R&D will create master records for all machines.
Rule:
•	No machine can exist in ERP without R&D entry 
________________________________________
Product Master Data
Each machine will include:
•	Machine Name 
•	Machine Code 
•	Design File (CAD / SolidWorks) 
•	Part Drawing 
•	Assembly Drawing 
•	BOM Attachment 
________________________________________
4. Design Approval System
Each design will have status.
Design statuses:
•	Draft 
•	Testing 
•	Approved 
•	Rejected 
________________________________________
Production Rule
•	Production can work only on Approved Design 
________________________________________
Workflow:
Design Creation
↓
Testing
↓
Approval / Rejection
↓
Production Access
________________________________________
5. BOM (Bill of Material) Control
R&D will define:
•	Raw Material 
•	Quantity 
•	Grade 
________________________________________
BOM Rule
•	BOM remains locked 
•	Production cannot modify BOM 
________________________________________
6. Tool & Process Definition
R&D will define:
•	Tool to be used 
•	Manufacturing process 
________________________________________
Manufacturing Process Includes
•	Cutting 
•	Bending 
•	Welding 
•	Assembly 
________________________________________
7. Prototype Development
Every new machine will pass through prototype stage.
________________________________________
Prototype Process
•	Prototype creation 
•	Testing 
•	Performance validation 
•	Output testing 
•	Durability testing 
________________________________________
Release Rule
•	Only after passing prototype testing machine can move to production 
________________________________________
Workflow:
Prototype Creation
↓
Testing
↓
Pass / Fail
↓
Production Release
________________________________________
8. Production Release Control
Machine release statuses:
•	Not Released 
•	Released 
________________________________________
Production Rule
•	Production starts only for Released machines 
________________________________________
9. Change Management System
If issue occurs:
•	Production raises query 
•	Quality raises query 
________________________________________
R&D Action
R&D will:
•	Review issue 
•	Approve or reject change 
________________________________________
Restriction
•	No direct design/material/tool change allowed 
________________________________________
Workflow:
Issue Raised
↓
R&D Review
↓
Approve / Reject
________________________________________
10. Inventory & Material Standardization
R&D decides:
•	Material specifications 
•	Material coding 
•	Approved inventory standards 
________________________________________
Store Rule
•	Store maintains only approved material 
________________________________________
11. Purchase Standard Control
R&D defines:
•	Purchaseable part 
•	Required specifications 
________________________________________
Purchase Rule
•	Purchase department follows R&D standards 
________________________________________
12. Discontinue System
R&D decides discontinuation of:
•	Product 
•	Material 
•	Tool 
________________________________________
ERP Action
Items marked as:
•	Inactive 
________________________________________
13. Feedback Improvement Loop
Input sources:
•	Production 
•	Quality 
•	Service 
•	Complaint 
________________________________________
R&D Action
•	Root cause analysis 
•	Design improvement 
________________________________________
Workflow:
Feedback Received
↓
Root Cause Analysis
↓
Design Improvement
________________________________________
14. Customization / SPM Handling
R&D manages:
•	Customized machines 
•	SPM (Special Purpose Machine) 
________________________________________
Mandatory process:
•	New Design 
•	New BOM 
•	Testing 
•	Approval 
________________________________________
15. Quality Parameter Definition
R&D defines quality standards.
Parameters include:
•	Tolerance 
•	Performance standards 
•	QC checklist 
________________________________________
Quality Department Rule
•	Quality team follows R&D defined parameters 
________________________________________
16. Documentation System
Each machine will have attached documents inside ERP.
Required documents:
•	Design Files 
•	BOM 
•	Process Sheet 
•	QC Checklist 
•	User Manual 
________________________________________
Access Rule
•	Production can directly access documents 
________________________________________
17. R&D Rights (Control Authority)
R&D authority includes:
•	Design approval 
•	Material selection 
•	Tool selection 
•	Process definition 
•	Prototype approval 
•	Production approval 
•	Change approval 
•	Discontinue authority 
________________________________________
Restriction
•	Production cannot make changes without R&D approval 
________________________________________
18. Department Integration
Department connections:
•	Production → Approved design 
•	Purchase → R&D defined materials 
•	Store → Approved inventory 
•	Quality → R&D standards 
•	Service → Field feedback to R&D 
•	Sales → New product launch through R&D 
________________________________________
19. Final Requirement
System should ensure:
•	Product master control 
•	Design approval control 
•	BOM control 
•	Process definition 
•	Version control 
•	Change management 
Final rule:
•	No production can start without R&D approval.
