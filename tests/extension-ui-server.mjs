import http from "node:http";
import { readFile } from "node:fs/promises";

// Local-only harness: real content script/CSS, simulated YouTube DOM and Chrome API.
// The sole source substitution enables the YouTube branch on localhost.
const root = new URL("../", import.meta.url);
const routes = {
  "/": ["tests/fixtures/extension-ui.html", "text/html"],
  "/content.js": ["extension/src/content.js", "text/javascript"],
  "/content.css": ["extension/src/content.css", "text/css"],
  "/toolbar": ["extension/src/popup.html", "text/html"],
  "/settings": ["extension/src/options.html", "text/html"],
  "/popup.mjs": ["extension/src/popup.mjs", "text/javascript"],
  "/options.mjs": ["extension/src/options.mjs", "text/javascript"],
  "/popup.css": ["extension/src/popup.css", "text/css"],
  "/options.css": ["extension/src/options.css", "text/css"],
};
const server = http.createServer(async (req, res) => {
  const route = routes[req.url];
  if (!route) { res.writeHead(404).end(); return; }
  try {
    let body = await readFile(new URL(route[0], root), "utf8");
    if (["/toolbar", "/settings"].includes(req.url)) {
      // Blank fixture settings only: never read the user's real extension storage.
      body = body.replace('<script type="module"', `<script>window.chrome={runtime:{async sendMessage(m){return {ok:true,data:m.type==='lookup'?{missingPack:true}:{mode:'en-vi'}}},openOptionsPage(){}},storage:{local:{async get(){return {}},async set(){}},onChanged:{addListener(){}}}};</script><script type="module"`);
    }
    if (req.url === "/content.js") {
      const environmentCheck = 'location.hostname === "www.youtube.com"';
      if (!body.includes(environmentCheck)) throw new Error("Update harness YouTube environment check");
      body = body.replace(environmentCheck, "true /* YouTube fixture */");
    }
    res.writeHead(200, { "Content-Type": `${route[1]}; charset=utf-8`, "Cache-Control": "no-store" }).end(body);
  } catch (error) {
    res.writeHead(500).end(error.message);
  }
});
server.listen(3001, "127.0.0.1", () => console.log("Extension UI fixture: http://127.0.0.1:3001"));
