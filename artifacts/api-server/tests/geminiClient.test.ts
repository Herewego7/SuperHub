import assert from "node:assert/strict";
import test from "node:test";
import { BOTLIFE_MODELS, chatGenerationConfig, geminiSetup, jsonGenerationConfig } from "../src/geminiClient.ts";

const account = JSON.stringify({ client_email: "superhub@botlife.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

test("chat uses Bot Life's model and does not set its own length cap", () => {
  assert.equal(BOTLIFE_MODELS.chat, "gemini-3.1-pro-preview");
  assert.equal(BOTLIFE_MODELS.extract, "gemini-3.5-flash");
  assert.equal(BOTLIFE_MODELS.triage, "gemini-3.1-flash-lite");
  assert.equal(BOTLIFE_MODELS.digest, "gemini-3.5-flash");
  assert.equal(BOTLIFE_MODELS.draft, "gemini-3.5-flash");
  assert.deepEqual(chatGenerationConfig(), { temperature: 0.3 });
  assert.equal("maxOutputTokens" in chatGenerationConfig(), false);
  assert.equal("maxOutputTokens" in jsonGenerationConfig(), false);
  assert.equal(jsonGenerationConfig().temperature, 0);
  assert.equal(jsonGenerationConfig("digest").temperature, 0.3);
});

test("Gemini is off until a Google Cloud project or the Replit proxy is set", () => {
  assert.equal(geminiSetup({}).kind, "off");
  assert.equal(geminiSetup({ GOOGLE_CLOUD_PROJECT: "botlife" }).kind, "off");
});

test("a service account on Bot Life's project uses Vertex, ahead of Replit", () => {
  const setup = geminiSetup({
    GOOGLE_CLOUD_PROJECT: "botlife",
    GOOGLE_SERVICE_ACCOUNT_JSON: account,
    AI_INTEGRATIONS_GEMINI_API_KEY: "replit",
    AI_INTEGRATIONS_GEMINI_BASE_URL: "http://localhost",
  });
  assert.equal(setup.kind, "vertex");
  if (setup.kind !== "vertex") return;
  assert.equal(setup.project, "botlife");
  assert.equal(setup.location, "global");
  assert.equal(setup.credentials.client_email, "superhub@botlife.iam.gserviceaccount.com");
});

test("the region can be overridden, and a bad secret falls back to Replit", () => {
  const moved = geminiSetup({ GOOGLE_CLOUD_PROJECT: "botlife", GOOGLE_CLOUD_LOCATION: "us-central1", GOOGLE_SERVICE_ACCOUNT_JSON: account });
  assert.equal(moved.kind, "vertex");
  if (moved.kind === "vertex") assert.equal(moved.location, "us-central1");
  const fallback = geminiSetup({
    GOOGLE_CLOUD_PROJECT: "botlife",
    GOOGLE_SERVICE_ACCOUNT_JSON: "not-json",
    AI_INTEGRATIONS_GEMINI_API_KEY: "replit",
    AI_INTEGRATIONS_GEMINI_BASE_URL: "http://localhost",
  });
  assert.deepEqual(fallback, { kind: "replit", apiKey: "replit", baseUrl: "http://localhost" });
});
