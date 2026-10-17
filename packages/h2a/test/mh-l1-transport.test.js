import test from "node:test";
import { StreamableHTTPTransport } from "../dist/runtime/mcp/transport/streamable-http.js";
import { exerciseTypedIdReuse } from "./helpers/mh-l1-transport.js";

test("MH-L1 transport should not reuse a completed JSON reply in a later batch with the same typed ID", () =>
  exerciseTypedIdReuse(StreamableHTTPTransport));
