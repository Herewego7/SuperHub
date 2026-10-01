// Minimal stub OIDC discovery endpoint, used ONLY for local/CI runs of the app
// tour outside Replit's own hosting.
//
// The api-server's setupAuth() unconditionally awaits openid-client's
// discovery() against ISSUER_URL (normally https://replit.com/oidc) at boot,
// even when the account being tested only uses email/password login. Outside
// Replit's network that host is unreachable, which would otherwise crash the
// server before it ever serves a single route.
//
// All that's actually required for discovery() to succeed is a same-issuer
// JSON document — every other OIDC field is validated lazily, only if the
// real Replit-login route (/api/login) is exercised, which this tour never
// does.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 9443);
const ISSUER = `https://127.0.0.1:${PORT}`;

const server = https.createServer(
  {
    cert: fs.readFileSync(path.join(__dirname, "certs/cert.pem")),
    key: fs.readFileSync(path.join(__dirname, "certs/key.pem")),
  },
  (req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ issuer: ISSUER }));
      return;
    }
    res.writeHead(404).end();
  },
);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-oidc] listening on ${ISSUER}`);
});
