const TIMESTAMP = /\[\d{1,2}:\d{2}:\d{2}\]\s*/gu;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/gu;
const TOKEN_PART = /[\p{L}\p{N}]+/gu;

export function scoreTranscript(reference, hypothesis) {
  const referenceCharacters = comparableCharacters(reference);
  const hypothesisCharacters = comparableCharacters(hypothesis);
  if (!referenceCharacters.length) {
    throw new Error("The reference transcript has no comparable text.");
  }

  const referenceWords = comparableWords(reference);
  const hypothesisWords = comparableWords(hypothesis);
  const characterEdits = editDistance(
    referenceCharacters,
    hypothesisCharacters,
  );
  const wordEdits = editDistance(referenceWords, hypothesisWords);

  return {
    characterEdits,
    referenceCharacters: referenceCharacters.length,
    hypothesisCharacters: hypothesisCharacters.length,
    characterErrorRate: characterEdits / referenceCharacters.length,
    wordEdits,
    referenceWords: referenceWords.length,
    hypothesisWords: hypothesisWords.length,
    wordErrorRate: referenceWords.length
      ? wordEdits / referenceWords.length
      : undefined,
  };
}

export function comparableCharacters(value) {
  return Array.from(normalize(value).match(LETTER_OR_NUMBER) ?? []);
}

export function comparableWords(value) {
  const normalized = normalize(value);
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
    return Array.from(segmenter.segment(normalized)).flatMap((entry) =>
      entry.isWordLike ? (entry.segment.match(TOKEN_PART) ?? []) : [],
    );
  }
  return normalized.match(TOKEN_PART) ?? [];
}

/** Myers' bit-vector algorithm keeps memory bounded for long transcripts. */
export function editDistance(left, right) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  if (left.length > right.length) return editDistance(right, left);

  const length = left.length;
  const fullMask = (1n << BigInt(length)) - 1n;
  const highBit = 1n << BigInt(length - 1);
  const positions = new Map();
  for (let index = 0; index < length; index += 1) {
    const value = left[index];
    positions.set(value, (positions.get(value) ?? 0n) | (1n << BigInt(index)));
  }

  let positive = fullMask;
  let negative = 0n;
  let distance = length;
  for (const value of right) {
    const equal = positions.get(value) ?? 0n;
    const vertical = equal | negative;
    const horizontal = (((equal & positive) + positive) ^ positive) | equal;
    let positiveHorizontal = negative | ~(horizontal | positive);
    let negativeHorizontal = positive & horizontal;
    if (positiveHorizontal & highBit) distance += 1;
    else if (negativeHorizontal & highBit) distance -= 1;
    positiveHorizontal = ((positiveHorizontal << 1n) | 1n) & fullMask;
    negativeHorizontal = (negativeHorizontal << 1n) & fullMask;
    positive =
      (negativeHorizontal | ~(vertical | positiveHorizontal)) & fullMask;
    negative = positiveHorizontal & vertical;
  }
  return distance;
}

function normalize(value) {
  return String(value)
    .normalize("NFKC")
    .replace(TIMESTAMP, "")
    .toLocaleLowerCase("und");
}
