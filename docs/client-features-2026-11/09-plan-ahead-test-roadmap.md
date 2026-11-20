# Feature 9: Planning work on any step (browser test)

*Written 12 November 2026, company test-1 on dev. What changed: [09-plan-ahead-changes.md](09-plan-ahead-changes.md). Do it the same day, after feature 8's roadmap. It uses the teams, the made-up attendance (test production employee absent) and the stage 5 result: ORD-2026-069 unit 1's grinding completed.*

## Where test-1 starts
- **PROD-2026-296498** (Machine BP816, 2 units): assemble → pre painting → post painting, all in-house. Its **material isn't issued,** so its Start is refused: the "can't start yet" case.
- **ORD-2026-069** (Fan), **unit 1:** grinding is completed (stage 5), so **coating** (in-house, QC) can start. Nothing waits on material.

## Steps
### 1. Skills for the test
1. As **Production Head** → **Manpower** → Team One A → **Skills** next to Rahul Pramanik: also tick **assemble** and **coating.** Save.
2. Team Three → **Skills** next to Test Worker Two: tick **pre painting.** Save.

### 2. Plan a step that can't start yet
1. **Process Execution** → **PROD-2026-296498**, unit 1 → **assemble** → **Add people** → **Rahul Pramanik** → **Put on step.**
   - [ ] **No "Material not yet received" message.**
   - [ ] The crew line reads **"Planned: Rahul Pramanik"**.
2. Type `5` in Planned hours → **Start.**
   - [ ] Refused: *"Cannot start process: All required materials have not been issued yet."* Start still guards execution.

### 3. Plan a later step of the same order
1. On the same order, **pre painting** → **Add people** → **Test Worker Two** → **Put on step.**
   - [ ] Allowed, though assemble isn't done: **"Planned: Test Worker Two"**.

### 4. Plan across orders, with someone absent
1. **ORD-2026-069**, unit 1 → **coating** → **Add people** → **Whole team** → tick **Team One A.**
   - [ ] Rahul is ticked. Next to him: *"planned on 1 other step"*.
2. Also tick **test production employee** (Absent; put on anyway). **Put on step.**
   - [ ] **No "Move them here?"** for Rahul, though he's planned on PROD-2026-296498's assemble.
   - [ ] **"Planned: Rahul Pramanik, test production employee"**.
   - [ ] The "Added, but check" note lists test production employee: Absent.

### 5. The Today tab
1. **Manpower → Today.**
   - [ ] **Rahul Pramanik:** Free, and *"Planned: PROD-2026-296498 · assemble; ORD-2026-069 · coating"*.
   - [ ] **Test Worker Two:** *"Planned: PROD-2026-296498 · pre painting"*.

### 6. Start: execution, with the absent warning
1. **ORD-2026-069** unit 1 → **coating** → Planned hours `1` → **Start** → *Started now* → **Start.**
   - [ ] coating is **In Progress**.
   - [ ] A **"Started"** note: *"Not present today: test production employee: Absent"*, with a hint to replace them or take them off.
2. **Manpower → Today.**
   - [ ] Rahul: **Working on** ORD-2026-069 · coating, and *"Planned: PROD-2026-296498 · assemble"* still there.

### 7. Remove someone from a plan
1. **PROD-2026-296498** → **pre painting** → click the **×** on Test Worker Two.
   - [ ] They're removed at once, with no "Left now / Left at" question: nobody worked yet.
2. Do the same for Rahul on **assemble**.

### 8. Clean up
1. On **ORD-2026-069** coating, take test production employee off (× → Left now). Leave Rahul on, or take him off too.

## Not needed on screen
The `planahead` suite covers:
- **Start asking to move** a planned person who's still working on another running step, and their old step ending at the (back-dated) start.
- **Hours:** someone planned at −300 on a step started at −120 counts 2 h, not 5.
- **Work held at Store:** planning allowed, Start refused; QC-passed work is brought back.
- **The picker's "working" vs "planned elsewhere".**

## Automatic results
| Suite | Result |
|---|---|
| `planahead`, new | 18 of 18, 0 left behind |
| `crew`, changed to the new rule | 67 of 67 |
| `teamcover`, changed to the new rule | 29 of 29 |
| `steptimes`, `labour`, `teams`, `slice4-cost` | 28, 33, 72, 30 |
| `slice7`, `stale-atstore`, `dispatch-store-part2`, `partial-3a`, `partial-3c` | 31, 2, 19, 20, 16 |

## Browser results
**13–14 Nov 2026, test-1** (not this roadmap's orders):
- **Planning without material:** Team Two planned on IHT ORD-2026-112 pre painting, which has no material. No refusal; it read "Planned:", Start was refused, and the Today tab showed "Planned: ORD-2026-112 · pre painting".
- **Working while planned:** the same people were then put on ORD-2026-089 drilling with **no "Move them here?"**. They worked there and still showed as planned on the IHT step.
- **Start needs a crew:** Start was refused with no crew and with no planned hours. From 13 Nov, a QC redo can't be finished with nobody on it either.
- **Found and fixed 14 Nov:** after Team Two A was retired, Start now counts planned people under their current team.
