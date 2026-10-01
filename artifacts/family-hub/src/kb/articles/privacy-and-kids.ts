import type { KbArticle } from "../types";

export const privacyAndKidsArticles: KbArticle[] = [
  {
    id: "deleting-profile-vs-account",
    title: "Deleting a profile vs. deleting your account",
    category: "privacy-and-kids",
    type: "how-to",
    summary: "Two very different actions that sound similar — what each one actually removes.",
    tags: [
      "delete profile", "delete account", "remove child", "remove profile",
      "delete my data", "delete kid", "remove family member data",
      "close account", "data deletion",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "These are easy to mix up, but they're very different in scope. Pick the one that actually matches what you want to remove.",
      },
      {
        kind: "faq",
        items: [
          {
            q: "Delete a profile",
            a:
              "Removes one person — their chores, stars, and history go with them, but everyone else's data and your login are untouched. This can't be undone.",
          },
          {
            q: "Delete your account",
            a:
              "Permanently removes your login. If you're the sole owner of your family's data, this also deletes all of it — every profile, chore, event, and reward, for everyone. If your family has other Family Members, your login goes away but their shared data isn't wiped just because you leave.",
          },
        ],
      },
      { kind: "path", path: ["Settings", "People"] },
      {
        kind: "steps",
        steps: [
          "To delete a profile: open Settings → People, tap that person to edit them, and tap \"Delete this profile\" at the bottom of the form.",
          "To delete your whole account: open Settings → Account & Family, tap \"Delete Account & Reset Data\", then Delete account. You'll need to type DELETE before it actually happens.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Both actions are immediate and permanent — neither can be reversed once confirmed. If you're not sure which one you want, \"Reset data\" (right above Delete account) clears your family's content but keeps your login, which is a safer option if you're trying to start over rather than leave for good.",
      },
    ],
    related: ["adding-people"],
    updatedAt: "2026-09-30",
  },
];
