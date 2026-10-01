// Plain JS on purpose: this source is read as text and evaluated INSIDE the
// browser. Keeping it out of the TypeScript pipeline avoids esbuild injecting
// its `__name` helper, which doesn't exist in the page and throws on evaluate.
//
// Returns a compact list of geometric faults. The four checks, and the real
// bug each was written from:
//   clipped   - text cut off by an ancestor's overflow (the "1:30 PI" time
//               field; the truncated "Choose who it's fr" select)
//   crushed   - text wrapping to ~one word per line because a non-shrinking
//               sibling ate the row ("On / for / this / device")
//   overflow  - an element extending past a container that constrains it
//   touching  - stacked controls with no gap (Snap a flyer's uploaders, where
//               display:contents swallowed the margin)
(() => {
  const faults = [];

  const describe = (el) => {
    const t = el.tagName.toLowerCase();
    const id = el.dataset && el.dataset.testid;
    if (id) return t + "[" + id + "]";
    const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const txt = (el.textContent || "").trim().slice(0, 28).replace(/\s+/g, " ");
    return t + (cls ? "." + cls : "") + (txt ? ' "' + txt + '"' : "");
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  };

  const all = Array.from(document.querySelectorAll("body *"));

  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // 1. CLIPPED
    const hidesX = s.overflowX === "hidden" || s.overflowX === "clip";
    if (hidesX && s.textOverflow !== "ellipsis" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      faults.push({
        kind: "clipped",
        where: describe(el),
        detail: "content " + el.scrollWidth + "px in a " + el.clientWidth + "px box",
      });
    }

    // 2. CRUSHED — only judged on an element's OWN text nodes, so a wrapper
    //    isn't blamed for its children's wrapping.
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || "").trim())
      .join(" ")
      .trim();
    if (ownText) {
      const words = ownText.split(/\s+/).filter(Boolean).length;
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2 || 16;
      const lines = Math.round(rect.height / lh);
      if (words >= 3 && lines >= 3 && lines >= words * 0.8) {
        faults.push({
          kind: "crushed",
          where: describe(el),
          detail: words + " words over ~" + lines + " lines in " + Math.round(rect.width) + "px",
        });
      }
    }

    // 3. OVERFLOW
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const ps = getComputedStyle(parent);
      const constrains = ps.overflowX === "hidden" || ps.overflowX === "clip";
      if (constrains) {
        const pr = parent.getBoundingClientRect();
        const over = rect.right - pr.right;
        if (over > 2 && pr.width > 0) {
          faults.push({
            kind: "overflow",
            where: describe(el),
            detail: Math.round(over) + "px past " + describe(parent),
          });
        }
      }
    }
  }

  // 4. TOUCHING
  const controls = all.filter(
    (el) => visible(el) && (el.tagName === "BUTTON" || el.getAttribute("role") === "button"),
  );
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      const sameColumn = Math.abs(a.left - b.left) < 4 && Math.abs(a.width - b.width) < 4;
      const stacked = b.top >= a.bottom - 1 && b.top - a.bottom < 1.5;
      // Only DISCRETE buttons — ones with their own rounded outline. A flush
      // list of rows inside a rounded container (Settings' Alerts/Schedules/
      // Devices) is a deliberate pattern and legitimately has no gap; the bug
      // this catches is two standalone rounded buttons rendered flush.
      const discrete = (el) => parseFloat(getComputedStyle(el).borderRadius) >= 6;
      if (sameColumn && stacked && a.height > 20 && b.height > 20
          && discrete(controls[i]) && discrete(controls[j])) {
        faults.push({
          kind: "touching",
          where: describe(controls[i]) + " + " + describe(controls[j]),
          detail: (b.top - a.bottom).toFixed(1) + "px gap",
        });
      }
    }
  }

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    faults.push({
      kind: "page-overflow",
      where: "document",
      detail: de.scrollWidth + "px wide in " + de.clientWidth + "px viewport",
    });
  }

  const seen = new Set();
  return faults.filter((f) => {
    const k = f.kind + "|" + f.where + "|" + f.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})()
