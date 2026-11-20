# Delivery estimate for Sales

Your ask (18 Nov 2026): rebuild Sales → Leads → **Estimate Delivery Date**. Purchase (procurement v2), outsource (outsource v2) and production (BOM levels, manpower, crews) have all changed since the old estimator was built.
- **The date:** Sales gets a **likely date**, and a **date to commit**, which adds a buffer the client is happy with.
- **The people:** the date uses who is really free and when, within each part's usual crew.

This is item 16 in the [client features list](../client-features-2026-11/README.md).

| Doc | What | Status |
|---|---|---|
| [01-logic.md](01-logic.md) | The design: two routes (bought and in-house cascade), the material, work and people clocks, the pretend plan, the buffer, the screen, and every decision with the worked example | Written 18 Nov, walked through part by part with you; **all decisions settled 18 Nov**; **§11 revision 19 Nov** (matching Production: 8 changes + a Production fix) |
| [02-plan.md](02-plan.md) | The build in 5 slices: the numbers going in, history, the work list, the pure planner, API + screen + retiring the old estimator | **Approved 18 Nov** |
| [03-changes.md](03-changes.md) | What changed, in plain words, with the choices made while building | **Built 18 Nov**; **revision built 19 Nov** (+ the Production fix); suites `estplan` 53, `estwork` 45, `estimate` 21 |
| [04-test-roadmap.md](04-test-roadmap.md) | Browser test on test-1 (R&D numbers, Delivery Settings, the header estimate, from a lead + Use this date + order form, permissions, one date by hand; 19 Nov: step by step + unit by unit, the BOM warning, Urgent, the Production fix) | Next |

| [05-deep-test-plan.md](05-deep-test-plan.md) | The deep test (19 Nov): fresh test-1 (what's deleted, money reversed, backup), the test world, rounds 0–5 (typed → history → work in hand → real runs → edges) | Written 19 Nov; **reset done 19 Nov** |
| [06-deep-test-log.md](06-deep-test-log.md) | Each run: hand-worked expectation, what came out, verdict; the bugs and improvements list | **Round 0 done 19 Nov**; round 1 next |

**Background:**
- [delivery-date-estimator.md](../delivery-date-estimator.md): the old estimator, being replaced
- [procurement-v2](../procurement-v2/): the purchase flow, POs and quotes
- [outsource-v2](../outsource-v2/): job work
- [client-features-2026-11](../client-features-2026-11/) 02e (crews, hours, averages), 09 (plan ahead), 11 (planning board), 13 (scorecard)
- the make-or-buy docs: bought parts
