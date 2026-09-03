-- Where a folder's contents came from — for Soundgasm imports, the uploader's profile page.
-- Set automatically by the importer and editable by hand, so a folder built up over several
-- imports (or moved in from elsewhere) can still point back at its source.
--
-- Deliberately survives a rescan: the scanner's folder upsert only touches parent/name/depth/
-- last_seen_at, so this column is never overwritten by a scan that revisits the folder.
ALTER TABLE folders ADD COLUMN source_url TEXT;
