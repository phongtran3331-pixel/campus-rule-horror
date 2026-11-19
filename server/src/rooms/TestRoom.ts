import { GameRoom, type JoinOptions } from "./GameRoom.js";

/** 单人探索测试房：复用 GameRoom 全部场景/规则引擎，沙盒模式不走对局流程 */
export class TestRoom extends GameRoom {
  maxClients = 1;

  onCreate(options: JoinOptions) {
    this.sandbox = true;
    super.onCreate(options);
  }
}
