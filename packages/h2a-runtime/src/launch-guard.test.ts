import {describe,it,expect,vi} from "vitest";
import {cleanupLaunch} from "./launch-guard.js";

describe("launch cancellation",()=>{
 it("should stop exactly the owned native incarnations after launcher EOF",()=>{
  const stop=vi.fn(()=>true);
  expect(cleanupLaunch({host:"native",sessions:[{name:"h2a-worker",socketPath:"/private/owned.sock",generation:"g",incarnation:"i"},{name:"h2a-worker.h2a",socketPath:"/private/owned.sock",generation:"g",incarnation:"s"}]},{stopNative:stop,stopTmux:vi.fn()})).toBe(true);
  expect(stop.mock.calls).toEqual([["h2a-worker.h2a","g","s","/private/owned.sock"],["h2a-worker","g","i","/private/owned.sock"]]);
 });
 it("should not report a surviving or replaced incarnation as cleaned",()=>{
  expect(cleanupLaunch({host:"native",sessions:[{name:"h2a-worker",socketPath:"/private/owned.sock",generation:"g",incarnation:"i"}]},{stopNative:()=>false,stopTmux:vi.fn()})).toBe(false);
 });
 it("should continue cleaning the main session when the sidecar stop fails",()=>{
  const stop=vi.fn((name:string)=>{if(name.endsWith(".h2a"))throw new Error("unreachable");return true;});
  expect(cleanupLaunch({host:"native",sessions:[{name:"h2a-worker",socketPath:"/private/owned.sock",generation:"g",incarnation:"i"},{name:"h2a-worker.h2a",socketPath:"/private/owned.sock",generation:"g",incarnation:"s"}]},{stopNative:stop,stopTmux:vi.fn()})).toBe(false);
  expect(stop).toHaveBeenCalledTimes(2);
 });
 it("should fence tmux cancellation by the created pane and pid",()=>{
  const stop=vi.fn(()=>true);
  expect(cleanupLaunch({host:"tmux",sessions:[{name:"h2a-worker",pane:"%5",pid:123}]},{stopNative:vi.fn(),stopTmux:stop})).toBe(true);
  expect(stop).toHaveBeenCalledWith("h2a-worker","%5",123);
 });
});
