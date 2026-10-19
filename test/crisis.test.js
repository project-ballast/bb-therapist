import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRisk, stripToken } from "../public/crisis.js";

test("flags risk phrases", () => {
  for (const t of [
    "I want to kill myself",
    "honestly everyone would be better off without me",
    "I don't want to wake up tomorrow",
    "thinking about taking all my pills",
    "I've been cutting myself again",
    "I can't do this anymore",
    "I’m suicidal",
    "there's no point in living",
  ]) assert.equal(detectRisk(t), true, t);
});

test("does not flag ordinary messages", () => {
  for (const t of ["I slept 4 hours and feel amazing", "I'm so tired and sad today", "I want to buy a boat"]) assert.equal(detectRisk(t), false, t);
});

test("strips crisis token, including a half-streamed one", () => {
  assert.equal(stripToken("Please call 988.\n[[CRISIS]]"), "Please call 988.");
  assert.equal(stripToken("Please call 988.\n[[CRI"), "Please call 988.");
  assert.equal(stripToken("No token here."), "No token here.");
  assert.equal(stripToken("How do you feel now?\n[[MOOD]]"), "How do you feel now?");
  assert.equal(stripToken("How do you feel now?\n[[MO"), "How do you feel now?");
});
