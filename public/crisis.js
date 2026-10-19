// In-browser risk check. Runs before any AI call and works offline.
// Deliberately broad: a false alarm costs a few seconds, a miss could cost far more.
const PATTERNS = [
  /\bkill(ing)? (my ?self|me)\b/,
  /\bsuicid/,
  /\bend (it all|my life|things|everything)\b/,
  /\b(want|wanna|wish|going|ready|plan(ning)?) to die\b/,
  /\bwish i (was|were) dead\b/,
  /\bbetter off (dead|without me)\b/,
  /\b(no|any) (reason|point) (to|in) (live|living|going on)\b/,
  /\bdon'?t want to (be alive|live|wake up|exist|be here)\b/,
  /\b(not|never) wake up\b/,
  /\b(hurt|harm|cutt?|burn)(ing)? my ?self\b/,
  /\bself[- ]?harm/,
  /\boverdos/,
  /\b(take|taking|took|swallow(ing|ed)?) (all|a bunch|a lot|the rest|a handful) of (my |the |these )?(pills|meds|medication|tablets)/,
  /\ball (of )?my (pills|meds|medication)\b/,
  /\b(jump|jumping) (off|in front)\b/,
  /\b(hang|hanging) my ?self\b/,
  /\b(gun|rope|razor|blade)s?\b.*\b(me|my ?self)\b/,
  /\bgoodbye (forever|letter|note)\b/,
  /\bsuicide note\b/,
  /\bgiv(e|ing) (away )?(all )?my (stuff|things) away\b/,
  /\bburden (to|on) every/,
  /\bcan'?t (go on|do this anymore|keep going)\b/,
  /\b(hurt|kill)(ing)? (him|her|them|someone|somebody|people)\b/,
];

export function detectRisk(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
  return PATTERNS.some((p) => p.test(t));
}

export const CRISIS_TOKEN = "[[CRISIS]]";
// Not a risk flag: asks the app to show the 1-10 "How do you feel now?" picker.
export const MOOD_TOKEN = "[[MOOD]]";
const TOKENS = [CRISIS_TOKEN, MOOD_TOKEN];

// Removes the AI's hidden flags, plus a half-streamed flag at the very end.
export function stripToken(text) {
  let out = String(text);
  for (const t of TOKENS) out = out.split(t).join("");
  out = out.trimEnd();
  for (const t of TOKENS) {
    for (let i = t.length - 1; i > 1; i--) {
      if (out.endsWith(t.slice(0, i))) return out.slice(0, -i).trimEnd();
    }
  }
  return out;
}
