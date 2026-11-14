# ValuX Authentication

## Boundary of this phase

PostgreSQL stores identity and access data in the dedicated `auth` schema and
durable business data in the separate `app` schema. Authenticated users share
workflow records, institutions, payments, task-linked drafts, report revisions,
file metadata and estimation snapshots across sessions. Actual generated and
uploaded files use the development local filesystem; browser storage is limited
to appearance/navigation preferences, practice drafts, and temporary recovery
codes during activation.

All identity objects live in the dedicated `auth` schema. The `public` schema
contains no ValuX tables and does not allow general object creation. A
one-shot migration service uses the database owner account; the web process
uses the configured non-superuser role (`valux_app` by default) with only the DML privileges needed
by authentication workflows. The migration ledger is not readable or writable
by the web role.

## Account lifecycle

There is no public registration.

```text
Operator provisions User ID + one-time password
  → user chooses permanent password
  → user enrolls and verifies a TOTP authenticator
  → user saves one-time recovery codes
  → user adds and verifies a recovery email
  → account becomes active
  → every fresh login requires password + TOTP
```

A verified recovery email is mandatory. An active account cannot remove its
only recovery email; replacement-email functionality will verify the new
address before any later change is allowed.

## Operator commands

Run commands from `valuation_app/`.

Provision an account and enter a one-time password without echoing it:

```sh
docker compose exec app python -m backend.app.auth.cli provision \
  --user-id lavk0401 --name "Lavakumar" --role employee
```

Add `--generate-password` to generate and display a one-time password. Share it
privately; it expires after seven days.

Assisted recovery revokes sessions, MFA, recovery codes, tokens and the old
recovery email, then starts the complete activation flow again:

```sh
docker compose exec app python -m backend.app.auth.cli recover \
  --user-id lavk0401 --generate-password
```

Disable or re-enable an account:

```sh
docker compose exec app python -m backend.app.auth.cli disable --user-id lavk0401
docker compose exec app python -m backend.app.auth.cli enable --user-id lavk0401
```

The operator never receives an existing password, TOTP secret or recovery
code. Assisted recovery replaces credentials instead of revealing them.

## Email modes

`EMAIL_MODE=mailpit` is the default regression-test configuration. View the
host-only inbox at <http://127.0.0.1:8026>.

For manual Gmail testing, run:

```sh
python3 scripts/configure_gmail_smtp.py
```

The script defaults to `support.valux@gmail.com`. Enter a Google App Password
created for the selected sender account. The script hides the password,
verifies the SMTP server's TLS certificate, and sends a test message before
updating the ignored, owner-only `.env` and recreating the app container.

Set `APP_BASE_URL` to the address that the recipient device can open, such as
`http://192.168.1.3:4180`. Verification and reset tokens are carried in the URL
fragment so they are not sent in the initial server request or access log.

## LAN development

The app is published on host port 4180. Another device on the same Wi-Fi can
open `http://192.168.1.3:4180` while the Mac is awake, Docker is running and the
firewall permits the connection. PostgreSQL is internal to Docker and Mailpit
is bound to host loopback only.

Plain HTTP is suitable only for development with test accounts. Configure an
HTTPS reverse proxy and set `COOKIE_SECURE=true` before using real employee or
father credentials beyond controlled testing.

## Session and recovery policy

- Sessions use opaque random cookies; only a hash is stored in PostgreSQL.
- Cookies are `HttpOnly`, `SameSite=Lax`, and become `Secure` under HTTPS.
- Idle expiry is 60 minutes; absolute expiry is 24 hours.
- Logout and password reset revoke server-side sessions.
- Signed-in voluntary password changes require the current password and a fresh
  authenticator code. They rotate the current session, revoke all others, record
  an audit event and send a confirmation email. Five failed reauthentication
  attempts lock that session's security verification for 15 minutes.
- My Account identity fields are immutable; only the optional profile photo can
  change. Photo bytes are normalized to a 384px square JPEG in the auth schema
  and served only to their authenticated owner.
- Visible-page notification polling and photo requests do not extend inactivity.
  Trusted keyboard, pointer, input or scroll activity refreshes the session at
  most once a minute; the 24-hour absolute deadline still requires fresh login.
- Password-reset links expire after 30 minutes and are single-use.
- Email-verification links expire after 24 hours and are single-use.
- Five failed logins in 15 minutes trigger a 15-minute lockout.
- Passwords must be 12–128 characters with uppercase, lowercase, numeric and
  symbol characters. The last 5 passwords are retained as hashes and cannot
  be reused. The history begins when this policy is deployed; passwords that
  were discarded before that time cannot be reconstructed safely.
- Five incorrect authenticator codes during one fresh-login or activation
  session trigger a 15-minute MFA lockout.
- Recovery codes are hashed and single-use. Using one starts fresh authenticator
  enrollment and replaces all remaining codes.

## Known recovery limit

If an active user simultaneously loses the verified mailbox, authenticator and
recovery codes, self-service recovery is intentionally impossible. The host
operator must run the assisted-recovery command and verify the user's identity
outside the application.
