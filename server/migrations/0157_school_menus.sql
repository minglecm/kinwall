-- Published school menus are separate from the family's saved meals. A connector owns each
-- menu's dated contents; one school-wide selection optionally supplies lunch defaults.
CREATE TABLE school_menus (
  id TEXT PRIMARY KEY,
  school_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_school_menus_school ON school_menus(school_contact_id, archived);
CREATE TABLE school_menu_entries (
  menu_id TEXT NOT NULL REFERENCES school_menus(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'not_served')),
  title TEXT,
  description TEXT,
  source_url TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (menu_id, date)
);
CREATE TABLE school_menu_settings (
  school_contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  lunch_menu_id TEXT REFERENCES school_menus(id) ON DELETE SET NULL,
  use_for_meals INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
