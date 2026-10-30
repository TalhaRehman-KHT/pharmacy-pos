PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'salesman',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE medicines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  generic_name  TEXT,
  company       TEXT,
  category      TEXT,
  unit          TEXT DEFAULT 'tablet',
  barcode       TEXT UNIQUE,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id    INTEGER NOT NULL REFERENCES medicines(id),
  batch_no       TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price     REAL NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 0,
  expiry_date    TEXT,
  received_at    TEXT NOT NULL
);

CREATE TABLE sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no     TEXT UNIQUE NOT NULL,
  subtotal       REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  status         TEXT NOT NULL DEFAULT 'completed',
  customer_name  TEXT,
  customer_phone TEXT,
  doctor_name    TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL
);

CREATE TABLE sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  medicine_id   INTEGER NOT NULL REFERENCES medicines(id),
  batch_id      INTEGER REFERENCES batches(id),
  medicine_name TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  unit_price    REAL NOT NULL,
  line_total    REAL NOT NULL
);

CREATE TABLE payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method     TEXT NOT NULL,
  amount     REAL NOT NULL,
  reference  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id   INTEGER NOT NULL REFERENCES batches(id),
  qty_change INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  sale_id    INTEGER REFERENCES sales(id),
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_medicines_name  ON medicines(name);
CREATE INDEX idx_batches_med     ON batches(medicine_id);
CREATE INDEX idx_batches_expiry  ON batches(expiry_date);
CREATE INDEX idx_sales_date      ON sales(created_at);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
