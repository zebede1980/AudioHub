import assert from "node:assert/strict";
import test from "node:test";
import { longestRepeatedRun } from "../src/transcription/quality.js";

test("a clean transcript reports no consecutive repetition", () => {
  assert.equal(
    longestRepeatedRun("She opened the door. The hallway was dark. Something moved upstairs."),
    1
  );
});

test("a repetition spiral is measured by its longest unbroken run", () => {
  // The real failure: fine for a while, then the same sentence for the rest of the file.
  const text = ["Are you comfortable?", "Just relax.", ...Array(50).fill("Mm-hmm.")].join(" ");
  assert.equal(longestRepeatedRun(text), 50);
});

test("repeats scattered through a file are not counted as a run", () => {
  // Audio genuinely does repeat short interjections — that must not be flagged.
  const text = "It's okay. Come here. It's okay. Sit down. It's okay. Breathe.";
  assert.equal(longestRepeatedRun(text), 1);
});

test("casing and punctuation differences still count as the same sentence", () => {
  assert.equal(longestRepeatedRun("Mm-hmm. mm hmm! MM-HMM… Something else."), 3);
});

test("unpunctuated line-per-segment output is still measured", () => {
  assert.equal(longestRepeatedRun(["hello there", "yeah", "yeah", "yeah", "goodbye"].join("\n")), 3);
});

test("empty or whitespace-only text is zero, not a crash", () => {
  assert.equal(longestRepeatedRun(""), 0);
  assert.equal(longestRepeatedRun("   \n  "), 0);
});
