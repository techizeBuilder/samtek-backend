# Feature 15: A cap on incentives HR can approve alone (logic)

*18 Nov 2026, from the scorecard browser test. Builds on feature 10 §8 (incentives) and feature 13 §11.*

**Decided 18 Nov: A–G as recommended (your go-ahead).**

## 1. The idea (yours)
- **Today:** HR can give an incentive directly, or approve a Production Head's request, for any amount. It's approved at once, with no limit.
- **Change:**
  - **The Company Admin sets a cap.**
  - **At or under the cap,** HR gives or approves on their own, as today.
  - **Above the cap,** the incentive waits for the **Company Admin**, who approves or rejects it. Nothing is paid until then.

## 2. Who does what

| Who | Can do |
|---|---|
| **Production Head** | **Request** only, with a suggested amount (optional). Unchanged. |
| **HR** | Approve a request, or give directly. **Up to the cap:** approved at once. **Above it:** sent to the Company Admin. |
| **Company Admin** | Sets the cap. Approves or rejects what's above it. Their own give or approval has no cap. |

## 3. Decisions to settle

| # | Question | Recommended | Why |
|---|---|---|---|
| **A** | What does the cap measure? | **Per person per month:** everything approved for that person, paid with that month's payroll, plus this one | Otherwise ₹500 + ₹500 + ₹500 slips under a ₹1,000 cap one at a time (today's test: two ₹500 gives to Test Worker Two). |
| **B** | Does it cover HR **approving a Production request** too, or only HR's direct give? | **Both** | It's the same money; the cap is about HR spending alone. |
| **C** | No cap set (e.g. a new company)? | **No limit, as today** | Nothing changes until the Company Admin sets one. |
| **D** | Above the cap: what happens? | Saved as **"Waiting for Company Admin"** (not paid). The Company Admin's bell rings. They **approve** (and may change the amount or the month) or **reject** with a reason. HR and the Production Head who asked are told. | Same pattern as the other approvals. |
| **E** | Where is the cap set? | **Performance Settings**, as one more box ("HR can approve alone up to ₹ … per person per month"), saved in the same **versioned** settings (an "applies from" month, never a past month) | One page for the rules; the history shows who changed the cap and when. The incentive's payroll month picks the cap in force. |
| **F** | The payroll for that month is already run while it waits? | The Company Admin's approval is refused for that month, so they pick the next month (today's rule). | Payroll stays as it was. |
| **G** | Where does the Company Admin decide? | **Employee Performance → Incentives**, which they have since today, under a new filter **"Waiting for Company Admin"**, with Approve / Reject. | No new page. |

### What the screens show
- **HR's Give / Approve box:** under the amount, "Up to ₹X this month for this person, HR approves alone. Above it, the Company Admin decides." If it would go over, the button says **"Send to Company Admin"**.
- **Status:** "Waiting for Company Admin" (amber), then "Approved" / "Rejected". It shows who decided.
- **Production's list:** their request shows "Waiting for Company Admin" while it waits there.

## 4. Worked example
- **Cap:** ₹1,000 per person per month, from November.
- **HR gives Test Worker Two ₹500:** ₹0 approved so far + ₹500 = ₹500, under the cap. Approved at once.
- **HR gives ₹500 again:** ₹500 + ₹500 = ₹1,000, at the cap. Approved at once.
- **The Production Head requests ₹800; HR approves ₹800:** ₹1,000 + ₹800 = ₹1,800, over the cap. It goes to the **Company Admin**. If they approve, November's payroll pays ₹1,800 in all.
- **The Company Admin gives ₹2,000 themselves:** approved at once, with no cap.

## 5. Not in this change
- A grade-linked amount (A+ gets ₹X): waits for the client's details (feature 13 decision M).
- A cap on the company's total incentives per month.
- Request buttons for other departments' heads.

## 6. Tests (planned)
- Under, at and over the cap, for HR's give and for HR's approval; the per-month sum, including the payroll month that was picked.
- No cap set → as today. The Company Admin's own give is never capped.
- Above the cap: not paid by payroll until approved; the Company Admin approves (amount or month changed) or rejects; the bells.
- Payroll already run → refused for that month.
- The cap's version: a cap from December leaves November as it was; never a past month.
- Regression: `incentive`, `scorecard`, `payroll`, `mpages`.
