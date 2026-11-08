CREATE TABLE app.notifications (
    id UUID PRIMARY KEY,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
    activity_id UUID NOT NULL REFERENCES app.task_activities(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (recipient_user_id, activity_id)
);
CREATE INDEX notifications_recipient_idx
    ON app.notifications (recipient_user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx
    ON app.notifications (recipient_user_id) WHERE read_at IS NULL;
