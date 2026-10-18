CREATE UNIQUE INDEX IF NOT EXISTS auth_users_pending_email_unique
    ON auth_users(LOWER(pending_email)) WHERE pending_email IS NOT NULL;
