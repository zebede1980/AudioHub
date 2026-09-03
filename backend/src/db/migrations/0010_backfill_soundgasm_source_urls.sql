-- Backfill source_url for uploader folders the importer created before that column existed.
--
-- Every folder directly under "Soundgasm" was named by startSoundgasmDownload as
-- sanitizeForFilesystem(<account name>), so the account name — and therefore the profile URL —
-- can be read straight back off the folder name.
--
-- Three guards, because this writes to folders it is inferring the origin of rather than knowing it:
--   * source_url IS NULL      — never touch a link the importer or a person already set.
--   * depth = 2 + parent      — only direct children of a "Soundgasm" folder, not nested subfolders.
--   * NOT GLOB '*[^...]*'     — only names made entirely of characters that survive the importer's
--                               sanitizer unchanged, so the folder name really is the account name.
--                               A name containing anything else was not round-trippable and would
--                               produce a dead link, so it is left alone for a human to fill in.
UPDATE folders
SET source_url = 'https://soundgasm.net/u/' || name
WHERE source_url IS NULL
  AND depth = 2
  AND name NOT GLOB '*[^A-Za-z0-9._~-]*'
  AND parent_folder_id IN (SELECT id FROM folders WHERE relative_path = 'Soundgasm');
