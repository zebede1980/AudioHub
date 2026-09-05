const SOUNDGASM_HOST = "soundgasm.net";
const SOUNDGASM_MEDIA_HOST_SUFFIX = ".soundgasm.net";
const USER_AGENT = "Mozilla/5.0 (compatible; AudioHub/1.0; personal library import)";

export interface SoundgasmPost {
  title: string;
  postUrl: string;
  /** The uploader's blurb under the title on the profile page. Often absent, and often several
   * lines long — tags, script credits, content notes — so it is shown on hover, not inline. */
  description?: string;
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

/** What a soundgasm username may contain — the charset a bare-username input is held to before
 * it is pasted into a URL, so this endpoint can never be talked into fetching somewhere else. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Resolves whatever the user typed into a soundgasm profile, or throws — this endpoint must
 * never be usable to fetch arbitrary URLs. Accepts, in order of how people actually type it:
 * a bare username, a host-only paste with no scheme, a profile URL, and a URL to a single post
 * (which resolves to the uploader's profile — the whole point of pasting one is "more like this").
 */
export function parseProfileUrl(profileUrl: string): { username: string; canonicalUrl: string } {
  const input = profileUrl.trim();
  if (!input) throw new Error("enter a soundgasm profile URL or username");

  // A bare username, which is all most people have to hand — the rest of the URL is boilerplate.
  if (USERNAME_PATTERN.test(input)) return canonicalProfile(input);

  let parsed: URL;
  try {
    // "soundgasm.net/u/name" is a URL to everyone except the URL parser; assume https.
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("not a valid URL");
  }
  const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (hostname !== SOUNDGASM_HOST) {
    throw new Error("only soundgasm.net profile URLs are supported");
  }
  // Anything after the username is a post (or deeper) — drop it and keep the uploader.
  const match = parsed.pathname.match(/^\/u\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    throw new Error("expected a profile URL like https://soundgasm.net/u/<username>");
  }
  return canonicalProfile(match[1]);
}

function canonicalProfile(username: string): { username: string; canonicalUrl: string } {
  return { username, canonicalUrl: profileUrlFor(username) };
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
  // The description span follows the title link inside the same block, separated by a line break.
  // Optional in the pattern: a post with no blurb still renders the (empty) span, but treating it
  // as required would silently drop any post whose markup differs.
  const blockRegex = new RegExp(
    `<div class="sound-details"><a href="(https://${SOUNDGASM_HOST}/u/([^/"]+)/[^"]*)">([^<]*)</a>` +
      `(?:\\s*</?br\\s*/?>\\s*<span class="soundDescription">([^<]*)</span>)?`,
    "gi"
  );
  for (const m of html.matchAll(blockRegex)) {
    const postUrl = m[1];
    username = m[2];
    const title = decodeHtmlEntities(m[3]).trim();
    const description = decodeHtmlEntities(m[4] ?? "").trim();
    posts.push(description ? { title, postUrl, description } : { title, postUrl });
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
