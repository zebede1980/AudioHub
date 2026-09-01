export interface ParsedName {
  title: string;
  trackNumber: number | null;
}

const TRACK_PATTERNS: RegExp[] = [
  /^\s*chapter\s*0*(\d{1,4})\b[\s._-]*/i,
  /^\s*ch\.?\s*0*(\d{1,4})\b[\s._-]*/i,
  /^\s*track\s*0*(\d{1,4})\b[\s._-]*/i,
  /^\s*part\s*0*(\d{1,4})\b[\s._-]*/i,
  /^\s*0*(\d{1,4})[\s._-]+/,
];

/** Replace underscores/dots used as word separators with spaces, and tidy whitespace. */
function deslugify(raw: string): string {
  let s = raw;
  // Dots between words (not part of an ellipsis or a real sentence) read as separators when there are no spaces at all.
  if (!s.includes(" ") && (s.includes("_") || s.includes("."))) {
    s = s.replace(/[._]+/g, " ");
  } else {
    s = s.replace(/_+/g, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Derive a display title and track/chapter number from a bare filename (no extension).
 * Tags are usually absent for this library, so filename convention is the primary signal.
 */
export function parseFilename(filenameNoExt: string): ParsedName {
  let remainder = filenameNoExt;
  let trackNumber: number | null = null;

  for (const pattern of TRACK_PATTERNS) {
    const match = remainder.match(pattern);
    if (match) {
      trackNumber = Number.parseInt(match[1], 10);
      remainder = remainder.slice(match[0].length);
      break;
    }
  }

  // Also catch a trailing " - 03" style track marker if no leading one was found.
  if (trackNumber === null) {
    const trailing = remainder.match(/[\s._-]0*(\d{1,4})\s*$/);
    if (trailing) {
      trackNumber = Number.parseInt(trailing[1], 10);
      remainder = remainder.slice(0, trailing.index);
    }
  }

  const title = deslugify(remainder) || deslugify(filenameNoExt);

  return { title, trackNumber };
}

export interface FolderContext {
  /** Author/show — derived from the folder two levels above the file, when it exists and isn't the library root. */
  parsedAuthor: string | null;
  /** Book/series/album — derived from the immediate parent folder. */
  parsedSeriesOrBook: string | null;
}

/**
 * ancestorFolderNames is ordered root-first, e.g. ["Brandon Sanderson", "Mistborn Book 1"]
 * for a file at "Brandon Sanderson/Mistborn Book 1/01 Prologue.mp3".
 */
export function deriveFolderContext(ancestorFolderNames: string[]): FolderContext {
  const depth = ancestorFolderNames.length;
  if (depth === 0) {
    return { parsedAuthor: null, parsedSeriesOrBook: null };
  }
  if (depth === 1) {
    return { parsedAuthor: null, parsedSeriesOrBook: deslugify(ancestorFolderNames[0]) };
  }
  const parent = ancestorFolderNames[depth - 1];
  const grandparent = ancestorFolderNames[depth - 2];
  return {
    parsedAuthor: deslugify(grandparent),
    parsedSeriesOrBook: deslugify(parent),
  };
}
