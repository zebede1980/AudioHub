import { parseFile } from "music-metadata";

export interface AudioTags {
  durationSec: number | null;
  tagTitle: string | null;
  tagArtist: string | null;
  tagAlbum: string | null;
  tagTrack: number | null;
  tagGenre: string | null;
  /** Raw embedded picture bytes/mime, if present, for cover extraction. */
  picture: { data: Buffer; format: string } | null;
}

const EMPTY_TAGS: AudioTags = {
  durationSec: null,
  tagTitle: null,
  tagArtist: null,
  tagAlbum: null,
  tagTrack: null,
  tagGenre: null,
  picture: null,
};

export async function readAudioTags(absolutePath: string): Promise<AudioTags> {
  try {
    const meta = await parseFile(absolutePath, { duration: true, skipCovers: false });
    const picture = meta.common.picture?.[0];
    return {
      durationSec: meta.format.duration ?? null,
      tagTitle: meta.common.title ?? null,
      tagArtist: meta.common.artist ?? null,
      tagAlbum: meta.common.album ?? null,
      tagTrack: meta.common.track?.no ?? null,
      tagGenre: meta.common.genre?.[0] ?? null,
      picture: picture ? { data: Buffer.from(picture.data), format: picture.format } : null,
    };
  } catch {
    // Corrupt/unsupported file: still index it by filename, just without tag-derived data.
    return EMPTY_TAGS;
  }
}
