CREATE TABLE app.whatsapp_contacts (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_key TEXT NOT NULL UNIQUE,
    phone_encrypted TEXT NOT NULL,
    revision UUID NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opted_in_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    consent_version TEXT
);

CREATE TABLE app.whatsapp_challenges (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    id UUID NOT NULL UNIQUE,
    session_id UUID REFERENCES auth.sessions(id) ON DELETE SET NULL,
    phone_key TEXT,
    phone_encrypted TEXT,
    code_hash TEXT,
    consent BOOLEAN NOT NULL,
    failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    window_count SMALLINT NOT NULL CHECK (window_count BETWEEN 1 AND 5)
);

CREATE TABLE app.whatsapp_outbox (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES app.task_activities(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contact_revision UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'uncertain', 'cancelled')),
    attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sending_at TIMESTAMPTZ,
    provider_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, recipient_id)
);

CREATE INDEX whatsapp_outbox_queue ON app.whatsapp_outbox(next_attempt_at, id) WHERE status = 'queued';
CREATE INDEX whatsapp_outbox_task ON app.whatsapp_outbox(task_id) WHERE status = 'queued';
CREATE INDEX whatsapp_outbox_recipient ON app.whatsapp_outbox(recipient_id) WHERE status = 'queued';
