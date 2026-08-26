-- Gap fill: widen run pack/flow keys (plan noted varchar(40) too tight for real keys).

ALTER TABLE exec.runs
  ALTER COLUMN pack_id TYPE varchar(120);

ALTER TABLE exec.runs
  ALTER COLUMN flow_id TYPE varchar(120);

INSERT INTO platform.schema_migrations (version) VALUES ('017_pack_id_widen') ON CONFLICT DO NOTHING;
