-- 聊天室 D1 数据库初始化
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL DEFAULT 'general',
    session_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar_seed TEXT NOT NULL DEFAULT '1',
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_type TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at DESC);
