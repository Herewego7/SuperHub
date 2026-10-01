import { useEffect, useRef } from "react";

// For numeric "trigger counter" props (a parent increments a number to tell a
// child to open a dialog/drawer). A plain
//   useEffect(() => { if (trigger > 0) ... }, [trigger])
// can't tell "a genuinely new press" apart from "the counter was already
// nonzero when I (re)mounted" — so any remount (tab revisit, wide/narrow
// toggle, card reorder) would spuriously re-fire the last action, popping
// dialogs nobody asked for. Seeding the ref with the mount-time value means
// only real increments after mount fire the effect.
export function useTriggerEffect(trigger: number, effect: () => void) {
  const lastSeen = useRef(trigger);
  useEffect(() => {
    if (trigger !== lastSeen.current) {
      lastSeen.current = trigger;
      effect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
}
