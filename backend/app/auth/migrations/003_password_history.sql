CREATE TABLE auth_password_history (
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, password_hash)
);

CREATE INDEX auth_password_history_recent_idx
    ON auth_password_history(user_id, created_at DESC);

-- Existing accounts have only their current hash available at migration time.
-- It becomes the first entry in the enforced history; previously discarded
-- passwords cannot be reconstructed or compared safely.
INSERT INTO auth_password_history (user_id, password_hash, created_at)
SELECT id, password_hash, updated_at
FROM auth_users
ON CONFLICT (user_id, password_hash) DO NOTHING;
