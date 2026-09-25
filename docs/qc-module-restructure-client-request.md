# QC Module Changes — Current System vs Client Request

Writeup on the new QC requirements from the client, compared against what the app already does today. Covers the three screens involved: R&D's Quality Parameters, the QC department's job queue, and Production's process execution.

Pages: `/r&d/quality-parameters`, `/qc/jobs`, `/production/process-execution`

## What we have right now

**R&D side — Quality Parameters**

Right now there's just one page under R&D called Quality Parameters. You pick an item from a dropdown (it's grouped into Inventory / Product Master / Motor Master, but that's just for browsing — it's all one page, one flow), and for that item you type in:

- Parameters — things like "Frame Levelness, Tolerance ±2mm"
- QC Checklist — plain text checks like "all welds inspected, no defects found"

There's no saving a checklist as a template and reusing it elsewhere — every item gets its own list typed from scratch, every time. It's also just one flat list, no stages, and it has no link to the BOM or to any sub-parts.

**QC department — QC Jobs**

Items come into QC from four places — Purchase, Production, Store or Stock. Doesn't matter which, they're all handled the same way: one QC Job per item/batch. When the job gets created, the system just grabs whatever checklist R&D made for that item name and copies it in (or uses a generic default if nothing was defined for it). QC goes through the list, marks each line pass/fail, then gives one overall pass/fail for the whole job.

So for anything built in-house, QC only ever inspects the finished, fully assembled machine — they never actually see the individual parts.

**Production — Process Execution**

Every production order goes through 6 fixed stages: Job Work, Fabrication, Assembly, Painting, Re-Assembly, Final Testing. Inside a stage you can also break the work into sub-entries — individual parts like "Main Chassis — Side Panels" assigned to a team member.

Here's the important part: each stage, and each sub-entry, has an "Approve/Reject" button, but that's Production approving its own work. Whoever clicks it just types their own name in — it never goes to the actual QC department and doesn't touch R&D's checklist at all. It's basically Production self-certifying as it goes.

Only once all 6 stages are self-approved does the order get marked Completed, and that's the moment the system auto-creates the one and only QC Job for it, sending the whole finished machine to QC for its one real inspection.

So basically, today: Production checks itself the whole way through, and the real QC department only sees the finished product once, right at the end.

## What the client is asking for

**Split the sidebar into three** — instead of one "Quality Parameters" menu item, they want three separate ones: Inventory QC, Product Master QC, and Motor Master QC.

**Reusable checklists instead of retyping every time** — R&D would build a checklist first, as its own thing (presumably named, so it can be reused), and then attach/select it onto whichever products it applies to, instead of typing it fresh per item like today.

**In-house products get checklists tied to the BOM** — for anything manufactured in-house, the checklist should follow the BOM's sub-child parts. (The BOM already breaks a machine down into Child Part → Sub Child Part, so this reuses structure that's already there, it's not new.) Instead of one flat list, there'd be three stages:

- Initial checklist — from the BOM's initial data, before the part starts
- Process checklist — checks during the actual build
- Final checklist — after painting and assembly

**The real change: QC checks every part, not just the finished machine.** This is the big one. Instead of Production self-checking everything and only sending the finished machine to QC once at the end, the client wants each sub-child part built in Production (going through its process checks), then actually sent to QC for inspection — not self-approved by Production. QC checks it and sends it back to Production: if it's good, move on; if not, it gets reworked. This repeats part by part until everything in the BOM has been built and QC-approved. Once all the parts are approved, they get assembled, that assembly goes through painting and a final check, and then the whole thing goes to QC once more for a final inspection. Only after that passes does it move on to Dispatch or Store.

## So what's actually different

Two things, mainly. First, checklists go from "typed once per item, thrown away" to "built as a reusable template and attached to items." Second, and bigger — QC goes from "only checks the finished machine, once, at the end" to "checks every individual part as it's built," with Production and QC going back and forth on each part, plus one more final check once everything's assembled. Right now Production is basically self-policing and real QC only shows up once at the very end — the new flow puts QC in the loop at every stage instead of just the last one.

## Things worth confirming with the client before we scope this

- Can one checklist be reused across multiple products, or is it still one checklist per product, just built from a template?
- For items that aren't manufactured in-house — plain inventory items, or Product/Motor Master items that are just purchased — do they still get the simple one-stage checklist, or does everything under the three new modules get the full Initial/Process/Final treatment?
- Does each sub-child part need its own QC Job now (one machine = many QC jobs instead of one), or does the QC screen need to track this some other way?
- What happens to orders that are already mid-pipeline under the current process when this change ships?
- Is there a cap on how many times a part can go back and forth between Production and QC before it gets escalated?

## 2026-09-14 follow-on — Child Part QC and Sub Child Part QC split out as their own modules

**The problem found**: the Inventory QC page's "Sub Child Part Inventory" tab
(`SubChildPartInventoryQC.jsx`) was mislabeled and wrongly scoped. It actually queried
`productKind:'ChildPart'` — i.e. it was genuinely about **Child Part**, the level renamed
from the old "Sub Child Part" naming during the BOM hierarchy correction — but it
hardcoded `module:'productMaster'` throughout, meaning its checklists lived in the SAME
shared catalog Product Master QC's own per-part Initial/Process checklists use. Editing a
checklist from either screen touched the exact same underlying record
(`qcChecklistController.js`'s `resolveTarget`, `subChildPartCanonical` branch). The client
considers this sharing the wrong design — Child Part is its own real, standalone thing
now (its own Item, its own BOM, its own stock) and shouldn't borrow Product Master QC's
catalog. There was also **no QC configuration anywhere** for the real, new, lower Sub
Child Part level — it never existed.

**What changed**: two genuinely independent QC modules, `childPart` and `subChildPart`,
added to `QCMasterChecklist`/`QCItemChecklist`'s module enums — each with its own
checklist catalog, sharing nothing with `productMaster`. Inventory QC's page grew from 2
tabs to 3: Inventory / Child Part / Sub Child Part.
- **Child Part** — staged Initial/Process, same interaction pattern as before (list of
  Child Parts, Initial/Process buttons, a 2-tab Manage Master Checklist dialog) — just its
  own module now (`ChildPartInventoryQC.jsx`, replacing the old mislabeled file).
- **Sub Child Part** — flat, single checklist (its production order flow is a single
  order-level Assign/Start/Complete cycle, no stages, so a flat checklist fits) — needed
  zero new frontend code, just the existing generic `QCChecklistModule.jsx` pointed at
  `productKind=SubChildPart` items.
- New permission feature keys `qcChildPart`/`qcSubChildPart` registered in
  `roleModulesConfig.js` so they're grantable from Role & Permission Management.

**What deliberately did NOT change, and why**: Product Master QC's own Child Part → Sub
Child Part accordion (`ProductMasterQC.jsx`, `getProductQCParts`) is untouched — it still
reads the legacy `RDChildPart`/`RDBOM` tree under its own `module:'productMaster'`, and
still feeds the live per-part QC execution real in-house Machine orders go through today
(`qcChecklistPullService.js`'s `ensurePartChecksStructure`/`resolvePartChecklistRows`,
`productionMfgController.js`'s `getPartsQC`/`getPartChecklistRows`/`savePartChecklist`,
`SubChildPartQCPanel.jsx`). Rewiring that live execution path before Machine's own
production flow is rebuilt onto the new BOM hierarchy would risk silently breaking real
QC gating for in-house builds — explicitly scoped out of this pass. The redesign is
proceeding ground-level-first (Sub Child Part's own order flow shipped first, this QC
split is next); Product Master QC's own rebuild is a later pass, once Child Part's (and
then Machine's) production flow itself moves onto the new hierarchy.

## 2026-09-14 follow-on #2 — dropdown-select UI + Composition reference panels

Two rounds of feedback after the split above shipped:

**UI pattern** — Child Part QC's first cut kept the old scrollable-list-with-inline-
buttons layout; asked to match Sub Child Part QC's own dropdown-select pattern instead
(pick one part from a dropdown, then see/manage its checklist). `ChildPartInventoryQC.jsx`
was rebuilt around that pattern — one "Select Child Part" dropdown, then two stage cards
(Initial + Process) for whichever part is selected, each with its own "Manage Checklist"
button.

**Composition reference panels** — Product Master QC's old per-part panel showed a
compact "what is this actually made of" summary (material name · grade · brand · qty ·
unit, plus a design-file link) alongside each part's checklist buttons. Asked to bring the
same idea to the two new modules, adapted to what each level actually is:
- **Child Part QC** — a new "Composition" card shows the Sub Child Parts this Child Part
  is assembled from (code/name/qty, each with its own design-file link) plus its
  Materials & Tools (name · grade · brand · qty), live off `ChildPartBOM` via a new
  read-only endpoint `GET /qc-checklist/child-part/:itemId/reference`.
- **Sub Child Part QC** — a new "Composition" card shows the one raw material it's built
  from (name · grade · brand · qty) plus its own design file, live off
  `Item.subChildPartDetails` via a new read-only endpoint
  `GET /qc-checklist/sub-child-part/:itemId/reference`. This needed its own dedicated page
  (`SubChildPartInventoryQC.jsx`, replacing the generic `QCChecklistModule.jsx` the
  "Inventory" tab still uses) since the shared component has no room for a
  module-specific reference panel.

Both new endpoints are gated by the same `qcChildPart`/`qcSubChildPart` feature keys as
everything else on these two pages (not `bomManagement`) — same reasoning
`getProductQCParts` already established: this is the QC page reading BOM data for
reference, not BOM Management itself. Verified against real production data (Fan/CP-001's
real Sub Child Parts + materials, Fan Blade/FB-01's real source material) by calling the
controller functions directly against the live database.

**Permission gotcha, worth remembering**: right after the first QC split shipped, both
new tabs looked broken (empty Child Part list, no "Add" button anywhere) — turned out to
be the exact same root cause both times: `qcChildPart`/`qcSubChildPart` are brand-new
permission keys, and no role had them granted yet (the "Research & Development Head" role
had `qcInventory`/`qcProductMaster`/`qcMotorMaster` but not the two new ones). Not a code
bug — same as every previous QC module rollout, a new feature key needs granting via Role
& Permission Management before any non-Superadmin role can use it. Did fix one real gap
while diagnosing it, though: `ChildPartInventoryQC.jsx`'s list query wasn't checking
`isError`, so a 403 rendered as a misleading "No Child Parts yet" instead of a real error
— fixed to show the actual error message now.
