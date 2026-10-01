import { orientedImageUrl } from "./backgroundImage";

/**
 * The full-screen background library, and the rules for showing one.
 *
 * Lives in lib/ rather than in `components/privacy-screen.tsx` because it is
 * DATA, used by two different full-screen surfaces (the privacy screen and the
 * idle screensaver) and by unit tests. Importing it from the component dragged
 * in React and a stylesheet, which Node's test runner cannot load at all.
 */

/**
 * The chosen background for this device: either one of BUILTIN_IMAGES' remote
 * URLs or an uploaded "/objects/..." path. Per-device, like the app's other
 * display preferences.
 */
export const PRIVACY_IMAGE_KEY = "familyHub_privacyImageUrl";

/**
 * Backgrounds withdrawn from the library, by url.
 *
 * Removing an entry from BUILTIN_IMAGES stops it being OFFERED, but a device
 * that already picked it has the url in its own storage and would carry on
 * showing it forever — which is no use when the reason for removing it was
 * that it shouldn't be on anyone's wall. Anything listed here is treated as
 * no choice at all, so that device falls back to the default on its next
 * full-screen show.
 *
 * ⚠️ One-time and self-resolving: the family sees a different background once,
 * without warning, and can pick another whenever they like.
 */
const RETIRED = new Set([
  // A product marketing shot rather than something anyone would want on a
  // kitchen wall (withdrawn 2026-09-16).
  "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1920&h=1080&fit=crop&q=80",
]);

/** The stored choice, falling back to the library's first image. */
export function getPrivacyImageUrl(): string {
  try {
    const stored = localStorage.getItem(PRIVACY_IMAGE_KEY);
    if (!stored || RETIRED.has(stored)) return BUILTIN_IMAGES[0].url;
    return stored;
  } catch {
    return BUILTIN_IMAGES[0].url; // private mode
  }
}

/** Exported for tests — the list above is easy to get silently wrong. */
export function isRetiredBackground(url: string): boolean {
  return RETIRED.has(url);
}

// Unsplash: serene, beautiful, wall-art worthy — appeals to women with kids
export const BUILTIN_IMAGES: {
  id: string; url: string; label: string; category: string;
  /**
   * Keep the busiest region rather than the middle when cropping to portrait.
   *
   * Set from a one-by-one review of every background in both crops
   * (2026-09-16): the centre won 31 of the 40 judged, so entropy is marked on
   * the nine whose subject sits off to one side rather than applied library
   * -wide, which would have made 31 of them worse to fix 9.
   *
   * Portrait only — see `orientedImageUrl`. Six backgrounds were not judged
   * (Autumn Harvest, Blush Tones, Cherry Blossoms, Pink Peonies, Pink Sunset
   * Hills, Wildflower Meadow) and keep the centre crop, which is what they do
   * today; if one of those looks wrong on a phone, mark it here.
   */
  portraitCrop?: "entropy";
}[] = [
  // Floral & Botanical
  { id: "bi1", label: "Pink Peonies",        category: "Floral",    url: "https://images.unsplash.com/photo-1490750967868-88df5691240b?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi2", label: "White Roses",         category: "Floral",    url: "https://images.unsplash.com/photo-1525310072745-f49212b5ac6d?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi3", label: "Cherry Blossoms",     category: "Floral",    url: "https://images.unsplash.com/photo-1522383225753-aa8fe0cdfb14?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi4", label: "Lavender Field",      category: "Floral",    url: "https://images.unsplash.com/photo-1462275646964-a0e3386b89fa?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi5", label: "Wildflower Meadow",   category: "Floral",    url: "https://images.unsplash.com/photo-1490818852745-9f62b0b58e38?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi6", label: "Sunflower Field",     category: "Floral",    url: "https://images.unsplash.com/photo-1504386106331-3e4e71712b38?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi7", label: "Garden Roses",        category: "Floral",    url: "https://images.unsplash.com/photo-1502977249166-824b3a8a4d6d?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi9", label: "Hydrangea Bloom",     category: "Floral",    url: "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi10", label: "Soft Magnolia",      category: "Floral",    url: "https://images.unsplash.com/photo-1519659528534-7fd733a832a0?w=1920&h=1080&fit=crop&q=80" },

  // Serene Water & Beaches
  { id: "bi11", label: "Calm Ocean Sunrise", category: "Water",     url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi12", label: "Pastel Sunset Beach",category: "Water",     url: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi13", label: "Turquoise Lagoon",   category: "Water",     url: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi14", label: "Lake Reflection",    category: "Water",     url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi15", label: "Misty Waterfall",    category: "Water",     url: "https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi16", label: "Golden Hour Shore",  category: "Water",     url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi17", label: "Seashell Beach",     category: "Water",     url: "https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi56", label: "Snowy River",            category: "Water",      url: "https://images.unsplash.com/photo-1579169559034-4d5f2c407edc?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi63", label: "Canoe at the Dock",      category: "Water",      url: "https://images.unsplash.com/photo-1464069668014-99e9cd4abf16?w=1920&h=1080&fit=crop&q=80" },

  // Palm Trees & Tropical Islands
  { id: "bi49", label: "Palm Tree Silhouette",  category: "Tropical", url: "https://images.unsplash.com/photo-1520454974749-611b7248ffdb?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi50", label: "Tropical Beach Cove",    category: "Tropical", url: "https://images.unsplash.com/photo-1573790387438-4da905039392?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi51", label: "Island Palms",           category: "Tropical", url: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi52", label: "Overwater Bungalow",     category: "Tropical", url: "https://images.unsplash.com/photo-1573843981267-be1999ff37cd?w=1920&h=1080&fit=crop&q=80" },

  // Forests & Nature
  { id: "bi18", label: "Enchanted Forest",   category: "Nature",    url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi20", label: "Misty Morning Trees",category: "Nature",    url: "https://images.unsplash.com/photo-1441974231674-7be02c33085b?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi21", label: "Fern Forest Path",   category: "Nature",    url: "https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi22", label: "Spring Blossoms",    category: "Nature",    url: "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi23", label: "Autumn Leaves",      category: "Nature",    url: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi53", label: "Autumn Forest",          category: "Nature",     url: "https://images.unsplash.com/photo-1788894531609-e76e696ab1ab?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi55", label: "Trees in a Field",       category: "Nature",     url: "https://images.unsplash.com/photo-1683806743160-2fc2e159dc66?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi59", label: "Sunbeam Forest",         category: "Nature",     url: "https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi62", label: "Forest From Above",      category: "Nature",     url: "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1920&h=1080&fit=crop&q=80" },

  // Mountains & Landscapes
  { id: "bi25", label: "Alpine Meadow",      category: "Landscape", url: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi26", label: "Pink Sunset Hills",  category: "Landscape", url: "https://images.unsplash.com/photo-1465188035479-23b8f7e53caa?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi27", label: "Foggy Valley",       category: "Landscape", url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi28", label: "Rolling Green Hills",category: "Landscape", url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi29", label: "Snow-Capped Peaks",  category: "Landscape", url: "https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi30", label: "Dreamy Meadow",      category: "Landscape", url: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi57", label: "Mountain Church",        category: "Landscape",  url: "https://images.unsplash.com/photo-1763560043495-6e67a3a7f34e?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi58", label: "Foggy Summit",           category: "Landscape",  url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi61", label: "Mountain Road",          category: "Landscape",  url: "https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=1920&h=1080&fit=crop&q=80" },

  // Sky & Light
  { id: "bi31", label: "Aurora Borealis",    category: "Sky",       url: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi34", label: "Golden Hour Glow",   category: "Sky",       url: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi35", label: "Starry Night",       category: "Sky",       url: "https://images.unsplash.com/photo-1436891620584-47fd0e565afb?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi36", label: "Soft Morning Mist",  category: "Sky",       url: "https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi60", label: "Hot Air Balloons",       category: "Sky",        url: "https://images.unsplash.com/photo-1433838552652-f9a46b332c40?w=1920&h=1080&fit=crop&q=80" },

  // Cozy & Warm
  { id: "bi37", label: "Cozy Fireplace",     category: "Cozy",      url: "https://images.unsplash.com/photo-1512552288940-3a300922a275?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi38", label: "Morning Coffee",     category: "Cozy",      url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi39", label: "Warm Candlelight",   category: "Cozy",      url: "https://images.unsplash.com/photo-1481277542470-605612bd2d61?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi40", label: "Autumn Harvest",     category: "Cozy",      url: "https://images.unsplash.com/photo-1476887334197-56a5f1f56f56?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi42", label: "Garden Patio",       category: "Cozy",      url: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1920&h=1080&fit=crop&q=80" },

  // Abstract & Soft Art
  { id: "bi43", label: "Soft Pink Marble",   category: "Art",       url: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi44", label: "Pastel Watercolor",  category: "Art",       url: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=1920&h=1080&fit=crop&q=80" },
  { id: "bi45", label: "Golden Swirls",      category: "Art",       url: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
  { id: "bi46", label: "Blush Tones",        category: "Art",       url: "https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=1920&h=1080&fit=crop&q=80" },

  // Seasons & Gardens
  { id: "bi48", label: "Rose Arbour",        category: "Garden",    url: "https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=1920&h=1080&fit=crop&q=80", portraitCrop: "entropy" },
];

/**
 * The url to actually render a full-screen background with: the family's
 * chosen picture, cropped to the shape of the screen, using whichever region
 * that particular photo wants.
 *
 * Both the privacy screen and the screensaver call this, so the two surfaces
 * cannot drift apart — and an uploaded photo falls through `orientedImageUrl`
 * untouched, since it is a real file rather than something we can re-crop.
 */
export function displayBackgroundUrl(storedUrl: string, portrait: boolean): string {
  const builtin = BUILTIN_IMAGES.find(i => i.url === storedUrl);
  return orientedImageUrl(storedUrl, portrait, builtin?.portraitCrop);
}

