import { Server } from "colyseus";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { GameRoom } from "./rooms/GameRoom.js";

const app = express();
app.use(cors());
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

const gameServer = new Server({ server: createServer(app) });
gameServer.define("game", GameRoom);

const port = Number(process.env.PORT || 2567);
gameServer.listen(port).then(() => {
  console.log(`[server] Colyseus listening on ws://0.0.0.0:${port}`);
});
