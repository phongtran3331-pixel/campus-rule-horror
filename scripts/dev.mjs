// 开发服务器编排：同时拉起 Colyseus 服务端与 Vite 客户端。
// 用法：npm run dev [-- --host 127.0.0.1 --port 7100]
// CLI 传入的 host/port 仅转发给 Vite（客户端），服务端固定 2567 端口。
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
function argOf(flag, dft) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dft;
}
const host = argOf("--host", "127.0.0.1");
const port = argOf("--port", "7100");
const extra = argv.filter((a) => !["--host", "--port"].includes(a) && a !== argv[argv.indexOf("--host") + 1] && a !== argv[argv.indexOf("--port") + 1]);

const procs = [
  spawn("npm", ["run", "dev", "-w", "server"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npm", ["run", "dev", "-w", "client", "--", "--host", host, "--port", port, ...extra],
    { stdio: "inherit", shell: process.platform === "win32" }),
];

function shutdown() {
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const p of procs) p.on("exit", (code) => { if (code) shutdown(); });
