import assert from "node:assert/strict";
import test from "node:test";
import { acceptModelDraft, draftFromSentence, draftLine, draftWrite } from "../src/ai/draft.ts";
import { pickPlace } from "../src/lib/geocode.ts";
import { outlookAttachment } from "../src/ingest/parse.ts";

const now = new Date(2026, 9, 5, 9, 0);

test("a sentence becomes a backpack item, an event, or a key date", () => {
  const shirt = draftFromSentence("Bring a red shirt Friday", ["Liam"], now);
  assert.equal(shirt.kind, "backpack");
  assert.equal(shirt.date, "2026-10-09");
  assert.equal(shirt.time, null);
  const soccer = draftFromSentence("Soccer Friday at 4pm", ["Liam"], now);
  assert.equal(soccer.kind, "event");
  assert.equal(soccer.time, "4:00 PM");
  assert.equal(soccer.title, "Soccer");
  const picture = draftFromSentence("Picture day October 9", [], now);
  assert.equal(picture.kind, "keyDate");
  assert.equal(picture.date, "2026-10-09");
  assert.match(draftLine(picture), /Key date/);
});

test("a model time the sentence never said is thrown out", () => {
  const accepted = acceptModelDraft(
    "Picture day Friday",
    { kind: "event", title: "Picture day", detail: "", date: "2026-10-09", time: "4:00 PM", who: [] },
    ["Liam"],
    now,
  );
  assert.equal(accepted, null);
  const saved = draftWrite(
    { kind: "backpack", title: "Red shirt", detail: "", date: "2026-10-09", time: null, who: ["Liam"] },
    [{ id: "liam", name: "Liam" }],
    now,
    "America/Chicago",
  );
  assert.equal(saved?.kind, "todo");
  if (saved?.kind === "todo") assert.match(saved.description, /Bring Red shirt/);
});

test("an Outlook PDF is kept and an inline logo is not the one we read", () => {
  const picked = outlookAttachment([
    { id: "logo", "@odata.type": "#microsoft.graph.fileAttachment", contentType: "image/png", size: 4000, isInline: true, contentBytes: "bG9nbw==" },
    { id: "flyer", "@odata.type": "#microsoft.graph.fileAttachment", contentType: "application/pdf", size: 8000, isInline: false, contentBytes: "Zmx5ZXI=" },
    { id: "huge", "@odata.type": "#microsoft.graph.fileAttachment", contentType: "application/pdf", size: 3_000_000, isInline: false },
  ]);
  assert.equal(picked?.id, "flyer");
  assert.equal(picked?.mimeType, "application/pdf");
});

test("weather for another place names the city that matched", () => {
  const place = pickPlace(
    [
      { name: "Springfield", latitude: 39.78, longitude: -89.65, admin1: "Illinois" },
      { name: "Springfield", latitude: 42.1, longitude: -72.58, admin1: "Massachusetts" },
    ],
    "Massachusetts",
  );
  assert.equal(place?.label, "Springfield, Massachusetts");
  assert.equal(pickPlace([], "") , null);
});
