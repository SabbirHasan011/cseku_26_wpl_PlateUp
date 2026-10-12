# PlateUp platform income and restaurant billing

PlateUp charges restaurants **10% of the final discounted order total** when a new
reservation completes verified pickup. The customer still pays the restaurant;
there is no extra customer fee or payment gateway. Original/minimum food prices
remain customer-facing values. Restaurant proceeds after the service fee equal
the sale total minus commission, before other expenses. Previous completed orders
are also included at the same 10% rate.

## Run and create the platform owner

Run `npm run db:migrate`, then restart with `npm start`. Migration 008 adds an
order rate snapshot, `billing_invoices`, `platform_commissions` and
`billing_payments`. Migration 009 applies the requested 10% policy to existing
orders, recalculates existing commission entries and adds missing entries for all
previous completed orders. Existing customer order totals, sales data, inventory
and payment/audit records are preserved. Pending orders are updated to 10% but
incur a fee only when completed; cancelled/rejected/expired orders have no fee.
Rerunning the migration does not duplicate charges or receipts. New reservations
snapshot 1000 basis points (10%); clients cannot choose the rate. The rate is a
prototype policy constant in `server/billing.js` and the database default.

Historical charges use the original Bangladesh completion month. For older orders
without a pickup timestamp, migration uses the linked sales timestamp, then the
order's update/order/creation timestamps. Legacy timestamps are interpreted as
Bangladesh wall-clock time. Existing charge titles, sale totals, completion dates,
invoice assignments and receipts remain intact; changing 5% to 10% increases the
outstanding fee if the old fee had already been paid. No payment is invented.
Leave the admin month filter empty to see all historical completed platform sales.
Imported/self-reported ML training history is not a platform transaction or income.

Administrators are created only through the local CLI. There is no public admin
signup, default password or automatic promotion of existing users. In PowerShell,
replace the email below with your own and enter a password when prompted:

```powershell
$billingAdminSecret = Read-Host 'Choose an admin password' -AsSecureString
$billingAdminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($billingAdminSecret)
try {
  $env:PLATEUP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($billingAdminPointer)
  npm run admin:create -- --email sabbirfahim@plateup.com --name "PlateUp Admin"
} finally {
  Remove-Item Env:PLATEUP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($billingAdminPointer)
}
```

Password rules: at least 8 characters, at most 72 UTF-8 bytes. The tool uses the
existing bcrypt hashing and never prints or stores the plaintext password. Sign
in at **http://localhost:5000/admin/login**, then access `/admin`. The public
customer/business form has no admin option, and `/api/auth/login` cannot sign in
an admin. The dedicated `POST /api/auth/admin/login` always checks the admin role;
there is no admin registration API. JWT authentication, active account checks and
password-change/recovery mechanisms are reused. Visiting `/admin` without an
account redirects to the separate admin sign-in screen. Admin logout and password
changes return to that screen. Existing admin accounts continue to work.

Administrator sign-in allows up to 5 attempts per IP/email combination and 30
attempts per IP in 15 minutes. Success resets the email counter; the IP counter
still applies. Responses do not reveal whether an email exists. Limits are held
in this Node process and reset on restart; multiple server instances would need
a shared limiter. Behind a proxy, configure trusted proxy handling deliberately
before deployment so IP limits identify clients correctly. The separate URL is
not a security boundary: backend role checks protect every administration API.

## Demonstration workflow

1. Create a new restaurant order and complete pickup with the existing code flow.
2. A ৳200 completed sale generates a ৳20 fee and ৳180 after commission.
3. As the restaurant, open **Billing & invoices** (`/business/billing`). View
   all completed sales, charges, fees paid, outstanding balances
   and each monthly statement's order lines and payment records.
4. As Admin, view `/admin`. The report separates commission earned from actual
   receipts, outstanding fees and demo receipts. Filter by month or leave it
   empty for all periods. Open a restaurant statement.
5. Choose **Demo** to show a simulated payment. It is explicitly labelled,
   never counts as actual money received and does not settle the real balance.
6. To record an actual offline payment, verify the bank/mobile transfer or cash
   receipt, select **Verified actual receipt**, enter amount, method, unique
   reference and date, and confirm verification. Partial payments are supported.
7. Both roles can download a statement CSV. Mistakes can be voided by Admin with
   a reason; the original receipt and actor remain in the audit history.

Set optional `BILLING_PAYMENT_INSTRUCTIONS` in `.env` to give restaurants your
actual settlement instructions, then restart. The default asks them to arrange
payment with the platform owner. No bank/mobile account or real money movement is
invented or configured automatically.

## Accounting rules

- Fees accrue only after completed pickup, in the same transaction as order
  completion and sales recording. Pending, cancelled, rejected and expired orders
  do not incur fees. An order-unique constraint prevents duplicate charges.
- Commission uses PostgreSQL NUMERIC and rounds each order's fee to two decimal
  places. Food prices stay whole taka; service-fee/payment amounts may include paisa.
- The completion month in **Asia/Dhaka** determines the monthly statement. The
  current month is an interim statement and can accrue more fees. Closed months
  become monthly invoices automatically on reads; no scheduled job is needed.
- Payments can be recorded against current accrued fees or closed invoices. Paid
  current-month statements may become outstanding again as more sales complete.
- Statements aggregate fee snapshots rather than current item prices. Existing
  reservations keep their agreed totals. Historical title, gross amount, rate and
  fee are retained per charge.
- Commission earned/owed is not cash received. Demo receipts are a separate stream.
  Only non-voided, administrator-recorded **real** receipts reduce actual balances.
- Payment type is mandatory. Real receipts require explicit verification. Receipt
  dates must have a timezone, be in the past, and not precede the statement.
- Invoice row locks serialize receipts and corrections, preventing concurrent
  overpayment. Amounts must be positive with at most two decimal places. References
  are unique per type/method even across restaurants, including voided receipts.
- Businesses can read only their own statements. Only admins can record/void
  payments or access platform-wide revenue. CSV output escapes spreadsheet formulas.
- Financial references use restrictive foreign keys; ordinary deactivation preserves
  billing records. Test cleanup explicitly deletes only disposable fixture records.

## API and implementation files

| Endpoint | Access / function |
| --- | --- |
| `GET /api/business/billing?month=YYYY-MM` | Business, own totals and statements |
| `GET /api/business/billing/invoices/:id` | Business, own statement lines and receipts |
| `GET /api/admin/revenue?month=YYYY-MM` | Admin, platform totals and statements |
| `GET /api/admin/billing/invoices/:id` | Admin, statement details |
| `POST /api/admin/billing/invoices/:id/payments` | Admin, record `amount`, `kind`, `method`, `reference`, `note`, `received_at`, `verified` |
| `POST /api/admin/billing/payments/:id/void` | Admin, correction with `reason` |

Core additions are `server/billing.js`, migrations 008–009, `tools/create-admin.js`,
`frontend/js/billing.js` and `frontend/views/admin.html`. Existing server order
completion/migration scripts, frontend auth/router/URLs/views/actions/state,
business navigation, polling and CSS connect these features. `.env.example`,
`package.json` and README document setup. Backend/frontend/static tests cover
authorization, exact fees, receipt separation, concurrency, correction and routing.

This implements manual offline receipt accounting, not automatic payment collection,
subscriptions, tax calculation, gateway reconciliation or order refunds. Recording
an actual receipt is an administrator's assertion, not independent bank verification.
No sample income is injected into production data. A demo account/order still needs
to go through the existing customer/business workflow.
