# Department mailboxes — every email uses its own, and says so when it's missing

*2026-10-29. Asked by you after the QC-results email: "a department should use its own mail; if none is
set, give an error telling them to ask the Super Admin".*

## How it works

Super Admin → Admin Settings → **SMTP Settings** holds **one mailbox per department**, shared by every
company on the platform (Sales, Accounts, Purchase, HR, Info (support), Cash Access). Every email the
app sends picks **its own department's** mailbox — never another department's, never a default.

| Email | Department mailbox |
|---|---|
| Quotation to a customer, meeting invite to a lead | Sales |
| Customer payment reminders (button + daily automatic) | Accounts |
| PO (with PDF), quotation requests, RFQ, PO cancellation, 6 pm QC results | Purchase |
| Task assigned, training (staged / passed / rejected) | HR |
| Complaint / service emails (ticket created, assigned, cancelled, verification…) | Info (support) |
| Cash Access OTP to the Company Admin | Cash Access |
| "Send email" (e.g. from a Lead) | the one chosen |

## What was wrong (found 2026-10-29)

1. **Four kinds of email never went out, even with the mailbox set** — task emails, training emails,
   meeting invites and complaint/service emails asked for the mailbox with the company id in the
   department's place, so the lookup always came back empty and the email was silently skipped.
2. **Payment reminder button said "Reminder email sent"** (and logged it as sent) when the Accounts
   mailbox wasn't set. The daily automatic reminders logged unsent reminders as sent too, so they were
   never tried again.
3. **Missing mailbox was silent** for meeting invites, tasks, training and complaint emails; the
   quotation email said only "Failed to send quotation".
4. **A second mailbox could be added for a department that already had one** — never used (the first
   always wins). On dev, accounts@samtekmachinery.com sits under **Sales** this way, and **Accounts has
   no mailbox**.

## Now

- **One message everywhere:** "The <Department> email isn't set up yet. Ask your Super Admin to set it
  in Admin Settings → SMTP Settings."
- **Emails you ask for** (quotation, payment reminder button, Send email, PO Send / Resend, quotation
  requests, Cash Access OTP): refused with that message; nothing is logged as sent.
- **Actions that send an email on the side** (schedule a meeting, create a task, training stage / pass
  / reject, complaint ticket actions): the action is **saved**, and a red toast says "Saved — but the
  email was not sent" with that message. (Server replies carry `emailWarning`; the app shows it for
  every page in one place.)
- **Automatic emails** (6 pm QC results, daily payment reminders, the PO email after creation /
  approval, PO cancellation): nobody is on screen, so the **department head gets one bell per day**:
  "<what> couldn't be sent. The <Dept> email isn't set up yet…" — Purchase / Accounts → Accounts Head,
  Sales → Sales Head, HR → HR-Admin, Info → Complaint Management Head. They're tried again the next run.
- **SMTP Settings:** a department that already has a mailbox can't be added again — it shows "(already
  set — delete it below to replace)" in the list, and the server refuses it too.

## To do on dev (Super Admin) — DONE 2026-10-29 (you)

- ~~Delete the second **Sales** entry (accounts@samtekmachinery.com) and add it again with Department
  **Accounts**~~ — done.
- ~~HR, Info (support) and Cash Access mailboxes~~ — done.

## Changed

Backend: `config/mailAccounts.js` (`mailboxMissingMessage`, `mailboxWarning`, `reportMissingMailbox`),
`utils/taskEmail.js`, `utils/trainingEmail.js`, `utils/serviceEmail.js`, `meetingController`,
`hrmsTaskManagement`, `TrainingManagementController`, `ComplaintServiceController`, `salesController`
(quotation), `paymentReminderController` (button + cron), `emailService` (wording), `emailController`,
`purchaseController` / `poCancellationService` / `qcVendorEmailService` (bells),
`adminSettingsController` (one per department).
Frontend: `lib/emailWarning.ts` (new), `lib/queryClient.ts`, `api/complaintApi.ts`, `api/trainingApi.ts`,
`api/taskManagementApi.ts`, `pages/admin/AdminSettings.jsx`.

## Tested

With the dev database's real mailbox settings (Purchase + Sales set; Accounts, HR, Info, Cash Access
not) — nothing changed in them, no email sent; made-up company, 0 left. 15 checks: the department
lookup works and the old (company id, department) form never did; no broken call left in the 4 files;
the message; HR warning present / Purchase none; the payment reminder button refuses with the
Accounts message and logs nothing; the automatic reminder gets the same answer; bells — one per
department per company per day, to the Accounts Head, none without a company. Everything loads under
ts-node; the frontend files build.
**Not tested by running:** the SMTP Settings duplicate refusal (it would write to the platform's real
settings if wrong) — checked by reading; please try adding a second Sales mailbox in the browser.
