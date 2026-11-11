# Slice 1 — what was planned, what was built, and the correction

- **Dates:** planned and built 2026-10-19; corrected 2026-10-20.
- **Status:** **built in its corrected form** — change report §1 in
  [outsource-v2-changes-2026-10.md](outsource-v2-changes-2026-10.md). 27 tests. Check in the
  browser.

---

## The correction (2026-10-20)

**What the 19 Oct plan did:** "one outsource system". A fully-outsourced Sub Child Part became a
production order with one hand-off, and the job-work order (`SubChildPartJobWorkOrder`) was
retired.

**Why that was wrong:** it changed how requests **arrive**. Such an order then showed up on
Production's pages (Orders → Sub Child Part tab, Process Execution, counts). The rules are:
- **A fully-outsourced Sub Child Part** goes straight to Purchase and is **visible to Purchase
  only**.
- **A Sub Child Part whose first step is Out Source** goes straight to Purchase.
- **A Child Part / Machine** reaches Purchase only when Production sends it.

Outsource v2 **only expands what happens after a request reaches Purchase.** The user caught it;
I had asked it as a display choice ("show read-only?") instead of flagging that it broke the rule.

**What was undone (option 1, user's choice):**
- the job-work order's model, controller, routes and mount
- its QC branches, its reservation lookups and its dialogs, all restored
- the order service's routing restored
- the 7 test orders + 1 QC job restored from the backup
- the "always QC the last step" rule and the auto rework hand-off, which only existed for the
  merged orders, removed
- the retire script deleted

**What was kept, because it sits in Purchase's send or fixes a bug:**
1. **A hybrid Sub Child Part's first send takes the material out of Store** (it was a dummy).
   - once per order
   - a rework resend doesn't take it again
   - leftover measured on return
2. **Production can't Issue** that material (it could be taken twice).
3. **The send code is shared,** not copied: `services/subChildPartMaterialSendService.js`, used
   by both routes.
4. **Leftover fixes:**
   - the "mm" unit recorded a full-sheet leftover
   - "0 leftover" was refused

## The original 19 Oct plan (superseded)

It is kept here only as a record. Its decisions Q1–Q3 (delete the old orders, show them
read-only to Production, the cost field until slice 4) **no longer apply**: the job-work order
keeps its own cost field on its final receive, as before.

The findings that still hold:
- the hybrid first send was a dummy (ORD-2026-078 finished without deducting)
- Production could issue the same material

Both are fixed in the corrected slice 1.
