#!/usr/bin/env node
// Square avatar crops for the App Store screenshot fixture.
//
// Sources are the full-length portraits in tests/e2e/assets/family/. Centre-
// cropping those lands on the chest, so each one carries a measured face
// centre instead — and the kids' heads sit higher in frame than the adults',
// which is why the numbers differ per person.
//
// The square is 0.62 of the image height: head AND shoulders, because the app
// masks these into circles and the corners are thrown away. A crop that looks
// right as a square reads far too tight once it is round.
//
// Usage: node scripts/crop-family-avatars.mjs   (needs python3 + Pillow)
import { execFileSync } from "node:child_process";

const SPEC = [
  // source,             output,     centre-x, centre-y, side (fraction of height)
  ["Demo Dad.png",      "dad.jpg",  0.50, 0.31, 0.62],
  ["Demo Mom.png",      "mom.jpg",  0.50, 0.31, 0.62],
  ["Demo Daughter.png", "ava.jpg",  0.50, 0.27, 0.62],
  ["Demo Son.png",      "noah.jpg", 0.50, 0.32, 0.62],
];

const py = `
from PIL import Image
import sys, os
d = "tests/e2e/assets/family"
for src, out, cx, cy, sf in ${JSON.stringify(SPEC)}:
    im = Image.open(os.path.join(d, src)).convert("RGB")
    W, H = im.size
    side = int(H * sf)
    x = max(0, min(W - side, int(W * cx - side / 2)))
    y = max(0, min(H - side, int(H * cy - side / 2)))
    im.crop((x, y, x + side, y + side)).resize((512, 512), Image.LANCZOS).save(
        os.path.join(d, out), quality=92)
    print("wrote", out)
`;
execFileSync("python3", ["-c", py], { stdio: "inherit" });
