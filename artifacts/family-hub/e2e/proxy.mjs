// Single HTTPS origin fronting the plain-HTTP Vite dev server (frontend) and
// the plain-HTTP api-server (backend), so a real browser sees ONE origin for
// both. This is required for the app's session cookie: cookie.secure is
// hardcoded true (replitAuth.ts), which needs a genuine HTTPS connection
// FROM THE BROWSER's point of view — the backend hops behind this proxy stay
// plain HTTP, that's irrelevant to the Secure cookie attribute.
//
// Also proxies the Vite HMR websocket so the console doesn't fill with
// reconnect-loop noise during a run.
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTEN_PORT = Number(process.argv[2] || 8443);
const FRONTEND_PORT = Number(process.argv[3] || 5173);
const API_PORT = Number(process.argv[4] || 4000);

const API_PREFIXES = ["/api", "/objects"];
function targetPortFor(url) {
  return API_PREFIXES.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"))
    ? API_PORT
    : FRONTEND_PORT;
}

const server = https.createServer({
  cert: fs.readFileSync(path.join(__dirname, "certs/cert.pem")),
  key: fs.readFileSync(path.join(__dirname, "certs/key.pem")),
});

server.on("request", (clientReq, clientRes) => {
  const port = targetPortFor(clientReq.url);
  const proxyReq = http.request(
    {
      host: "127.0.0.1",
      port,
      path: clientReq.url,
      method: clientReq.method,
      headers: { ...clientReq.headers, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" },
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(clientRes);
    },
  );
  proxyReq.on("error", (err) => {
    clientRes.writeHead(502).end(`proxy error: ${err.message}`);
  });
  clientReq.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  const port = targetPortFor(req.url);
  const proxyReq = http.request({
    host: "127.0.0.1",
    port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    proxySocket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`[proxy] https://127.0.0.1:${LISTEN_PORT} -> frontend:${FRONTEND_PORT} / api:${API_PORT}`);
});
