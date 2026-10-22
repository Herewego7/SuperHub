import { test } from "node:test";
import assert from "node:assert/strict";
import { mailParts, siteName } from "../../src/lib/mailLinks";

test("a link reads as its site's name", () => {
  assert.equal(siteName("https://www.cnn.com/2026/10/19/business/elon?_hsenc=abc"), "CNN");
  assert.equal(siteName("https://www.bloomberg.com/news/articles/x"), "Bloomberg");
  assert.equal(siteName("https://www.nytimes.com/x"), "NYT");
  assert.equal(siteName("https://news.bbc.co.uk/x"), "BBC");
  assert.equal(siteName("https://click.convertkit-mail.com/abc"), "link");
  assert.equal(siteName("not a url"), "link");
});

test("a newsletter's bracketed link becomes (Site), and the sentence keeps its punctuation", () => {
  const parts = mailParts("is building (https://www.bloomberg.com/news/a?_hsenc=p2A-9F) 3.8k+ new units. See https://cnn.com/x.");
  assert.deepEqual(parts, [
    { text: "is building (" },
    { text: "Bloomberg", href: "https://www.bloomberg.com/news/a?_hsenc=p2A-9F" },
    { text: ") 3.8k+ new units. See " },
    { text: "CNN", href: "https://cnn.com/x" },
    { text: "." },
  ]);
});

test("an address that opens its own bracket keeps it, and <angle> links lose the angles", () => {
  assert.deepEqual(mailParts("https://en.wikipedia.org/wiki/Foo_(bar)"), [
    { text: "Wikipedia", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
  ]);
  assert.deepEqual(mailParts("Read <https://example.com/a>"), [
    { text: "Read " },
    { text: "Example", href: "https://example.com/a" },
  ]);
});

test("text with no links is one run", () => {
  assert.deepEqual(mailParts("Spirit day Friday"), [{ text: "Spirit day Friday" }]);
});
