# Feature 25, slice 1: KRAs (browser test)

*On test-1. What changed: [25-kra-slice1-changes.md](25-kra-slice1-changes.md). The suite `kra` (33) already checks the rules; this is about the screens. Before starting I take a snapshot; after, the KRAs the test made are removed (unless you want to keep them for slice 2).*

**Logins:** HR-Admin (or the Company Admin), a Sales Employee, the Production Head.

## 1. Set a role's KRA (HR → KRA)
1. The left side lists the departments and their roles, then "Other roles". **Sales Employee** says *Not set*.
2. **Set the KRA:**
   - **Lead management 30%:** target *"Every lead followed up within 2 days"*; routine duty *"Call the day's leads"*, working days, 11:00, **Track daily** on
   - **Sales conversion 40%**
   - **Customer follow-up 20%**
   - **Daily reporting 10%:** routine *"Daily sales report"*, working days, 18:00, **Track daily** on, **File** on; and *"Monthly review notes"*, monthly on the 5th, **Track daily** off
3. Before saving, set one weight wrong: the bar says *"…must add up to 100%"*, and Save refuses. Fix it.
4. **Save as a new version.** The role shows **v1 · 4 KRAs**.

## 2. A change, and history
1. **Change the KRA:** move 5% from Sales conversion to a new **Customer relationship 15%** (take 5% from Daily reporting too). Why: *"Added customer relationship"*. Save → **v2**.
2. **History:** v1 and v2, each opening read-only. v1 still shows the old weights.

## 3. One person's own KRA
1. **People → a Sales person → Open:** *"The Sales Employee KRA (version 2)"*.
2. **Give them their own KRA:** add a temporary *"Cover Asha's accounts"* (ends in a few days), adjust the weights, and save. The person is now marked **Their own KRA**.
3. **Change the role's KRA again:** the box lists that person; choose **Keep their own**. Their KRA stays theirs.

## 4. Dated ahead
Change the role's KRA **from tomorrow**. The role shows *"changes from …"*, and today's version stays in force.

## 5. The person's view
1. **Log in as a Sales Employee → My Task → My KRA:** their items, the duties marked *tracked daily* or *described only*, and *"Changes from tomorrow"* if it applies to them.
2. **The Production Head:** sees no KRA menu in HR (no permission). Their own My KRA works.

## Log
| Step | Result | Notes |
|---|---|---|
| | | |
