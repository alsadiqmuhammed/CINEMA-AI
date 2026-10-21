-- Uploaded images live in the database so they survive redeploys on hosts without a persistent disk.
CREATE TABLE uploads (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL,
  data          BYTEA NOT NULL,
  size          INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
