/**
 * Repetition detection for finished transcripts.
 *
 * No decoder setting makes whisper's repetition spirals impossible, so a transcript is measured
 * after the fact and the worst run recorded. A degraded transcript is then visibly degraded in the
 * UI instead of quietly wrong — the failure mode is a file that transcribes fine for a minute and
 * then emits the same sentence fifty times.
 */

/** Splits on sentence enders, falling back to lines — whisper output is punctuated, but not always. */
function sentencesIn(text: string): string[] {
  const bySentence = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySentence.length > 1) return bySentence;
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Compared case- and punctuation-insensitively, so "Mm-hmm." and "Mm-hmm" count as the same. */
function normalise(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The longest run of the same sentence repeated back to back. 1 means nothing repeats
 * consecutively; a healthy transcript of this kind of audio sits in the low single digits.
 */
export function longestRepeatedRun(text: string): number {
  const sentences = sentencesIn(text).map(normalise).filter(Boolean);
  if (sentences.length === 0) return 0;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sentences.length; i++) {
    if (sentences[i] === sentences[i - 1]) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return longest;
}
