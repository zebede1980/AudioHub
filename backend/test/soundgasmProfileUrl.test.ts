import assert from "node:assert/strict";
import test from "node:test";

import { parseProfileUrl } from "../src/scraper/soundgasm.js";

test("accepts a bare username and fills in the rest of the URL", () => {
  assert.deepEqual(parseProfileUrl("someuploader"), {
    username: "someuploader",
    canonicalUrl: "https://soundgasm.net/u/someuploader",
  });
  assert.equal(parseProfileUrl("  some_uploader-2.0  ").username, "some_uploader-2.0");
});

test("reduces a single-post URL to the uploader's profile", () => {
  assert.deepEqual(parseProfileUrl("https://soundgasm.net/u/someuploader/A-Track-Title"), {
    username: "someuploader",
    canonicalUrl: "https://soundgasm.net/u/someuploader",
  });
});

test("accepts profile URLs with or without a scheme, www, or trailing slash", () => {
  for (const input of [
    "https://soundgasm.net/u/someuploader",
    "https://soundgasm.net/u/someuploader/",
    "http://www.soundgasm.net/u/someuploader",
    "soundgasm.net/u/someuploader",
  ]) {
    assert.equal(parseProfileUrl(input).canonicalUrl, "https://soundgasm.net/u/someuploader", input);
  }
});

test("still refuses anything that isn't a soundgasm profile", () => {
  assert.throws(() => parseProfileUrl(""), /profile URL or username/);
  assert.throws(() => parseProfileUrl("https://example.com/u/someuploader"), /only soundgasm.net/);
  assert.throws(() => parseProfileUrl("https://soundgasm.net/about"), /expected a profile URL/);
  // A "username" that would smuggle in another host or path must not be pasted into a URL.
  assert.throws(() => parseProfileUrl("evil.com/x"), /only soundgasm.net/);
  assert.throws(() => parseProfileUrl("../../etc"), /only soundgasm.net|not a valid URL/);
});
