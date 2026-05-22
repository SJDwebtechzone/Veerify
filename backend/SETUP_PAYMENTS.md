# Payment & Email Setup — Veerify Backend

This document walks through the env vars, credentials, and one-time configuration
needed to make the **approve → email → pay → auto-activate** flow work.

## 1. Database migration

Run once, against the same Postgres your backend is using:

```bash
psql "$DATABASE_URL" -f src/db/migrations/002_add_payment_columns.sql
```

Adds these columns to `institutions`:

| Column                  | What it holds                              |
|-------------------------|--------------------------------------------|
| `payment_link_id`       | Razorpay Payment Link id (`plink_xxx`)      |
| `payment_link_url`      | The customer-facing short URL              |
| `payment_link_status`   | `pending` \| `paid` \| `expired` \| `cancelled` |
| `payment_amount`        | Amount in paise (₹ × 100)                  |
| `payment_reference`     | Razorpay payment id after success (`pay_xxx`) |
| `paid_at`               | Timestamp the payment was marked paid       |

The migration is idempotent (`IF NOT EXISTS` everywhere) — safe to re-run.

## 2. Environment variables

Create or extend `backend/.env`:

```dotenv
# ── Gmail SMTP (Nodemailer) ────────────────────────────────────────────────
SMTP_USER=connectwithdevspectra@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx      # 16-char Gmail App Password (see below)
MAIL_FROM_NAME=Veerify Admin
SUPPORT_EMAIL=connectwithdevspectra@gmail.com

# ── Razorpay ──────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=pick-any-long-random-string

# ── App URLs ──────────────────────────────────────────────────────────────
# Where the customer lands after paying (callback_url on the payment link).
APP_BASE_URL=http://localhost:5173
```

Restart the backend after changing env vars (`npm run dev` or `npm start`).

## 3. Get a Gmail App Password

`SMTP_PASS` cannot be your normal Google password — 2FA blocks that. You need an
**App Password**:

1. Make sure 2-Step Verification is ON for the Gmail account
   (https://myaccount.google.com/security).
2. Open https://myaccount.google.com/apppasswords.
3. Choose app: **Mail**, device: **Other → "Veerify backend"**.
4. Google shows a 16-character password. Copy it (no spaces) into `SMTP_PASS`.

If sending fails with "Username and Password not accepted", regenerate the app
password — they expire when you change your main Google password.

## 4. Get Razorpay test keys

1. Sign up at https://dashboard.razorpay.com (free).
2. Stay in **Test Mode** (toggle top-right).
3. Settings → API Keys → **Generate Test Key**.
4. Copy `Key Id` (`rzp_test_…`) and `Key Secret` into your `.env`.

Test mode supports the full Payment Links flow with fake card numbers —
no real money moves. Use card `4111 1111 1111 1111`, any future expiry,
any CVV, OTP `1234` to simulate success.

## 5. Configure the Razorpay webhook

The webhook is what actually flips an institution from `approved` to `active`
once payment lands. Local dev needs a tunnel because Razorpay can't reach
`localhost`.

### a) Expose your local backend with ngrok

```bash
# one-time install (https://ngrok.com/download)
ngrok http 5000
```

ngrok prints a public URL like `https://1a2b3c.ngrok-free.app`. Your webhook
endpoint is then `https://1a2b3c.ngrok-free.app/api/payments/webhook`.

### b) Add the webhook in Razorpay

Dashboard → **Settings → Webhooks → + Add New Webhook**.

| Field        | Value                                                |
|--------------|------------------------------------------------------|
| Webhook URL  | `https://<your-ngrok>.ngrok-free.app/api/payments/webhook` |
| Secret       | The same value as `RAZORPAY_WEBHOOK_SECRET` in `.env`     |
| Active events| **Payment Link → `payment_link.paid`**               |

Save. Razorpay will fire a test ping — your backend should log
`[webhook] invalid signature` only if your `RAZORPAY_WEBHOOK_SECRET` doesn't
match. If signatures match and the event is just a ping, you'll see no DB
change — that's expected.

## 6. End-to-end test

1. Sign up as an institution owner via the mobile app, submit the onboarding
   form.
2. In the admin web, go to **Pending Approvals** → open the institution →
   click **Approve Academy**.
3. The owner should receive an email titled
   `<Academy> approved on Veerify — complete payment to go live` containing
   a "Pay ₹XXX now" button.
4. Owner clicks the link → completes test payment with `4111 1111 1111 1111`.
5. Razorpay fires `payment_link.paid` → your webhook flips the institution to
   `active`, activates the owner user, and emails them
   `🎉 <Academy> is live on Veerify`.
6. Owner opens the mobile app, signs in with their registered credentials,
   and lands in the institution dashboard.

## 7. Going to production

When you switch from `rzp_test_…` to `rzp_live_…`:

- Update `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to live keys.
- Add a **second** webhook in Razorpay using your production domain
  (no ngrok needed). Generate a different `RAZORPAY_WEBHOOK_SECRET` for prod.
- Make sure `APP_BASE_URL` points at your prod admin domain.
- Switch the Gmail account to one that scales (or move to SendGrid / SES —
  Nodemailer transport is one swap).

## 8. Manual fallbacks (when things go wrong)

| Symptom                                              | What to do                                            |
|------------------------------------------------------|-------------------------------------------------------|
| Approval ran but email never arrived                 | Click **Resend Payment Link** in the admin UI.        |
| Owner paid by UPI / bank transfer, no Razorpay link  | Click **Manually Activate** — bypasses the webhook.   |
| Webhook fired but institution still shows `approved` | Check backend logs for `[webhook] no institution matched` — the `payment_link_id` may not have been saved (Razorpay was misconfigured at approve time). Click **Manually Activate**. |
| Razorpay isn't configured but you still need to approve | Approval will succeed with a warning, no link created. Set up Razorpay, then click **Resend Payment Link**. |
