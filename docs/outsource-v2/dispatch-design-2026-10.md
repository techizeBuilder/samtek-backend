# Dispatch — Vendor Pickups (Purchase + Outsource), trips and vehicles

- **Date:** 2026-10-20
- **Status:** design, decisions T1–T7 agreed with the user (§2). A few questions are still open
  (§6). Not built.
- **Builds on:** [material-logic-2026-10.md](material-logic-2026-10.md) (where the material
  comes from and how much; decisions M1–M4).
- **Part of:** [outsource-workflow-2026-10.md](outsource-workflow-2026-10.md) §6.

---

## 1. Today

- **Vendor Pickups (`/dispatch/vendor-pickups`) is a read-only stub.**
  - It lists POs where Purchase chose "We pick up" (`Purchase.transportBy: 'Company'`): vendor,
    address, items, dates.
  - There's no vehicle, no status and nothing to press.
  - It reuses the Dispatch dashboard's view permission.
- **No vehicle list exists.** Customer dispatch (`DispatchOrder`) types the vehicle number,
  driver and transporter on each record.
- **Transport cost** is only typed by hand as a general expense: Dispatch "Transporting Cost"
  (`PackagingDispatchExpense`) or Purchase "Transport Cost".
- **Outsource:** Purchase's **Mark sent** / **Receive** on the Outsource Order are temporary
  until Dispatch and Store are built (workflow §4.6).

---

## 2. Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|---|---|
| T1 | Who transports outsource work? | **Always us** — outsourcing means sending our material to be processed. No transport choice on the Outsource Order; every send and return appears in Dispatch. (POs keep their "Vendor delivers / We pick up" choice.) |
| T2 | One vendor per trip, or several? | **One vendor per trip**, with any number of that vendor's jobs. **Several vendors per trip is ready to build if the client asks** (§5.1). |
| T3 | Transport cost | **On the trip, for a hired vehicle only:** the freight amount and how it's paid. Saving the trip creates a Dispatch "Transporting Cost" expense linked to it. Our own vehicle: no cost asked. |
| T4 | Job-work challan / e-way bill | **For now: type the challan number** (their hand-written challan) and the e-way bill number, if any, on the send. **Printing the challan from the system is ready to build if the client asks** (§5.2). |
| T5 | Handover confirmation | **Five recorded handovers** (§3.3), each pressed by whoever gives or receives the material. Store / Production confirm their own handovers, and a count mismatch is flagged. |
| T6 | Partial loads | **Sends: the whole line** (combined sheet / length material goes together). **Returns: by request** (one order's work now, another's later). Within one request (6 of 10 pieces) is later, if needed. |
| T7 | Permission and vehicles | A new **Vendor Pickups** permission under Dispatch (view / add / edit), and a **Vehicles** page under Dispatch. |

---

## 3. The design

### 3.1 Vendor Pickups — two tabs

| Tab | Lists | Journeys |
|---|---|---|
| **Purchase** | POs with "We pick up" (today's list) | one: collect from the vendor → Store's normal PO receive |
| **Outsource** | Outsource Order lines (Open and later) | two: **send** (our material → vendor) and **return** (finished work → us) |

Each tab shows what's waiting, grouped by vendor, so Dispatch can tick jobs for the same
vendor and make a trip.

- **Outsource send:** the line's pick list from its material plan (material-logic §6), split
  into a **Store** list and a **Production** list.
- **Outsource return:** the requests that are with the vendor.

### 3.2 A trip

- **One vehicle, one vendor, one date** (T2), with any number of that vendor's jobs: PO
  pickups, outsource sends, outsource returns.
- **The vehicle** (T7):
  - **Regular:** picked from the Vehicles list. The driver and phone are filled in and can be
    changed.
  - **One-time:** typed on the trip only (number, driver, phone, transporter). A **"save as
    regular"** tick adds it to the list.
- **Freight** (T3): asked only when the vehicle is hired (regular hired or one-time):
  - **the amount**
  - **how it's paid:** cash / bank / the transporter bills later
  - creates the Dispatch expense "Transporting Cost", linked to the trip
- **Documents** (T4): on an outsource send, the challan number and the e-way bill number
  (optional).
- **Status:** Planned → Out → Done, with each job's own handovers (§3.3).

### 3.3 The handovers (T5)

| # | Handover | Pressed by | What it does |
|---|---|---|---|
| 1 | Material handed to Dispatch | **Store** (stock out) or **Production** (units / earmarked material) | Store: stock down, booked to each order (material-logic §6). Production: recorded as used by the step. |
| 2 | Delivered to the vendor | **Dispatch** | The request's round becomes **Sent** (this replaces Purchase's Mark sent). Optionally a photo of the signed challan. |
| 3 | Collected from the vendor | **Dispatch** | How many units / pieces, per request (T6). *(2026-10-26, change report §22: if Store receives first, Store's receive records this — "whoever records first".)* |
| 4 | Received at the factory | **Store** | The count is checked against #3 (a mismatch is flagged); offcuts are measured; the round becomes **Received** → QC (this replaces Purchase's Receive). *(2026-10-26: Store doesn't wait for #3 — without it, its count is checked against what was sent; only what's on a trip can be received.)* |
| 5 | PO picked up | **Dispatch** | "Picked up, on the way". *(Replaced 2026-10-26, change report §21: by PO line; Store receives only a line on a trip, and Store's receive records the pickup if Dispatch hadn't — "whoever records first".)* |

### 3.4 Vehicles page (T7)

- **Regular vehicles:**
  - number
  - type (tempo / pickup / truck / other)
  - **own or hired**
  - transporter name and phone (hired)
  - usual driver and phone
  - capacity (kg)
  - active / inactive
- **Unique** by vehicle number per company.

### 3.5 Permission (T7)

- A new feature **`vendorPickups`** under the `dispatches` module, with view / add / edit. The
  Company Admin grants it as usual.
- **Vehicles** is under the same key (edit = manage vehicles).

### 3.6 What goes away

- **Purchase's temporary Mark sent and Receive** on the Outsource Order: replaced by handovers
  #2 and #4.
- **The dummy first send** for Child Part / Machine (material-logic G1).

---

## 4. Examples

**One trip, three jobs at one vendor:**
- tempo **UK07 AB 1234** (own vehicle, no freight), driver Ramesh, 22 Oct, vendor *Rahul Vendor*
- the jobs:
  - **send OSO-0007 line 1:** 2 sheets from Store (orders A and B combined) + Frame units 1–2
    of ORD-0051 from Production
  - **return OSO-0004:** ORD-0048's 5 units
  - **pick up PO-1791…:** 5 × Angle

**Handovers on that trip:**
- Store presses #1 for the 2 sheets, Production presses #1 for the 2 units
- Dispatch presses #2 (OSO-0007 → With vendor), #3 (5 units collected) and #5 (PO picked up)
- back at the factory, Store presses #4 for the 5 units → QC, then receives the PO as usual

**A one-time hired vehicle:** pickup **UK07 CD 9876**, transporter Sharma Transport, freight
₹1,200, cash → a "Transporting Cost" expense of ₹1,200 linked to the trip.

---

## 5. Ready if the client asks

### 5.1 Several vendors per trip (T2, option B)

- **Model it this way from the start:** a trip holds **`stops[]`**, each stop = one vendor + its
  jobs + its own status + its own challan. Built with **exactly one stop allowed**, so moving
  to several stops is a screen change, not a data change.
- **With several stops:**
  - stops in a set order (Dispatch arranges them)
  - each stop's handovers as in §3.3
  - one challan per stop (per vendor)
  - the freight still once per trip; split over the stops (equal / by value / by weight — to
    decide then) only when slice 4 needs it per part
- **Screens then:** "add stop", a route list on the trip, and each stop's jobs.

### 5.2 Printing the job-work challan (T4, option B)

- **A numbered challan per outsource send** (per stop, if several), printable from the trip:
  - our and the vendor's name, address and GSTIN
  - the date and vehicle number
  - items (material and / or parts), qty, unit, value, HSN
  - "Sent for job work, to be returned"
  - the e-way bill number
- **The rules behind it (GST):**
  - material sent to a job worker travels on a delivery challan, not an invoice
  - interstate job-work movement needs an e-way bill even below ₹50,000; within the state the
    usual ₹50,000 limit applies
  - the goods must return within 1 year (3 years for capital goods), reported on Form ITC-04
- **Then possible:** a "material still at vendors" list with ages, for ITC-04 and the 1-year
  limit.
- **To ask the client:** what they use today (challan book, Tally, other), and their challan
  number format.

---

## 6. Still open

| # | Question | Recommendation |
|---|---|---|
| T8 *(replaced 2026-10-25: QC pass / no-QC receive hands it to Production automatically — change report §20)* | After QC passes returned work on a hybrid part, is the physical handover **Store → Production** recorded? | **Yes: Store presses "Handed to Production"**, and Production's next in-house step can't be given to a team until then (the same blocker as for material). Without it, the system would say the parts are in Production while they're still in Store. |
| T9 | How does Dispatch know the vendor's work is ready to collect? | **Purchase (or Dispatch) marks a request "Vendor says ready"**, after the vendor calls. It shows at the top of the Outsource tab's returns. Collecting without it is still allowed. |
| T10 | The job-work order's final receive asks for the cost today (pre-filled from the order). Store won't know costs. | **Store doesn't see a cost field:** the cost is taken from the Outsource Order automatically. |
| T11 | When do Purchase's temporary Mark sent / Receive go? | **When the Dispatch + Store build is complete and tested;** until then both paths work. |
