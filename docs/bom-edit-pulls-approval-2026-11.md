# Editing an approved BOM pulls its approval back (2026-11-02)

## Why
Found in the browser test: PRO001 and Chamber stayed Approved and Released after their BOMs were edited. A released Chamber then
held two parts that weren't released, and nobody had to re-approve the change. The check for unreleased parts only runs at the
moment of release. A checklist edit already pulled approval back; a BOM edit didn't.

## What changed
**Editing the BOM of an approved Machine, Child Part or Sub Child Part now:**
- pulls back its **BOM approval** and its **Release**;
- flags it on **R&D → Approval → Needs re-approval**, saying what changed, who and when;
- leaves **Design** and **QC List** as they are.

R&D approves the BOM and releases it again, and the flag clears. Until then it gets no automatic orders, and a Machine can't be sold.

**BOM Management warns first:** an approved item shows an amber note saying a change will pull approval back.

| Counts as an edit | Doesn't |
|---|---|
| Adding, editing, removing, discontinuing or reactivating a line (material, Child Part, Sub Child Part) | Saving the form or the steps with nothing changed |
| Changing the process steps | Production cost / expense |
| Sub Child Part: its source material, quantity, unit, size, or steps | Name, design file, specification |
| | Automatic cost updates and opening the BOM |
| | A part not approved yet, or a bought part (no BOM stage) |

## Behaviour to know
- **The parent isn't pulled back.** Editing Chamber un-releases Chamber, not PRO001, the same as a checklist edit. Otherwise one part's edit would stop
  every machine using it from being sold. While Chamber is unreleased, a new PRO001 order gets no Chamber build order.
- **Open orders carry on as they are.**
- **It isn't retroactive.** PRO001 and Chamber, edited before this, stay Approved and Released.
- **No bell.** R&D makes the edit itself, and the Approval page's count and filter show it.

## Technical notes
`productApprovalService.invalidateBomApproval`, called from the edit handlers in `machineBOMController`, `childPartBOMController` and
`subChildPartMasterController` (compares its build fields before and after). `approvalRedo.what` is new; `approvalRedo.to` stays empty for a BOM edit,
which is how the banner tells it from a make / buy switch. Frontend: `approvalShared.jsx`, `DesignApproval.jsx`, `MakeBuySwitch.jsx`, `MachineBOMTab.jsx`,
`ChildPartMasterTab.jsx`, `SubChildPartMasterTab.jsx`.

## Checked
23/23 on a made-up company through the real handlers, 0 left. Every changed page builds. Regression is listed in the daily report. Not yet clicked through in the browser.

## Browser check
1. Open an approved Child Part in BOM Management: the amber note shows. Change a line's quantity.
2. R&D → Approval → **Needs re-approval**: it's listed with what changed. Its BOM chip is pending and Release is Not Released; Design and QC List stay approved.
3. Approve the BOM, Release it: the flag and count clear.
4. Open the same BOM again and save nothing, or rename it: nothing is pulled back.
