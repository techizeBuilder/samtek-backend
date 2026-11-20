# Feature 16: A delivery date Sales can commit to (logic, for discussion)

*18 Nov 2026, revised the same day with your details (two routes, the in-house cascade, the people cap). Your ask: rebuild Sales → Leads → **Estimate Delivery Date**, because purchase, outsource and production have all changed since it was built. The client allows a buffer, and wants the date to use who is free and when. Nothing is built yet. Decisions are in section 9.*

## 1. What was asked
- **A date Sales can commit to:** as accurate a guess as possible, plus a buffer the company is happy to add.
- **Use manpower:** "On 25 Nov Team One and a few workers get free, so a new order's date counts from then."
- **The open question from the client:** if more people get free on 28 Nov or 1 Dec, does the date move earlier? Production may never actually put them on this order.
- **Your details (18 Nov):**
  - Sales sells two kinds of things: **in-house machines**, and **bought machines and motors**. The bought ones are simple: the usual purchase time.
  - **The hard part is in-house,** with its cascade: Machine → Child Part → Sub Child Part (section 3).
  - **Never assume every free person goes onto one order.** Keep, for each kind of machine, Child Part and Sub Child Part, the **usual** and the **most** people who work on it at once. The estimate plans within that cap.

## 2. Today's estimator, and why it's out of date
It was built before the BOM levels, procurement v2, outsource v2 and manpower ([delivery-date-estimator.md](../delivery-date-estimator.md)).

| What it does | Why that's wrong now |
|---|---|
| Finished stock is enough → today + 1 day | Still fine. But it ignores stock already **reserved** for other orders |
| Bought item → its average purchase days (old PurchaseRequest hook) | It ignores a PO that's **already on order**, the vendor's quoted days, and the time it takes to buy |
| Made item → **every** open production order in one line, one after another, plus the new machine's own days | No teams, no people, no free dates. 31 open orders on test-1 would add up to months. Child Parts, Sub Child Parts and job work aren't counted |
| Materials: the old BOM (`RDBOM`), worst material days | The new BOM levels and make-or-buy aren't read |
| No history → **7 days** | It looks precise but it's made up |

## 3. What Sales sells, and the routes
### Route 1: bought (bought machines, motors)
In order of trust:
1. **Free stock** (stock minus what's reserved for other orders) covers it: **today**.
2. **Already on order:** the PO line's expected date.
3. **Not on order:** today + the **usual purchase time** for that item (section 7).

Then QC and dispatch days, and the buffer.

### Route 2: in-house machines, the cascade
It's the same cascade the order form already runs on submit (Store's check → Machine order → Child Part orders → Sub Child Part orders). The estimate walks it **without creating anything**:

- **Machine** = Child Parts + its own **assembly material**
  - **Child Part** = Sub Child Parts + its own assembly material
    - **Sub Child Part** = its raw material. It's made in-house, or sent out as job work.
- At any level, a part marked **bought** (make or buy) is a purchase, not built.

| Case | What we have | What the estimate adds |
|---|---|---|
| **1** | The Child Parts **and** the machine's assembly material | Only the **machine's own steps** |
| **1b** | The Child Parts, but **not** all the assembly material | The machine's steps, starting when the **material is bought** |
| **2** | **Not** the Child Parts (with or without the assembly material); the Sub Child Parts **are** there | Each missing **Child Part's steps** and its assembly material, then the machine's steps. Assembly material is bought at the same time |
| **3** | **Not** the Sub Child Parts either | Each missing **Sub Child Part's steps** (or job work) and its raw material, then the Child Part, then the machine |

**How the levels fit together:**
- **Every purchase starts on the order day,** side by side. The cascade raises them all when the order form is submitted.
- **A part's work can start** when all three are true:
  - the parts below it are ready
  - its own material is in
  - its people are free (section 5)
- **Stock counts as free stock only:** stock minus what's already reserved for other orders, at every level.
- **Partly in stock:** 5 machines needing 10 Child Parts, with 6 free, means only **4** are built.
- **Several items** on one order: one date, the latest of them, because the order ships together.

## 4. What the system knows now
| Need | Where it is | Good enough? |
|---|---|---|
| **Stock** of machines, parts and materials | Inventory qty, minus reservations | Yes |
| **What a machine is made of** | Machine BOM → Child Parts → Sub Child Parts → materials; make or buy; each level's steps in order (in-house or out-source) | Yes |
| **Material already on order** | Open PO lines: each line's expected delivery date (moved when the vendor gives a new date) | Yes: the best number there is |
| **Material not yet ordered** | Past purchases of that item (raised → received); recent quotes' delivery days; Item "Lead Time" (typed) | Some history (test-1: 39 received) |
| **Job work time** | Outsource orders: sent → received, per process | Some history (test-1: 39 received) |
| **In-house step time** | Finished step runs: person-hours per piece, by crew size | **Very thin:** test-1 has 6 runs, none with 3+. Live has **none** |
| **People on a part at once** | Crew entries: who was on which order's steps, from when to when | Thin, for the same reason |
| **Typed time** | Machine "Build Days" (R&D) | Set on **no** machine |
| **Open work ahead** | Open production orders, each step's planned hours, hours done so far, who is on it or planned, who worked on it lately | Yes. But "nobody on a step right now" **isn't** "free" (section 5) |
| **People** | Production people, teams, skills, shifts, holidays and weekly offs (payroll's rules), attendance | Yes. The device isn't connected, so the attendance rate isn't known |

**The gap:** nothing says how long a step should take, or how many people a part usually gets, before it has been done a few times. Section 7 fills it.

## 5. The fuzzy solution: three clocks, a people cap, and a pretend plan
A part is ready when three things allow it:
1. **The material clock:** free stock first, then what's on order, then what must still be bought.
2. **The work clock:** steps in order, each at about its usual time and crew. Job work takes its usual days away.
3. **The people clock:** when people are free. Work already in hand goes first.

**The people cap (your point):** every machine, Child Part and Sub Child Part has a **usual number of people** working on it at once, and a **most**, taken from history (or typed, section 7).
- The pretend plan never puts more than the usual number on that part of this order, however many people are free.
- So a big free team doesn't make the date look magically short.

**The pretend plan** is worked out in a second when Sales clicks Estimate. Nothing is saved and nobody is assigned.
- **The days:** it walks day by day on the company's working days.
- **Each production person** has their usual hours that day (shift minus lunch, times the attendance rate).
- **Work in hand goes first,** earliest delivery date first. That includes planned and running steps, and the rest of each open order. The people who have been working on an order carry on with it (see "Who is really free" below).
- **The new order** then gets free people with the right skill, **up to its cap**.
  - A step starts only when its material is in and the step before it is done.
  - A part starts only when the parts below it are ready.
- **Job work** counts its usual days away, in calendar days.
- **Then** QC, packing and dispatch days are added.

**Two dates come out:**
- **Likely date:** when the plan finishes.
- **Date to commit:** the likely date plus the buffer.

**It shows its working:**
- the material that came last, and why ("Motor: not ordered, usually 7 days")
- which part or step was slowest
- who it counted on and from when ("Team One from 25 Nov, 2 people as usual for AC-10")
- what was guessed

### Who is really free (your point, 18 Nov)
**Assigning is daily, or step by step.** Someone with no step assigned right now shows as **Free** on Manpower → Today, but they're often between two steps of an order they'll go straight back to. So **the estimate never reads "free" from today's assignments.** A person is free only once the work in hand they would do is done:

1. **People stay with their order:** whoever worked on an open order in its **last few working days** (crew entries) is planned to carry on with it, up to that order's cap, until its remaining steps are done.
2. **Open work nobody is on yet** (orders not started, or steps waiting) gets people next, earliest delivery date first, within each order's cap.
3. **Only the hours left over** go to the new order.

**The remaining work of an open order** is the hours left on its steps:
- **a running or planned step:** its planned hours minus the hours already worked
- **a step not planned yet:** its usual hours (section 7)
- **job work:** its usual days away; the people are free for other work meanwhile

**Example:**
- Ravi finished a step on ORD-2026-114 yesterday, and nothing is assigned to him today, so Manpower shows him **Free**.
- ORD-114 still has 12 person-hours of steps left, and its usual crew is 2.
- The plan keeps Ravi on ORD-114 for those hours: 12 ÷ 2 people = 6 hours each, so most of today.
- **So Ravi is free for a new order from tomorrow, not today.**

### The client's question: do people freed later pull the date earlier?
**Only up to the cap.**
- **Below the cap:** if the order has fewer people than its usual number, someone free on 28 Nov with the right skill joins it in the plan, and the date comes in.
- **At the cap:** extra people don't change anything.
- **The rest is the buffer's job:** Production may still put them elsewhere. The screen names who it counted on, so Production can plan them in (plan-ahead, feature 9) if the date matters.

## 6. Worked example (by hand)
*This matches the Part 7 walk-through of 18 Nov. Today is Wed 18 Nov. Sundays are off. Every person works 8 hours a day at full attendance.*
- *QC checkpoints have no history yet, so they're decided by the end of the same working day (W).*
- *Packing and dispatch take 1 day each.*
- *The buffer is 15% of the working days, at least 2 (B).*

**The order:** 1 × machine AC-10.
- Free stock: no AC-10, no Body (its Child Part), no Plate (the Body's Sub Child Part). So this is **case 3**.

**The work, each step from history or R&D's usual hours:**

| Level | Step | Work | Crew | Takes |
|---|---|---|---|---|
| Sub Child Part "Plate", batch of 4 (usually 1 person) | cutting | 0.5 h/piece = 2 person-h | 1 | 2 h |
| | drilling (QC) | 0.25 h/piece = 1 person-h | 1 | 1 h + QC |
| Child Part "Body" (usually 2) | welding | 6 person-h | 2 | 3 h |
| | grinding | 2 person-h | 1 | 2 h |
| | painting | **job work**, usually 3 days | | 3 days |
| Machine AC-10 (usually 2, most 3) | assembly | 8 person-h | 2 | 4 h |
| | testing (final QC) | 2 person-h | 1 | 2 h + QC |

**Materials (all raised today, side by side):**
- **Steel sheet** (the Plate's raw material): short, but **on a PO due Sat 21 Nov**.
- **Motor** (the machine's assembly material): short, **not ordered**. It usually takes 7 days to buy, so **Wed 25 Nov**.
- **Frame** (a **bought** Child Part): none free, not ordered. It usually takes 10 days, so **Sat 28 Nov**.
- Bolts and the belt are in stock.

**People** (worked out by the plan as in section 5, not read from today's Manpower screen):
- **Team One (3 people):** the orders they've been working on are done by Tue 24 Nov, so free from **Wed 25 Nov**.
- **Ravi and Meena:** free from Sat 28 Nov.
- Everyone else is busy past December.
- **Caps:** Plate 1, Body 2, AC-10 2.

**The pretend plan:**

| Day | What happens |
|---|---|
| **Wed 18 Nov** | Order day. All purchases start: motor and Frame raised, steel already on a PO |
| Sat 21 Nov | Steel in (QC passed). Nobody free yet |
| **Wed 25 Nov** | Team One free. **Plate:** 1 person (cap 1) cuts h0–2 and drills h2–3, then QC by the end of the day. Motor in. Team One's other two take other waiting work |
| **Thu 26 Nov** | **Body:** welding with 2 people h0–3, grinding h3–5. Painting ready to send |
| Sat 28 Nov | Frame in. Ravi and Meena free, but AC-10 has nothing to work on (the Body is away) |
| Sun 29 Nov | Painting back (3 days), usable from Monday |
| **Mon 30 Nov** | **AC-10:** assembly with 2 people h0–4, testing h4–6, final QC by the end of the day |
| Tue 1 Dec | Packing |
| **Wed 2 Dec** | Dispatch |

**Result:**
- **Likely date (dispatch):** **Wed 2 Dec**.
- **Buffer:** 12 working days to 2 Dec × 15% = 1.8, below the minimum, so 2 days.
- **Date to commit:** **Fri 4 Dec**. Sales adds travel days for "delivered by".
- **What decided it:** nobody free until 25 Nov, then the painting job work, plus the Sunday it came back on. The Frame and the motor were ready before they were needed.
- **If Team One were free today:** Plates Sat 21, Body Mon 23, painting back Thu 26. **The Frame (Sat 28) now decides**: AC-10 is assembled Sat 28, with packing and dispatch Mon 30 and Tue 1 Dec.

**The same with 5 machines, to show the cap:**
- The order needs 5 × 21 = 105 person-hours. AC-10 usually gets 2 people at once (most 3).
- **The plan uses 2 people** even though Team One has 3 free, so Ravi joining on 28 Nov **doesn't** bring the date in. The cap is already met.
- **With the old "everyone free" idea,** 3, then 4 people would have made it look about a third faster. The cap stops that.
- **The result (after the 19 Nov revision, §11):** likely **Wed 9 Dec**; 18 working days × 15% = 2.7, so a 3-day buffer; commit **Sat 12 Dec**. Ravi and Meena never getting free gives the same date.
- **With a cap of 3,** it's **Tue 8 Dec**, a day earlier.
- The `estplan` suite holds these numbers.
- The 1-machine example above is unchanged by the revision (no step picks anything, so everything holds the first step, as before).

## 7. Where each number comes from (most trusted first)
**In-house step, its time for 1, 2, 3… people (revised 19 Nov, §11 changes 1–2):**
1. **History:** the last 10 runs of that step on that part, once there are **3 or more**. The time for N people is stage 5's average: runs with exactly N people first, else the work split evenly.
2. **R&D's usual hours:** a **new optional box on each in-house BOM step**, "usual hours per piece", split evenly across up to the part's usual people (marked "estimated").
3. **Nothing known:** said so, naming the steps ("No time known for: welding on Body"). It never makes up a number.

*(The machine's Build Days were dropped on 19 Nov, §11 change 8.)*

**People at once on a part (the cap):**
1. **History:** from crew entries, per order of that part: the **usual** (average, rounded) and the **most**, over its last 10 orders.
2. **R&D's usual people:** a new optional box on each BOM part (Machine, Child Part, Sub Child Part).
3. **Its biggest step crew:** the largest usual crew among its steps.
4. Otherwise **1**.

**Material, when free stock is short:**
1. **Already on order:** the PO line's expected date. If the advance isn't paid yet, today + the quoted days + the usual days to pay the advance.
2. **History:** the usual days from raising to receiving for that item (the last 10).
3. **Recent quotes:** the vendor's quoted days, plus the company's usual **buying time** (raised → PO, from history).
4. **Item "Lead Time"** (typed).
5. **Nothing known:** said so.

**Bought machine or motor** (route 1): the same as material.

**Job work:**
1. The usual days that process spends away (the last 10 returns).
2. A typed number (section 9, H).
3. Nothing known: said so.

**QC, packing, dispatch:** fixed days, set by the Company Admin.

**How sure:** each estimate gets a label:
- **Good:** mostly from history
- **Rough:** mostly typed numbers
- **Missing pieces:** something was unknown

## 8. What it won't do (first version)
- **It doesn't hold people or material for a quote.** Two quotes on the same day both see the same free people. Only confirmed orders count as work in hand.
- **It doesn't change Production's plan,** and it never assigns anyone or raises any order or purchase.
- **It isn't a full scheduler.** It works in people-hours per day, within each part's cap, not bench by bench.

## 9. Decisions for you (and the client)
**Decided so far, during the part-by-part walk-through (18 Nov):**
- **B:** the buffer is a **% of the working days, with a minimum**. The Company Admin sets both (default 15%, at least 2 days).
- **J:** **one date for the whole order** (the latest item), with each item's own date in the breakdown.
- **R (open POs):** a new estimate counts **only what's left** of stock + open POs after confirmed orders take their share.
  - The share comes from reservations, which hold each order's **whole** need, so free stock can go below 0, and from purchase requests tied to customer orders.
  - It's taken earliest delivery date first. Anything more is **still to buy**, at the usual purchase time.
  - Example: stock 2 + PO 5 − needs 6 = **1 left**.
- **S (ready when):** a bought item or material is ready when it has **passed incoming QC and is in stock**. The usual purchase time runs from raising the request to QC passed, so rejections and replacements show up in it.
- **T (for-stock orders):** what open **for-stock** production orders will produce counts as coming in, on the date the pretend plan finishes them, and only what's left after confirmed orders.
  - These are orders such as the low-stock sweep's machine orders, or a Child Part order raised for stock.
  - In-house machines can also simply be **in stock**: that's case 0, ready today.
  - The sweep is switched on only for some machines. A machine without it just has no for-stock orders to count on.
- **U ("usual" days):** the **middle one** (median) of the last 10, for purchase and job-work days. Example: 5, 6, 6, 7, 7, 7, 8, 9, 12, 20 → **7**, not the average 8.7. Step hours keep stage 5's averages by crew size.
- **V (fabrication sizes):** usual purchase time **per size** when that size has 3+ purchases, otherwise all sizes of that material together.
- **D + E (step times):** R&D types **"usual hours per piece"** once on each in-house BOM step; history replaces it after 3 runs. A step with no time at all → **"can't estimate yet"**, naming the steps. No made-up default.
- **H (job work):** measured from **ready to send** (request raised) **to back at Store**, so waiting for a vehicle trip counts. It's the middle one of the last 10. Before 3 trips of that process, a **"usual days"** box is typed once on the Outsource process.
- **W (QC checkpoints):** a "QC required" step adds the **usual QC wait**: the middle one of the last 10 production checkpoint waits (submitted → decided), in working hours. Until there's history, the same working day.
- **C (work ahead):** **all confirmed work**, earliest delivery date first: open production orders' remaining steps, plus submitted order forms not yet in production. Quotes don't hold anyone.
- **L + N (people cap):** plan with the **usual** number of people on each part. The most shows as "could be faster with up to N". An order **bigger than history has seen keeps the same cap.**
- **P (stays on):** whoever was on an open order's crew in its **last 3 working days** carries on with it (up to its cap) until it's done. "Free" is never read from today's assignments.
- **G (attendance):** each person's usual hours × **their own attendance rate over the last 3 months**. With no records (the device isn't connected yet), 100%, and the screen says so.
- **F (skills):** skills are matched where they're recorded. **A person with no skills recorded counts for any step.**
- **Q (work in hand with no time):** usual hours → otherwise **1 working day per remaining step** for its usual crew. The estimate is marked **Rough** and names those orders.
- **Travel (new):** the plan ends at **dispatch**.
  - The dialog has a **"travel days"** box (default set by the Company Admin) that Sales adjusts per customer, giving "delivered by".
  - The buffer is worked on the dispatch date.
- **I (saving):** **"Use this date"** saves the estimate on the lead: the dates, what decided it, how sure, and when and by whom.
  - When the order form is filled for that lead, its delivery date **starts as the saved date to commit**. Sales can change it.
  - Re-estimating shows what moved.
- **K (who):** anyone with **Sales orders view**, as today. "Who it counted on" shows **team names and how many people**, never anyone's hours.
- **M (cap before history):** R&D types a **"usual people"** box once on each BOM part; history replaces it. If it's empty, the biggest usual crew among the part's steps, otherwise 1.
- **O (purchases):** **every purchase starts on day 0, side by side**, as the order form's cascade does on submit.
- **A:** follows from L. People who free up later join only up to the part's usual cap.
- **All decisions are settled (18 Nov).** The table below is kept for the reasoning.
- **Rules used in the Part 7 walk-through:**
  - Job work or material arriving on a day off is usable from the next working day.
  - A day where work in hand can't proceed (waiting for material) leaves its people free for other work that day.

| # | Question | Recommended | Why |
|---|---|---|---|
| **A** | **People freed later** (28 Nov, 1 Dec) | **They join only up to the part's people cap** (L). The screen names who it counted on, and the buffer covers the rest | Your point: never pour every free person into one order |
| **B** | **The buffer** | **The Company Admin sets it** as a % of the working days (default **15%**, at least **2 days**). Sales sees both dates | Bigger jobs carry more risk |
| **C** | **Which work goes ahead of the new order** | **All confirmed work:** open production orders, plus submitted order forms not yet in production, earliest delivery date first. Quotes don't hold anything | Sales can't jump the queue on paper |
| **D** | **Step time before there's history** (live has none) | **"Usual hours per piece" on each in-house BOM step**, typed once by R&D. History takes over at 3 runs | Without it, live can't estimate at all |
| **E** | **A step with no time anywhere** | **"Can't estimate yet",** naming the steps. No 7-day default | A made-up date that Sales commits to is worse than none |
| **F** | **Skills** | **Match by skill** where people have skills, otherwise anyone in Production | People without the skill can't do the step |
| **G** | **Attendance rate** | **Each person's last 3 months.** Until the device is connected, **100%**, and say so | Absence is real time lost, but only once it's measured |
| **H** | **Job work with no history** | A **usual days** box on the Outsource process (Process Category options), typed once | The same kind of gap as D |
| **I** | **Saving it** | **"Use this date"** saves it on the lead or quotation: the date, what decided it, when and by whom. Re-estimating shows what moved | Sales can show why they promised it |
| **J** | **Several items in one order** | **One date for the whole order,** as today | It ships together |
| **K** | **Who can use it** | **Sales, as today.** "Who it counted on" shows team names and how many people, never anyone's hours | Hours are close to pay |
| **L** | **The people cap: usual or most?** | **Plan with the usual** (the likely case). Show the most as "could be faster with up to N people" | The usual is what Production really does. The most is a best case, not a plan |
| **M** | **The cap before there's history** | **A "usual people" box on each BOM part** (R&D), else its biggest step crew, else 1 | The same gap as D, filled the same way |
| **N** | **Bigger orders than history has seen** (5 machines when only 1s were built) | **Keep the same cap** (cautious). History grows as bigger orders are built | Production may split the work over crews, but the estimate shouldn't count on it |
| **O** | **Purchases at all levels start on the order day** | **Yes,** as the cascade raises them all at submit | That's how the system already works |
| **P** | **Who carries on with an open order** | **Whoever worked on it in its last 3 working days** stays on it (up to its cap) until it's done. Never read "free" from today's assignments | Assigning is daily, so "no step right now" isn't "free" (your point) |
| **Q** | **Work in hand with no time known** (old orders, steps not planned, no history) | Use the **usual hours** (section 7). If still unknown, **count it as 1 working day per step left** and mark the estimate **Rough**, naming those orders | Unlike the new order (E), work in hand can't be left out: it really does hold people. A rough figure, marked as rough, is better than counting those people as free |

## 10. How it would be built (rough slices, after your decisions)
1. **The numbers:**
   - on BOM steps and parts: "usual hours per piece" (D) and "usual people" (M)
   - job-work usual days (H)
   - the buffer and QC/packing/dispatch days in settings (B)
2. **The pretend plan:**
   - the order's work list from the cascade (both routes), with the reorder services' checks in read-only mode
   - the material clock
   - the work in hand
   - the day-by-day plan with the people cap
   - a suite holding the worked example (1 and 5 machines) as exact totals
3. **The screen:** the new Estimate dialog (likely date, date to commit, what decided it, who it counted on, how sure), with an EN / Hinglish "How this date is worked out" panel, and "Use this date" on the lead.
4. **Retire** the old estimator and its 7-day default.

## 11. Revision, 19 Nov: matching how Production really works
*After the build, you asked me to check Orders, Process Execution, Manpower and Work Planning line by line. That found eight places where the planner differed from Production, and one Production behaviour to fix. All are agreed (19 Nov). They replace anything above that says otherwise.*

### What Production does (checked in the code)
- **Start** (`startBlockers`, shared with the Work Planning board) checks:
  - **Machine:** the BOM is approved by R&D, and nothing Production has requested is still waiting (the `materialIssued` flag; see 11.3).
  - **Machine and Child Part:** the **step's own picks** (the material and parts R&D picked for that step), counted **per unit**.
  - **Every step:** the **previous step on that unit** is done, and nothing for that unit is held at Store.
- **Sub Child Part:** one batch. Its raw material is a separate request; the steps have no picks of their own.
- **Material is requested line by line, in any quantity** (Process Execution → Material List): Store transfers it, Production receives it.
- **QC:** a QC step holds the next step until QC decides, and while anything waits on Rework.
- **Job work:** consecutive job-work steps (and several units) go to the vendor **in one trip**.
- **Orders** have a priority (**Urgent** / Normal) as well as a delivery date.
- **Plan-ahead:** people can be planned on specific future steps across orders.
- **Stage 5 (02e decision 5):** the usual time for **N people** comes from real runs with N people first, else the overall work split evenly.

### 11.1 The eight changes to the estimate
| # | Change | Before | After |
|---|---|---|---|
| 1 | **Time by number of people** (02e decision 5) | Stage 5's work for the usual crew, then split evenly | **Runs with exactly N people first, else an even split.** When people join or leave mid-step, the plan keeps how much is done and goes on at the new count's speed. Example: welding with 1 person takes 4.5 h; 2 people (2 real runs) take 2.9 h, not 2.25; 1 person for 2 h (44%) then 2 people → 0.56 × 2.9 = 1.6 h more |
| 2 | **Steps with R&D's typed hours** | 1 person at most | **Up to the part's usual people,** with an even split ("estimated"). Example: 8 h typed, 3 usual people → 2.7 h |
| 3 | **When a step may start** | A part waited for all its material and all its children, for all units, before step 1 | **Each step waits for its own picks, unit by unit,** at Machine and Child Part. Machine unit 1 can start when the parts its step uses are ready for unit 1. Sub Child Part: one batch, and its raw material holds the first step. **Material no step picks holds the first step** |
| 4 | **Job work in one trip** | Each consecutive job-work step's days added up | **Consecutive job-work steps are one trip:** the longer of their usual days. History already times the whole trip |
| 5 | **Urgent first** | Work in hand by delivery date only | **Urgent first, then delivery date** |
| 6 | **Planned people** | People stay with their order | **People Production planned on a step are that step's crew** in the plan, once it's ready |
| 7 | **BOM not approved** | Not checked | **A warning:** "This machine's BOM isn't approved yet. Production can't start until R&D approves it." The date assumes approval today |
| 8 | **Build Days** | In §7 as a fallback, never built | **Dropped.** Per-step times replace it; a step with no time says "can't estimate yet" |

**How the units of a part line up (change 3):**
- Each unit of a Machine / Child Part order has its own steps.
- A Child Part (or Sub Child Part) is **handed to the parent as each unit is ready** (a Sub Child Part batch: all at once).
- The parent's unit *i* uses its share of each part: the BOM quantity × 1 unit. A step that picks a part waits until that many are ready.

### 11.2 Unchanged (already as Production does it)
- steps in order on each unit; units independent
- QC waits
- one running step per person
- people stay with their order (P), and the part's people cap (L, M, N)
- attendance and shifts
- skills
- free stock, open POs and for-stock orders
- the buffer and travel days

### 11.3 A Production fix found on the way (agreed)
**Today:** a Machine order's `materialIssued` flag is off while **any** requested line is waiting. While it's off, **no step of any unit** can start.
- **Example:** a top-up of bolts for unit 2 blocks unit 1's next step too.
- **It's also inconsistent:** a top-up turns the flag off, but a first request for a new line doesn't.

**The fix (recommended):**
- For orders built from the BOM's Process Definition, **Start no longer needs the order-wide flag.** Each step's own picks are already checked, per unit, as Child Parts are.
- "BOM approved" stays.
- Old fixed-step orders (Job Work / Assembly) keep their old checks.
- The Work Planning board uses the same checks, so it follows by itself.

**Built 19 Nov:**
- `machineGate` (in `controllers/productionMfgController.js`) asks for the flag only when no step has a process category, which means an old fixed-step order.
- The Order Tracking list's quick check follows the same rule.
- The tests:
  - `planboard` section 5: a Process-Definition Machine order with a top-up waiting shows as ready and starts, while an old order still waits.
  - `ordertrack`: the same order reads "in the production queue", not "materials are being arranged".

## 12. Decided during the deep test (19 Nov)
*Found on test-1's fresh data. These replace G and U where they differ.*
- **G2 (attendance):**
  - Only days that have an attendance record count: present, half day, or the device's own Absent. A working day with no record is neither present nor absent.
  - A person's rate is measured once they have **20 recorded working days** in the last 3 months. Before that it's 100%, and the estimate says "not measured yet".
  - **Why:** test-1 had records on only 7 days, so every no-record day counted as absent (5–53%), and each person's working day shrank to almost nothing.
- **U2 (buying time):**
  - History replaces Purchase's typed lead time only from **3 receipts** of that item, the same rule as step times, trips and QC waits.
  - The company-wide "raise → PO" buying time also needs 3.
  - **Why:** test-1's receipts came from dev tests, received within minutes. One receipt said "usually 0 days".

## 13. Purchase owns "days to buy" and job-work time (19 Nov, deep test)
**Why:** round 1 found the estimate's last fallback was the item's "Lead Time (Days)", and that box was removed from the item form at the client's request (8 Aug). So for an item bought fewer than 3 times with no quote, nobody could give the estimate a number. Job-work days were typed in R&D's process templates, but Purchase deals with the vendors.

**Your decisions:**
- **A. Usual days to buy, on Purchase → Inventory.**
  - A new column beside Purchase Cost, on every item tab.
  - It's stored in the item's existing `leadTime` field (whole days, empty = not set). The item form doesn't show it, and keeps whatever is there.
  - Under the box is what the estimate uses: "From history: 5 days (4 receipts)" once there are 3+ receipts, otherwise "Your number", or "Not set".
- **B. Job Work Time, a new tab on the same page.**
  - One row per Out Source process (laser cutting, welding, grinding, pre painting…), with:
    - the usual days away (editable)
    - the history figure (the middle of the last 10 trips, once there are 3)
    - the parts that send it out
    - what the estimate uses
  - Saving writes the days to every process category that lists that process, so two "painting" categories can't disagree.
- **C. R&D's "Usual days away when sent out" box is removed** from the process templates dialog. Purchase owns the number now. The days already typed stay, because it's the same data.

**The estimate's order of trust is unchanged:**
- **Material or bought item:** open PO → history (3+ receipts) → a vendor quote + the usual buying time → Purchase's usual days to buy → can't estimate yet.
- **Job work:** history (3+ trips) → Purchase's usual days → can't estimate yet.

**Messages:** "can't estimate yet" now says where to fix it:
- "Purchase can type its usual days to buy on Purchase → Inventory." An item without the Purchase tick isn't listed there, and the message says that too.
- "Purchase can type the usual days on Purchase → Inventory → Job Work Time."

**Who:** whoever can edit Purchase Cost on that page (Purchase module, edit).
