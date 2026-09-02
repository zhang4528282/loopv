-- 系统设置表（邀请码等）
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_code', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_code_enabled', '0');
