#!/usr/bin/env node
// 极简静态服务器（零依赖，Node 18+）：node scripts/static-server.mjs <root> [port]
// 供服务器上用 systemd 托管 client/dist；不用于本地开发（本地用 vite）
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const root = process.argv[2] || "client/dist";
const port = Number(process.argv[3] || 7100);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(root, p));
    if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    // 缓存策略：HTML/JSON 不缓存（防 heuristic 缓存旧包）；指纹资源(index-哈希)长缓存；图片等 1 小时
    const cc = file.endsWith(".html") || extname(file) === ".json" ? "no-cache"
      : p.startsWith("/assets/index-") ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": cc });
    res.end(data);
  } catch {
    // SPA 回退：找不到就回 index.html（游戏内路由都是前端状态，无真实路径）
    try {
      const data = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  }
}).listen(port, () => console.log(`[static] ${root} → http://0.0.0.0:${port}`));
