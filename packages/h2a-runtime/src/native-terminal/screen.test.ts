import {describe,it,expect} from "vitest";
import {renderTerminalScreen} from "./screen.js";

describe("native visible screen",()=>{
 it("should preserve cursor-positioned rows and spaces instead of concatenating a Codex composer",async()=>{
  const raw="\x1b[2J\x1b[1;1Hmodel: loading\x1b[1;1H\x1b[2KGPT-6.1-Sol high\x1b[1;20H· ~/repo\x1b[3;1H› Explain this codebase\x1b[4;1H⚠ 1 warning · f2 to view";
  const screen=await renderTerminalScreen(raw,80,24);
  expect(screen).toContain("GPT-6.1-Sol high   · ~/repo");
  expect(screen).toContain("\n› Explain this codebase\n");
  expect(screen).not.toContain("loading");
 });
 it("should not treat a historical composer as current readiness",async()=>{
  const screen=await renderTerminalScreen("› Explain this codebase\r\nmodel · ~/repo\x1b[2J\x1b[Hmodel: loading",80,24);
  expect(screen.trim()).toBe("model: loading");
 });
 it("should render Muse's empty composer and status footer",async()=>{
  const screen=await renderTerminalScreen("\x1b[10;1H❯\x1b[12;3Hmuse-spark-1.3-contributor\x1b[12;30H·\x1b[12;32Hxhigh\x1b[12;38H·\x1b[12;40H~/repo",160,48);
  expect(screen).toContain("❯");
  expect(screen).toContain("muse-spark-1.3-contributor · xhigh · ~/repo");
 });
});
