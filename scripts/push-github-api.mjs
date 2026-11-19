// 经 Git Database API 推送（api.github.com 可达，github.com 直连被重置时的备用通道）
// 用法：GH_TOKEN=<token> node scripts/push-github-api.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OWNER = "phongtran3331-pixel";
const REPO = "campus-rule-horror";
const BRANCH = "main";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error("缺少 GH_TOKEN"); process.exit(1); }

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "atto-page-sync",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gh(path, method = "GET", body) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (res.ok) return await res.json();
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      console.log("速率限制，等待至", new Date(reset).toLocaleTimeString());
      await sleep(Math.max(1000, reset - Date.now()));
      continue;
    }
    console.error(`API ${method} ${path} → ${res.status}`, (await res.text()).slice(0, 300));
    if (res.status >= 500) { await sleep(2000); continue; }
    process.exit(1);
  }
  process.exit(1);
}

const localFiles = execSync("git -c core.quotepath=false ls-files", { encoding: "utf-8", maxBuffer: 16 << 20 })
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/^"|"$/g, ""));
const base64 = (buf) => Buffer.from(buf).toString("base64");

// 1) 远端当前 main
const ref = await gh(`/git/ref/heads/${BRANCH}`);
const baseSha = ref.object.sha;
const baseCommit = await gh(`/git/commits/${baseSha}`);
console.log(`远端 main = ${baseSha.slice(0, 7)}`);

// 2) 远端树（用于计算删除）
const remoteTree = await gh(`/git/trees/${baseCommit.tree.sha}?recursive=1`);
const remotePaths = new Set(remoteTree.tree.filter((t) => t.type === "blob").map((t) => t.path));

// 3) 逐个建 blob（文本用 utf-8 直传，二进制 base64）
const entries = [];
let done = 0;
for (const p of localFiles) {
  const buf = readFileSync(p);
  const binary = /[\x00-\x08\x0e-\x1f]/.test(buf.slice(0, 4096).toString("latin1"));
  const body = binary
    ? { content: base64(buf), encoding: "base64" }
    : { content: buf.toString("utf-8"), encoding: "utf-8" };
  const blob = await gh("/git/blobs", "POST", body);
  entries.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  if (++done % 40 === 0) console.log(`  blobs ${done}/${localFiles.length}`);
}

// 4) 删除项：远端有而本地无
const localSet = new Set(localFiles);
for (const rp of remotePaths) {
  if (!localSet.has(rp)) entries.push({ path: rp, mode: "100644", type: "blob", sha: null });
}

// 5) 建树 / 提交 / 更新引用
const tree = await gh("/git/trees", "POST", { base_tree: baseCommit.tree.sha, tree: entries });
const commit = await gh("/git/commits", "POST", {
  message: "sync: 本地 30 提交合并同步（P0–P2 功能 + 体验打磨 + 探索测试沙盒）",
  tree: tree.sha,
  parents: [baseSha],
});
await gh(`/git/refs/heads/${BRANCH}`, "PATCH", { sha: commit.sha, force: false });
console.log(`✓ 推送完成 ${commit.sha.slice(0, 7)}（${entries.length} 项，含 ${entries.length - localFiles.length} 个删除）`);
