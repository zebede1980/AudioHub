-- Longest run of the same sentence repeated back to back, recorded when a transcript is written.
-- Lets the UI flag a transcript degraded by whisper's repetition spiral instead of presenting it
-- as if it were sound. NULL means "written before this was measured", not "clean".
ALTER TABLE transcripts ADD COLUMN repeat_run INTEGER;
