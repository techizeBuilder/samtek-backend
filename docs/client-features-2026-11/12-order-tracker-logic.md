# 12: Order tracker for the Complaint team (logic)

*Written 14 November 2026. Your ask: after Sales submits the order form, customers call the Complaint team to ask where their order is. The team needs one place to answer. Section 9 lists the decisions I need from you before the plan.*

## 1. Today
The Complaint team sees an order only at its two ends:
- **At the start:** Deal Verifications. They verify the deal on a call.
- **At the end:** Delivery Confirmation, Installation Schedule, Feedback & Ratings, and Customer Records, which shows only delivered machines.

**Nothing in between.** To answer "where is my order?" they have to ask Store, Production, QC and Packing one by one.

**Everything in between is already recorded,** across seven records. The tracker only joins them up: nobody types anything new.

## 2. The order's journey, as the system runs today
| # | Stage | What happens | Recorded in |
|---|---|---|---|
| 1 | **Order placed** | Deal Won on a lead creates the order, e.g. ORD-0131 | Order |
| 2 | **Deal verified** | the Complaint team's verification call | Order (service verification) |
| 3 | **Order form** | Sales submits the items and the promised delivery date | Order Form |
| 4 | **Payment check** | Accounts approves the payment | Order (accounts approval) |
| 5 | **Store check** | automatic when the form is submitted, **per item**: in stock → QC; to be made → Production; to be bought → Purchase | the order's item list |
| 6a | **Being made** | production order: steps done, the current step, what it waits for, parts being made for it | Production Order (+ the part orders made for it) |
| 6b | **Being bought** | purchase request → purchase order → received | Purchase Request, Purchase Order |
| 7 | **Final QC** | waiting, being checked, passed or failed | QC Job |
| 8 | **Packing** | one packing job per machine | Packaging Job |
| 9 | **Dispatched** | transport, vehicle, tracking number, expected delivery | Dispatch Order |
| 10 | **Delivered** | reached safely, installation, feedback | Dispatch Order |

**Two things found on test-1:**
- **The payment check doesn't hold an order up.** 75 of 87 orders went ahead with it still pending. The tracker shows it as information ("payment check pending"), not as a stage the order waits at.
- **Only 17 of 61 order forms have a delivery date.** See section 6.

## 3. Who uses it, and how
1. A customer calls.
2. The team member searches by **order number, mobile number, customer name or company name.**
3. They see that customer's orders, the ones still on their way first.
4. They open one and see where **every item** is, in a sentence they can read out.

**A production order number also finds its customer order**, e.g. PROD-2026-278970 or ORD-2026-112. People inside the company often quote those.
- **Watch out:** production orders also start with "ORD-2026-…", while customer orders are "ORD-0131". The search accepts both and always shows the customer order.

## 4. What one order shows
- **Header:**
  - order number, customer, order date
  - the **promised delivery date** with *on track* / *3 days late* / *no date promised*
  - the payment check
- **A stage bar:** Placed · Verified · Order form · In work · Final QC · Packing · Dispatched · Delivered. *("Packing" was "Packed" here at first; renamed in the build because it covers passed QC, being packed and packed.)* It's filled up to where the order is. **An order is as far as its slowest item.**
- **Per item** (e.g. Blower Pulverizer × 2): where it is now:
  - **one sentence to read to the customer**
  - **details for the team** underneath: production order, current step, what it waits on, dates
- **Timeline:** dated events, e.g. verified, order form, production started, QC passed, packed, dispatched, delivered.

## 5. What to tell the customer (one sentence per item)
| Where the item is | Sentence to read out | Details for the team |
|---|---|---|
| Not checked by Store yet | "Your order is confirmed and being processed." | order form not submitted / Store hasn't routed it |
| In stock, waiting for final QC | "It's ready in stock and going through our final quality check." | QC job and its status |
| To be made, material not ready | "It's being prepared for production. Materials are being arranged." | which material isn't issued |
| Being made | "It's in production: 2 of 4 steps done (now: painting)." | production order, current step, unit by unit |
| Waiting for a part we make | "It's in production. One of its parts (Fan) is being made first." | the part's order, e.g. ORD-2026-113, 1 of 5 steps |
| A step at an outside workshop | "It's in production. One step is being done at a partner workshop." | the outsourced step, sent on |
| Being bought | "It's being procured. Expected in stock by 20 Nov." | purchase request / purchase order, expected date |
| Failed final QC, being fixed | "Our final check found something to correct. It's being fixed before dispatch." | what QC rejected, rework order |
| QC passed, not packed yet | "It passed quality check and is being packed." | |
| Packed | "It's packed and ready for dispatch." | packing jobs, serial numbers |
| Dispatched | "It was dispatched on 12 Nov by (transporter), vehicle (no.), tracking (id). Expected by 15 Nov." | dispatch line |
| Delivered | "It was delivered on 15 Nov." Then installation: scheduled for / done. | confirmation, installation, feedback |

**Never in the sentence to read out:** costs, people's names, vendor names, or internal reject details. The team sees those in the details only.

## 6. On track or late
- **The promised date** is the Order Form's delivery date. It's the same date the production orders are due on.
- **Shown as:**
  - *Promised 23 Nov · on track*
  - *3 days late*: past the date and not delivered
  - *No date was promised*: most test-1 forms today
- **It doesn't estimate a new date.** That's the delivery-date feature (option 1), later.

## 7. Real examples on test-1 (14 Nov)
| Order | Item | Where it is | Sentence |
|---|---|---|---|
| ORD-0127 | Blower Pulverizer × 1 | being made as PROD-2026-278970, 0 of 4 steps, material not issued | "…being prepared for production. Materials are being arranged." |
| ORD-0124 | Blower Pulverizer × 1 | in stock, waiting for final QC | "…ready in stock and going through our final quality check." |
| ORD-0122 | 3 machines | QC passed, all 3 packed, not dispatched | "…packed and ready for dispatch." |
| ORD-0120 | | QC passed, packing in progress | "…passed quality check and is being packed." |
| ORD-0125, ORD-0118 | Blower Pulverizer, Aata machine | Store sent them to Production, but **no production order carries their order number** | the tracker says *"To be made: production order not found, ask Production"*. I'll find out why during the build. |

## 8. Lists, permissions, safety
- **A new Complaint permission, "Order Tracking" (view):** on by default for the Complaint Head and the Complaint Employee.
- **The search list is paged on the server,** 20 a page.
- **Read-only:** opening an order changes nothing anywhere.
- **Stock orders** (no customer) aren't shown.

## 9. Decisions (yours, 14 Nov)
| # | Question | Decided |
|---|---|---|
| Q1 | Internal only, or a link for the customer too? | **Internal now; a customer link later.** The link would reuse the section 5 sentences, like the feedback link the Complaint team already sends. |
| Q2 | Who can open it? | **The Complaint team (Head and Employee), plus the Sales Head (view).** |
| Q3 | Keep a note of each enquiry? | **Yes: a notes list on the order.** Dated, with who wrote it, e.g. *"Customer asked; told: in production, 2 of 4 steps"*. The next person sees what was said. |

Decided by me (you can change it): a failed final QC is told softly, as in section 5's "found something to correct".

## 10. Not in this version
- Estimating a new delivery date (option 1, later).
- SMS / WhatsApp / email updates to the customer.
- Stock orders that have no customer.
