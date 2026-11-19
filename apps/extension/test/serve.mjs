// Tiny static server for testing the content script outside Chrome: node test/serve.mjs  ->  http://localhost:5178/test/form.html
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(5178, () => console.log("http://localhost:5178/test/form.html"));
