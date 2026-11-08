ALTER TABLE auth.users
    ADD COLUMN profile_photo BYTEA,
    ADD COLUMN profile_photo_updated_at TIMESTAMPTZ;

ALTER TABLE auth.mfa_credentials
    ADD COLUMN last_account_totp_counter BIGINT;
