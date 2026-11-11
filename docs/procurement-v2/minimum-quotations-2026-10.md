# Minimum quotations per item before a PO

*Logic doc, 2026-10-29 (client). Doc → plan → build. Fits into the vendor selection check
(change report §13, `services/vendorSelectionCheckService.js`).*

## 1. Why

The Company Admin's **"Minimum vendors per item"** counts vendors **asked** (an email request or a
manual quote, even unanswered). Nothing counts quotations **received**: Purchase can ask 3
vendors, get one price back and make the PO with no reason. The client wants a minimum number of
**received** quotations from different vendors before an item can go on a PO.

## 2. The setting

**Company Admin → Purchase & Vendor Approval → Settings → "Minimum quotations per item"**, below
"Minimum vendors per item". One number for every item.
- It can't be higher than "Minimum vendors per item" (you can't receive more quotations than you
  ask for). Saving either number refuses a pair where quotations > vendors.
- Starts at **1** for every company — nothing changes until the Company Admin raises it.

## 3. What counts as a quotation

For one item (its open RFQ/PO card), one per vendor:

| Counts | Doesn't count |
|---|---|
| A submitted quote with a price — from the vendor's email link or a manual quotation | "Can't supply" |
| …still within the quote validity (Purchase Settings) | An expired quote (past validity) |
| | A request still waiting for a reply |

## 4. The rule (per item on the PO)

1. **Received ≥ minimum → passes.** Nothing more is waited for, even if other vendors were asked
   and haven't replied.
2. **Received < minimum** → look at what's still **possible**:
   - received
   - \+ vendors asked who haven't answered and whose request is still open
   - \+ approved vendors that supply the item and haven't been asked yet
   - \+ vendors whose quote has expired (they can be asked again)

   A request whose link expired **unanswered**, and a "can't supply", count as won't-come.
   - **Possible ≥ minimum → blocked.** The PO can't be made — no exception: "1 of 2 quotations —
     wait for the reply or ask another vendor".
   - **Possible < minimum → exception.** The minimum can't be reached. Purchase picks a reason
     (new reason: **"Not enough vendors can quote"**, or any other on the list) and the PO goes to
     the **Company Admin whatever its value** — the same exception flow as the rest of the vendor
     selection check.

## 5. Worked examples (minimum 2)

| Approved vendors | Asked | Replies | Result |
|---|---|---|---|
| 3 | 3 | 2 quotes, 1 waiting | **passes** (2 ≥ 2) |
| 3 | 3 | 1 quote, 2 waiting | **blocked** — wait for a reply |
| 3 | 1 | 1 quote | **blocked** — ask another vendor (2 not asked yet) |
| 3 | 3 | 1 quote, 2 "can't supply" | **exception** — can't reach 2 |
| 1 | 1 | 1 quote | **exception** — only one vendor supplies it |
| 2 | 2 | 1 quote, 1 request expired unanswered | **exception** |
| 2 | 2 | 2 quotes, 1 expired (past validity) | **blocked** — get a fresh quote from that vendor |

A PO with several items: **any blocked item blocks the PO**; any exception item makes the whole
check fail (reason + Company Admin), as today.

## 6. Where it shows

- **RFQ/PO item card:** "Quotations 1 of 2" — green when met, amber when short.
- **Vendor card → Review & create PO:** the vendor selection check lists each item's quotations.
  A blocked item: "Create PO" stays disabled with what's missing. An exception item: the reason
  picker, as today.
- **Server:** `createPurchase` re-runs the check and refuses a blocked PO, whatever the page sent.
- **Company Admin's PO approval:** the saved check shows the quotation lines.
- **Low Vendor Coverage** (Company Admin): also flags items with **fewer approved vendors than the
  minimum quotations** — where the exception will always be needed.

## 7. Not changed

- "Minimum vendors per item" and the "asked" test; the cheapest-landed test; the ₹ approval limit.
- Outsource orders (no quotations).
- POs already made or waiting for approval.
