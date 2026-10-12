# Integrated HTTP transport

Sources: published `@hono/mcp@0.3.2` source map, fetched by the repository lockfile.
`dist/index.mjs` SHA-256: `5d4f9b97f00a2d9e70153c7cf50f6648badae5e95d2e383aa83c872e7f546938`.
`dist/index.mjs.map` SHA-256: `06676dcb68be83146cf93977e805d3e3f9f79b6464a9e26157815af8627298c3`.

Local changes: explicit ESM extension, JSON POST map retirement before resolving
the response, request map cleanup on close, and an empty HTTP 202 body for
notifications. The central imports its own payload implementation, without an
operator patch to `node_modules/@hono/mcp`. Hosted OAuth MCP keeps the external
package and is outside MH-L1. Extraction is never a postinstall operation.

MIT License

Copyright (c) 2022 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
