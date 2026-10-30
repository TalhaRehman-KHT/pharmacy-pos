-- Cash handed over by the customer, so a reprinted invoice can show tendered and change.
-- NULL for card payments and for sales saved before this migration.
ALTER TABLE payments ADD COLUMN tendered REAL;

-- Placeholder shop details so invoices print before the Settings screen (Phase 9) exists.
-- OR IGNORE keeps anything already set. An empty printer_name means "export a PDF instead".
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shop_name', 'My Pharmacy'),
  ('shop_address', 'Shop address, City'),
  ('shop_phone', '0300-0000000'),
  ('licence_no', 'DSL-00000'),
  ('invoice_footer', 'Medicines once sold are not returnable without the invoice. Get well soon.'),
  ('printer_name', ''),
  ('invoice_layout', 'thermal');
