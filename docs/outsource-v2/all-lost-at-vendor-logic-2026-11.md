# Everything on a trip lost at the vendor: logic

- **Date:** 2026-11-04. **Status:** approved by you on 4 Nov, §5.1 added at your request. Built and unit-tested the same day: [change report](all-lost-at-vendor-changes-2026-11.md). Write-off passed in the browser on OSO-0028; refund and credit unit-tested only.
- **Found at:** browser test step 3.4, on OSO-0028 (ORD-2026-099, Motor Mount × 1, MTEST-03).
- **Changes:** [partial-returns-2026-10.md](partial-returns-2026-10.md) §3, the refusal "all of it, with nothing back".

## 1. The problem

Writing off every piece on a trip, with nothing back, is refused: *"Purchase cancels / re-orders instead."* But an Outsource Order can only be cancelled while nothing has gone out, so once the pieces are with the vendor there is no way out. A trip of 1 piece always hits this.

Today, stuck for good:

| What | Stays |
|---|---|
| The serial | "Issued", never "Lost" |
| The order | Waiting for pieces that will never come |
| The replacement | Never raised, so the parent stays short |
| The bill | "Awaiting work" |
| The reservations | Held by an order that can't finish |

The only way forward is to pretend the piece came back and reject it at QC, which records something false.

## 2. The new rule

**The refusal goes.** Purchase can write off everything on a trip, with a reason. Refused as before: more than is with the vendor, and units lines (Child Part / Machine).

What is new is what happens next. A normal write-off goes on to "received" (QC, next step). With nothing back, there is nothing for QC to check, so:

| Pieces left on the order | Example | What happens |
|---|---|---|
| **None** | First send, all lost | The order **closes as all lost** (§3) |
| **Some**, already passed QC | A rework resend, all lost, other pieces passed earlier | The resend closes, its pieces count as scrap (as today), and the batch carries on |

## 3. When the order closes as all lost

| Area | Result |
|---|---|
| **Request and trip** | Closed, with "0 back, n not coming". Its return-trip entry drops off, as today. |
| **QC** | No job asked for, nothing to decide. |
| **Later steps** | Never run. |
| **Stock** | Unchanged: no pieces arrive. |
| **Parent's line** | Delivered count unchanged. The replacement order covers the need. |
| **Production order status** | **Completed** (the only closing status), with a clear mark: **"All lost at the vendor: 0 made"**. |
| **Outsource Order status** | **Received** once all its requests are closed (no new status), with the line reading **"0 back, n not coming"**. |
| **Replacement** | As today: a cascade order gets one for the lost quantity; a low-stock order gets none. |
| **Serials** | Picked ones → **Lost**, not on Defective Inventory. |
| **Reservations** | Released, because the order closed. Material already sent stays gone. |
| **Bill** | The trip's value comes off as "lost at vendor", as today. It then counts as decided, with 0 accepted, so it no longer waits. |
| **Part cost** | **Not updated.** No piece finished, so there's no cost per piece to work out. Today's formula would divide by at least 1 and push a wrong price. |
| **Offcut** | A "whole sheet" first send normally measures its offcut on the first trip home. No trip home means no offcut is recorded. |

## 4. Worked example: OSO-0028

ORD-2026-099, Motor Mount × 1, built for Chamber ORD-2026-096, welding ₹50, MTEST-03 with the vendor. Purchase writes off 1.

| Thing | Before | After |
|---|---|---|
| MTEST-03 | Issued, ORD-2026-099 | **Lost at rahul vendor (OSO-0028)** |
| ORD-2026-099 | Pending | **Completed, All lost: 0 made** |
| New replacement order | None | **Motor Mount × 1**, built for ORD-2026-096, needs 1 Test Motor |
| Chamber's Mount line | 1 of 2 delivered | 1 of 2 delivered, now waiting on the new order |
| Motor Mount stock | 0 | 0 |
| Defective Inventory | Motor Mount 1 | Motor Mount 1 |
| OSO-0028 bill | ₹50, Awaiting work | **₹0**, nothing to pay |
| TRP-0037's return entry | Collect 1 Motor Mount | Gone |

**Test Motor on `/store/reservations`:**

| | In stock | Reserved | Issued | Still to issue | Free |
|---|---|---|---|---|---|
| Before | 7 | 3 | 1 | 2 | 5 |
| After | 7 | 3 | 0 | 3 | 4 |

ORD-2026-099's row (1 reserved, 1 issued) is released, and the new order reserves 1. PRO001's 2 stay.

## 5. An advance already paid: refund or credit

**The rule, the same as a PO cancel or short close** ([procurement change report §24](../procurement-v2/procurement-v2-changes-2026-10.md), case 5): advance paid above what's still owed comes off the bill as money the vendor holds, marked **"To decide"**. On **Vendor Payment → Refunds & credits**, Accounts picks **"Vendor refunds it"** or **"Keep as credit"**. The record names the Outsource Order.

Replace isn't an answer here, because the replacement order covers the pieces. Written off isn't offered either: a PO only reaches it when a vendor refuses after a QC rejection.

**Only the amount above what's still owed moves:**

| Order | Paid | Lost | Bill after | Result |
|---|---|---|---|---|
| ₹50, advance 20% | ₹10 | All (₹50) | ₹0 | **₹10 To decide** |
| ₹150 on two lines, advance 20% | ₹30 | One line (₹50) | ₹100 | Nothing moves. The ₹30 still counts against the ₹100 |
| ₹50, no advance (OSO-0028) | ₹0 | All (₹50) | ₹0 | Nothing moves |

**Ledger, as for a PO:** the ₹10 stays in Advance to Vendors until Accounts decides.
- **Refund:** Dr Vendor Refund Due / Cr Advance to Vendors, then Dr Bank / Cr Vendor Refund Due when it arrives.
- **Credit:** it stays in Advance to Vendors, and is used on that vendor's later payments.

### 5.1 The same rule in two more places (added at your request, 4 Nov)

Whenever an outsource bill ends up below what was paid, the difference goes to "To decide". There are three ways that can happen:

| Case | Today | New |
|---|---|---|
| **Lost at the vendor** | Refused or stuck | The bill drops; anything above it is To decide |
| **QC rejects the work** | The bill drops, but the vendor keeps the extra with no record, and the screen says "nothing left to pay" | The bill drops; anything above it is To decide |
| **Cancel with an advance paid** (only possible before anything has gone out) | Refused: "can't be cancelled until that's refunded", with nowhere to record a refund | The order and bill are cancelled; the **whole amount paid** is To decide |

**Examples:**

| Order | Paid | What happens | Bill after | Result |
|---|---|---|---|---|
| ₹100 work, 20% advance | ₹20 | QC rejects all | ₹0 | **₹20 To decide** |
| ₹100 work + ₹20 charges, advance ₹30 | ₹30 | QC rejects all | ₹20 (the charges stay, as today) | **₹10 To decide**; the other ₹20 pays the charges |
| ₹100 on 2 pieces, 20% advance | ₹20 | QC rejects 1 | ₹50 | Nothing moves |
| ₹100, 20% advance | ₹20 | Cancelled before sending | Cancelled | **₹20 To decide** |

Only the money moves here. QC's rework and replacement orders don't change. Outsource still has no "vendor refused" answer (workflow OQ3). The amount can't be written off to Purchase Loss from here, as a PO rejection can.

## 6. Not changed

- Partial write-offs, which keep today's flow and counts.
- Units lines (Child Part / Machine).
- Who can write off. Purchase can. Store's screen only lists trips with something already back, so it never reaches this case.
- The vendor score.

## 7. Tests to write

1. Production order, first send, all lost: closes, serial Lost, replacement, bill ₹0, reservations released, cost unchanged.
2. Low-stock order: closes, no replacement.
3. Job-work order, all lost: closes the same way.
4. 1 lost, then the rest lost: closes.
5. A rework resend all lost with other pieces passed: the batch carries on and the last step finishes the order.
6. Refusals unchanged: too many, units line, no reason.
7. A second write-off on a closed request: refused.
8. Advance: ₹10 To decide, then Refund and Credit each give the entries in §5; a partial loss still below what's owed moves nothing.
9. QC rejects all after an advance: ₹20 To decide, no set-off on top. With charges: ₹10 To decide. Rejecting 1 of 2: nothing moves.
10. Cancel with an advance paid: order and bill cancelled, requests free again, ₹20 To decide. Cancel with nothing paid: as today. Cancel after something was sent: still refused.

`partial-3b-test` checks the old refusal, so that one check changes on purpose.
