import test from "node:test";
import assert from "node:assert/strict";
import { parsePostTitle, parseProfilePosts } from "../src/scraper/soundgasm.js";

/**
 * Soundgasm renders uploader-written titles and blurbs into the page raw, so a bare "<" reaches
 * the markup unescaped — a title ending "<3" is common. The patterns here used to capture
 * "everything up to the next <", which made such a post unparseable: the single-post import
 * failed outright, and on a profile listing the post was silently skipped, so it never even
 * appeared as available to import.
 */

const POST_PAGE = `
<html><body>
  <div class="jp-title" aria-label="title">[F4M] Wake up, babyboy~ &amp; good morning &lt;3 <3</div>
  <script>m4a: "https://media.soundgasm.net/sounds/abc123.m4a"</script>
</body></html>`;

function profilePage(...blocks: string[]): string {
  return `<html><body>${blocks.join("\n")}</body></html>`;
}

function block(slug: string, title: string, description = ""): string {
  return (
    `<div class="sound-details"><a href="https://soundgasm.net/u/nevvrotik/${slug}">${title}</a>` +
    `<br><span class="soundDescription">${description}</span></div>`
  );
}

test("a post title containing a bare < is read in full", () => {
  assert.equal(parsePostTitle(POST_PAGE), "[F4M] Wake up, babyboy~ & good morning <3 <3");
});

test("a post title is still read when the div carries no extra attributes", () => {
  assert.equal(parsePostTitle(`<div class="jp-title">Plain title</div>`), "Plain title");
});

test("a missing title is reported rather than returned empty", () => {
  assert.throws(() => parsePostTitle("<html><body>no player here</body></html>"), /could not find a title/);
});

test("profile listing keeps posts whose titles contain a bare <", () => {
  const html = profilePage(
    block("first-post", "An ordinary title"),
    block("heart-post", "got a little excited <3 [ramblefap]"),
    block("third-post", "Another ordinary title")
  );

  const { posts } = parseProfilePosts(html, "nevvrotik");

  assert.equal(posts.length, 3, "the post with < in its title must not be dropped");
  assert.deepEqual(
    posts.map((p) => p.title),
    ["An ordinary title", "got a little excited <3 [ramblefap]", "Another ordinary title"]
  );
});

test("profile listing reads descriptions containing a bare < too", () => {
  const html = profilePage(block("post", "A title", "script by u/someone <3 [SFW]"));
  const { posts } = parseProfilePosts(html, "nevvrotik");
  assert.equal(posts[0].description, "script by u/someone <3 [SFW]");
});

test("real tags inside a title are stripped, entities are decoded", () => {
  const html = profilePage(block("post", "A <b>bold</b> title &amp; more"));
  const { posts } = parseProfilePosts(html, "nevvrotik");
  assert.equal(posts[0].title, "A bold title & more");
});

test("an empty description is omitted rather than stored blank", () => {
  const html = profilePage(block("post", "A title"));
  const { posts } = parseProfilePosts(html, "nevvrotik");
  assert.equal(posts[0].description, undefined);
});

test("the uploader's own casing is read back off the page", () => {
  const html = profilePage(block("post", "A title"));
  const { username } = parseProfilePosts(html, "NEVVROTIK");
  assert.equal(username, "nevvrotik");
});

test("an empty profile is reported rather than returned empty", () => {
  assert.throws(() => parseProfilePosts("<html><body></body></html>", "nevvrotik"), /no posts found/);
});
