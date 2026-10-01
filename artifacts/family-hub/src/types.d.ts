// canvas-confetti ships no types and @types/canvas-confetti isn't installed.
// Four files import it (home-view, rewards-view, todos-view, family-hub) and
// each was carrying its own TS7016 in the baseline; one ambient declaration
// clears all of them. Typed loosely on purpose — this is a declaration of
// what already exists, not an attempt to model the library.
declare module "canvas-confetti" {
  const confetti: (opts?: Record<string, unknown>) => void;
  export default confetti;
}
