# Production → Orders: the search covers every tab (what changed)

*14 November 2026, your ask during the feature 11 browser test. ORD-2026-118 took three searches to find: the Machine tab, then Child Part, then Sub Child Part, typed again each time.*

## Why it happened
- **The search looked in the open tab only.** Machine, Child Part and Sub Child Part orders are three separate lists.
- **Switching tabs cleared the search box,** so the order number had to be typed again on every tab.

## What changes
1. **Switching tabs keeps the search.** Status and source filters still reset, as before.
2. **While you search, each tab shows how many orders match,** e.g. *Machine Orders 0 · Child Part Orders 0 · Sub Child Part Orders 1*. Tabs with none are greyed.
3. **Nothing in this tab, and exactly one other tab has it: the page opens that tab.** A blue note says why: *"No Machine Orders match "ORD-2026-118", so this is Sub Child Part Orders, where it was found."*
4. **Nothing in this tab, and two other tabs have matches:** no jump. An amber note offers both: *"No Machine Orders match "Fan". Found in: Child Part Orders (13) · Sub Child Part Orders (10)"*.
5. **No jump while a status or source filter is on.** The filter, not the tab, may be why nothing shows. The amber note still says where else it's found.
6. **Picking a tab yourself is never undone** for the same search.

**Smaller:**
- **The search waits until you stop typing** (0.3 s) instead of asking the server on every key.
- **Typed text is matched as plain text.** Before, a `(` or `+` in the box could make the list fail.
- **The box reads** *"Search order ID, code or name (all tabs)…"*

## Not changed
- **What the search matches:** order ID, sales order ID, part code, part name.
- **The stat cards** still count the whole tab, not the search.
- **Other pages** that use the same order list get exactly what they got before.

## Technical notes
- **Server, `getOrders` (`productionMfgController.js`):**
  - the search is escaped
  - with `grouped=true` and a search, the reply adds `searchCounts: { search, Machine, ChildPart, SubChildPart }`, counted as grouped rows, like the list (the open tab = the list's total; the others = the search alone)
  - the grouping key moved out as `orderGroupKey`, and the tabs' filters into `ORDER_TABS`
- **Screen, `OrderManagement.jsx`:**
  - `searchFor` (debounced) is what's sent
  - `changeOrderTab` no longer clears the search
  - `jumpDecidedFor` decides the jump once per search
  - `jumpNote` holds the note

## Checked
On test-1's real data, through the server (the page compiles; a screen check is next):

| Search, from the Machine tab | Counts | What the page does |
|---|---|---|
| `ORD-2026-118` | Machine 0, Child Part 0, Sub Child Part 1 | opens Sub Child Part |
| `Fan` | Machine 0, Child Part 13, Sub Child Part 10 | amber note, two buttons |
| `(` | all 0, no error | "No orders found" |
| no search | none | as before |

Without `grouped=true` (other pages), the reply has no counts and is unchanged.

## Browser check
**Passed, checked by you on screen (14–16 Nov):** typing an order number on the wrong tab opens the tab that has it, with the note and the counts per tab.
