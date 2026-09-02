import { rawDb } from "./client.js";

export interface FileTagSummary {
  id: number;
  name: string;
}

// Batch-fetches tags for a set of file ids, keyed by fileId, so listing endpoints (folder
// browsing, search) can attach tags without an N+1 query per row.
export function tagsByFileId(fileIds: number[]): Map<number, FileTagSummary[]> {
  const map = new Map<number, FileTagSummary[]>();
  if (fileIds.length === 0) return map;

  const placeholders = fileIds.map(() => "?").join(",");
  const rows = rawDb
    .prepare(
      `SELECT ft.file_id as fileId, t.id, t.name
       FROM file_tags ft
       JOIN tags t ON t.id = ft.tag_id
       WHERE ft.file_id IN (${placeholders})
       ORDER BY t.name`
    )
    .all(...fileIds) as { fileId: number; id: number; name: string }[];

  for (const row of rows) {
    const list = map.get(row.fileId);
    if (list) list.push({ id: row.id, name: row.name });
    else map.set(row.fileId, [{ id: row.id, name: row.name }]);
  }
  return map;
}
