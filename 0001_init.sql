-- 物流管理支援システム D1 初期スキーマ
-- 適用: npx wrangler d1 migrations apply qr-regen-print-db --remote

-- QRレコード（localStorage の logistics_v4_data と対応）
-- ・image（QR画像）は保存しない。url から再生成できるため。
-- ・端末ごとに別々のUUIDを持つので、スマホとPCのデータが同じ表に集まる。
-- ・削除は deleted_at を入れる論理削除（誤削除時にD1から復元できるように）。
CREATE TABLE IF NOT EXISTS qr_records (
  id                   TEXT PRIMARY KEY,
  qr_key               TEXT NOT NULL,
  url                  TEXT NOT NULL,
  delivery_date        TEXT NOT NULL DEFAULT '',
  main_name            TEXT NOT NULL DEFAULT '',
  hall                 TEXT NOT NULL DEFAULT '',
  product              TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'unprinted',
  assignment_completed INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT,
  scanned_at           TEXT,
  sent_at              TEXT,
  printed_at           TEXT,
  print_batch_id       TEXT,
  deleted_at           TEXT,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_records_qr_key  ON qr_records (qr_key);
CREATE INDEX IF NOT EXISTS idx_qr_records_status  ON qr_records (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_qr_records_hall    ON qr_records (hall, delivery_date);

-- 本社名 / ホール名マスタ（logistics_v4_halls）
CREATE TABLE IF NOT EXISTS halls (
  position  INTEGER PRIMARY KEY,
  main_name TEXT NOT NULL,
  hall      TEXT NOT NULL
);

-- 商品名の候補（logistics_v4_products）
CREATE TABLE IF NOT EXISTS products (
  name TEXT PRIMARY KEY
);
