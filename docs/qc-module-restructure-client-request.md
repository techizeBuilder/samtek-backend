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
