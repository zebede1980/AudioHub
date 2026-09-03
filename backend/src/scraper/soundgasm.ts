const SOUNDGASM_HOST = "soundgasm.net";
const SOUNDGASM_MEDIA_HOST_SUFFIX = ".soundgasm.net";
const USER_AGENT = "Mozilla/5.0 (compatible; AudioHub/1.0; personal library import)";

export interface SoundgasmPost {
  title: string;
  postUrl: string;
}

/** The canonical profile page for an uploader — what an imported folder records as its source. */
export function profileUrlFor(username: string): string {
  return `https://${SOUNDGASM_HOST}/u/${username}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Throws if profileUrl isn't a soundgasm.net user profile URL — this endpoint must never be usable to fetch arbitrary URLs. */
export function parseProfileUrl(profileUrl: string): { username: string; canonicalUrl: string } {
  let parsed: URL;
  try {
    parsed = new URL(profileUrl);
  } catch {
    throw new Error("not a valid URL");
  }
  if (parsed.hostname !== SOUNDGASM_HOST) {
    throw new Error("only soundgasm.net profile URLs are supported");
  }
  const match = parsed.pathname.match(/^\/u\/([^/]+)\/?$/);
  if (!match) {
    throw new Error("expected a profile URL like https://soundgasm.net/u/<username>");
  }
  const username = match[1];
  return { username, canonicalUrl: `https://${SOUNDGASM_HOST}/u/${username}` };
}

export async function listSoundgasmPosts(profileUrl: string): Promise<{ username: string; posts: SoundgasmPost[] }> {
  const { username: requestedUsername, canonicalUrl } = parseProfileUrl(profileUrl);

  const res = await fetch(canonicalUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`profile page returned ${res.status}`);
  const html = await res.text();

  const posts: SoundgasmPost[] = [];
  // Soundgasm's own username casing (as embedded in each post link) can differ from whatever
  // casing the profile URL happened to be typed in — its profile routing is case-insensitive,
  // so we read the canonical casing back off the page rather than assuming the input matches.
  let username = requestedUsername;
  const blockRegex = new RegExp(
    `<div class="sound-details"><a href="(https://${SOUNDGASM_HOST}/u/([^/"]+)/[^"]*)">([^<]*)</a>`,
    "gi"
  );
  for (const m of html.matchAll(blockRegex)) {
    const postUrl = m[1];
    username = m[2];
    const title = decodeHtmlEntities(m[3]).trim();
    posts.push({ title, postUrl });
  }

  if (posts.length === 0) {
    throw new Error("no posts found on this profile — it may be empty, private, or the page layout changed");
  }

  return { username, posts };
}

/** Resolves a single post URL (not necessarily listed on its profile page) to its title and username. */
export async function resolveSoundgasmPost(postUrl: string): Promise<{ username: string; post: SoundgasmPost }> {
  const { canonicalUrl, username } = parsePostUrl(postUrl);

  const res = await fetch(canonicalUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`post page returned ${res.status}`);
  const html = await res.text();

  const match = html.match(/<div class="jp-title"[^>]*>([^<]*)<\/div>/i);
  if (!match) throw new Error("could not find a title on this post — the page layout may have changed");
  const title = decodeHtmlEntities(match[1]).trim();

  return { username, post: { title, postUrl: canonicalUrl } };
}

export async function extractAudioUrl(postUrl: string): Promise<string> {
  const { canonicalUrl } = parsePostUrl(postUrl);

  const res = await fetch(canonicalUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`post page returned ${res.status}`);
  const html = await res.text();

  const match = html.match(/m4a:\s*"([^"]+)"/);
  if (!match) throw new Error("could not find an audio URL on this post — the page layout may have changed");
  const audioUrl = match[1];

  let parsedAudio: URL;
  try {
    parsedAudio = new URL(audioUrl);
  } catch {
    throw new Error("audio URL on the post page was not a valid URL");
  }
  if (!parsedAudio.hostname.endsWith(SOUNDGASM_MEDIA_HOST_SUFFIX)) {
    throw new Error("audio URL was not hosted on soundgasm.net — refusing to download");
  }

  return audioUrl;
}

function parsePostUrl(postUrl: string): { canonicalUrl: string; username: string } {
  let parsed: URL;
  try {
    parsed = new URL(postUrl);
  } catch {
    throw new Error("not a valid post URL");
  }
  if (parsed.hostname !== SOUNDGASM_HOST) {
    throw new Error("only soundgasm.net post URLs are supported");
  }
  const match = parsed.pathname.match(/^\/u\/([^/]+)\/([^/]+)\/?$/);
  if (!match) {
    throw new Error("expected a post URL like https://soundgasm.net/u/<username>/<title>");
  }
  return { canonicalUrl: `https://${SOUNDGASM_HOST}${parsed.pathname}`, username: match[1] };
}
