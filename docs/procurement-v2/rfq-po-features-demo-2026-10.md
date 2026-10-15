# RFQ/PO page — what's built (client demo guide)

**Where:** Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO**

This is everything the RFQ/PO page does as of 12 October 2026, in the order it's best shown. Each
part has a **Say** line: the point to make to the client in one sentence. The section numbers
(§) point to the build report, `procurement-v2-changes-2026-10.md`.

---

## 1. One page for the whole buying flow (§5)

- Before, buying took two tabs: **By Item** for quoting and **By Vendor** for ordering. Now it's one
  page:
  - **left side:** what needs buying
  - **right side:** who can supply it
- The two sides scroll separately. The item list can be **collapsed** to a thin rail so the vendors
  get the full width (remembered in the browser).

**Say:** "From request to purchase order on one screen."

---

## 2. Left side: items to buy

- **One card per item.** All its pending purchase requests are combined.
  - **Every request is selected automatically.**
  - **Select requests** lets you hold one back.
  - A request that arrives later shows as "N new — not selected", so a hold-back is never undone.
  - Requests that Store rejected never appear.
- **The combined quantity can be edited:** more than requested is allowed, never less.
- **Fabrication items:** one card **per size**, ordered in **pieces**, with the kg calculated
  automatically (§9).
- **Stock button** on each card: Stock · Reserved · Free · Incoming · Min. It opens a popup with
  what each request is for, which orders have reserved the stock, and the open POs already bringing
  it in (§12).
  **Say:** "Before buying, you can see whether the stock is already there or already on its way."
- **Low vendor warning:** shown when an item has fewer approved vendors than the company minimum
  (set by the Company Admin).
- **Search and filters:** source → category, priority, origin.
  - Matches **move to the top** and are highlighted, so nothing is ever hidden.
  - Search is debounced, so typing stays smooth.
- **Quotes compared** (expand a card, below Select requests) (§17):
  - every vendor's quote for that item side by side: rate, GST, rate with GST, line total,
    delivery, validity
  - the cheapest valid one is marked **Lowest**, the others show "+n%"
  - expired and old-quantity quotes are greyed out
  - vendors still being waited on, and vendors who can't supply, are listed below

  **Say:** "Every vendor's price for an item, side by side, in one click."

---

## 3. Right side: vendors

- **Who shows:** only **Company-Admin-approved, active** vendors that are linked to the item in
  Vendor Master.
- **Order:** ranked by **how many items they cover** ("k/N items"), then sorted by lowest total,
  best rating, fastest delivery, or name.
- **Vendor track record on each card** (§17):
  - ★ rating · **On time n/N** · **QC pass n/N**
  - stage: Probationary / Watchlist
  - risk: **Low / Medium / High**, colour-coded

  **Say:** "You see the vendor's track record at the moment you choose them."
- **Each row** shows that vendor's quote for the item:
  - **Cheapest** / **Fastest** badges and **Valid till**
  - rows **grouped**: priced first, then expired or old-quantity, then waiting for a reply, then
    can't supply, then nothing yet
- **Bought before** tag (§7):
  - compares the quote with what we **actually paid** this vendor last time (delivered purchases
    only, before GST)
  - turns amber when the price jumped more than the set % (default 10)
  - clicking it shows every vendor's past prices for the item
- **Jump to item:** clicking a quantity on a vendor row jumps to that item's card on the left to
  change it.

---

## 4. Getting quotes, way 1: by email (§6, §20, §21)

- Tick items on a vendor card → **Email quotation request**. The vendor gets **one email for all
  the items**.
- **The vendor's page** needs no login. The vendor:
  - enters price, GST %, delivery days and warranty per item, or marks **Can't supply**
  - adds their **charges** (freight, packing…) and **payment terms**, each only by choice
  - submits once; a second submission is refused
- **Security:** the link goes **only to the vendor's email**. Our staff can't see or copy it, so
  nobody inside can submit prices pretending to be the vendor.
- **Asking again:** re-asking a vendor offers a choice:
  - **Only items that need a quote** (new, expired, quantity changed, no reply)
  - **All ticked items**

**Say:** "One email per vendor for all items. The vendor fills one page, and only the vendor can
use the link."

---

## 5. Getting quotes, way 2: manual quotation with evidence (§8, §13, §21)

- **For** quotes that come by WhatsApp, a vendor PDF, an outside email, or a visit / written quote.
- **No proof, no quote.** You must:
  - attach the files (up to 5)
  - say how the quote came
  - give the date on the evidence
- **Prices for several items** are entered at once (MQ-…). The vendor's charges and payment terms
  are recorded too.
- **Negotiation history:**
  - a new price over a **still-valid** quote needs a **reason**
  - replacing an expired or changed-quantity quote is noted automatically
- **Replacing, not editing:** a saved quote can't be edited, only replaced by a new one. The old
  one is kept.
- **No leftover files:** evidence is uploaded only when the quote is saved. A cancelled or refused
  save leaves no files behind.

**Say:** "A phone call isn't a quote. Every manual price has proof attached."

---

## 6. Quote control (§7)

- **Quote validity:** default 30 days, set in Purchase Settings. An **expired quote can't go on a
  PO**.
- **Quantity changed after the quote:** the row is marked "Quoted at qty X — now Y" and must be
  re-quoted. A manual quote can be **Synced** to the new quantity at the same rate.
- **All quotes:** the full history of every offer and re-quote for the items, with the evidence
  files, reasons, charges and terms.

---

## 7. Follow-ups (§18)

- **Remind button** on rows waiting for the vendor's reply: re-sends the same link, marked
  "Reminder", **at most once a day**.
- **Daily notification at 9:35** to the Purchase person, covering:
  - no reply after 3 days
  - the link expired without a reply
  - a quote expiring within 2 days
- **A person decides:** the system **never emails a vendor on its own**.

**Say:** "Nothing gets forgotten, and nothing goes to a vendor without a person deciding."

---

## 8. Creating the PO: Review & create PO (§5, §6, §13, §19)

- **One PO per vendor**, from the ticked quoted rows.
- **Pre-filled:** charges and payment terms come from the vendor's quotation (email or manual).
  - GST per line
  - transport: vendor delivers / we pick up
- **The final total** is shown before confirming, with the vendor's credit-limit warning.
- **GST type is automatic** (from the company's and the vendor's GSTIN):
  - same state → **CGST + SGST**
  - other state → **IGST**
- **Vendor selection check:**
  - were enough vendors asked?
  - did another vendor quote cheaper for the whole order on **landed cost** (price + GST + their
    charges)?
  - if the check fails, Purchase must give a reason, and the PO **goes to the Company Admin**,
    even under the ₹ limit
- **Approval:**
  - above the ₹ limit, the Company Admin approves
  - nobody can approve their own PO
  - while waiting, the items are locked on RFQ/PO
- **Once it's a real order:**
  - the PO is **emailed to the vendor**, with CGST / SGST or IGST rows
  - **Store is notified** of the incoming material
  - every step is recorded in the **audit log**

**Say:** "The system checks the buying decision. A costlier vendor needs a reason and the admin's
approval."

---

## 9. After the PO (if asked)

- **Never edited after ordering.** A change is a **cancel or short close**, approved by the Company
  Admin, then a re-order (§14).
- **Store's To Receive** shows **Overdue / Due today / Due in 3 days**. A delivery date can be
  changed only with a reason, and the original date still counts for the vendor's on-time score
  (§16).
- **The overdue alert** goes to the PO's creator every morning, once per date (§16).
- **History** on every PO, plus an **Audit Log** tab for the Company Admin and permitted Purchase
  users (§15).

---

## Not ready to demo yet

*(This list was written for the client meeting of 2026-10-12. Updated 2026-10-13.)*

- **Built since the meeting** (change report §22–§32), **not yet browser-tested**:
  - bills, ledger and vendor payments (the client answered the 9 questions)
  - serial numbers
  - vendor warranty claims
  - the vendor and purchaser scores
  - the Purchase Dashboard
- **PO creation and approval:** not yet browser-tested (RFQ/PO slices 6–7). Walk through them
  carefully if shown live.
- **Browser-tested so far:** RFQ/PO parts 1–7 above (slices 1–5) and Vendor Master.
