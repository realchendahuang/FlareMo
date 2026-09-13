import assert from "node:assert/strict";
import test from "node:test";
import { editDistance, scoreTranscript } from "./lib/transcript-accuracy.mjs";

test("scores Chinese ASR text without counting timestamps, punctuation, or case", () => {
  const score = scoreTranscript(
    "这是 FlareMo 的一次语音记录测试。",
    "[11:36:39] 这是 flaremo 的一次语音记录测试!",
  );

  assert.equal(score.characterEdits, 0);
  assert.equal(score.characterErrorRate, 0);
  assert.equal(score.wordEdits, 0);
  assert.equal(score.wordErrorRate, 0);
});

test("reports substitutions, insertions, and deletions against reference length", () => {
  const score = scoreTranscript("语音记录测试", "语音纪录新测试");

  assert.equal(score.referenceCharacters, 6);
  assert.equal(score.hypothesisCharacters, 7);
  assert.equal(score.characterEdits, 2);
  assert.equal(score.characterErrorRate, 2 / 6);
});

test("bit-vector distance matches dynamic programming for representative sequences", () => {
  const cases = [
    [[], []],
    [["a"], []],
    [[], ["a", "b"]],
    [
      ["a", "b", "c"],
      ["a", "x", "c"],
    ],
    [
      ["你", "好", "世", "界"],
      ["你", "世", "界", "呀"],
    ],
    [Array.from("kitten"), Array.from("sitting")],
  ];

  for (const [left, right] of cases) {
    assert.equal(editDistance(left, right), dynamicDistance(left, right));
  }
});

test("rejects a reference containing no comparable speech", () => {
  assert.throws(
    () => scoreTranscript("...", "some text"),
    /no comparable text/,
  );
});

function dynamicDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous.at(-1);
}
