-- Move the authentication domain out of PostgreSQL's shared public schema.
--
-- This migration is intentionally additive and data preserving.  It supports
-- databases created by migrations 001-004 and is also run during a clean
-- bootstrap after those migrations have created their legacy table names.

CREATE SCHEMA IF NOT EXISTS auth;

ALTER TABLE public.auth_users SET SCHEMA auth;
ALTER TABLE public.auth_sessions SET SCHEMA auth;
ALTER TABLE public.auth_mfa_credentials SET SCHEMA auth;
ALTER TABLE public.auth_recovery_codes SET SCHEMA auth;
ALTER TABLE public.auth_account_tokens SET SCHEMA auth;
ALTER TABLE public.auth_login_attempts SET SCHEMA auth;
ALTER TABLE public.auth_audit_events SET SCHEMA auth;
ALTER TABLE public.auth_password_history SET SCHEMA auth;

ALTER TABLE auth.auth_users RENAME TO users;
ALTER TABLE auth.auth_sessions RENAME TO sessions;
ALTER TABLE auth.auth_mfa_credentials RENAME TO mfa_credentials;
ALTER TABLE auth.auth_recovery_codes RENAME TO recovery_codes;
ALTER TABLE auth.auth_account_tokens RENAME TO account_tokens;
ALTER TABLE auth.auth_login_attempts RENAME TO login_attempts;
ALTER TABLE auth.auth_audit_events RENAME TO audit_events;
ALTER TABLE auth.auth_password_history RENAME TO password_history;

ALTER TABLE auth.users RENAME CONSTRAINT auth_users_pkey TO users_pkey;
ALTER TABLE auth.users RENAME CONSTRAINT auth_users_user_id_key TO users_user_id_key;
ALTER TABLE auth.users RENAME CONSTRAINT auth_users_email_key TO users_email_key;
ALTER TABLE auth.users RENAME CONSTRAINT auth_users_role_check TO users_role_check;
ALTER TABLE auth.users RENAME CONSTRAINT auth_users_status_check TO users_status_check;

ALTER TABLE auth.sessions RENAME CONSTRAINT auth_sessions_pkey TO sessions_pkey;
ALTER TABLE auth.sessions RENAME CONSTRAINT auth_sessions_token_hash_key TO sessions_token_hash_key;
ALTER TABLE auth.sessions RENAME CONSTRAINT auth_sessions_scope_check TO sessions_scope_check;
ALTER TABLE auth.sessions RENAME CONSTRAINT auth_sessions_user_id_fkey TO sessions_user_id_fkey;

ALTER TABLE auth.mfa_credentials RENAME CONSTRAINT auth_mfa_credentials_pkey TO mfa_credentials_pkey;
ALTER TABLE auth.mfa_credentials RENAME CONSTRAINT auth_mfa_credentials_user_id_fkey TO mfa_credentials_user_id_fkey;

ALTER TABLE auth.recovery_codes RENAME CONSTRAINT auth_recovery_codes_pkey TO recovery_codes_pkey;
ALTER TABLE auth.recovery_codes RENAME CONSTRAINT auth_recovery_codes_user_id_code_hash_key TO recovery_codes_user_id_code_hash_key;
ALTER TABLE auth.recovery_codes RENAME CONSTRAINT auth_recovery_codes_user_id_fkey TO recovery_codes_user_id_fkey;

ALTER TABLE auth.account_tokens RENAME CONSTRAINT auth_account_tokens_pkey TO account_tokens_pkey;
ALTER TABLE auth.account_tokens RENAME CONSTRAINT auth_account_tokens_token_hash_key TO account_tokens_token_hash_key;
ALTER TABLE auth.account_tokens RENAME CONSTRAINT auth_account_tokens_token_type_check TO account_tokens_token_type_check;
ALTER TABLE auth.account_tokens RENAME CONSTRAINT auth_account_tokens_user_id_fkey TO account_tokens_user_id_fkey;

ALTER TABLE auth.login_attempts RENAME CONSTRAINT auth_login_attempts_pkey TO login_attempts_pkey;
ALTER TABLE auth.login_attempts RENAME CONSTRAINT auth_login_attempts_user_id_fkey TO login_attempts_user_id_fkey;

ALTER TABLE auth.audit_events RENAME CONSTRAINT auth_audit_events_pkey TO audit_events_pkey;
ALTER TABLE auth.audit_events RENAME CONSTRAINT auth_audit_events_user_id_fkey TO audit_events_user_id_fkey;

ALTER TABLE auth.password_history RENAME CONSTRAINT auth_password_history_pkey TO password_history_pkey;
ALTER TABLE auth.password_history RENAME CONSTRAINT auth_password_history_user_id_fkey TO password_history_user_id_fkey;

ALTER INDEX auth.auth_users_pending_email_unique RENAME TO users_pending_email_unique;
ALTER INDEX auth.auth_sessions_user_idx RENAME TO sessions_user_idx;
ALTER INDEX auth.auth_sessions_expiry_idx RENAME TO sessions_expiry_idx;
ALTER INDEX auth.auth_tokens_user_type_idx RENAME TO account_tokens_user_type_idx;
ALTER INDEX auth.auth_login_attempts_identifier_idx RENAME TO login_attempts_identifier_idx;
ALTER INDEX auth.auth_audit_user_idx RENAME TO audit_events_user_idx;
ALTER INDEX auth.auth_password_history_recent_idx RENAME TO password_history_recent_idx;

COMMENT ON SCHEMA auth IS 'ValSphere identity, authentication, session, and access-audit data';
