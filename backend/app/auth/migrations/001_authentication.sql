CREATE TABLE auth_users (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('father', 'employee')),
    status TEXT NOT NULL DEFAULT 'provisioned'
        CHECK (status IN ('provisioned', 'activating', 'active', 'disabled')),
    password_hash TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    activation_expires_at TIMESTAMPTZ,
    email TEXT UNIQUE,
    pending_email TEXT,
    email_verified_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_pending_email_unique
    ON auth_users(LOWER(pending_email)) WHERE pending_email IS NOT NULL;

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('activation', 'mfa', 'full')),
    activation_step TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE auth_mfa_credentials (
    user_id UUID PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_recovery_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, code_hash)
);

CREATE TABLE auth_account_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_type TEXT NOT NULL CHECK (token_type IN ('email_verification', 'password_reset')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    target_email TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_tokens_user_type_idx ON auth_account_tokens(user_id, token_type);

CREATE TABLE auth_login_attempts (
    id UUID PRIMARY KEY,
    identifier_hash CHAR(64) NOT NULL,
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    ip_address TEXT,
    succeeded BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_login_attempts_identifier_idx
    ON auth_login_attempts(identifier_hash, attempted_at);

CREATE TABLE auth_audit_events (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    actor TEXT,
    ip_address TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_audit_user_idx ON auth_audit_events(user_id, created_at);
