/*!
MIT License

Copyright (c) 2026 Fabien Antoine (rhanka)

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

Bundled third-party code:

@sentropic/diagram-canvas@0.6.0
MIT License

Copyright (c) 2026 rhanka

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


@sentropic/diagram-core@0.6.1
MIT License

Copyright (c) 2026 rhanka

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

*/
// node_modules/@sentropic/diagram-canvas/dist/geometry.js
function normaliseRect(rect) {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}
function isFiniteRect(rect) {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height);
}
function rectsIntersect(left, right) {
  const a = normaliseRect(left);
  const b = normaliseRect(right);
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function rectUnion(left, right) {
  const a = normaliseRect(left);
  const b = normaliseRect(right);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  };
}
function rectFromPoints(points) {
  if (points.length === 0)
    return void 0;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    if (point.x < minX)
      minX = point.x;
    if (point.x > maxX)
      maxX = point.x;
    if (point.y < minY)
      minY = point.y;
    if (point.y > maxY)
      maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function rectCenter(rect) {
  const box = normaliseRect(rect);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// node_modules/@sentropic/diagram-core/dist/diagnostics.js
function diagnostic(input) {
  return {
    code: input.code,
    severity: input.severity ?? "error",
    path: input.path,
    message: input.message,
    ...input.refs === void 0 ? {} : { refs: input.refs },
    ...input.details === void 0 ? {} : { details: input.details }
  };
}
var hasErrors = (diagnostics) => diagnostics.some((entry) => entry.severity === "error");

// node_modules/@sentropic/diagram-core/dist/refs.js
var REF_KINDS = ["entity", "relation", "occurrence", "port", "view", "resource", "document"];
var LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var RefFormatError = class extends Error {
  kind;
  localId;
  constructor(kind, localId) {
    super(`invalid ${kind} local id ${JSON.stringify(localId)}: expected /${LOCAL_ID.source}/ (a reference is \`<namespace>:<localId>\`, so the local id may not contain \`:\`)`);
    this.name = "RefFormatError";
    this.kind = kind;
    this.localId = localId;
  }
};
function makeRef(kind, localId) {
  if (!LOCAL_ID.test(localId))
    throw new RefFormatError(kind, localId);
  return `${kind}:${localId}`;
}
function hasKind(value, kind) {
  if (typeof value !== "string")
    return false;
  const separator = value.indexOf(":");
  if (separator !== kind.length)
    return false;
  if (!value.startsWith(`${kind}:`))
    return false;
  return LOCAL_ID.test(value.slice(separator + 1));
}
var occurrenceRef = (localId) => makeRef("occurrence", localId);
var viewRef = (localId) => makeRef("view", localId);
function refKindOf(value) {
  for (const kind of REF_KINDS)
    if (hasKind(value, kind))
      return kind;
  return void 0;
}
function localIdOf(ref) {
  return ref.slice(ref.indexOf(":") + 1);
}
function parseRef(kind, value, path) {
  if (hasKind(value, kind))
    return { ok: true, ref: value };
  const seen = refKindOf(value);
  if (seen === void 0) {
    return {
      ok: false,
      diagnostic: diagnostic({
        code: "malformed-ref",
        path,
        message: `expected a ${kind} reference, got ${JSON.stringify(value)}`,
        details: { expectedKind: kind }
      })
    };
  }
  return {
    ok: false,
    diagnostic: diagnostic({
      code: "reference-type-mismatch",
      path,
      message: `expected a ${kind} reference, got a ${seen} reference (${String(value)})`,
      refs: [String(value)],
      details: { expectedKind: kind, seenKind: seen }
    })
  };
}

// node_modules/@sentropic/diagram-core/dist/attributes.js
function matchesPattern(source, value) {
  try {
    return new RegExp(source).test(value);
  } catch {
    return true;
  }
}
var ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
function isRealDate(text3) {
  if (!ISO_8601.test(text3))
    return false;
  const [year, month, day] = text3.slice(0, 10).split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
function validateScalar(schema, value, path, attributeName) {
  if (value.kind !== schema.kind) {
    return [
      diagnostic({
        code: "attribute-type-mismatch",
        path,
        message: `expected a ${schema.kind} value, got ${value.kind}`,
        details: { expectedKind: schema.kind, seenKind: value.kind }
      })
    ];
  }
  switch (schema.kind) {
    case "text": {
      const text3 = value.value;
      if (schema.maxLength !== void 0 && text3.length > schema.maxLength) {
        return [
          diagnostic({
            code: "text-too-long",
            path,
            message: `text is ${text3.length} characters, the schema allows ${schema.maxLength}`,
            details: { length: text3.length, maxLength: schema.maxLength }
          })
        ];
      }
      if (schema.minLength !== void 0 && text3.length < schema.minLength) {
        return [
          diagnostic({
            code: "text-pattern-mismatch",
            path,
            message: `value is shorter than the minimum length for ${attributeName}`,
            refs: [],
            details: { pattern: "min-length", length: text3.length, minLength: schema.minLength }
          })
        ];
      }
      if (schema.pattern !== void 0 && !matchesPattern(schema.pattern, text3)) {
        return [
          diagnostic({
            code: "text-pattern-mismatch",
            path,
            message: `value does not match the ${schema.patternName} grammar`,
            refs: [],
            details: schema.maxLength === void 0 ? { pattern: schema.patternName, length: text3.length } : { pattern: schema.patternName, length: text3.length, maxLength: schema.maxLength }
          })
        ];
      }
      return [];
    }
    case "boolean":
      return [];
    case "date": {
      const text3 = value.value;
      if (!isRealDate(text3)) {
        return [
          diagnostic({
            code: "date-not-iso8601",
            path,
            message: `${JSON.stringify(text3)} is not an ISO-8601 date or date-time`
          })
        ];
      }
      return [];
    }
    case "quantity": {
      const quantity = value;
      const diagnostics = [];
      if (typeof quantity.unit !== "string" || quantity.unit.length === 0) {
        diagnostics.push(diagnostic({
          code: "quantity-unit-missing",
          path,
          message: "a quantity carries a unit; none was given",
          details: { allowedUnits: schema.units.join(",") }
        }));
      } else if (!schema.units.includes(quantity.unit)) {
        diagnostics.push(diagnostic({
          code: "quantity-unit-not-allowed",
          path,
          message: `unit ${JSON.stringify(quantity.unit)} is not one of ${schema.units.join(", ")}`,
          details: { unit: quantity.unit, allowedUnits: schema.units.join(",") }
        }));
      }
      if (!Number.isFinite(quantity.value)) {
        diagnostics.push(diagnostic({
          code: "value-not-finite",
          path,
          message: `quantity magnitude is not finite (${String(quantity.value)})`
        }));
      }
      if (typeof quantity.value === "number" && Number.isFinite(quantity.value)) {
        if (schema.integer === true && !Number.isInteger(quantity.value)) {
          diagnostics.push(diagnostic({
            code: "quantity-not-integer",
            path,
            message: `value ${String(quantity.value)} is not an integer`,
            refs: [],
            details: { value: quantity.value, integer: "required" }
          }));
        } else if (schema.min !== void 0 && quantity.value < schema.min) {
          diagnostics.push(diagnostic({
            code: "quantity-below-min",
            path,
            message: `value ${String(quantity.value)} is below the minimum ${String(schema.min)}`,
            refs: [],
            details: { value: quantity.value, min: schema.min }
          }));
        } else if (schema.max !== void 0 && quantity.value > schema.max) {
          diagnostics.push(diagnostic({
            code: "quantity-above-max",
            path,
            message: `value ${String(quantity.value)} is above the maximum ${String(schema.max)}`,
            refs: [],
            details: { value: quantity.value, max: schema.max }
          }));
        }
      }
      return diagnostics;
    }
    case "enum": {
      const text3 = value.value;
      if (!schema.values.includes(text3)) {
        return [
          diagnostic({
            code: "enum-value-not-allowed",
            path,
            message: `${JSON.stringify(text3)} is not one of ${schema.values.join(", ")}`,
            details: { value: text3, allowedValues: schema.values.join(",") }
          })
        ];
      }
      return [];
    }
    case "reference": {
      const raw = value.value;
      const seen = refKindOf(raw);
      if (seen === void 0) {
        return [
          diagnostic({
            code: "malformed-ref",
            path,
            message: `${JSON.stringify(raw)} carries no identity namespace`,
            details: { expectedKind: schema.refKind }
          })
        ];
      }
      if (seen !== schema.refKind) {
        return [
          diagnostic({
            code: "reference-type-mismatch",
            path,
            message: `expected a ${schema.refKind} reference, got a ${seen} reference`,
            refs: [raw],
            details: { expectedKind: schema.refKind, seenKind: seen }
          })
        ];
      }
      return [];
    }
  }
}
function validateAttributeValue(schema, value, path) {
  if (schema.kind === "collection") {
    if (value.kind !== "collection") {
      return [
        diagnostic({
          code: "attribute-type-mismatch",
          path,
          message: `expected a collection of ${schema.item.kind}, got ${value.kind}`,
          details: { expectedKind: "collection", seenKind: value.kind }
        })
      ];
    }
    const diagnostics = [];
    const minItems = schema.minItems ?? 0;
    if (value.items.length > schema.maxItems) {
      diagnostics.push(diagnostic({
        code: "collection-bound-exceeded",
        path,
        message: `collection holds ${value.items.length} items, the bound is ${schema.maxItems}`,
        details: { bound: "max", items: value.items.length, maxItems: schema.maxItems }
      }));
    }
    if (value.items.length < minItems) {
      diagnostics.push(diagnostic({
        code: "collection-bound-exceeded",
        path,
        message: `collection holds ${value.items.length} items, the minimum is ${minItems}`,
        details: { bound: "min", items: value.items.length, minItems }
      }));
    }
    value.items.forEach((item, index) => {
      diagnostics.push(...validateScalar(schema.item, item, `${path}[${index}]`, schema.name));
    });
    return diagnostics;
  }
  if (value.kind === "collection") {
    return [
      diagnostic({
        code: "attribute-type-mismatch",
        path,
        message: `expected a ${schema.kind} value, got a collection`,
        details: { expectedKind: schema.kind, seenKind: "collection" }
      })
    ];
  }
  if (schema.kind === "struct") {
    if (value.kind !== "struct") {
      return [
        diagnostic({
          code: "attribute-type-mismatch",
          path,
          message: `expected a struct value, got ${value.kind}`,
          details: { expectedKind: "struct", seenKind: value.kind }
        })
      ];
    }
    return [];
  }
  if (value.kind === "struct") {
    return [
      diagnostic({
        code: "attribute-type-mismatch",
        path,
        message: `expected a ${schema.kind} value, got struct`,
        details: { expectedKind: schema.kind, seenKind: "struct" }
      })
    ];
  }
  return validateScalar(schema, value, path, schema.name);
}
function referencesOf(schema, value) {
  if (schema.kind === "collection") {
    if (value.kind !== "collection" || schema.item.kind !== "reference")
      return [];
    const refKind = schema.item.refKind;
    const found = [];
    value.items.forEach((item, index) => {
      if (item.kind === "reference")
        found.push({ raw: item.value, refKind, index });
    });
    return found;
  }
  if (schema.kind !== "reference" || value.kind !== "reference")
    return [];
  return [{ raw: value.value, refKind: schema.refKind }];
}

// node_modules/@sentropic/diagram-core/dist/hash.js
var OFFSET_BASIS = 0xcbf29ce484222325n;
var PRIME = 0x00000100000001b3n;
var MASK = 0xffffffffffffffffn;
function utf8Bytes(text3) {
  const bytes = [];
  for (let index = 0; index < text3.length; index += 1) {
    let codePoint = text3.charCodeAt(index);
    if (codePoint >= 55296 && codePoint <= 56319 && index + 1 < text3.length) {
      const low = text3.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        codePoint = (codePoint - 55296) * 1024 + (low - 56320) + 65536;
        index += 1;
      }
    }
    if (codePoint < 128) {
      bytes.push(codePoint);
    } else if (codePoint < 2048) {
      bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint < 65536) {
      bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    } else {
      bytes.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    }
  }
  return bytes;
}
var HASH_ALGORITHM = "fnv1a64";
function hashContent(content) {
  let hash = OFFSET_BASIS;
  for (const byte of utf8Bytes(content)) {
    hash = (hash ^ BigInt(byte)) * PRIME & MASK;
  }
  return `${HASH_ALGORITHM}:${hash.toString(16).padStart(16, "0")}`;
}

// node_modules/@sentropic/diagram-core/dist/sha256.js
function assertWellFormedUnicode(text3) {
  for (let i = 0; i < text3.length; i += 1) {
    const unit = text3.charCodeAt(i);
    if (unit >= 55296 && unit <= 56319) {
      const next = i + 1 < text3.length ? text3.charCodeAt(i + 1) : -1;
      if (next < 56320 || next > 57343)
        throw new Error("invalid-unicode:lone-surrogate");
      i += 1;
    } else if (unit >= 56320 && unit <= 57343) {
      throw new Error("invalid-unicode:lone-surrogate");
    }
  }
}
function canonicalStringify(value, active = /* @__PURE__ */ new Set()) {
  if (value === null)
    return "null";
  if (typeof value === "boolean")
    return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("non-finite-number");
    if (Number.isInteger(value))
      return String(value);
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    if (active.has(value))
      throw new Error("invalid-json:cycle");
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error("invalid-json:prototype");
    }
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string"))
      throw new Error("invalid-json:key");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => !(array && key === "length"));
    for (const key of keys) {
      assertWellFormedUnicode(key);
      const descriptor = descriptors[key];
      if (descriptor === void 0 || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("invalid-json:property");
      }
    }
    if (array && (keys.length !== value.length || keys.some((key, i) => key !== String(i)))) {
      throw new Error("invalid-json:array");
    }
    active.add(value);
    const bytes = array ? `[${keys.map((key) => canonicalStringify(descriptors[key].value, active)).join(",")}]` : `{${keys.sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(descriptors[key].value, active)}`).join(",")}}`;
    active.delete(value);
    return bytes;
  }
  throw new Error(`unserializable:${typeof value}`);
}
function canonicalBytes(value) {
  return canonicalStringify(value);
}
function utf8Bytes2(text3) {
  const bytes = [];
  for (let index = 0; index < text3.length; index += 1) {
    let codePoint = text3.charCodeAt(index);
    if (codePoint >= 55296 && codePoint <= 56319 && index + 1 < text3.length) {
      const low = text3.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        codePoint = (codePoint - 55296) * 1024 + (low - 56320) + 65536;
        index += 1;
      }
    }
    if (codePoint < 128) {
      bytes.push(codePoint);
    } else if (codePoint < 2048) {
      bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint < 65536) {
      bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    } else {
      bytes.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    }
  }
  return bytes;
}
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Hex(text3) {
  const message = utf8Bytes2(text3);
  const bitLengthHigh = Math.floor(message.length * 8 / 4294967296);
  const bitLengthLow = message.length * 8 >>> 0;
  const padded = [...message, 128];
  while (padded.length % 64 !== 56)
    padded.push(0);
  padded.push(bitLengthHigh >>> 24 & 255, bitLengthHigh >>> 16 & 255, bitLengthHigh >>> 8 & 255, bitLengthHigh & 255, bitLengthLow >>> 24 & 255, bitLengthLow >>> 16 & 255, bitLengthLow >>> 8 & 255, bitLengthLow & 255);
  let h0 = 1779033703;
  let h1 = 3144134277;
  let h2 = 1013904242;
  let h3 = 2773480762;
  let h4 = 1359893119;
  let h5 = 2600822924;
  let h6 = 528734635;
  let h7 = 1541459225;
  const w = new Array(64).fill(0);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      w[i] = padded[p] << 24 | padded[p + 1] << 16 | padded[p + 2] << 8 | padded[p + 3] | 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = (h + s1 + ch + K[i] + w[i] | 0) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = s0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

// node_modules/@sentropic/diagram-core/dist/bindings.js
var LEGACY_CONSTRAINTS_ADAPTER = "legacy-constraints@1";
var SCOPED_CONSTRAINTS_ADAPTER = "scoped-constraints@1";
var IMPOSED_ADAPTERS = {
  "generic@1": LEGACY_CONSTRAINTS_ADAPTER,
  "archimate@1": LEGACY_CONSTRAINTS_ADAPTER,
  "bpmn@1": LEGACY_CONSTRAINTS_ADAPTER,
  "uml@1": LEGACY_CONSTRAINTS_ADAPTER,
  "erd@1": SCOPED_CONSTRAINTS_ADAPTER,
  "generic@2": SCOPED_CONSTRAINTS_ADAPTER,
  "archimate@2": SCOPED_CONSTRAINTS_ADAPTER,
  "uml@2": SCOPED_CONSTRAINTS_ADAPTER,
  "process@1": SCOPED_CONSTRAINTS_ADAPTER
};
function imposedAdapterFor(profileId) {
  return IMPOSED_ADAPTERS[profileId];
}
var RETAINED_LEGACY_PROFILE_IDS = ["generic@1", "archimate@1", "bpmn@1", "uml@1"];
function isRetainedLegacyProfileId(profileId) {
  return RETAINED_LEGACY_PROFILE_IDS.includes(profileId);
}
function embeddedExecutorBindings(profiles) {
  return {
    schemaVersion: "1",
    rows: profiles.map((profile) => {
      const imposed = imposedAdapterFor(profile.id);
      if (imposed === void 0) {
        throw new Error(`no imposed executor adapter for profile ${profile.id}; pass an explicit binding row`);
      }
      return bindingRowFor(profile, imposed);
    })
  };
}
function stableStringify(value) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value))
        throw new Error("stableStringify: non-finite number");
      return JSON.stringify(value === 0 ? 0 : value);
    case "undefined":
      return "null";
    default:
      break;
  }
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`stableStringify: unsupported ${typeof value}`);
}
function contentDiagramPreimage(profile) {
  return {
    completeness: profile.completeness,
    constraints: [...profile.constraints],
    entityTypes: [...profile.entityTypes],
    limits: {
      maxEntities: profile.limits.maxEntities ?? null,
      maxRelations: profile.limits.maxRelations ?? null,
      maxEndpointsPerRelation: profile.limits.maxEndpointsPerRelation ?? null
    },
    portTypes: [...profile.portTypes],
    profile: profile.id,
    relationTypes: [...profile.relationTypes]
  };
}
function contentDiagramDigest(profile) {
  return sha256Hex(canonicalBytes(contentDiagramPreimage(profile)));
}
var digestProfile = (profile) => hashContent(stableStringify(profile));
function bindingRowFor(profile, declarationAdapter) {
  return {
    profileId: profile.id,
    profilePin: { id: profile.id, version: profile.version, contentDigest: contentDiagramDigest(profile) },
    declarationAdapter
  };
}
function verifyExecutorBindings(bindings, registry) {
  const diagnostics = [];
  if (bindings.schemaVersion !== "1") {
    return [
      diagnostic({
        code: "type-definition-conflict",
        path: "bindings.schemaVersion",
        message: `executor bindings schema version ${JSON.stringify(bindings.schemaVersion)} is not readable by this build`,
        details: { seen: String(bindings.schemaVersion) }
      })
    ];
  }
  const seen = /* @__PURE__ */ new Set();
  bindings.rows.forEach((row, index) => {
    const rowPath = `bindings.rows[${index}]`;
    if (seen.has(row.profileId)) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: rowPath,
        message: `executor binding for profile ${row.profileId} is declared twice`,
        details: { profile: row.profileId }
      }));
      return;
    }
    seen.add(row.profileId);
    const registered = registry.get(row.profileId);
    if (registered === void 0) {
      diagnostics.push(diagnostic({
        code: "unknown-profile",
        path: rowPath,
        message: `executor binding names profile ${row.profileId}, which is not in the registry`,
        details: { profile: row.profileId }
      }));
      return;
    }
    if (row.declarationAdapter !== LEGACY_CONSTRAINTS_ADAPTER && row.declarationAdapter !== SCOPED_CONSTRAINTS_ADAPTER) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: `${rowPath}.declarationAdapter`,
        message: `executor binding for ${row.profileId} names an unknown adapter`,
        details: { profile: row.profileId }
      }));
      return;
    }
    if (row.profilePin.id !== registered.id || row.profilePin.version !== registered.version || row.profilePin.contentDigest !== contentDiagramDigest(registered)) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: rowPath,
        message: `binding for ${row.profileId} does not match the registered bytes`,
        details: { profile: row.profileId }
      }));
    }
    const imposed = imposedAdapterFor(row.profileId);
    if (row.declarationAdapter === LEGACY_CONSTRAINTS_ADAPTER && !isRetainedLegacyProfileId(row.profileId) && imposed === void 0) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: rowPath,
        message: `executor binding for ${row.profileId} must use ${SCOPED_CONSTRAINTS_ADAPTER}, not ${LEGACY_CONSTRAINTS_ADAPTER}`,
        refs: [],
        details: { profile: row.profileId }
      }));
    }
    if (imposed !== void 0 && row.declarationAdapter !== imposed) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: rowPath,
        message: `executor binding for ${row.profileId} must use ${imposed}, not ${row.declarationAdapter}`,
        refs: [],
        details: { profile: row.profileId }
      }));
    }
  });
  return diagnostics;
}
function adapterFor(bindings, profileId) {
  if (bindings === void 0)
    return LEGACY_CONSTRAINTS_ADAPTER;
  return bindings.rows.find((row) => row.profileId === profileId)?.declarationAdapter;
}

// node_modules/@sentropic/diagram-core/dist/canonical.js
var CanonicalisationError = class extends Error {
  diagnostics;
  constructor(diagnostics) {
    super(`value is not canonically serialisable: ${diagnostics.map((entry) => entry.message).join("; ")}`);
    this.name = "CanonicalisationError";
    this.diagnostics = diagnostics;
  }
};
function encode(value, path, seen, diagnostics) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        diagnostics.push(diagnostic({ code: "value-not-finite", path, message: `${String(value)} is not a finite number` }));
        return void 0;
      }
      return JSON.stringify(value === 0 ? 0 : value);
    }
    case "undefined":
      return void 0;
    case "bigint":
    case "function":
    case "symbol":
      diagnostics.push(diagnostic({
        code: "value-not-serialisable",
        path,
        message: `a ${typeof value} cannot be part of a document`,
        details: { valueType: typeof value }
      }));
      return void 0;
    default:
      break;
  }
  const object = value;
  if (seen.has(object)) {
    diagnostics.push(diagnostic({ code: "value-not-serialisable", path, message: "cyclic value" }));
    return void 0;
  }
  const nested = new Set(seen).add(object);
  if (Array.isArray(object)) {
    const items = object.map((item, index) => {
      const encoded = encode(item, `${path}[${index}]`, nested, diagnostics);
      return encoded ?? "null";
    });
    return `[${items.join(",")}]`;
  }
  const entries = [];
  for (const key of Object.keys(object).sort()) {
    const encoded = encode(object[key], `${path}.${key}`, nested, diagnostics);
    if (encoded !== void 0)
      entries.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${entries.join(",")}}`;
}
function tryCanonicalise(value, path = "$") {
  const diagnostics = [];
  const text3 = encode(value, path, /* @__PURE__ */ new Set(), diagnostics);
  if (diagnostics.length > 0 || text3 === void 0) {
    return {
      ok: false,
      diagnostics: diagnostics.length > 0 ? diagnostics : [diagnostic({ code: "value-not-serialisable", path, message: "value encodes to nothing" })]
    };
  }
  return { ok: true, text: text3 };
}
function canonicalise(value, path = "$") {
  const result = tryCanonicalise(value, path);
  if (!result.ok)
    throw new CanonicalisationError(result.diagnostics);
  return result.text;
}

// node_modules/@sentropic/diagram-core/dist/chain-profile.js
function validateChainPredicates(profile) {
  if (profile.chainPredicates === void 0)
    return [];
  const root = `profiles.${profile.id}.chainPredicates`;
  const serialised = tryCanonicalise(profile.chainPredicates, root);
  if (!serialised.ok)
    return serialised.diagnostics;
  const diagnostics = [];
  const entities = new Set(profile.entityTypes.map((type) => type.id));
  const relations = new Set(profile.relationTypes.map((type) => type.id));
  const attributes = new Set(profile.entityTypes.flatMap((type) => type.attributes.map((field) => field.name)));
  const seen = /* @__PURE__ */ new Set();
  for (const [index, predicate] of profile.chainPredicates.entries()) {
    const path = `${root}[${index}]`;
    const fail = (check, field) => {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: `${path}${field}`,
        message: `chain predicate ${predicate.id} fails check ${check}`,
        details: { check }
      }));
    };
    const types = (values, known, field) => {
      if (values.length === 0 || values.some((value) => !known.has(value)))
        fail("chain-unknown-type", field);
    };
    const constraints = (values, field) => {
      for (const [i, constraint] of (values ?? []).entries()) {
        if (!attributes.has(constraint.attribute))
          fail("chain-unknown-type", `${field}[${i}].attribute`);
      }
    };
    const walk = (value, field) => {
      types(value.endTypes, entities, `${field}.endTypes`);
      constraints(value.endConstraints, `${field}.endConstraints`);
      if (value.steps.length === 0)
        fail("chain-unknown-type", `${field}.steps`);
      for (const [i, step] of value.steps.entries()) {
        types(step.relationTypes, relations, `${field}.steps[${i}].relationTypes`);
        if (step.direction !== "forward" && step.direction !== "inverse") {
          fail("chain-invalid-direction", `${field}.steps[${i}].direction`);
        }
        if (!["one", "zeroOrMore", "oneOrMore"].includes(step.repeat)) {
          fail("chain-invalid-repeat", `${field}.steps[${i}].repeat`);
        }
      }
    };
    if (predicate.id.length === 0 || seen.has(predicate.id))
      fail("chain-duplicate-id", ".id");
    seen.add(predicate.id);
    types(predicate.appliesTo.relationTypes, relations, ".appliesTo.relationTypes");
    types(predicate.appliesTo.startTypes, entities, ".appliesTo.startTypes");
    const roles = new Set(profile.relationTypes.filter((type) => predicate.appliesTo.relationTypes.includes(type.id)).flatMap((type) => type.roles.map((role3) => role3.role)));
    types(predicate.appliesTo.roles, roles, ".appliesTo.roles");
    constraints(predicate.startConstraints, ".startConstraints");
    if (predicate.alternatives.length === 0)
      fail("chain-unknown-type", ".alternatives");
    predicate.alternatives.forEach((alternative, i) => walk(alternative, `.alternatives[${i}]`));
    const aggregation2 = predicate.aggregation;
    const raw = predicate;
    if (predicate.selection !== "aggregate") {
      if (aggregation2 !== void 0 || raw["sort"] !== void 0 || raw["members"] !== void 0) {
        fail("chain-members-not-aggregate", ".aggregation");
      }
    } else if (aggregation2?.memberRelationTypes === void 0 || aggregation2.memberTargetChain === void 0 || aggregation2.memberSourceChain === void 0) {
      fail("chain-members-not-aggregate", ".aggregation");
    } else {
      types(aggregation2.memberRelationTypes, relations, ".aggregation.memberRelationTypes");
      walk(aggregation2.memberTargetChain, ".aggregation.memberTargetChain");
      walk(aggregation2.memberSourceChain, ".aggregation.memberSourceChain");
      if (aggregation2.sort !== void 0 && aggregation2.sort !== "sourceId,targetId,relationId") {
        fail("chain-members-not-aggregate", ".aggregation.sort");
      }
    }
  }
  return diagnostics;
}

// node_modules/@sentropic/diagram-core/dist/profile.js
function createProfileRegistry(profiles) {
  const byId = /* @__PURE__ */ new Map();
  for (const profile of profiles) {
    const existing = byId.get(profile.id);
    if (existing !== void 0) {
      throw new Error(`profile ${profile.id} registered twice; a profile id is a version, not a name`);
    }
    byId.set(profile.id, profile);
  }
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => [...byId.keys()].sort()
  };
}
var entityTypeOf = (profile, typeId) => profile.entityTypes.find((type) => type.id === typeId);
var portTypeOf = (profile, typeId) => profile.portTypes.find((type) => type.id === typeId);
var relationTypeOf = (profile, typeId) => profile.relationTypes.find((type) => type.id === typeId);
var roleOf = (relationType, role3) => relationType.roles.find((declared) => declared.role === role3);
function validateProfile(profile, adapter = "legacy-constraints@1") {
  const diagnostics = [];
  const path = `profiles.${profile.id}`;
  const seenEntityTypes = /* @__PURE__ */ new Set();
  for (const type of profile.entityTypes) {
    if (seenEntityTypes.has(type.id)) {
      diagnostics.push(diagnostic({ code: "duplicate-id", path: `${path}.entityTypes.${type.id}`, message: "entity type declared twice" }));
    }
    seenEntityTypes.add(type.id);
    diagnostics.push(...duplicateAttributeNames(type.attributes, `${path}.entityTypes.${type.id}.attributes`));
  }
  for (const type of profile.relationTypes) {
    const roles = new Set(type.roles.map((role3) => role3.role));
    for (const role3 of type.roles) {
      if (role3.cardinality.max < role3.cardinality.min || role3.cardinality.min < 0) {
        diagnostics.push(diagnostic({
          code: "endpoint-cardinality-violation",
          path: `${path}.relationTypes.${type.id}.roles.${role3.role}`,
          message: `declared cardinality ${role3.cardinality.min}..${role3.cardinality.max} is empty or negative`
        }));
      }
      for (const entityType of role3.entityTypes ?? []) {
        if (!seenEntityTypes.has(entityType)) {
          diagnostics.push(diagnostic({
            code: "unknown-entity-type",
            path: `${path}.relationTypes.${type.id}.roles.${role3.role}.entityTypes`,
            message: `role accepts entity type ${entityType}, which the profile does not declare`
          }));
        }
      }
    }
    const hierarchy3 = type.hierarchy;
    if (hierarchy3 !== void 0) {
      for (const role3 of [hierarchy3.parentRole, hierarchy3.childRole]) {
        if (!roles.has(role3)) {
          diagnostics.push(diagnostic({
            code: "endpoint-role-unknown",
            path: `${path}.relationTypes.${type.id}.hierarchy`,
            message: `hierarchy ${hierarchy3.id} names role ${role3}, which the relation type does not declare`
          }));
        }
      }
    }
  }
  for (const [index, constraint] of profile.constraints.entries()) {
    if (constraint.kind === "acyclic-hierarchy") {
      const declared = profile.relationTypes.some((type) => type.hierarchy?.id === constraint.hierarchyId);
      if (!declared) {
        diagnostics.push(diagnostic({
          code: "type-definition-conflict",
          path: `${path}.constraints`,
          message: `constraint names hierarchy ${constraint.hierarchyId}, which no relation type declares`
        }));
      }
    } else if (constraint.kind === "unique-attribute" || constraint.kind === "max-entities-of-type") {
      if (!seenEntityTypes.has(constraint.entityType)) {
        diagnostics.push(diagnostic({
          code: "unknown-entity-type",
          path: `${path}.constraints`,
          message: `constraint names entity type ${constraint.entityType}, which the profile does not declare`
        }));
      }
      if (constraint.kind === "unique-attribute" && adapter === "scoped-constraints@1" && constraint.scope === void 0) {
        diagnostics.push(diagnostic({
          code: "type-definition-conflict",
          path: `${path}.constraints[${index}]`,
          message: `unique-attribute constraint for ${constraint.entityType}.${constraint.attribute} requires an explicit scope`,
          refs: [],
          details: { check: "unique-scope-missing", type: constraint.entityType, attribute: constraint.attribute }
        }));
      }
    }
  }
  diagnostics.push(...validateM3Declarations(profile, seenEntityTypes, adapter));
  diagnostics.push(...validateChainPredicates(profile));
  return diagnostics;
}
function validateM3Declarations(profile, seenEntityTypes, adapter) {
  const diagnostics = [];
  const path = `profiles.${profile.id}`;
  profile.entityTypes.forEach((type, typeIndex) => {
    if (type.abstract === true && type.container === true) {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: `${path}.entityTypes[${typeIndex}]`,
        message: `abstract type ${type.id} cannot declare container capability`,
        refs: [],
        details: { check: "abstract-container", type: type.id }
      }));
    }
    type.attributes.forEach((schema, schemaIndex) => {
      diagnostics.push(...qualifyAttributeSchema(schema, `${path}.entityTypes[${typeIndex}].attributes[${schemaIndex}]`));
    });
  });
  profile.portTypes.forEach((type, typeIndex) => {
    (type.attributes ?? []).forEach((schema, schemaIndex) => {
      diagnostics.push(...qualifyAttributeSchema(schema, `${path}.portTypes[${typeIndex}].attributes[${schemaIndex}]`));
    });
  });
  profile.relationTypes.forEach((type, typeIndex) => {
    (type.attributes ?? []).forEach((schema, schemaIndex) => {
      diagnostics.push(...qualifyAttributeSchema(schema, `${path}.relationTypes[${typeIndex}].attributes[${schemaIndex}]`));
    });
  });
  diagnostics.push(...validateSupertypes(profile));
  profile.constraints.forEach((constraint, index) => {
    const constraintPath = `${path}.constraints[${index}]`;
    switch (constraint.kind) {
      case "unique-attribute":
        if (constraint.scope !== void 0 && adapter === "scoped-constraints@1") {
          diagnostics.push(...validateUniqueScope(profile, constraint.entityType, constraint.attribute, constraint.scope, constraintPath));
        }
        break;
      case "relationship-matrix": {
        const seen = /* @__PURE__ */ new Set();
        let invalid = false;
        for (const tuple of constraint.tuples) {
          const key = `${tuple.relationType}
${tuple.sourceType}
${tuple.targetType}`;
          const sourceKnown = tuple.sourceType === "@relation" || seenEntityTypes.has(tuple.sourceType);
          const targetKnown = tuple.targetType === "@relation" || seenEntityTypes.has(tuple.targetType);
          if (tuple.relationType.length === 0 || tuple.sourceType.length === 0 || tuple.targetType.length === 0 || seen.has(key) || profile.relationTypes.every((declared) => declared.id !== tuple.relationType) || !sourceKnown || !targetKnown) {
            invalid = true;
            break;
          }
          seen.add(key);
        }
        if (invalid) {
          diagnostics.push(diagnostic({
            code: "type-definition-conflict",
            path: constraintPath,
            message: `relationship matrix ${constraint.matrixId} has an invalid or duplicate tuple`,
            refs: [],
            details: { check: "matrix-constraint-invalid", matrixId: constraint.matrixId }
          }));
        }
        break;
      }
      case "hierarchy": {
        const declaration3 = profile.relationTypes.find((type) => type.id === constraint.relationType);
        const hierarchy3 = declaration3?.hierarchy;
        if (declaration3 === void 0 || hierarchy3 === void 0 || hierarchy3.id !== constraint.hierarchyId || hierarchy3.parentRole !== constraint.parentRole || hierarchy3.childRole !== constraint.childRole) {
          diagnostics.push(diagnostic({
            code: "type-definition-conflict",
            path: constraintPath,
            message: `hierarchy constraint names relation type ${constraint.relationType}, which does not declare hierarchy ${constraint.hierarchyId} with roles ${constraint.parentRole}/${constraint.childRole}`,
            refs: [],
            details: {
              check: "hierarchy-constraint-invalid",
              relationType: constraint.relationType,
              hierarchyId: constraint.hierarchyId
            }
          }));
        }
        break;
      }
      case "parent-family":
        diagnostics.push(...requireHierarchy(profile, constraint.hierarchyId, constraintPath));
        for (const root of constraint.familyRoots) {
          requireEntityType(seenEntityTypes, root, constraintPath, diagnostics);
        }
        break;
      case "children-restricted":
      case "required-parent": {
        diagnostics.push(...requireHierarchy(profile, constraint.hierarchyId, constraintPath));
        for (const root of constraint.parentFamilyRoots) {
          requireEntityType(seenEntityTypes, root, constraintPath, diagnostics);
        }
        for (const child of constraint.childTypes) {
          requireEntityType(seenEntityTypes, child, constraintPath, diagnostics);
        }
        break;
      }
      case "bound-pair":
        requireEntityType(seenEntityTypes, constraint.valueType, constraintPath, diagnostics);
        break;
      case "reference-application":
        requireEntityType(seenEntityTypes, constraint.declarationType, constraintPath, diagnostics);
        break;
      case "incident-type-uniformity":
        requireEntityType(seenEntityTypes, constraint.entityType, constraintPath, diagnostics);
        for (const relationType of constraint.relationTypes) {
          if (profile.relationTypes.every((declared) => declared.id !== relationType)) {
            diagnostics.push(diagnostic({
              code: "unknown-relation-type",
              path: constraintPath,
              message: `constraint names relation type ${relationType}, which the profile does not declare`
            }));
          }
        }
        break;
      case "at-most-value":
        if (profile.relationTypes.every((declared) => declared.id !== constraint.relationType)) {
          diagnostics.push(diagnostic({
            code: "unknown-relation-type",
            path: constraintPath,
            message: `constraint names relation type ${constraint.relationType}, which the profile does not declare`
          }));
        }
        break;
      case "collection-unique":
        requireEntityType(seenEntityTypes, constraint.entityType, constraintPath, diagnostics);
        break;
      case "acyclic-hierarchy":
      case "max-entities-of-type":
        break;
    }
  });
  return diagnostics;
}
function requireEntityType(seenEntityTypes, typeId, constraintPath, diagnostics) {
  if (!seenEntityTypes.has(typeId)) {
    diagnostics.push(diagnostic({
      code: "unknown-entity-type",
      path: constraintPath,
      message: `constraint names entity type ${typeId}, which the profile does not declare`
    }));
  }
}
function requireHierarchy(profile, hierarchyId, constraintPath) {
  const declared = profile.relationTypes.some((type) => type.hierarchy?.id === hierarchyId);
  if (declared)
    return [];
  return [
    diagnostic({
      code: "type-definition-conflict",
      path: constraintPath,
      message: `constraint names hierarchy ${hierarchyId}, which no relation type declares`
    })
  ];
}
function profileAncestry(profile, typeId) {
  const ancestry = [typeId];
  const seen = /* @__PURE__ */ new Set([typeId]);
  const stack = [typeId];
  while (stack.length > 0) {
    const current = stack.pop();
    const declared = profile.entityTypes.find((type) => type.id === current);
    for (const superId of declared?.supertypes ?? []) {
      if (seen.has(superId))
        continue;
      seen.add(superId);
      ancestry.push(superId);
      stack.push(superId);
    }
  }
  return ancestry;
}
function selectGroupingHierarchy(profile, entityType, withinType) {
  const candidates = profile.relationTypes.filter((relation) => {
    const hierarchy4 = relation.hierarchy;
    if (hierarchy4 === void 0)
      return false;
    const parent = relation.roles.find((role3) => role3.role === hierarchy4.parentRole);
    const child = relation.roles.find((role3) => role3.role === hierarchy4.childRole);
    if (parent === void 0 || child === void 0)
      return false;
    if (!roleAccepts(profile, child, entityType))
      return false;
    if (withinType !== void 0 && !roleAccepts(profile, parent, withinType))
      return false;
    return true;
  });
  if (candidates.length !== 1)
    return void 0;
  const hierarchy3 = candidates[0].hierarchy;
  return { hierarchyId: hierarchy3.id };
}
function roleAccepts(profile, role3, entityType) {
  if (!role3.targets.includes("entity"))
    return false;
  if (role3.entityTypes === void 0)
    return true;
  return role3.entityTypes.some((allowed) => profileAncestry(profile, entityType).includes(allowed));
}
function validateUniqueScope(profile, entityType, attribute, scope, constraintPath) {
  if (scope === "document")
    return [];
  const noHierarchy = () => [
    diagnostic({
      code: "type-definition-conflict",
      path: constraintPath,
      message: `unique-attribute constraint for ${entityType}.${attribute} selects no unique hierarchy`,
      refs: [],
      details: { check: "unique-hierarchy-selection", type: entityType, attribute }
    })
  ];
  if (scope === "siblings") {
    if (selectGroupingHierarchy(profile, entityType) === void 0)
      return noHierarchy();
    return [];
  }
  if (!profile.entityTypes.some((type) => type.id === scope.withinType)) {
    return [
      diagnostic({
        code: "unknown-entity-type",
        path: constraintPath,
        message: `constraint names entity type ${scope.withinType}, which the profile does not declare`
      })
    ];
  }
  if (selectGroupingHierarchy(profile, entityType, scope.withinType) === void 0)
    return noHierarchy();
  return [];
}
function isQualifiablePattern(source) {
  if (source.length === 0 || source[0] !== "^")
    return false;
  if (!/^[\x00-\x7F]*$/.test(source))
    return false;
  let backslashes = 0;
  for (let index = source.length - 2; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  if (source[source.length - 1] !== "$" || backslashes % 2 === 1)
    return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
function qualifyAttributeSchema(schema, schemaPath) {
  if (schema.kind === "collection") {
    const item = schema.item;
    if (item.kind === "text" || item.kind === "quantity") {
      return qualifyScalarShape(item, `${schemaPath}.item`, schema.name);
    }
    return [];
  }
  if (schema.kind === "text" || schema.kind === "quantity") {
    return qualifyScalarShape(schema, schemaPath, schema.name);
  }
  return [];
}
function qualifyScalarShape(shape, shapePath, attributeName) {
  if (shape.kind === "text") {
    const patternInvalid = shape.pattern !== void 0 && (shape.patternName === void 0 || !isQualifiablePattern(shape.pattern)) || shape.minLength !== void 0 && shape.minLength < 0 || shape.maxLength !== void 0 && shape.maxLength < 0 || shape.minLength !== void 0 && shape.maxLength !== void 0 && shape.minLength > shape.maxLength;
    if (patternInvalid) {
      return [
        diagnostic({
          code: "type-definition-conflict",
          path: shapePath,
          message: `text schema for ${attributeName} has an invalid pattern or length bounds`,
          refs: [],
          details: { check: "text-pattern-invalid", attribute: attributeName }
        })
      ];
    }
    return [];
  }
  const boundsInvalid = shape.min !== void 0 && (typeof shape.min !== "number" || !Number.isFinite(shape.min)) || shape.max !== void 0 && (typeof shape.max !== "number" || !Number.isFinite(shape.max)) || shape.min !== void 0 && shape.max !== void 0 && shape.min > shape.max;
  if (boundsInvalid) {
    return [
      diagnostic({
        code: "type-definition-conflict",
        path: shapePath,
        message: `quantity schema for ${attributeName} has invalid numeric bounds`,
        refs: [],
        details: { check: "numeric-constraint-invalid", attribute: attributeName }
      })
    ];
  }
  return [];
}
function validateSupertypes(profile) {
  const diagnostics = [];
  const path = `profiles.${profile.id}`;
  const byId = new Map(profile.entityTypes.map((type) => [type.id, type]));
  const reportedUnknown = /* @__PURE__ */ new Set();
  const reportedCycles = /* @__PURE__ */ new Set();
  const memoBroken = /* @__PURE__ */ new Map();
  const memoInherited = /* @__PURE__ */ new Map();
  const reportUnknown = (holderId, superId, index) => {
    if (reportedUnknown.has(superId))
      return;
    reportedUnknown.add(superId);
    diagnostics.push(diagnostic({
      code: "supertype-unknown",
      path: `${path}.entityTypes.${holderId}.supertypes[${index}]`,
      message: `supertype ${superId} is not declared`,
      refs: [],
      details: { supertype: superId }
    }));
  };
  const reportCycle = (holderId, ordered) => {
    const smallest = [...ordered].sort()[0];
    const first = ordered.indexOf(smallest);
    const key = JSON.stringify([...ordered.slice(first), ...ordered.slice(0, first)]);
    if (reportedCycles.has(key))
      return;
    reportedCycles.add(key);
    diagnostics.push(diagnostic({
      code: "supertype-cycle",
      path: `${path}.entityTypes.${holderId}.supertypes`,
      message: `supertype chain for ${holderId} is cyclic`,
      refs: [],
      details: { type: holderId }
    }));
  };
  const walkBroken = (rootId) => {
    const cached = memoBroken.get(rootId);
    if (cached !== void 0)
      return cached;
    const root = byId.get(rootId);
    if (root === void 0)
      return true;
    const direct = root.supertypes ?? [];
    if (direct.length === 0) {
      memoBroken.set(rootId, false);
      return false;
    }
    let rootBroken = false;
    const trail = [rootId];
    const onTrail = /* @__PURE__ */ new Set([rootId]);
    const stack = [{ id: rootId, supers: direct, next: 0, broken: false }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next < frame.supers.length) {
        const superId = frame.supers[frame.next];
        const edgeIndex = frame.next;
        frame.next += 1;
        const declared = byId.get(superId);
        if (declared === void 0) {
          frame.broken = true;
          rootBroken = true;
          reportUnknown(frame.id, superId, edgeIndex);
          continue;
        }
        if (onTrail.has(superId)) {
          frame.broken = true;
          rootBroken = true;
          reportCycle(frame.id, trail.slice(trail.indexOf(superId)));
          continue;
        }
        const known = memoBroken.get(superId);
        if (known !== void 0) {
          if (known) {
            frame.broken = true;
            rootBroken = true;
          }
          continue;
        }
        trail.push(superId);
        onTrail.add(superId);
        stack.push({ id: superId, supers: declared.supertypes ?? [], next: 0, broken: false });
      } else {
        memoBroken.set(frame.id, frame.broken);
        stack.pop();
        const removed = trail.pop();
        onTrail.delete(removed);
        if (frame.broken) {
          rootBroken = true;
          const parent = stack[stack.length - 1];
          if (parent !== void 0)
            parent.broken = true;
        }
      }
    }
    memoBroken.set(rootId, rootBroken);
    return rootBroken;
  };
  const inheritedOf = (rootId) => {
    const cached = memoInherited.get(rootId);
    if (cached !== void 0)
      return cached;
    const reachable = [];
    const seen = /* @__PURE__ */ new Set([rootId]);
    const order = [];
    const stack = [];
    const rootDeclared = byId.get(rootId);
    if (rootDeclared === void 0) {
      const empty = /* @__PURE__ */ new Map();
      memoInherited.set(rootId, empty);
      return empty;
    }
    stack.push({ id: rootId, next: 0, supers: rootDeclared.supertypes ?? [] });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next < frame.supers.length) {
        const superId = frame.supers[frame.next];
        frame.next += 1;
        if (seen.has(superId))
          continue;
        const declared = byId.get(superId);
        if (declared === void 0)
          continue;
        seen.add(superId);
        reachable.push(superId);
        stack.push({ id: superId, next: 0, supers: declared.supertypes ?? [] });
      } else {
        order.push(frame.id);
        stack.pop();
      }
    }
    for (const id of order) {
      if (memoInherited.has(id))
        continue;
      const declared = byId.get(id);
      if (declared === void 0)
        continue;
      const merged = /* @__PURE__ */ new Map();
      for (const superId of declared.supertypes ?? []) {
        const parentInherited = memoInherited.get(superId);
        if (parentInherited !== void 0) {
          for (const [name, schemas] of parentInherited) {
            const existing = merged.get(name);
            if (existing === void 0)
              merged.set(name, [...schemas]);
            else
              existing.push(...schemas);
          }
        }
        const parent = byId.get(superId);
        if (parent === void 0)
          continue;
        for (const schema of parent.attributes) {
          const existing = merged.get(schema.name);
          if (existing === void 0)
            merged.set(schema.name, [schema]);
          else
            existing.push(schema);
        }
      }
      memoInherited.set(id, merged);
    }
    return memoInherited.get(rootId) ?? /* @__PURE__ */ new Map();
  };
  for (const type of profile.entityTypes) {
    const supertypes = type.supertypes;
    if (supertypes === void 0 || supertypes.length === 0)
      continue;
    const broken = walkBroken(type.id);
    if (broken)
      continue;
    const inherited = inheritedOf(type.id);
    const own = new Map(type.attributes.map((schema) => [schema.name, schema]));
    for (const [name, candidates] of inherited) {
      const compared = [...candidates.map((schema) => stableStringify(schema))];
      const ownSchema = own.get(name);
      if (ownSchema !== void 0)
        compared.push(stableStringify(ownSchema));
      if (new Set(compared).size > 1) {
        diagnostics.push(diagnostic({
          code: "attribute-conflict",
          path: `${path}.entityTypes.${type.id}.attributes.${name}`,
          message: `inherited attribute ${name} has incompatible schemas on ${type.id}`,
          refs: [],
          details: { attribute: name, type: type.id }
        }));
      }
    }
  }
  return diagnostics;
}
function duplicateAttributeNames(attributes, path) {
  const seen = /* @__PURE__ */ new Set();
  const diagnostics = [];
  for (const attribute of attributes) {
    if (seen.has(attribute.name)) {
      diagnostics.push(diagnostic({ code: "duplicate-id", path: `${path}.${attribute.name}`, message: "attribute declared twice" }));
    }
    seen.add(attribute.name);
  }
  return diagnostics;
}

// node_modules/@sentropic/diagram-core/dist/profiles/archimate-matrix.js
var ARCHIMATE_CATALOGUE = [{ "name": "ApplicationCollaboration", "id": "application-collaboration", "layer": "application", "aspect": "active" }, { "name": "ApplicationComponent", "id": "application-component", "layer": "application", "aspect": "active" }, { "name": "ApplicationEvent", "id": "application-event", "layer": "application", "aspect": "behaviour" }, { "name": "ApplicationFunction", "id": "application-function", "layer": "application", "aspect": "behaviour" }, { "name": "ApplicationInteraction", "id": "application-interaction", "layer": "application", "aspect": "behaviour" }, { "name": "ApplicationInterface", "id": "application-interface", "layer": "application", "aspect": "active" }, { "name": "ApplicationProcess", "id": "application-process", "layer": "application", "aspect": "behaviour" }, { "name": "ApplicationService", "id": "application-service", "layer": "application", "aspect": "behaviour" }, { "name": "Artifact", "id": "artifact", "layer": "technology", "aspect": "passive" }, { "name": "Assessment", "id": "assessment", "layer": "motivation", "aspect": "motivation" }, { "name": "BusinessActor", "id": "business-actor", "layer": "business", "aspect": "active" }, { "name": "BusinessCollaboration", "id": "business-collaboration", "layer": "business", "aspect": "active" }, { "name": "BusinessEvent", "id": "business-event", "layer": "business", "aspect": "behaviour" }, { "name": "BusinessFunction", "id": "business-function", "layer": "business", "aspect": "behaviour" }, { "name": "BusinessInteraction", "id": "business-interaction", "layer": "business", "aspect": "behaviour" }, { "name": "BusinessInterface", "id": "business-interface", "layer": "business", "aspect": "active" }, { "name": "BusinessObject", "id": "business-object", "layer": "business", "aspect": "passive" }, { "name": "BusinessProcess", "id": "business-process", "layer": "business", "aspect": "behaviour" }, { "name": "BusinessRole", "id": "business-role", "layer": "business", "aspect": "active" }, { "name": "BusinessService", "id": "business-service", "layer": "business", "aspect": "behaviour" }, { "name": "Capability", "id": "capability", "layer": "strategy", "aspect": "behaviour" }, { "name": "CommunicationNetwork", "id": "communication-network", "layer": "technology", "aspect": "active" }, { "name": "Constraint", "id": "constraint", "layer": "motivation", "aspect": "motivation" }, { "name": "Contract", "id": "contract", "layer": "business", "aspect": "passive" }, { "name": "CourseOfAction", "id": "course-of-action", "layer": "strategy", "aspect": "behaviour" }, { "name": "DataObject", "id": "data-object", "layer": "application", "aspect": "passive" }, { "name": "Deliverable", "id": "deliverable", "layer": "implementation", "aspect": "passive" }, { "name": "Device", "id": "device", "layer": "technology", "aspect": "active" }, { "name": "DistributionNetwork", "id": "distribution-network", "layer": "physical", "aspect": "active" }, { "name": "Driver", "id": "driver", "layer": "motivation", "aspect": "motivation" }, { "name": "Equipment", "id": "equipment", "layer": "physical", "aspect": "active" }, { "name": "Facility", "id": "facility", "layer": "physical", "aspect": "active" }, { "name": "Gap", "id": "gap", "layer": "implementation", "aspect": "passive" }, { "name": "Goal", "id": "goal", "layer": "motivation", "aspect": "motivation" }, { "name": "Grouping", "id": "grouping", "layer": "none", "aspect": "composite" }, { "name": "ImplementationEvent", "id": "implementation-event", "layer": "implementation", "aspect": "behaviour" }, { "name": "Junction", "id": "junction", "layer": "none", "aspect": "other" }, { "name": "Location", "id": "location", "layer": "none", "aspect": "composite" }, { "name": "Material", "id": "material", "layer": "physical", "aspect": "passive" }, { "name": "Meaning", "id": "meaning", "layer": "motivation", "aspect": "motivation" }, { "name": "Node", "id": "node", "layer": "technology", "aspect": "active" }, { "name": "Outcome", "id": "outcome", "layer": "motivation", "aspect": "motivation" }, { "name": "Path", "id": "path", "layer": "technology", "aspect": "active" }, { "name": "Plateau", "id": "plateau", "layer": "implementation", "aspect": "composite" }, { "name": "Principle", "id": "principle", "layer": "motivation", "aspect": "motivation" }, { "name": "Product", "id": "product", "layer": "business", "aspect": "composite" }, { "name": "Representation", "id": "representation", "layer": "business", "aspect": "passive" }, { "name": "Requirement", "id": "requirement", "layer": "motivation", "aspect": "motivation" }, { "name": "Resource", "id": "resource", "layer": "strategy", "aspect": "active" }, { "name": "Stakeholder", "id": "stakeholder", "layer": "motivation", "aspect": "motivation" }, { "name": "SystemSoftware", "id": "system-software", "layer": "technology", "aspect": "active" }, { "name": "TechnologyCollaboration", "id": "technology-collaboration", "layer": "technology", "aspect": "active" }, { "name": "TechnologyEvent", "id": "technology-event", "layer": "technology", "aspect": "behaviour" }, { "name": "TechnologyFunction", "id": "technology-function", "layer": "technology", "aspect": "behaviour" }, { "name": "TechnologyInteraction", "id": "technology-interaction", "layer": "technology", "aspect": "behaviour" }, { "name": "TechnologyInterface", "id": "technology-interface", "layer": "technology", "aspect": "active" }, { "name": "TechnologyProcess", "id": "technology-process", "layer": "technology", "aspect": "behaviour" }, { "name": "TechnologyService", "id": "technology-service", "layer": "technology", "aspect": "behaviour" }, { "name": "Value", "id": "value", "layer": "motivation", "aspect": "motivation" }, { "name": "ValueStream", "id": "value-stream", "layer": "strategy", "aspect": "behaviour" }, { "name": "WorkPackage", "id": "work-package", "layer": "implementation", "aspect": "behaviour" }];
var ARCHIMATE_CONCEPT_NAMES = ["ApplicationCollaboration", "ApplicationComponent", "ApplicationEvent", "ApplicationFunction", "ApplicationInteraction", "ApplicationInterface", "ApplicationProcess", "ApplicationService", "Artifact", "Assessment", "BusinessActor", "BusinessCollaboration", "BusinessEvent", "BusinessFunction", "BusinessInteraction", "BusinessInterface", "BusinessObject", "BusinessProcess", "BusinessRole", "BusinessService", "Capability", "CommunicationNetwork", "Constraint", "Contract", "CourseOfAction", "DataObject", "Deliverable", "Device", "DistributionNetwork", "Driver", "Equipment", "Facility", "Gap", "Goal", "Grouping", "ImplementationEvent", "Junction", "Location", "Material", "Meaning", "Node", "Outcome", "Path", "Plateau", "Principle", "Product", "Relationship", "Representation", "Requirement", "Resource", "Stakeholder", "SystemSoftware", "TechnologyCollaboration", "TechnologyEvent", "TechnologyFunction", "TechnologyInteraction", "TechnologyInterface", "TechnologyProcess", "TechnologyService", "Value", "ValueStream", "WorkPackage"];
var ARCHIMATE_MATRIX_CELLS = [
  "cfgostv fgortv fiortv fiortv fiortv cfgortv fiortv fiortv ao no fotv fotv fortv fortv fortv fortv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv cfgorstv fiortv fiortv fiortv cfgortv fiortv fiortv ao no fotv fotv fortv fortv fortv fortv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv cfgostv fotv fotv fotv fotv fotv ao no fotv fotv fortv fotv fotv fotv ao fotv fotv fotv o fotv nor ao o ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no o o",
  "fotv fotv fotv cfgostv cfgotv fotv cfgotv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv cfgotv cfgostv fotv cfgotv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv fotv fotv cfgostv fotv fiotv ao no fotv fotv fotv fotv fotv fortv ao fotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv cfgotv cfgotv fotv cfgostv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv fotv fotv fotv fotv cfgostv ao no fotv fotv fotv fotv fotv fotv ao fotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "or or or or or or or or cgors no o o or or or or or or o or or o nor or or or o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o nor or no or o or or or or or or no or o",
  "o o o o o o o o o cgnos o o o o o o o o o o o o no o o o o o o no o o o no cgnos o acfginorstv o o no o no o o no o o o no o no o o o o o o o o no o o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no cfgostv fotv fiotv fiotv fiotv cfgiotv ao fiotv fiotv fiortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv io acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or ino fotv fotv fotv fotv fotv fotv fotv fotv no or io",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fgotv cfgostv fiotv fiotv fiotv cfgiotv ao fiotv fgiotv fiortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv io acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or ino fotv fotv fotv fotv fotv fotv fotv fotv no or io",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv cfgostv fotv fotv fotv ao fotv fotv fotv o fotv nor ao o ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no o o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fotv cfgostv cfgotv fotv ao cfgotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fotv cfgotv cfgostv fotv ao cfgotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fotv fotv fotv cfgostv ao fotv fotv fiotv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "o o o o o o o o o no o o o o o o cgos o o o or o nor cgos or o o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o nor or no o o o o o o o o no or o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fotv cfgotv cfgotv fotv ao cfgostv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fiotv fiotv fiotv cfgotv ao fiotv cfgostv fiortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv io acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or ino fotv fotv fotv fotv fotv fotv fotv fotv no or io",
  "fotv fotv fotv fotv fotv fotv fotv fotv ao no fotv fotv fotv fotv fotv fotv ao fotv fotv cfgostv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv fotv no or o",
  "o o o o o o o o o no o o o o o o o o o o cfgostv o nor o fortv o o o o no o o o nor cfgnorstv o acfginorstv o o no o nor o o nor o o o nor fotv no o o o o o o o o no fotv o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fortv fortv fortv fortv fortv fortv ao fortv fortv fortv or cfgostv nor ao or ao o fgortv fotv no fortv fortv o nor acfginorstv o acfginorstv fotv ao no fortv nor fortv o nor fotv o ao nor or nor fgiortv fortv fiortv fiortv fiortv fgiortv fiortv fiortv no or o",
  "o o o o o o o o o no o o o o o o o o o o o o cgnos o o o o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o cgnos o no o o o o o o o o no o o",
  "o o o o o o o o o no o o o o o o cgos o o o or o nor cgos or o o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o nor or no o o o o o o o o no or o",
  "o o o o o o o o o no o o o o o o o o o o fotv o nor o cfgostv o o o o no o o o nor cfgnorstv o acfginorstv o o no o nor o o nor o o o nor fotv no o o o o o o o o no fotv o",
  "o o o o o o o o o no o o o o o o or o o o or o nor or or cgos o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o nor or no o o o o o o o o no or o",
  "or or or or or or or or or no or or or or or or or or or or or or nor or or or cgos or or no or or o nor cgnors o acfginorstv or or no or nor or or nor or o or nor or nor or or or or or or or or no or o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fotv fotv fortv fortv fortv fortv ao fortv fotv fortv or fotv nor ao or ao o cfgostv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no cfgiortv fotv fiortv fiortv fiortv cfgiortv fiortv fiortv no or o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fiortv fiortv fiortv fiortv fiortv fiortv ao fiortv fiortv fiortv or fotv nor ao or ao o fgiortv cfgostv no fgiortv fgiortv o nor acfginorstv io acfginorstv fotv aio no fgiortv nor fortv o nor fotv o ao nor or inor fgiortv fortv fiortv fiortv fiortv fgiortv fiortv fiortv no or io",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o cgnos o o o no cgnos o acfginorstv o o no o no o o no o o o no o no o o o o o o o o no o o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fotv fotv fortv fortv fortv fortv ao fortv fotv fortv or fotv nor ao or ao o cfgortv fotv no cfgorstv fotv o nor acfginorstv o acfginorstv fotv aio no fotv nor fotv o nor fotv o ao nor or no cfgiortv fotv fiortv fiortv fiortv cfgiortv fiortv fiortv no or o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fiotv fiotv fiortv fiortv fiortv fiortv ao fiortv fiotv fiortv or fotv nor ao or ao o cfgiortv fotv no cfgiortv cfgiostv o nor acfginorstv io acfginorstv fotv aio no cfgiotv nor fotv o nor fotv o ao nor or ino cfgiortv fotv fiortv fiortv fiortv cfgiortv fiortv fiortv no or io",
  "o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o cgos o cgos o acfginorstv o o o o o o o o o o o o o o o o o o o o o o o o o",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o cgnos cgnos o acfginorstv o o no o no o o no o o o no o no o o o o o o o o no o o",
  "cfgorstv cfgorstv cfgiorstv cfgiorstv cfgiorstv cfgorstv cfgiorstv cfgiorstv acgiors cgnos cfgiorstv cfgiorstv cfgiorstv cfgiorstv cfgiorstv cfgiorstv acgors cfgiorstv cfgiorstv cfgiorstv cfgiorstv cfgorstv cgnors acgors cfgorstv acgors acgors cfgiorstv cfgorstv cgnos cfgiorstv cfgiorstv cgos cgnors acfginorstv cfgiost acfginorstv cfgorstv acgiors cgnos cfgiorstv cgnors cfgorstv cfgorst cgnors cfgorstv cgo acgors cgnors cfgorstv cginors cfgiorstv cfgorstv cfgiorstv cfgiorstv cfgiorstv cfgiorstv cfgiorstv cfgiorstv cgnos cfgiorstv cfgiost",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o ao o o no o o o no acfgnost cfgost acfginorstv o o no o no o fot no o o o no o no o o o o o o o o no o fot",
  "fortv fortv fiortv fiortv fiortv fortv fiortv fiortv aior no fiortv fiortv fiortv fiortv fiortv fiortv aor fiortv fiortv fiortv fiortv fortv nor aor fortv aor aor fiortv fortv no fiortv fiortv o nor afinortv fiot acfginorstv fortv aior no fiortv nor fortv fort nor fortv - aor nor fortv inor fiortv fortv fiortv fiortv fiortv fiortv fiortv fiortv no fiortv fiot",
  "cfgortv cfgortv cfgiortv cfgiortv cfgiortv cfgortv cfgiortv cfgiortv acgio cgno cfgiortv cfgiortv cfgiortv cfgiortv cfgiortv cfgiortv acgo cfgiortv cfgiortv cfgiortv cgor cfgotv cgnor acgo cgor acgo cgo cfgiortv cfgotv cgno cfgiortv cfgiortv cgo cgnor acfginorstv cgio acfginorstv cfgostv acgio cgno cfgiortv cgnor cfgortv cgo cgnor cfgotv cgo acgo cgnor cgor cginor cfgiortv cfgortv cfgiortv cfgiortv cfgiortv cfgiortv cfgiortv cfgiortv cgno cgor cgio",
  "or or or or or or or or or no o o or or or or or or o or or o nor or or or o or o no or o o nor cgnors o acfginorstv o cgors no o nor o o nor o o o nor or no or o or or or or or or no or o",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o no cgnos o acfginorstv o o cgnos o no o o no o o o no o no o o o o o o o o no o o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fiotv fiotv fiortv fiortv fiortv fiortv ao fiortv fiotv fiortv or fotv nor ao or ao o cfgiortv fotv no cfgiortv cfgiotv o nor acfginorstv io acfginorstv fotv aio no cfgiostv nor fotv o nor fotv o ao nor or ino cfgiortv fotv fiortv fiortv fiortv cfgiortv fiortv fiortv no or io",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o nor cgnors o acfginorstv o o no o cgnos o o no o o o no o no o o o o o o o o no o o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fiotv fiotv fiortv fiortv fiortv fiortv ao fiortv fiotv fiortv or fotv nor ao or ao o fgiortv fotv no fgiortv fgiotv o nor acfginorstv io acfginorstv fotv aio no fgiotv nor cfgostv o nor fotv o ao nor or ino fgiortv fgotv fiortv fiortv fiortv fgiortv fiortv fiortv no or io",
  "cgor cgor cgor cgor cgor cgor cgor cgor cgor no cgor cgor cgor cgor cgor cgor cgor cgor cgor cgor cgor cgor cgnor cgor cgor cgor ao cgor cgor no cgor cgor o cgnor acfginorst fot acfginorstv cgor cgor no cgor cgnor cgor cfgost nor cgor cgo cgor cgnor cgor inor cgor cgor cgor cgor cgor cgor cgor cgor no cgor fot",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o nor cgnors o acfginorstv o o no o nor o o cgnos o o o no o no o o o o o o o o no o o",
  "fortv fortv fortv fortv fortv fortv fortv cfgortv acgo no fotv fotv fortv fortv fortv fortv acgo fortv fotv cfgortv or fotv nor acgo or acgo o fortv fotv no fortv fotv o nor acfgnorstv o acfginorstv fotv acgo no fotv nor fotv o nor cfgostv o acgo nor or no fortv fotv fortv fortv fortv fortv fortv cfgortv no or o",
  "o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o o - o o o o o o o o o - o o o o o o o o o o o o o o o",
  "o o o o o o o o o no o o o o o o or o o o or o nor or or o o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o cgos nor or no o o o o o o o o no or o",
  "o o o o o o o o o no o o o o o o o o o o o o cgnos o o o o o o no o o o nor cgnors o acfginorstv o o no o nor o o nor o o o cgnos o no o o o o o o o o no o o",
  "o o o o o o o o o no o o o o o o o o o o fiotv o nor o fortv o o o o no o o o nor cfginorstv o acfginorstv o o no o nor o o nor o o o nor cfgostv no o o o o o o o o no fiotv o",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o no cgnos o acfginorstv o o no o no o o no o o o no o cgnos o o o o o o o o no o o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fotv fotv fortv fortv fortv fortv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no cfgiorstv fotv fiortv fiortv fiortv cfgiortv fiortv fiortv no or o",
  "fortv fortv fortv fortv fortv fortv fortv fortv aio no fiotv fiotv fiortv fiortv fiortv fiortv ao fiortv fiotv fiortv or fotv nor ao or ao o fgiortv fotv no fgiortv fgiotv o nor acfginorstv io acfginorstv fotv aio no fgiotv nor fotv o nor fotv o ao nor or ino fgiortv cfgostv fiortv fiortv fiortv cfgiortv fiortv fiortv no or io",
  "fotv fotv fortv fotv fotv fotv fotv fotv ao no fotv fotv fortv fotv fotv fotv ao fotv fotv fotv o fotv nor ao o ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv cfgostv fotv fotv fotv fotv fotv no o o",
  "fotv fotv fotv fortv fortv fotv fortv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv cfgostv cfgotv fotv cfgotv fortv no or o",
  "fotv fotv fotv fortv fortv fotv fortv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv cfgotv cfgostv fotv cfgotv fortv no or o",
  "fotv fotv fotv fotv fotv fortv fotv fortv ao no fotv fotv fotv fotv fotv fortv ao fotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfginorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor or no fotv fotv fotv fotv fotv cfgostv fotv fiotv no or o",
  "fotv fotv fotv fortv fortv fotv fortv fortv ao no fotv fotv fotv fortv fortv fotv ao fortv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv cfgotv cfgotv fotv cfgostv fortv no or o",
  "fotv fotv fotv fotv fotv fotv fotv fortv ao no fotv fotv fotv fotv fotv fotv ao fotv fotv fortv or fotv nor ao or ao o fotv fotv no fotv fotv o nor acfgnorstv o acfginorstv fotv ao no fotv nor fotv o nor fotv o ao nor o no fotv fotv fotv fotv fotv fotv fotv cfgostv no or o",
  "o o o o o o o o o no o o o o o o o o o o o o no o o o o o o no o o o no cgnos o acfginorstv o o no o no o o no o o o no o no o o o o o o o o cgnos o o",
  "o o o o o o o o o no o o o o o o o o o o fotv o nor o fortv o o o o no o o o nor cfgnorstv o acfginorstv o o no o nor o o nor o o o nor fotv no o o o o o o o o no cfgostv o",
  "or or or or or or or or or no or or or or or or or or or or or or nor or or or aor or or no or or o nor acfgnorst fot acfginorstv or or no or nor or fort nor or o or nor or nor or or or or or or or or no or cfgost"
];
var RELATION_KEY = {
  a: "access",
  c: "composition",
  f: "flow",
  g: "aggregation",
  i: "assignment",
  n: "influence",
  o: "association",
  r: "realization",
  s: "specialization",
  t: "triggering",
  v: "serving"
};

// node_modules/@sentropic/diagram-core/dist/profiles/skeletons.js
var BPMN_SKELETON_PROFILE_ID = "bpmn@1";
var ARCHIMATE_SKELETON_PROFILE_ID = "archimate@1";
var UML_SKELETON_PROFILE_ID = "uml@1";
function directedPair(id, label, entityTypes) {
  const endpointTypes = entityTypes === void 0 ? {} : { entityTypes };
  return {
    id,
    label,
    direction: "directed",
    roles: [
      { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity"], ...endpointTypes },
      { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity"], ...endpointTypes }
    ]
  };
}
var bpmnSkeletonProfile = {
  id: BPMN_SKELETON_PROFILE_ID,
  name: "bpmn",
  version: 1,
  completeness: "skeleton",
  entityTypes: [
    { id: "process", label: "Process", attributes: [{ name: "name", kind: "text", required: true, maxLength: 200 }] },
    { id: "participant", label: "Participant (pool)", attributes: [{ name: "name", kind: "text", required: true, maxLength: 200 }] },
    { id: "lane", label: "Lane", attributes: [{ name: "name", kind: "text", maxLength: 200 }] },
    { id: "task", label: "Task", attributes: [{ name: "name", kind: "text", maxLength: 200 }] },
    { id: "subProcess", label: "Sub-process", attributes: [{ name: "name", kind: "text", maxLength: 200 }] },
    {
      id: "event",
      label: "Event",
      attributes: [
        { name: "name", kind: "text", maxLength: 200 },
        // Position declared; the nature/direction matrix of BPMN events is NOT.
        { name: "position", kind: "enum", values: ["start", "intermediate", "end"], required: true }
      ]
    },
    {
      id: "gateway",
      label: "Gateway",
      attributes: [
        { name: "name", kind: "text", maxLength: 200 },
        { name: "gatewayKind", kind: "enum", values: ["exclusive", "inclusive", "parallel", "eventBased", "complex"], required: true }
      ]
    }
  ],
  portTypes: [{ id: "flowPort", label: "Flow port", directions: ["in", "out"] }],
  relationTypes: [
    {
      id: "sequenceFlow",
      label: "Sequence flow",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] }
      ],
      attributes: [
        { name: "condition", kind: "text", maxLength: 400 },
        { name: "default", kind: "boolean" }
      ]
    },
    directedPair("messageFlow", "Message flow"),
    directedPair("association", "Association"),
    {
      id: "flowElementContainment",
      label: "Flow element containment",
      direction: "directed",
      roles: [
        { role: "parent", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["process", "subProcess", "participant", "lane"] },
        { role: "child", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      hierarchy: { id: "bpmn-containment", shape: "tree", parentRole: "parent", childRole: "child" }
    }
  ],
  constraints: [{ kind: "acyclic-hierarchy", hierarchyId: "bpmn-containment" }],
  limits: { maxEndpointsPerRelation: 2 },
  notes: [
    "SKELETON. Declared: element types, sequence/message/association arity, a containment tree.",
    "NOT declared: sequence flow contained in its process, message flow between participants, event nature and direction, gateway arity, BPMN DI, IDs and refs of the XML serialisation.",
    "A diagram this profile validates is not an executable process. Execution engines are out of scope.",
    "Qualification fixtures are partial: fixtures/valid/bpmn-skeleton-document.json only."
  ]
};
var ARCHIMATE_RELATIONS = [
  "composition",
  "aggregation",
  "assignment",
  "realization",
  "serving",
  "access",
  "influence",
  "triggering",
  "flow",
  "association",
  "specialization"
];
var archimateSkeletonProfile = {
  id: ARCHIMATE_SKELETON_PROFILE_ID,
  name: "archimate",
  version: 1,
  completeness: "skeleton",
  entityTypes: [
    {
      id: "element",
      label: "Element",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        // Layer and aspect are declared as enumerations; WHICH element types
        // exist per layer is the M3 work, so the skeleton keeps one element
        // type rather than inventing a partial list that would read as a claim.
        { name: "layer", kind: "enum", required: true, values: ["strategy", "business", "application", "technology", "physical", "motivation", "implementation"] },
        { name: "aspect", kind: "enum", values: ["active", "behaviour", "passive", "motivation"] }
      ]
    },
    { id: "junction", label: "Junction", attributes: [{ name: "operator", kind: "enum", values: ["and", "or"], required: true }] },
    { id: "grouping", label: "Grouping", attributes: [{ name: "name", kind: "text", maxLength: 200 }] }
  ],
  portTypes: [],
  relationTypes: ARCHIMATE_RELATIONS.map((id) => directedPair(id, id)),
  constraints: [],
  limits: { maxEndpointsPerRelation: 2 },
  notes: [
    "SKELETON. Declared: element/junction/grouping, the eleven relation names with 1..1 arity.",
    "NOT declared: the versioned relation/source/target matrix, access mode, viewpoints, Open Group Model Exchange namespaces.",
    "No ArchiMate conformance is claimed. Conformance needs a fixture per matrix constraint (GD-M3).",
    "Qualification fixtures are partial: fixtures/valid/archimate-skeleton-document.json only."
  ]
};
var umlSkeletonProfile = {
  id: UML_SKELETON_PROFILE_ID,
  name: "uml",
  version: 1,
  completeness: "skeleton",
  entityTypes: [
    {
      id: "class",
      label: "Class",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "abstract", kind: "boolean" },
        { name: "stereotypes", kind: "collection", item: { kind: "text", maxLength: 60 }, maxItems: 8 }
      ]
    },
    { id: "interface", label: "Interface", attributes: [{ name: "name", kind: "text", required: true, maxLength: 200 }] },
    { id: "package", label: "Package", attributes: [{ name: "name", kind: "text", required: true, maxLength: 200 }] },
    {
      id: "property",
      label: "Property",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "typeName", kind: "text", maxLength: 200 },
        { name: "multiplicity", kind: "text", maxLength: 20 }
      ]
    },
    {
      id: "operation",
      label: "Operation",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "returnTypeName", kind: "text", maxLength: 200 }
      ]
    }
  ],
  portTypes: [],
  relationTypes: [
    {
      id: "association",
      label: "Association",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      attributes: [
        { name: "sourceMultiplicity", kind: "text", maxLength: 20 },
        { name: "targetMultiplicity", kind: "text", maxLength: 20 }
      ]
    },
    directedPair("generalization", "Generalization", ["class", "interface"]),
    directedPair("dependency", "Dependency"),
    {
      id: "packageContainment",
      label: "Package containment",
      direction: "directed",
      roles: [
        { role: "parent", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["package"] },
        { role: "child", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      hierarchy: { id: "uml-package-containment", shape: "tree", parentRole: "parent", childRole: "child" }
    }
  ],
  constraints: [{ kind: "acyclic-hierarchy", hierarchyId: "uml-package-containment" }],
  limits: { maxEndpointsPerRelation: 2 },
  notes: [
    "SKELETON. Declared subset: classifiers, properties, operations, association/generalization/dependency, a package containment tree.",
    "NOT declared: full multiplicity semantics, profiles and stereotype application rules, activity/sequence/state families (their own profiles).",
    "UML does not reduce to PlantUML text; the pivot is a codec concern (GD-M4).",
    "Qualification fixtures are partial: fixtures/valid/uml-skeleton-document.json only."
  ]
};

// node_modules/@sentropic/diagram-core/dist/profiles/archimate2.js
var ARCHIMATE_RELATIONSHIP_IDS = [
  "composition",
  "aggregation",
  "assignment",
  "realization",
  "serving",
  "access",
  "influence",
  "triggering",
  "flow",
  "association",
  "specialization"
];
function expandArchimateTuples() {
  const typeId = (name) => name === "Relationship" ? "@relation" : name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const out = [];
  ARCHIMATE_MATRIX_CELLS.forEach((row, i) => {
    row.split(" ").forEach((keys, j) => {
      if (keys === "-")
        return;
      for (const k of keys) {
        out.push({
          relationType: RELATION_KEY[k],
          sourceType: typeId(ARCHIMATE_CONCEPT_NAMES[i]),
          targetType: typeId(ARCHIMATE_CONCEPT_NAMES[j])
        });
      }
    });
  });
  return out;
}
var text = (name, maxLength, required = false) => ({
  name,
  kind: "text",
  ...required ? { required: true } : {},
  ...maxLength === void 0 ? {} : { maxLength }
});
var bool = (name) => ({ name, kind: "boolean" });
var enumeration = (name, values, required = false) => ({
  name,
  kind: "enum",
  values: [...values],
  ...required ? { required: true } : {}
});
var role = (name, targets, entityTypes) => ({
  role: name,
  cardinality: { min: 1, max: 1 },
  targets: [...targets],
  ...entityTypes === void 0 ? {} : { entityTypes: [...entityTypes] }
});
var pair = (id, entityTypes, targets = ["entity"]) => ({
  id,
  label: id,
  direction: "directed",
  roles: [role("source", targets, entityTypes), role("target", targets, entityTypes)]
});
var hierarchy = (id, hierarchyId, parentType, childTypes) => ({
  id,
  label: id,
  direction: "directed",
  roles: [role("parent", ["entity"], [parentType]), role("child", ["entity"], childTypes)],
  hierarchy: { id: hierarchyId, shape: "tree", parentRole: "parent", childRole: "child" }
});
function buildDeclaration() {
  const tuples = expandArchimateTuples();
  return {
    id: "archimate@2",
    name: "archimate",
    version: 2,
    completeness: "complete",
    entityTypes: [
      { id: "element", label: "Element", abstract: true, attributes: [] },
      ...ARCHIMATE_CATALOGUE.map((c) => ({
        id: c.id,
        label: c.name,
        supertypes: ["element"],
        ...c.id === "grouping" ? { container: true } : {},
        attributes: [
          ...c.id === "junction" ? [enumeration("operator", ["and", "or"], true)] : [text("name", 200, c.id !== "grouping")],
          ...c.layer === "none" ? [] : [enumeration("layer", [c.layer], true)],
          enumeration("aspect", [c.aspect])
        ]
      }))
    ],
    portTypes: [],
    relationTypes: [
      ...ARCHIMATE_RELATIONSHIP_IDS.map((id) => ({
        ...pair(id, void 0, ["entity", "relation"]),
        ...id === "access" ? { attributes: [enumeration("accessMode", ["write", "read", "unspecified", "read-write"])] } : id === "influence" ? { attributes: [text("strength")] } : id === "association" ? { attributes: [bool("directed")] } : {}
      })),
      hierarchy("groupingContainment", "archimate-grouping", "grouping", ["element"])
    ],
    constraints: [
      { kind: "acyclic-hierarchy", hierarchyId: "archimate-grouping" },
      {
        kind: "relationship-matrix",
        matrixId: "archimate-3.2",
        sourceRole: "source",
        targetRole: "target",
        tuples
      },
      {
        kind: "incident-type-uniformity",
        matrixId: "archimate-3.2",
        entityType: "junction",
        relationTypes: [...ARCHIMATE_RELATIONSHIP_IDS]
      }
    ],
    limits: { maxEndpointsPerRelation: 2 },
    notes: []
  };
}
var declaration = buildDeclaration();
var archimate2Profile = declaration;

// node_modules/@sentropic/diagram-core/dist/profiles/uml2.js
var text2 = (name, maxLength, required = false) => ({
  name,
  kind: "text",
  ...required ? { required: true } : {},
  ...maxLength === void 0 ? {} : { maxLength }
});
var bool2 = (name) => ({ name, kind: "boolean" });
var enumeration2 = (name, values, required = false) => ({
  name,
  kind: "enum",
  values: [...values],
  ...required ? { required: true } : {}
});
var role2 = (name, targets, entityTypes) => ({
  role: name,
  cardinality: { min: 1, max: 1 },
  targets: [...targets],
  ...entityTypes === void 0 ? {} : { entityTypes: [...entityTypes] }
});
var pair2 = (id, entityTypes, targets = ["entity"]) => ({
  id,
  label: id,
  direction: "directed",
  roles: [role2("source", targets, entityTypes), role2("target", targets, entityTypes)]
});
var hierarchy2 = (id, hierarchyId, parentType, childTypes) => ({
  id,
  label: id,
  direction: "directed",
  roles: [role2("parent", ["entity"], [parentType]), role2("child", ["entity"], childTypes)],
  hierarchy: { id: hierarchyId, shape: "tree", parentRole: "parent", childRole: "child" }
});
var visibility = () => enumeration2("visibility", ["public", "protected", "private", "package"]);
var stereotypes = () => ({
  name: "stereotypes",
  kind: "collection",
  item: { kind: "reference", refKind: "entity", targetTypes: ["stereotype"] },
  maxItems: 8
});
var common = () => [text2("name", 200, true), visibility(), stereotypes()];
var multiplicity = (name) => ({ name, kind: "struct", targetTypes: ["multiplicity"] });
var aggregation = (name) => enumeration2(name, ["none", "shared", "composite"]);
function buildDeclaration2() {
  const generalization = pair2("generalization", ["class", "interface"]);
  generalization["hierarchy"] = {
    id: "uml-generalization",
    shape: "dag",
    parentRole: "target",
    childRole: "source"
  };
  return {
    id: "uml@2",
    name: "uml",
    version: 2,
    completeness: "complete",
    entityTypes: [
      { id: "class", label: "Class", attributes: [...common(), bool2("abstract"), bool2("isStatic")] },
      { id: "interface", label: "Interface", attributes: common() },
      { id: "package", label: "Package", container: true, attributes: common() },
      {
        id: "property",
        label: "Property",
        attributes: [...common(), text2("typeName", 200), multiplicity("multiplicity"), bool2("isDerived"), bool2("isStatic")]
      },
      {
        id: "operation",
        label: "Operation",
        attributes: [...common(), text2("returnTypeName", 200), bool2("isStatic")]
      },
      {
        id: "stereotype",
        label: "Stereotype",
        attributes: [
          text2("name", 60, true),
          {
            name: "extends",
            kind: "collection",
            required: true,
            item: { kind: "enum", values: ["class", "interface", "package", "property", "operation"] },
            minItems: 1,
            maxItems: 5
          }
        ]
      },
      {
        id: "multiplicity",
        label: "Multiplicity",
        abstract: true,
        attributes: [
          { name: "lower", kind: "quantity", required: true, units: ["unit"], integer: true, min: 0, max: 9007199254740991 },
          { name: "upper", kind: "quantity", required: true, units: ["unit"], integer: true, min: -1, max: 9007199254740991 },
          bool2("isOrdered"),
          bool2("isUnique")
        ]
      }
    ],
    portTypes: [],
    relationTypes: [
      {
        ...pair2("association", ["class", "interface"]),
        attributes: [
          multiplicity("sourceMultiplicity"),
          multiplicity("targetMultiplicity"),
          aggregation("sourceAggregation"),
          aggregation("targetAggregation")
        ]
      },
      generalization,
      pair2("dependency"),
      hierarchy2("packageContainment", "uml-package-containment", "package")
    ],
    constraints: [
      { kind: "acyclic-hierarchy", hierarchyId: "uml-package-containment" },
      { kind: "acyclic-hierarchy", hierarchyId: "uml-generalization" },
      { kind: "bound-pair", valueType: "multiplicity", lowerField: "lower", upperField: "upper", unboundedUpper: -1 },
      {
        kind: "reference-application",
        attribute: "stereotypes",
        declarationType: "stereotype",
        allowedTypesField: "extends"
      },
      {
        kind: "at-most-value",
        relationType: "association",
        attributes: ["sourceAggregation", "targetAggregation"],
        value: "composite",
        max: 1
      },
      { kind: "collection-unique", entityType: "stereotype", attribute: "extends" }
    ],
    limits: { maxEndpointsPerRelation: 2 },
    notes: []
  };
}
var declaration2 = buildDeclaration2();
var uml2Profile = declaration2;

// node_modules/@sentropic/diagram-core/dist/relation-types.js
function relationBaseType(document, profile, relation) {
  if (relationTypeOf(profile, relation.type) !== void 0)
    return relation.type;
  const definition = document.typeDefinitions[relation.type];
  return definition?.profile === profile.id ? definition.baseType : relation.type;
}
function relationSchema(document, profile, relation) {
  const base = relationTypeOf(profile, relationBaseType(document, profile, relation));
  if (base === void 0)
    return void 0;
  const definition = document.typeDefinitions[relation.type];
  return relation.type === base.id || definition?.profile !== profile.id ? base : { ...base, attributes: [...base.attributes ?? [], ...definition.attributes] };
}

// node_modules/@sentropic/diagram-core/dist/erd-validate.js
function validateErdKeys(document, profile, maxFields) {
  const out = [];
  const report = (code, path, message) => out.push(diagnostic({ code, path, message }));
  for (const entity of Object.values(document.entities).filter((e) => e.profile === profile.id)) {
    const fields = Object.values(document.ports).filter((p) => p.owner === entity.id);
    const path = "entities." + entity.id;
    const keys = fields.filter((p) => p.attributes.pk?.kind === "boolean" && p.attributes.pk.value);
    if (keys.length !== 1)
      report(keys.length ? "erd-multiple-pk" : "erd-missing-pk", path, "An entity requires exactly one primary key");
    if (fields.length > maxFields)
      report("limit-exceeded", path, "Too many attribute rows: " + fields.length);
    if (new Set(fields.map((p) => p.name)).size !== fields.length || new Set(fields.map((p) => p.attributes.ordinal?.kind === "quantity" ? p.attributes.ordinal.value : -1)).size !== fields.length)
      report("erd-duplicate-field", path, "Field names and ordinals must be distinct");
    for (const field of fields) {
      const fk = field.attributes.fk;
      if (fk?.kind !== "reference")
        continue;
      const target = document.ports[fk.value];
      if (!target)
        report("erd-dangling-fk", "ports." + field.id, "Foreign key target is missing: " + fk.value);
      else if (target.profile !== profile.id || target.attributes.pk?.kind !== "boolean" || !target.attributes.pk.value)
        report("erd-invalid-fk-target", "ports." + field.id, "Foreign key must target a primary key");
    }
  }
  for (const relation of Object.values(document.relations).filter((r) => r.profile === profile.id)) {
    for (const role3 of ["from", "to"])
      if (!relation.endpoints.some((e) => e.role === role3))
        report("erd-missing-end", "relations." + relation.id, "Missing relationship end: " + role3);
  }
  return out;
}

// node_modules/@sentropic/diagram-core/dist/notation.js
var DIAGRAM_NOTATION_VOCABULARY = "diagram-notation@1";
var DIAGRAM_NOTATION_MODES = ["strict", "metadata"];
var DIAGRAM_NOTATION_ROLES = ["card", "container", "lane", "entity-table", "flow-node"];
var DIAGRAM_NOTATION_NATURES = ["component", "responsibility", "data", "activity"];
var DIAGRAM_NOTATION_ENCODINGS = ["arrow", "containment", "detail", "footer"];
var DIAGRAM_NOTATION_ENDS = ["none", "arrow", "cardinality"];
var TEXT = { type: "string", minLength: 1, maxLength: 40 };
var NAME = { type: "string", minLength: 1, maxLength: 80 };
var PRIVATE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "engram:diagram-notation-schema/1",
  title: "diagram-notation@1 block",
  type: "object",
  properties: {
    vocabulary: { const: DIAGRAM_NOTATION_VOCABULARY },
    mode: { enum: [...DIAGRAM_NOTATION_MODES] },
    entityTypes: { type: "object", additionalProperties: { $ref: "#/$defs/node" } },
    relationTypes: { type: "object", additionalProperties: { $ref: "#/$defs/relation" } }
  },
  required: ["vocabulary", "entityTypes", "relationTypes"],
  additionalProperties: false,
  $defs: {
    text: TEXT,
    name: NAME,
    role: { enum: [...DIAGRAM_NOTATION_ROLES] },
    nature: { enum: [...DIAGRAM_NOTATION_NATURES] },
    slot: {
      anyOf: [
        { $ref: "#/$defs/text" },
        {
          type: "object",
          properties: {
            attribute: { $ref: "#/$defs/name" },
            values: { type: "object", maxProperties: 32, additionalProperties: { $ref: "#/$defs/text" } },
            default: { $ref: "#/$defs/text" }
          },
          required: ["attribute", "values", "default"],
          additionalProperties: false
        }
      ]
    },
    typeRef: {
      type: "object",
      properties: { profile: { $ref: "#/$defs/name" }, type: { $ref: "#/$defs/name" } },
      required: ["profile", "type"],
      additionalProperties: false
    },
    node: {
      type: "object",
      properties: {
        role: { $ref: "#/$defs/role" },
        nature: { $ref: "#/$defs/nature" },
        variant: { $ref: "#/$defs/slot" },
        icon: { $ref: "#/$defs/slot" },
        kicker: { $ref: "#/$defs/slot" },
        holds: { type: "array", items: { $ref: "#/$defs/role" }, uniqueItems: true }
      },
      required: ["role", "nature"],
      additionalProperties: false
    },
    relation: {
      type: "object",
      properties: {
        encoding: { enum: [...DIAGRAM_NOTATION_ENCODINGS] },
        ends: { enum: [...DIAGRAM_NOTATION_ENDS] },
        provisional: {
          type: "object",
          properties: { attribute: { $ref: "#/$defs/name" }, equals: { $ref: "#/$defs/text" } },
          required: ["attribute", "equals"],
          additionalProperties: false
        },
        lift: {
          type: "object",
          properties: {
            via: { $ref: "#/$defs/typeRef" },
            ancestors: { type: "array", minItems: 1, items: { $ref: "#/$defs/typeRef" } }
          },
          required: ["via", "ancestors"],
          additionalProperties: false
        },
        fallback: {
          type: "object",
          properties: {
            encoding: { enum: ["detail", "footer"] },
            on: { $ref: "#/$defs/name" },
            label: { $ref: "#/$defs/text" }
          },
          required: ["encoding", "on", "label"],
          additionalProperties: false
        },
        on: { $ref: "#/$defs/name" },
        label: { $ref: "#/$defs/text" }
      },
      required: ["encoding"],
      additionalProperties: false
    }
  }
};
var PRIVATE_RULES = {
  vocabulary: DIAGRAM_NOTATION_VOCABULARY,
  defaultMode: "strict",
  roles: {
    card: {
      natures: ["component"],
      icon: "required",
      kicker: "optional",
      variant: "refused",
      holds: ["card", "entity-table", "flow-node"]
    },
    container: {
      natures: ["component"],
      icon: "required",
      kicker: "optional",
      variant: "refused",
      holds: ["card", "container", "entity-table", "lane", "flow-node"]
    },
    lane: {
      natures: ["responsibility"],
      icon: "refused",
      kicker: "refused",
      variant: "refused",
      holds: ["flow-node", "lane"]
    },
    "entity-table": {
      natures: ["data"],
      icon: "optional",
      kicker: "refused",
      variant: "refused",
      holds: []
    },
    "flow-node": {
      natures: ["activity", "data", "responsibility"],
      icon: "participant-only",
      kicker: "refused",
      variant: "by-nature",
      holds: ["flow-node"],
      holdsEffectiveFor: "subprocess"
    }
  },
  /** Variants of each nature; the first is the default. `component` has none. */
  variants: {
    activity: ["task", "start", "end", "decision", "subprocess"],
    data: ["data", "document"],
    responsibility: ["participant"],
    component: []
  },
  /** Glyph id grammar of an `icon` text. The glyph inventory is not part of the pin. */
  iconPattern: "^[a-z][a-z0-9-]{0,39}$",
  /** The properties each encoding admits, `encoding` included; `required` among them. */
  encodings: {
    arrow: { properties: ["encoding", "ends", "provisional"], required: ["encoding"] },
    containment: { properties: ["encoding", "lift", "fallback"], required: ["encoding"] },
    detail: { properties: ["encoding", "on", "label"], required: ["encoding", "on", "label"] },
    footer: { properties: ["encoding", "on", "label"], required: ["encoding", "on", "label"] }
  },
  /** `ends` when absent: `arrow` on a directed relation type, else `none`. */
  endsDefault: { directed: "arrow", undirected: "none" },
  /** Roles that own each text slot: every type allowed on the `on` endpoint must have one of them. */
  slotOwners: {
    detail: ["card", "container", "entity-table"],
    footer: ["card", "container"]
  },
  /** Roles a `lift.ancestors` type must have. */
  liftAncestorRoles: ["card", "container"],
  /** `containment` needs a relation type whose hierarchy has this shape. */
  containmentHierarchyShape: "tree"
};
function deepClone(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value.map((item) => deepClone(item));
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = deepClone(value[key]);
  }
  return out;
}
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value))
    deepFreeze(child);
  return Object.freeze(value);
}
deepFreeze(PRIVATE_SCHEMA);
deepFreeze(PRIVATE_RULES);
var DIAGRAM_NOTATION_SCHEMA = deepFreeze(deepClone(PRIVATE_SCHEMA));
var DIAGRAM_NOTATION_RULES = deepFreeze(deepClone(PRIVATE_RULES));
var DIAGRAM_NOTATION_DIGEST = sha256Hex(canonicalBytes({ schema: PRIVATE_SCHEMA, rules: PRIVATE_RULES }));
var DIAGRAM_NOTATION_PIN = deepFreeze({
  id: "diagram-notation",
  version: "1",
  contentDigest: DIAGRAM_NOTATION_DIGEST
});

// node_modules/@sentropic/diagram-core/dist/profiles/process.js
var PROCESS_PROFILE_ID = "process@1";
var PROCESS_STEP_KINDS = ["task", "start", "end", "decision", "subprocess"];
var PROCESS_TRANSITION_KINDS = ["normal", "retry", "exception"];
var PROCESS_FLOW_EXTENSION_NAMESPACE = "sentropic:process-flow";
var PROCESS_FLOW_EXTENSION_VERSION = "1";
var PROCESS_FLOW_DIRECTIONS = ["LR", "TB"];
var processProfile = {
  id: PROCESS_PROFILE_ID,
  name: "process",
  version: 1,
  completeness: "complete",
  entityTypes: [
    {
      id: "step",
      label: "Step",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "kind", kind: "enum", values: PROCESS_STEP_KINDS },
        { name: "subtitle", kind: "text", maxLength: 200 },
        { name: "stepNumber", kind: "text", maxLength: 16 }
      ]
    },
    {
      id: "lane",
      label: "Lane",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "order", kind: "quantity", units: ["index"], integer: true, min: 0 }
      ]
    }
  ],
  portTypes: [],
  relationTypes: [
    {
      id: "transition",
      label: "Transition",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["step"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["step"] }
      ],
      attributes: [
        { name: "label", kind: "text", maxLength: 120 },
        { name: "kind", kind: "enum", values: PROCESS_TRANSITION_KINDS },
        { name: "emphasis", kind: "enum", values: ["default", "emphasis"] }
      ]
    },
    {
      id: "inLane",
      label: "In lane",
      direction: "directed",
      roles: [
        { role: "lane", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["lane"] },
        { role: "step", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["step"] }
      ],
      hierarchy: {
        id: "laneMembership",
        shape: "tree",
        parentRole: "lane",
        childRole: "step"
      }
    }
  ],
  constraints: [
    {
      kind: "hierarchy",
      relationType: "inLane",
      hierarchyId: "laneMembership",
      parentRole: "lane",
      childRole: "step"
    },
    { kind: "acyclic-hierarchy", hierarchyId: "laneMembership" }
  ],
  limits: {
    maxEntities: 1e3,
    maxRelations: 5e3,
    maxEndpointsPerRelation: 2
  },
  notes: [
    "Simple-box process flow profile (non-BPMN) executing diagram-notation@1."
  ]
};
var processNotation = {
  vocabulary: DIAGRAM_NOTATION_VOCABULARY,
  mode: "strict",
  entityTypes: {
    step: {
      role: "flow-node",
      nature: "activity",
      variant: {
        attribute: "kind",
        values: {
          task: "task",
          start: "start",
          end: "end",
          decision: "decision",
          subprocess: "subprocess"
        },
        default: "task"
      }
    },
    lane: {
      role: "lane",
      nature: "responsibility",
      holds: ["flow-node"]
    }
  },
  relationTypes: {
    transition: {
      encoding: "arrow",
      ends: "arrow",
      provisional: { attribute: "kind", equals: "retry" }
    },
    inLane: {
      encoding: "containment"
    }
  }
};
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
function validateProcessFlowExtension(extension, path) {
  const diagnostics = [];
  if (extension.schemaVersion !== PROCESS_FLOW_EXTENSION_VERSION) {
    diagnostics.push(diagnostic({
      code: "extension-unsupported",
      path: `${path}.schemaVersion`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} supports schemaVersion ${PROCESS_FLOW_EXTENSION_VERSION}, got ${extension.schemaVersion}`
    }));
  }
  if (extension.scope.kind !== "document") {
    diagnostics.push(diagnostic({
      code: "type-definition-conflict",
      path: `${path}.scope`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} must be document-scoped`
    }));
  }
  if (extension.validation !== "validated") {
    diagnostics.push(diagnostic({
      code: "type-definition-conflict",
      path: `${path}.validation`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} must have validation "validated"`
    }));
  }
  if (extension.source === void 0) {
    diagnostics.push(diagnostic({
      code: "extension-source-not-retained",
      path: `${path}.source`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} requires retained source JSON`
    }));
    return diagnostics;
  }
  let parsed;
  try {
    parsed = JSON.parse(extension.source);
  } catch {
    diagnostics.push(diagnostic({
      code: "value-not-serialisable",
      path: `${path}.source`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} source must be valid JSON`
    }));
    return diagnostics;
  }
  if (!isPlainObject(parsed)) {
    diagnostics.push(diagnostic({
      code: "type-definition-conflict",
      path: `${path}.source`,
      message: `${PROCESS_FLOW_EXTENSION_NAMESPACE} payload must be a JSON object`
    }));
    return diagnostics;
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "direction" && key !== "numbered") {
      diagnostics.push(diagnostic({
        code: "type-definition-conflict",
        path: `${path}.source.${key}`,
        message: `unknown ${PROCESS_FLOW_EXTENSION_NAMESPACE} field ${key}`
      }));
    }
  }
  if (parsed["direction"] !== void 0 && (typeof parsed["direction"] !== "string" || !PROCESS_FLOW_DIRECTIONS.includes(parsed["direction"]))) {
    diagnostics.push(diagnostic({
      code: "enum-value-not-allowed",
      path: `${path}.source.direction`,
      message: `direction must be "LR" or "TB", got ${JSON.stringify(parsed["direction"])}`
    }));
  }
  if (parsed["numbered"] !== void 0 && typeof parsed["numbered"] !== "boolean") {
    diagnostics.push(diagnostic({
      code: "attribute-type-mismatch",
      path: `${path}.source.numbered`,
      message: `numbered must be a boolean`
    }));
  }
  return diagnostics;
}
function parseProcessFlowExtension(document) {
  const ext = document.extensions.find((entry) => entry.namespace === PROCESS_FLOW_EXTENSION_NAMESPACE && entry.schemaVersion === PROCESS_FLOW_EXTENSION_VERSION && entry.scope.kind === "document" && entry.validation === "validated");
  if (ext === void 0 || validateProcessFlowExtension(ext, "extensions").length > 0 || ext.source === void 0) {
    return void 0;
  }
  const parsed = JSON.parse(ext.source);
  return {
    ...parsed["direction"] === void 0 ? {} : { direction: parsed["direction"] },
    ...parsed["numbered"] === void 0 ? {} : { numbered: parsed["numbered"] }
  };
}

// node_modules/@sentropic/diagram-core/dist/profiles/erd.js
var ERD_PROFILE_ID = "erd@1";
var ERD_CARDINALITIES = ["1", "0..1", "1..n", "0..n"];
var erdProfile = {
  id: ERD_PROFILE_ID,
  name: "ERD",
  version: 1,
  completeness: "complete",
  entityTypes: [{ id: "entity", label: "Entity", foldable: true, attributes: [
    { name: "name", kind: "text", required: true },
    { name: "schema", kind: "text" }
  ] }],
  portTypes: [{ id: "field", label: "Attribute row", directions: ["inout"], attributes: [
    { name: "dataType", kind: "text", required: true },
    { name: "pk", kind: "boolean", required: true },
    { name: "fk", kind: "reference", refKind: "port" },
    { name: "nullable", kind: "boolean", required: true },
    { name: "ordinal", kind: "quantity", units: ["index"], integer: true, min: 0, required: true }
  ] }],
  relationTypes: [{
    id: "relationship",
    label: "Relationship",
    direction: "undirected",
    roles: ["from", "to"].map((role3) => ({ role: role3, cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] })),
    attributes: [
      { name: "name", kind: "text", required: true },
      { name: "label", kind: "text" },
      ...["from", "to"].flatMap((end) => [
        { name: end + "Cardinality", kind: "enum", values: ERD_CARDINALITIES, required: true },
        { name: end + "Role", kind: "text", required: true }
      ])
    ]
  }],
  constraints: [{ kind: "erd-keys", maxFields: 17 }],
  limits: { maxEntities: 1e3, maxRelations: 1e4, maxEndpointsPerRelation: 2 },
  notes: ["Exactly one primary key per entity; no composite keys. Many-to-many remains one relationship."]
};

// node_modules/@sentropic/diagram-core/dist/profiles/generic.js
var GENERIC_PROFILE_ID = "generic@1";
var GENERIC_CONTAINMENT_HIERARCHY = "containment";
var genericProfile = {
  id: GENERIC_PROFILE_ID,
  name: "generic",
  version: 1,
  completeness: "complete",
  entityTypes: [
    {
      id: "node",
      label: "Node",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "state", kind: "enum", values: ["draft", "active", "retired"] },
        // A single declared unit is how this profile PINS a unit: a bare number
        // is still refused, because the value carries its own kind.
        { name: "weight", kind: "quantity", units: ["unit"] },
        { name: "duration", kind: "quantity", units: ["s", "min", "h"] },
        { name: "createdAt", kind: "date" },
        { name: "pinned", kind: "boolean" },
        { name: "tags", kind: "collection", item: { kind: "text", maxLength: 40 }, maxItems: 8 },
        // A typed reference attribute: the namespace is declared, so an
        // occurrence id here is `reference-type-mismatch`, not a stray string.
        { name: "owner", kind: "reference", refKind: "entity" }
      ]
    },
    {
      id: "container",
      label: "Container",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "collapsed", kind: "boolean" }
      ]
    }
  ],
  portTypes: [
    {
      id: "port",
      label: "Port",
      directions: ["in", "out", "inout"],
      attributes: [{ name: "label", kind: "text", maxLength: 80 }]
    }
  ],
  relationTypes: [
    {
      id: "link",
      label: "Link",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] }
      ],
      attributes: [
        { name: "label", kind: "text", maxLength: 120 },
        { name: "weight", kind: "quantity", units: ["unit"] }
      ]
    },
    {
      id: "contains",
      label: "Contains",
      direction: "directed",
      roles: [
        // Only a container parents. This is the type matrix doing its job.
        { role: "parent", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["container"] },
        { role: "child", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      hierarchy: {
        id: GENERIC_CONTAINMENT_HIERARCHY,
        shape: "tree",
        parentRole: "parent",
        childRole: "child"
      }
    },
    {
      id: "association",
      label: "Association",
      direction: "undirected",
      roles: [
        // A hyperrelation: 2 to 8 members under ONE role, one business id. A
        // projection may turn it into a junction node; the id survives.
        { role: "member", cardinality: { min: 2, max: 8 }, targets: ["entity"] }
      ],
      attributes: [{ name: "label", kind: "text", maxLength: 120 }]
    }
  ],
  constraints: [
    { kind: "acyclic-hierarchy", hierarchyId: GENERIC_CONTAINMENT_HIERARCHY },
    { kind: "unique-attribute", entityType: "container", attribute: "name" },
    { kind: "max-entities-of-type", entityType: "container", max: 64 }
  ],
  limits: {
    maxEntities: 1e5,
    maxRelations: 5e5,
    maxEndpointsPerRelation: 8
  },
  notes: [
    "Complete profile: every declaration here is exercised by a test or a fixture in this package.",
    "Business cycles are legal through `link` and `association`; only the declared `containment` tree refuses them.",
    "No BPMN/ArchiMate/UML status is induced by any shape or name in this profile."
  ]
};

// node_modules/@sentropic/diagram-core/dist/profiles/generic2.js
var GENERIC2_PROFILE_ID = "generic@2";
var GENERIC2_CONTAINMENT_HIERARCHY = "containment";
var GENERIC_KEY_PATTERN = "^[a-z][a-z0-9-]*$";
var GENERIC_KEY_PATTERN_NAME = "key";
var keyCategory = (name, required) => ({
  name,
  kind: "text",
  ...required ? { required: true } : {},
  minLength: 1,
  maxLength: 40,
  pattern: GENERIC_KEY_PATTERN,
  patternName: GENERIC_KEY_PATTERN_NAME
});
var generic2Profile = {
  id: GENERIC2_PROFILE_ID,
  name: "generic",
  version: 2,
  completeness: "complete",
  entityTypes: [
    {
      id: "node",
      label: "Node",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "state", kind: "enum", values: ["draft", "active", "retired"] },
        { name: "weight", kind: "quantity", units: ["unit"] },
        { name: "duration", kind: "quantity", units: ["s", "min", "h"] },
        { name: "createdAt", kind: "date" },
        { name: "pinned", kind: "boolean" },
        { name: "tags", kind: "collection", item: { kind: "text", maxLength: 40 }, maxItems: 8 },
        { name: "owner", kind: "reference", refKind: "entity" },
        keyCategory("category", false)
      ]
    },
    {
      id: "container",
      label: "Container",
      container: true,
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        keyCategory("category", false)
      ]
    },
    {
      id: "legend",
      label: "Legend",
      container: true,
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "description", kind: "text", maxLength: 600 }
      ]
    },
    {
      id: "legend-key",
      label: "Legend key",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 120 },
        keyCategory("category", true),
        { name: "description", kind: "text", maxLength: 200 }
      ]
    }
  ],
  portTypes: [
    {
      id: "port",
      label: "Port",
      directions: ["in", "out", "inout"],
      attributes: [{ name: "label", kind: "text", maxLength: 80 }]
    }
  ],
  relationTypes: [
    {
      id: "link",
      label: "Link",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] }
      ],
      attributes: [
        { name: "label", kind: "text", maxLength: 200 },
        { name: "weight", kind: "quantity", units: ["unit"] }
      ]
    },
    {
      id: "contains",
      label: "Contains",
      direction: "directed",
      roles: [
        { role: "parent", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["container", "legend"] },
        { role: "child", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      hierarchy: {
        id: GENERIC2_CONTAINMENT_HIERARCHY,
        shape: "tree",
        parentRole: "parent",
        childRole: "child"
      }
    },
    {
      id: "association",
      label: "Association",
      direction: "undirected",
      roles: [{ role: "member", cardinality: { min: 2, max: 8 }, targets: ["entity"] }],
      attributes: [{ name: "label", kind: "text", maxLength: 120 }]
    }
  ],
  constraints: [
    {
      kind: "hierarchy",
      relationType: "contains",
      hierarchyId: GENERIC2_CONTAINMENT_HIERARCHY,
      parentRole: "parent",
      childRole: "child"
    },
    { kind: "parent-family", hierarchyId: GENERIC2_CONTAINMENT_HIERARCHY, familyRoots: ["container", "legend"] },
    {
      kind: "children-restricted",
      parentFamilyRoots: ["legend"],
      childTypes: ["legend-key"],
      hierarchyId: GENERIC2_CONTAINMENT_HIERARCHY
    },
    {
      kind: "required-parent",
      childTypes: ["legend-key"],
      parentFamilyRoots: ["legend"],
      hierarchyId: GENERIC2_CONTAINMENT_HIERARCHY
    },
    { kind: "acyclic-hierarchy", hierarchyId: GENERIC2_CONTAINMENT_HIERARCHY },
    {
      kind: "unique-attribute",
      entityType: "legend-key",
      attribute: "category",
      scope: { withinType: "legend" }
    }
  ],
  limits: {
    maxEntities: 1e5,
    maxRelations: 5e5,
    maxEndpointsPerRelation: 8
  },
  notes: [
    "Complete profile: the replacement base for generic@1, not its child.",
    "Business cycles are legal through `link` and `association`; only the declared `containment` tree refuses them.",
    "Category is domain data; tokens, icons, order and footprints live in the view/presentation contract."
  ]
};

// node_modules/@sentropic/diagram-core/dist/profiles/index.js
var completeProfiles = [genericProfile];
var skeletonProfiles = [bpmnSkeletonProfile, archimateSkeletonProfile, umlSkeletonProfile];
var defaultProfileRegistry = createProfileRegistry([
  ...completeProfiles,
  ...skeletonProfiles
]);
var m3ProfileRegistry = createProfileRegistry([
  ...completeProfiles,
  ...skeletonProfiles,
  generic2Profile,
  archimate2Profile,
  uml2Profile,
  erdProfile,
  processProfile
]);
var allProfilesRegistry = createProfileRegistry([
  ...completeProfiles,
  ...skeletonProfiles,
  generic2Profile,
  archimate2Profile,
  uml2Profile,
  erdProfile,
  processProfile
]);
function lazyBindings(profiles) {
  let cached;
  return {
    schemaVersion: "1",
    get rows() {
      if (cached === void 0)
        cached = embeddedExecutorBindings([...profiles]);
      return cached.rows;
    }
  };
}
var shippedExecutorBindings = lazyBindings([
  ...completeProfiles,
  ...skeletonProfiles,
  generic2Profile,
  archimate2Profile,
  uml2Profile,
  erdProfile,
  processProfile
]);
var retainedExecutorBindings = lazyBindings([
  ...completeProfiles,
  ...skeletonProfiles
]);

// node_modules/@sentropic/diagram-core/dist/document.js
var CURRENT_SCHEMA_VERSION = { major: 1, minor: 1 };
var scopeTargetOf = (scope) => scope.kind === "document" ? void 0 : scope.target;

// node_modules/@sentropic/diagram-core/dist/resolver.js
var CycleThrown = class {
  cycle;
  constructor(cycle) {
    this.cycle = cycle;
  }
};
var UnknownBaseThrown = class {
  fromId;
  baseId;
  constructor(fromId, baseId) {
    this.fromId = fromId;
    this.baseId = baseId;
  }
};
var RedeclarationThrown = class {
  definitionId;
  attribute;
  baseType;
  constructor(definitionId, attribute, baseType) {
    this.definitionId = definitionId;
    this.attribute = attribute;
    this.baseType = baseType;
  }
};
var ProfileConflictThrown = class {
  typeId;
  attribute;
  constructor(typeId, attribute) {
    this.typeId = typeId;
    this.attribute = attribute;
  }
};
function createTypeResolver(document) {
  let revision = document.revision;
  let cache = /* @__PURE__ */ new Map();
  const nodeOf = (profile, id) => {
    if (entityTypeOf(profile, id) !== void 0)
      return { kind: "profile", id };
    const definition = document.typeDefinitions[id];
    if (definition !== void 0 && definition.profile === profile.id)
      return { kind: "definition", definition };
    return void 0;
  };
  const resolveInto = (profile, typeId) => {
    if (nodeOf(profile, typeId) === void 0) {
      return {
        ok: false,
        diagnostic: diagnostic({
          code: "unknown-entity-type",
          path: `profiles.${profile.id}.entityTypes.${typeId}`,
          message: `neither profile ${profile.id} nor the document declares entity type ${typeId}`,
          details: { type: typeId, profile: profile.id }
        }),
        failedType: typeId
      };
    }
    const ancestryBaseFirst = [];
    const merged = [];
    const inheritedNames = /* @__PURE__ */ new Set();
    const seen = /* @__PURE__ */ new Set();
    const path = [];
    const onPath = /* @__PURE__ */ new Set();
    let container = false;
    const basesOf = (node) => node.kind === "definition" ? [node.definition.baseType] : entityTypeOf(profile, node.id)?.supertypes ?? [];
    const processFrame = (frame) => {
      const { id, node } = frame;
      if (node.kind === "definition") {
        for (const schema of node.definition.attributes) {
          if (inheritedNames.has(schema.name)) {
            throw new RedeclarationThrown(node.definition.id, schema.name, node.definition.baseType);
          }
        }
      } else {
        if (entityTypeOf(profile, node.id)?.container === true) {
          container = true;
        }
        const ownAttributes = entityTypeOf(profile, node.id)?.attributes ?? [];
        for (const schema of ownAttributes) {
          if (!inheritedNames.has(schema.name))
            continue;
          const inherited = merged.filter((candidate) => candidate.name === schema.name);
          if (inherited.some((candidate) => stableStringify(candidate) !== stableStringify(schema))) {
            throw new ProfileConflictThrown(node.id, schema.name);
          }
        }
      }
      const declaredAttributes = node.kind === "profile" ? entityTypeOf(profile, node.id)?.attributes ?? [] : node.definition.attributes;
      for (const schema of declaredAttributes) {
        if (!inheritedNames.has(schema.name)) {
          merged.push(schema);
          inheritedNames.add(schema.name);
        }
      }
      seen.add(id);
      ancestryBaseFirst.push(id);
    };
    try {
      const root = nodeOf(profile, typeId);
      const stack = [{ id: typeId, node: root, bases: basesOf(root), nextBase: 0 }];
      path.push(typeId);
      onPath.add(typeId);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame.nextBase < frame.bases.length) {
          const baseId = frame.bases[frame.nextBase];
          frame.nextBase += 1;
          if (seen.has(baseId))
            continue;
          if (onPath.has(baseId)) {
            throw new CycleThrown([...path.slice(path.indexOf(baseId)), baseId]);
          }
          const base = nodeOf(profile, baseId);
          if (base === void 0) {
            throw new UnknownBaseThrown(frame.id, baseId);
          }
          stack.push({ id: baseId, node: base, bases: basesOf(base), nextBase: 0 });
          path.push(baseId);
          onPath.add(baseId);
        } else {
          processFrame(frame);
          stack.pop();
          path.pop();
          onPath.delete(frame.id);
        }
      }
    } catch (thrown) {
      if (thrown instanceof CycleThrown) {
        const cycle = thrown.cycle.join(">");
        return {
          ok: false,
          diagnostic: diagnostic({
            code: "type-definition-conflict",
            path: `typeDefinitions.${typeId}.baseType`,
            message: `type definition ${typeId} closes base cycle ${cycle}`,
            refs: [],
            details: { check: "resolution-cycle", cycle }
          }),
          failedType: typeId
        };
      }
      if (thrown instanceof UnknownBaseThrown) {
        return {
          ok: false,
          diagnostic: diagnostic({
            code: "unknown-entity-type",
            path: `typeDefinitions.${thrown.fromId}.baseType`,
            message: `profile ${profile.id} does not declare base type ${thrown.baseId}`
          }),
          failedType: typeId
        };
      }
      if (thrown instanceof RedeclarationThrown) {
        return {
          ok: false,
          diagnostic: diagnostic({
            code: "type-definition-conflict",
            path: `typeDefinitions.${thrown.definitionId}.attributes.${thrown.attribute}`,
            message: `type definition ${thrown.definitionId} redeclares ${thrown.attribute}, which base type ${thrown.baseType} already declares; refinements are additive only`,
            details: { attribute: thrown.attribute, baseType: thrown.baseType }
          }),
          failedType: typeId
        };
      }
      if (thrown instanceof ProfileConflictThrown) {
        return {
          ok: false,
          diagnostic: diagnostic({
            code: "attribute-conflict",
            path: `profiles.${profile.id}.entityTypes.${thrown.typeId}.attributes.${thrown.attribute}`,
            message: `inherited attribute ${thrown.attribute} has incompatible schemas on ${thrown.typeId}`,
            refs: [],
            details: { attribute: thrown.attribute, type: thrown.typeId }
          }),
          failedType: typeId
        };
      }
      throw thrown;
    }
    const ancestry = [...ancestryBaseFirst].reverse();
    const familyType = ancestry.find((id) => entityTypeOf(profile, id) !== void 0) ?? typeId;
    const startDeclared = entityTypeOf(profile, typeId);
    return {
      ok: true,
      resolved: {
        profileId: profile.id,
        typeId,
        ancestry,
        familyType,
        schemas: merged,
        container,
        abstract: startDeclared?.abstract === true
      }
    };
  };
  return {
    get revision() {
      return revision;
    },
    resolve: (profile, typeId) => {
      if (document.revision !== revision) {
        revision = document.revision;
        cache = /* @__PURE__ */ new Map();
      }
      const key = `${profile.id}::${digestProfile(profile)}::${typeId}`;
      const cached = cache.get(key);
      if (cached !== void 0)
        return cached;
      const resolution = resolveInto(profile, typeId);
      cache.set(key, resolution);
      return resolution;
    }
  };
}

// node_modules/@sentropic/diagram-core/dist/connector-registry.js
var STROKE_STYLES = ["solid", "dashed", "dotted"];
var ARROWHEAD_KINDS = ["arrow", "none"];
var LINK_EMPHASIS_KINDS = ["default", "emphasis"];
function deepFreeze2(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value))
    deepFreeze2(child);
  return Object.freeze(value);
}
var DASH_PATTERN_REGISTRY = deepFreeze2({
  solid: {
    style: "solid",
    meaning: "default",
    dashArray: []
  },
  dashed: {
    style: "dashed",
    meaning: "proposed",
    dashArray: [8, 6],
    tokenName: "linkDashDashed"
  },
  dotted: {
    style: "dotted",
    meaning: "dotted",
    dashArray: [2, 5],
    tokenName: "linkDashDotted"
  }
});
var ARROWHEAD_REGISTRY = deepFreeze2({
  arrow: {
    kind: "arrow",
    canonicalKind: "arrow",
    shape: "triangle",
    fill: "stroke",
    outlined: false
  },
  none: {
    kind: "none",
    canonicalKind: "none",
    shape: "none",
    fill: "none",
    outlined: false
  }
});
var LINK_EMPHASIS_REGISTRY = deepFreeze2({
  default: {
    emphasis: "default",
    strokeToken: "edgeStroke",
    widthToken: "linkStrokeWidth",
    changesDash: false
  },
  emphasis: {
    emphasis: "emphasis",
    strokeToken: "linkEmphasisStroke",
    widthToken: "linkEmphasisStrokeWidth",
    changesDash: false
  }
});
var STROKE_STYLE_SET = new Set(STROKE_STYLES);
var ARROWHEAD_KIND_SET = new Set(ARROWHEAD_KINDS);
var LINK_EMPHASIS_SET = new Set(LINK_EMPHASIS_KINDS);
function isStrokeStyle(value) {
  return typeof value === "string" && STROKE_STYLE_SET.has(value);
}
function isArrowheadKind(value) {
  return typeof value === "string" && ARROWHEAD_KIND_SET.has(value);
}
function isLinkEmphasis(value) {
  return typeof value === "string" && LINK_EMPHASIS_SET.has(value);
}
function resolveDashPattern(style) {
  if (style === void 0)
    return DASH_PATTERN_REGISTRY.solid;
  return isStrokeStyle(style) ? DASH_PATTERN_REGISTRY[style] : void 0;
}
function resolveArrowhead(kind) {
  if (kind === void 0)
    return ARROWHEAD_REGISTRY.arrow;
  return isArrowheadKind(kind) ? ARROWHEAD_REGISTRY[kind] : void 0;
}
function resolveLinkEmphasis(emphasis) {
  if (emphasis === void 0)
    return LINK_EMPHASIS_REGISTRY.default;
  return isLinkEmphasis(emphasis) ? LINK_EMPHASIS_REGISTRY[emphasis] : void 0;
}

// node_modules/@sentropic/diagram-core/dist/presentation-pinned-adapter.js
var PINNED_ADAPTER_BYTES = '/**\n * Presentation view validation (M3 \xA73.2\u2013\xA73.6, C.3/C.6).\n *\n * Views without `presentation.diagram` validate exactly as on main; views\n * carrying it execute the closed presentation checks. No folds, no\n * measurement, no archimate@2/uml@2, no migrations.\n */\n\nimport { diagnostic, type Diagnostic } from "./diagnostics.js";\nimport type { SemanticDocument } from "./document.js";\nimport {\n  isPresentationContractPin,\n  type DiagramPresentation,\n  type PresentationPin,\n} from "./presentation.js";\nimport { createTypeResolver } from "./resolver.js";\nimport { refKindOf } from "./refs.js";\nimport type { ProfileRegistry } from "./profile.js";\nimport type { ValidationOptions } from "./validate.js";\nimport type { ViewDocument } from "./view.js";\n\nconst KEY_PATTERN = /^[a-z][a-z0-9-]*$/;\nconst TOKEN_PATTERN = /^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$/;\nconst DIGEST_PATTERN = /^[0-9a-f]{64}$/;\n\nfunction shapeMismatch(path: string): Diagnostic {\n  return diagnostic({\n    code: "occurrence-endpoint-mismatch",\n    severity: "error",\n    path,\n    message: "diagram presentation fails check presentation-shape-invalid",\n    refs: [],\n    details: { check: "presentation-shape-invalid" },\n  });\n}\n\nfunction pinMismatch(path: string): Diagnostic {\n  return diagnostic({\n    code: "occurrence-endpoint-mismatch",\n    severity: "error",\n    path,\n    message: "diagram presentation fails check presentation-pin-mismatch",\n    refs: [],\n    details: { check: "presentation-pin-mismatch" },\n  });\n}\n\nfunction formMismatch(path: string): Diagnostic {\n  return diagnostic({\n    code: "occurrence-endpoint-mismatch",\n    severity: "error",\n    path,\n    message: "diagram presentation fails check form-selector-mismatch",\n    refs: [],\n    details: { check: "form-selector-mismatch" },\n  });\n}\n\nfunction orderMismatch(path: string): Diagnostic {\n  return diagnostic({\n    code: "occurrence-endpoint-mismatch",\n    severity: "error",\n    path,\n    message: "diagram presentation fails check legend-order-invalid",\n    refs: [],\n    details: { check: "legend-order-invalid" },\n  });\n}\n\nfunction tokenConflict(path: string): Diagnostic {\n  return diagnostic({\n    code: "occurrence-endpoint-mismatch",\n    severity: "error",\n    path,\n    message: "diagram presentation fails check token-binding-conflict",\n    refs: [],\n    details: { check: "token-binding-conflict" },\n  });\n}\n\nfunction isRecord(value: unknown): value is Record<string, unknown> {\n  return typeof value === "object" && value !== null && !Array.isArray(value);\n}\n\nfunction textTooLong(path: string, length: number, maxLength: number): Diagnostic {\n  return diagnostic({\n    code: "text-too-long",\n    severity: "error",\n    path,\n    message: `text is ${length} characters, the schema allows ${maxLength}`,\n    details: { length, maxLength },\n  });\n}\n\nfunction patternMismatch(\n  path: string,\n  patternName: string,\n  length: number,\n  maxLength?: number,\n): Diagnostic {\n  return diagnostic({\n    code: "text-pattern-mismatch",\n    severity: "error",\n    path,\n    message: `value does not match the ${patternName} grammar`,\n    refs: [],\n    details:\n      maxLength === undefined\n        ? { pattern: patternName, length }\n        : { pattern: patternName, length, maxLength },\n  });\n}\n\nfunction minLengthMismatch(path: string, attribute: string, length: number, minLength: number): Diagnostic {\n  return diagnostic({\n    code: "text-pattern-mismatch",\n    severity: "error",\n    path,\n    message: `value is shorter than the minimum length for ${attribute}`,\n    refs: [],\n    details: { pattern: "min-length", length, minLength },\n  });\n}\n\nfunction danglingPresentation(path: string, targetId: string): Diagnostic {\n  return diagnostic({\n    code: "dangling-reference",\n    severity: "error",\n    path,\n    message: `presentation reference ${targetId} does not resolve`,\n    refs: [targetId],\n    details: {},\n  });\n}\n\nfunction wrongNamespacePresentation(path: string, targetId: string, expectedKind: string): Diagnostic {\n  return diagnostic({\n    code: "reference-type-mismatch",\n    severity: "error",\n    path,\n    message: `presentation reference ${targetId} must be a ${expectedKind}`,\n    refs: [targetId],\n    details: { expectedKind },\n  });\n}\n\nconst GENERIC2_PROFILE_ID = "generic@2" as const;\n\ninterface FamilySets {\n  readonly legendHierarchyIds: ReadonlySet<string>;\n}\n\nfunction collectFamilySets(registry: ProfileRegistry, profileIds: readonly string[]): FamilySets {\n  const legendHierarchyIds = new Set<string>();\n  for (const id of profileIds) {\n    if (id !== GENERIC2_PROFILE_ID) continue;\n    const profile = registry.get(id as never);\n    if (profile === undefined) continue;\n    for (const constraint of profile.constraints) {\n      if (constraint.kind === "children-restricted" || constraint.kind === "required-parent") {\n        const typed = constraint as {\n          readonly hierarchyId: string;\n        };\n        legendHierarchyIds.add(typed.hierarchyId);\n      }\n    }\n  }\n  return { legendHierarchyIds };\n}\n\nfunction isGeneric2Legend(\n  document: SemanticDocument,\n  registry: ProfileRegistry,\n  resolver: ReturnType<typeof createTypeResolver>,\n  entityId: string,\n): boolean {\n  const entity = document.entities[entityId];\n  if (entity === undefined) return false;\n  if (entity.profile !== GENERIC2_PROFILE_ID) return false;\n  const owner = registry.get(entity.profile as never);\n  if (owner === undefined) return false;\n  const resolution = resolver.resolve(owner, entity.type);\n  if (!resolution.ok) return false;\n  return resolution.resolved.ancestry.includes("legend");\n}\n\nfunction isGeneric2Key(\n  document: SemanticDocument,\n  registry: ProfileRegistry,\n  resolver: ReturnType<typeof createTypeResolver>,\n  entityId: string,\n): boolean {\n  const entity = document.entities[entityId];\n  if (entity === undefined) return false;\n  if (entity.profile !== GENERIC2_PROFILE_ID) return false;\n  const owner = registry.get(entity.profile as never);\n  if (owner === undefined) return false;\n  const resolution = resolver.resolve(owner, entity.type);\n  if (!resolution.ok) return false;\n  return resolution.resolved.ancestry.includes("legend-key");\n}\n\nfunction satisfiesExplicitForm(\n  form: string,\n  ownerId: string,\n  ancestry: readonly string[],\n  container: boolean,\n): boolean {\n  if (form === "card") return container === false;\n  if (form === "container") return container === true;\n  if (form === "legend") return ownerId === GENERIC2_PROFILE_ID && ancestry.includes("legend");\n  if (form === "legend-key") return ownerId === GENERIC2_PROFILE_ID && ancestry.includes("legend-key");\n  return false;\n}\n\nfunction hierarchyChildren(\n  document: SemanticDocument,\n  registry: ProfileRegistry,\n  hierarchyIds: ReadonlySet<string>,\n): Map<string, string[]> {\n  const childToParents = new Map<string, string[]>();\n  void registry;\n  void hierarchyIds;\n  void childToParents;\n  return new Map();\n}\n\nexport function validateDiagramPresentation(\n  document: SemanticDocument,\n  view: ViewDocument,\n  options: ValidationOptions,\n): readonly Diagnostic[] {\n  const diagram = view.presentation.diagram as DiagramPresentation | undefined;\n  if (diagram === undefined) return [];\n  const diagnostics: Diagnostic[] = [];\n  const registry = options.registry;\n  const resolver = createTypeResolver(document);\n  const familySets = collectFamilySets(\n    registry,\n    document.profileRefs as readonly string[],\n  );\n  for (const key of Object.keys(view.relationOccurrences).sort()) {\n    const occurrence = view.relationOccurrences[key] as unknown as Record<string, unknown>;\n    const style = occurrence["strokeStyle"];\n    if (style !== undefined && style !== "solid" && style !== "dashed") {\n      diagnostics.push(shapeMismatch(`relationOccurrences.${key}.strokeStyle`));\n    }\n  }\n\n  const shapeFailed = new Set<string>();\n\n  if (!isRecord(diagram)) {\n    diagnostics.push(shapeMismatch("presentation.diagram"));\n    return diagnostics;\n  }\n  const allowedDiagramKeys = new Set(["contractPin", "entities", "legends", "categoryTokens"]);\n  for (const key of Object.keys(diagram as unknown as Record<string, unknown>)) {\n    if (!allowedDiagramKeys.has(key)) {\n      diagnostics.push(shapeMismatch(`presentation.diagram.${key}`));\n      shapeFailed.add(`presentation.diagram.${key}`);\n    }\n  }\n  for (const required of ["contractPin", "entities", "legends", "categoryTokens"]) {\n    if ((diagram as unknown as Record<string, unknown>)[required] === undefined) {\n      diagnostics.push(shapeMismatch(`presentation.diagram.${required}`));\n      shapeFailed.add(`presentation.diagram.${required}`);\n    }\n  }\n  if (shapeFailed.size > 0) {\n    return diagnostics;\n  }\n\n  const contractPin = diagram.contractPin as unknown;\n  if (!isRecord(contractPin)) {\n    diagnostics.push(shapeMismatch("presentation.diagram.contractPin"));\n    return diagnostics;\n  }\n  const allowedPinKeys = new Set(["id", "version", "contentDigest"]);\n  for (const key of Object.keys(contractPin)) {\n    if (!allowedPinKeys.has(key)) {\n      diagnostics.push(shapeMismatch(`presentation.diagram.contractPin.${key}`));\n    }\n  }\n  for (const required of ["id", "version", "contentDigest"]) {\n    if (contractPin[required] === undefined) {\n      diagnostics.push(shapeMismatch(`presentation.diagram.contractPin.${required}`));\n    }\n  }\n  if (\n    typeof contractPin["id"] !== "string" ||\n    typeof contractPin["version"] !== "string" ||\n    typeof contractPin["contentDigest"] !== "string"\n  ) {\n    diagnostics.push(shapeMismatch("presentation.diagram.contractPin"));\n    return diagnostics;\n  }\n  if (\n    !isPresentationContractPin(contractPin as unknown as PresentationPin) ||\n    !DIGEST_PATTERN.test(contractPin["contentDigest"] as string)\n  ) {\n    diagnostics.push(pinMismatch("presentation.diagram.contractPin"));\n    return diagnostics;\n  }\n\n  if (!isRecord(diagram.entities as unknown)) {\n    diagnostics.push(shapeMismatch("presentation.diagram.entities"));\n    return diagnostics;\n  }\n  if (!isRecord(diagram.legends as unknown)) {\n    diagnostics.push(shapeMismatch("presentation.diagram.legends"));\n    return diagnostics;\n  }\n  if (!Array.isArray(diagram.categoryTokens as unknown)) {\n    diagnostics.push(shapeMismatch("presentation.diagram.categoryTokens"));\n    return diagnostics;\n  }\n\n  const entities = diagram.entities as unknown as Record<string, unknown>;\n  const legends = diagram.legends as unknown as Record<string, unknown>;\n  const categoryTokens = diagram.categoryTokens as unknown as readonly unknown[];\n\n  const validEntityOccurrences = new Set<string>();\n  for (const key of Object.keys(entities).sort()) {\n    const entryPath = `presentation.diagram.entities.${key}`;\n    if (refKindOf(key) !== "occurrence") {\n      diagnostics.push(wrongNamespacePresentation(entryPath, key, "occurrence"));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    if (view.entityOccurrences[key] === undefined) {\n      diagnostics.push(danglingPresentation(entryPath, key));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    validEntityOccurrences.add(key);\n    const entry = entities[key] as unknown;\n    if (!isRecord(entry)) {\n      diagnostics.push(shapeMismatch(entryPath));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    const allowed = new Set(["form", "text", "icon", "categoryRef"]);\n    for (const field of Object.keys(entry)) {\n      if (!allowed.has(field)) {\n        diagnostics.push(shapeMismatch(`${entryPath}.${field}`));\n        shapeFailed.add(`${entryPath}.${field}`);\n      }\n    }\n    if (entry["form"] === undefined || entry["text"] === undefined) {\n      if (entry["form"] === undefined) {\n        diagnostics.push(shapeMismatch(`${entryPath}.form`));\n        shapeFailed.add(`${entryPath}.form`);\n      }\n      if (entry["text"] === undefined) {\n        diagnostics.push(shapeMismatch(`${entryPath}.text`));\n        shapeFailed.add(`${entryPath}.text`);\n      }\n      continue;\n    }\n    if (\n      entry["form"] !== "card" &&\n      entry["form"] !== "container" &&\n      entry["form"] !== "legend" &&\n      entry["form"] !== "legend-key"\n    ) {\n      diagnostics.push(shapeMismatch(`${entryPath}.form`));\n      shapeFailed.add(`${entryPath}.form`);\n      continue;\n    }\n    const textValue = entry["text"] as unknown;\n    if (!isRecord(textValue)) {\n      diagnostics.push(shapeMismatch(`${entryPath}.text`));\n      shapeFailed.add(`${entryPath}.text`);\n      continue;\n    }\n    const allowedText = new Set(["title", "kicker", "body", "detail", "subtitle", "footer"]);\n    for (const slot of Object.keys(textValue)) {\n      if (!allowedText.has(slot)) {\n        diagnostics.push(shapeMismatch(`${entryPath}.text.${slot}`));\n        shapeFailed.add(`${entryPath}.text.${slot}`);\n      } else if (typeof textValue[slot] !== "string") {\n        diagnostics.push(shapeMismatch(`${entryPath}.text.${slot}`));\n        shapeFailed.add(`${entryPath}.text.${slot}`);\n      }\n    }\n    if (entry["icon"] !== undefined && typeof entry["icon"] !== "string") {\n      diagnostics.push(shapeMismatch(`${entryPath}.icon`));\n      shapeFailed.add(`${entryPath}.icon`);\n    }\n    if (entry["categoryRef"] !== undefined && typeof entry["categoryRef"] !== "string") {\n      diagnostics.push(shapeMismatch(`${entryPath}.categoryRef`));\n      shapeFailed.add(`${entryPath}.categoryRef`);\n    }\n  }\n\n  for (const key of Object.keys(legends).sort()) {\n    const entryPath = `presentation.diagram.legends.${key}`;\n    if (refKindOf(key) !== "occurrence") {\n      diagnostics.push(wrongNamespacePresentation(entryPath, key, "occurrence"));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    if (view.entityOccurrences[key] === undefined) {\n      diagnostics.push(danglingPresentation(entryPath, key));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    const entry = legends[key] as unknown;\n    if (!isRecord(entry)) {\n      diagnostics.push(shapeMismatch(entryPath));\n      shapeFailed.add(entryPath);\n      continue;\n    }\n    for (const field of Object.keys(entry)) {\n      if (field !== "order") {\n        diagnostics.push(shapeMismatch(`${entryPath}.${field}`));\n        shapeFailed.add(`${entryPath}.${field}`);\n      }\n    }\n    if (entry["order"] === undefined) {\n      diagnostics.push(shapeMismatch(`${entryPath}.order`));\n      shapeFailed.add(`${entryPath}.order`);\n      continue;\n    }\n    if (!Array.isArray(entry["order"])) {\n      diagnostics.push(shapeMismatch(`${entryPath}.order`));\n      shapeFailed.add(`${entryPath}.order`);\n      continue;\n    }\n    const order = entry["order"] as readonly unknown[];\n    let orderShapeBad = false;\n    order.forEach((item, index) => {\n      if (typeof item !== "string") {\n        diagnostics.push(shapeMismatch(`${entryPath}.order[${index}]`));\n        shapeFailed.add(`${entryPath}.order`);\n        orderShapeBad = true;\n      }\n    });\n    if (orderShapeBad) continue;\n  }\n\n  categoryTokens.forEach((item, index) => {\n    const itemPath = `presentation.diagram.categoryTokens[${index}]`;\n    if (!isRecord(item)) {\n      diagnostics.push(shapeMismatch(itemPath));\n      shapeFailed.add(itemPath);\n      return;\n    }\n    const allowed = new Set(["legendRef", "category", "token"]);\n    for (const field of Object.keys(item)) {\n      if (!allowed.has(field)) {\n        diagnostics.push(shapeMismatch(`${itemPath}.${field}`));\n        shapeFailed.add(`${itemPath}.${field}`);\n      }\n    }\n    for (const required of ["legendRef", "category", "token"]) {\n      if (item[required] === undefined) {\n        diagnostics.push(shapeMismatch(`${itemPath}.${required}`));\n        shapeFailed.add(`${itemPath}.${required}`);\n      } else if (typeof item[required] !== "string") {\n        diagnostics.push(shapeMismatch(`${itemPath}.${required}`));\n        shapeFailed.add(`${itemPath}.${required}`);\n      }\n    }\n  });\n\n  if (diagnostics.some((entry) => entry.details !== undefined && (entry.details as Record<string, unknown>)["check"] === "presentation-shape-invalid")) {\n    const onlyShape = diagnostics.filter(\n      (entry) => (entry.details as Record<string, unknown> | undefined)?.["check"] === "presentation-shape-invalid",\n    );\n    if (diagnostics.length > 0 && onlyShape.length > 0 && shapeFailed.size > 0) {\n      return onlyShape;\n    }\n  }\n\n  for (const key of Object.keys(entities).sort()) {\n    if (shapeFailed.has(`presentation.diagram.entities.${key}`)) continue;\n    if (!validEntityOccurrences.has(key)) continue;\n    const entry = entities[key] as { form: string; text: Record<string, string>; icon?: string };\n    const entryPath = `presentation.diagram.entities.${key}`;\n    const occurrence = view.entityOccurrences[key];\n    if (occurrence === undefined) continue;\n    const semantic = document.entities[occurrence.entity];\n    if (semantic === undefined) continue;\n    const owner = registry.get(semantic.profile as never);\n    if (owner === undefined) continue;\n    const resolution = resolver.resolve(owner, semantic.type);\n    if (!resolution.ok) continue;\n    const ancestry = resolution.resolved.ancestry;\n    const container = resolution.resolved.container;\n    if (!satisfiesExplicitForm(entry.form, owner.id, ancestry, container)) {\n      diagnostics.push(formMismatch(`${entryPath}.form`));\n      continue;\n    }\n    const textValue = entry.text as Record<string, string>;\n    const maxFor = (slot: string): number => {\n      if (slot === "title") return entry.form === "legend-key" ? 120 : 200;\n      if (slot === "kicker") return 80;\n      if (slot === "body" || slot === "detail") return 400;\n      if (slot === "subtitle") return 600;\n      return 120;\n    };\n    for (const slot of Object.keys(textValue).sort()) {\n      const value = textValue[slot] as string;\n      if (typeof value !== "string") continue;\n      if ((entry.form === "card" || entry.form === "legend-key") && slot === "subtitle") {\n        diagnostics.push(shapeMismatch(`${entryPath}.text.${slot}`));\n        continue;\n      }\n      const max = maxFor(slot);\n      if ([...value].length > max) {\n        diagnostics.push(textTooLong(`${entryPath}.text.${slot}`, [...value].length, max));\n      }\n    }\n    if (typeof entry.icon === "string") {\n      const length = [...entry.icon].length;\n      if (length > 40) {\n        diagnostics.push(textTooLong(`${entryPath}.icon`, length, 40));\n      } else if (length < 1) {\n        diagnostics.push(minLengthMismatch(`${entryPath}.icon`, "icon", length, 1));\n      } else if (!KEY_PATTERN.test(entry.icon)) {\n        diagnostics.push(patternMismatch(`${entryPath}.icon`, "key", length, 40));\n      }\n    }\n  }\n\n  categoryTokens.forEach((item, index) => {\n    const itemPath = `presentation.diagram.categoryTokens[${index}]`;\n    if (shapeFailed.has(itemPath)) return;\n    const typed = item as { legendRef: string; category: string; token: string };\n    if (typeof typed.legendRef !== "string" || typeof typed.category !== "string" || typeof typed.token !== "string") {\n      return;\n    }\n    if (refKindOf(typed.legendRef) !== "entity") {\n      diagnostics.push(wrongNamespacePresentation(`${itemPath}.legendRef`, typed.legendRef, "entity"));\n      return;\n    }\n    const target = document.entities[typed.legendRef];\n    if (target === undefined) {\n      diagnostics.push(danglingPresentation(`${itemPath}.legendRef`, typed.legendRef));\n      return;\n    }\n    if (!isGeneric2Legend(document, registry, resolver, typed.legendRef)) {\n      diagnostics.push({\n        code: "tone-category-unknown",\n        severity: "error",\n        path: `${itemPath}.legendRef`,\n        message: `legendRef names ${typed.legendRef}, which is not a legend`,\n        refs: [typed.legendRef],\n        details: {\n          value: typed.category,\n          legendBinding: "bound-target-not-legend",\n          categoryType: "legend-key",\n        },\n      });\n      return;\n    }\n    const categoryLength = [...typed.category].length;\n    if (typed.category.length === 0 || categoryLength > 40 || !KEY_PATTERN.test(typed.category)) {\n      if (categoryLength > 40) {\n        diagnostics.push(textTooLong(`${itemPath}.category`, categoryLength, 40));\n      } else if (categoryLength < 1) {\n        diagnostics.push(minLengthMismatch(`${itemPath}.category`, "category", categoryLength, 1));\n      } else {\n        diagnostics.push(patternMismatch(`${itemPath}.category`, "key", categoryLength, 40));\n      }\n      return;\n    }\n    const tokenLength = [...typed.token].length;\n    if (tokenLength > 80) {\n      diagnostics.push(textTooLong(`${itemPath}.token`, tokenLength, 80));\n    } else if (tokenLength < 1) {\n      diagnostics.push(minLengthMismatch(`${itemPath}.token`, "token", tokenLength, 1));\n    } else if (!TOKEN_PATTERN.test(typed.token)) {\n      diagnostics.push(patternMismatch(`${itemPath}.token`, "token-name", tokenLength, 80));\n    }\n  });\n\n  const seenBindings = new Map<string, number>();\n  categoryTokens.forEach((item, index) => {\n    const typed = item as { legendRef?: unknown; category?: unknown };\n    if (typeof typed.legendRef !== "string" || typeof typed.category !== "string") return;\n    const key = `${typed.legendRef}\\n${typed.category}`;\n    if (seenBindings.has(key)) {\n      diagnostics.push(tokenConflict(`presentation.diagram.categoryTokens[${index}]`));\n    } else {\n      seenBindings.set(key, index);\n    }\n  });\n\n  for (const key of Object.keys(entities).sort()) {\n    if (shapeFailed.has(`presentation.diagram.entities.${key}`)) continue;\n    if (!validEntityOccurrences.has(key)) continue;\n    const entry = entities[key] as { categoryRef?: unknown };\n    const entryPath = `presentation.diagram.entities.${key}.categoryRef`;\n    if (entry.categoryRef === undefined) continue;\n    if (typeof entry.categoryRef !== "string") continue;\n    const targetId = entry.categoryRef as string;\n    if (refKindOf(targetId) !== "entity") {\n      diagnostics.push(wrongNamespacePresentation(entryPath, targetId, "entity"));\n      continue;\n    }\n    if (document.entities[targetId] === undefined) {\n      diagnostics.push(danglingPresentation(entryPath, targetId));\n      continue;\n    }\n    if (!isGeneric2Key(document, registry, resolver, targetId)) {\n      diagnostics.push(wrongNamespacePresentation(entryPath, targetId, "legend-key"));\n    }\n  }\n\n  void hierarchyChildren;\n\n  const legendChildren = new Map<string, string[]>();\n  const buildLegendChildren = (): void => {\n    if (legendChildren.size > 0) return;\n    const hierarchyIds = familySets.legendHierarchyIds;\n    if (hierarchyIds.size === 0) return;\n    for (const profileId of document.profileRefs) {\n      if (profileId !== GENERIC2_PROFILE_ID) continue;\n      const profile = registry.get(profileId as never);\n      if (profile === undefined) continue;\n      const declarations = profile.relationTypes.filter((declaration) =>\n        declaration.hierarchy !== undefined && hierarchyIds.has(declaration.hierarchy.id),\n      );\n      for (const declaration of declarations) {\n        const hierarchy = declaration.hierarchy as { parentRole: string; childRole: string };\n        for (const relation of Object.values(document.relations)) {\n          if (relation.profile !== profile.id || relation.type !== declaration.id) continue;\n          const parents = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy.parentRole);\n          const kids = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy.childRole);\n          for (const parent of parents) {\n            if (refKindOf(parent.target) !== "entity") continue;\n            for (const kid of kids) {\n              if (refKindOf(kid.target) !== "entity") continue;\n              legendChildren.set(parent.target, [...(legendChildren.get(parent.target) ?? []), kid.target]);\n            }\n          }\n        }\n      }\n    }\n    for (const kids of legendChildren.values()) kids.sort();\n  };\n  buildLegendChildren();\n\n  const directKeysOf = (legendEntityId: string): string[] => {\n    if (!isGeneric2Legend(document, registry, resolver, legendEntityId)) return [];\n    const kids = legendChildren.get(legendEntityId) ?? [];\n    return kids.filter((kid) => isGeneric2Key(document, registry, resolver, kid));\n  };\n\n  const isLegendEntity = (entityId: string): boolean =>\n    isGeneric2Legend(document, registry, resolver, entityId);\n\n  categoryTokens.forEach((item, index) => {\n    const itemPath = `presentation.diagram.categoryTokens[${index}]`;\n    if (shapeFailed.has(itemPath)) return;\n    const typed = item as { legendRef?: unknown; category?: unknown; token?: unknown };\n    if (typeof typed.legendRef !== "string" || typeof typed.category !== "string" || typeof typed.token !== "string") {\n      return;\n    }\n    if (refKindOf(typed.legendRef) !== "entity") return;\n    if (document.entities[typed.legendRef] === undefined) return;\n    if (!isGeneric2Legend(document, registry, resolver, typed.legendRef)) return;\n    const categoryLength = [...typed.category].length;\n    if (typed.category.length === 0 || categoryLength > 40 || !KEY_PATTERN.test(typed.category)) return;\n    const tokenValue = typed.token;\n    if (typeof tokenValue !== "string") return;\n    const tokenLength = [...tokenValue].length;\n    if (tokenLength < 1 || tokenLength > 80 || !TOKEN_PATTERN.test(tokenValue)) return;\n    const direct = directKeysOf(typed.legendRef);\n    const categories = new Set<string>();\n    for (const kid of direct) {\n      const keyEntity = document.entities[kid];\n      if (keyEntity === undefined) continue;\n      const keyValue = keyEntity.attributes["category"];\n      if (keyValue !== undefined && keyValue.kind === "text") {\n        const value = (keyValue as { value: string }).value;\n        if (typeof value === "string") categories.add(value);\n      }\n    }\n    if (!categories.has(typed.category)) {\n      diagnostics.push({\n        code: "tone-category-unknown",\n        severity: "error",\n        path: `${itemPath}.category`,\n        message: `category ${typed.category} is not a direct key category of legend ${typed.legendRef}`,\n        refs: [typed.legendRef],\n        details: { value: typed.category, legendBinding: "undeclared", categoryType: "legend-key" },\n      });\n    }\n  });\n\n  for (const key of Object.keys(entities).sort()) {\n    if (shapeFailed.has(`presentation.diagram.entities.${key}`)) continue;\n    if (!validEntityOccurrences.has(key)) continue;\n    const entry = entities[key] as { categoryRef?: string };\n    if (entry.categoryRef !== undefined) continue;\n    const occurrence = view.entityOccurrences[key];\n    if (occurrence === undefined) continue;\n    const semantic = document.entities[occurrence.entity];\n    if (semantic === undefined) continue;\n    const owner = registry.get(semantic.profile as never);\n    if (owner === undefined) continue;\n    const resolution = resolver.resolve(owner, semantic.type);\n    if (!resolution.ok) continue;\n    const ancestry = resolution.resolved.ancestry;\n    const isKeyType = owner.id === GENERIC2_PROFILE_ID && ancestry.includes("legend-key");\n    const isLegendType = owner.id === GENERIC2_PROFILE_ID && ancestry.includes("legend");\n    if (isKeyType || isLegendType) continue;\n    const schemas = resolution.resolved.schemas;\n    const categorySchema = schemas.find((schema) => schema.name === "category");\n    if (categorySchema === undefined || categorySchema.kind !== "text") continue;\n    const value = semantic.attributes["category"];\n    if (value === undefined || value.kind !== "text") continue;\n    const category = (value as { value: string }).value;\n    if (typeof category !== "string" || category.length === 0) continue;\n    const matchingLegends: string[] = [];\n    for (const entityId of Object.keys(document.entities).sort()) {\n      if (!isLegendEntity(entityId)) continue;\n      const keys = directKeysOf(entityId);\n      for (const kid of keys) {\n        const keyEntity = document.entities[kid];\n        if (keyEntity === undefined) continue;\n        const keyValue = keyEntity.attributes["category"];\n        if (keyValue !== undefined && keyValue.kind === "text" && (keyValue as { value: string }).value === category) {\n          matchingLegends.push(entityId);\n          break;\n        }\n      }\n    }\n    if (matchingLegends.length === 0) {\n      diagnostics.push({\n        code: "tone-category-unknown",\n        severity: "error",\n        path: `presentation.diagram.entities.${key}.categoryRef`,\n        message: `category ${category} on occurrence ${key} is not declared by any legend in this document`,\n        refs: [key],\n        details: { value: category, legendBinding: "undeclared", categoryType: "legend-key" },\n      });\n      continue;\n    }\n    const tokens = new Set<string>();\n    for (const legendId of matchingLegends) {\n      for (const [index, item] of (categoryTokens as readonly unknown[]).entries()) {\n        void index;\n        const typed = item as { legendRef: string; category: string; token: string };\n        if (typed.legendRef === legendId && typed.category === category && typeof typed.token === "string") {\n          tokens.add(typed.token);\n        }\n      }\n    }\n    if (tokens.size === 0) {\n      diagnostics.push({\n        code: "tone-category-unknown",\n        severity: "error",\n        path: `presentation.diagram.entities.${key}.categoryRef`,\n        message: `category ${category} on occurrence ${key} is not declared by any legend in this document`,\n        refs: [key],\n        details: { value: category, legendBinding: "undeclared", categoryType: "legend-key" },\n      });\n      continue;\n    }\n    if (tokens.size > 1) {\n      diagnostics.push({\n        code: "tone-category-unknown",\n        severity: "error",\n        path: `presentation.diagram.entities.${key}.categoryRef`,\n        message: `category ${category} on occurrence ${key} resolves ambiguously across legends; set categoryRef to bind it`,\n        refs: [key],\n        details: { value: category, legendBinding: "ambiguous", categoryType: "legend-key" },\n      });\n    }\n  }\n\n  for (const key of Object.keys(legends).sort()) {\n    const entryPath = `presentation.diagram.legends.${key}.order`;\n    const entryKeyPath = `presentation.diagram.legends.${key}`;\n    if (shapeFailed.has(entryPath) || shapeFailed.has(entryKeyPath)) continue;\n    const occurrence = view.entityOccurrences[key];\n    if (occurrence === undefined) continue;\n    const semantic = document.entities[occurrence.entity];\n    if (semantic === undefined) continue;\n    if (!isGeneric2Legend(document, registry, resolver, semantic.id)) {\n      diagnostics.push(formMismatch(entryKeyPath));\n      continue;\n    }\n    const entry = legends[key] as { order: readonly unknown[] };\n    const actual = (entry.order ?? []) as readonly unknown[];\n    let referencesOk = true;\n    actual.forEach((item, index) => {\n      if (typeof item !== "string") return;\n      const itemPath = `${entryPath}[${index}]`;\n      if (refKindOf(item) !== "entity") {\n        diagnostics.push(wrongNamespacePresentation(itemPath, item, "entity"));\n        referencesOk = false;\n        return;\n      }\n      if (document.entities[item] === undefined) {\n        diagnostics.push(danglingPresentation(itemPath, item));\n        referencesOk = false;\n      }\n    });\n    if (!referencesOk) continue;\n    const expected = directKeysOf(semantic.id).slice().sort();\n    const actualStrings = actual.filter((item): item is string => typeof item === "string");\n    const actualSorted = [...actualStrings].sort();\n    const uniqueActual = new Set(actualStrings);\n    if (\n      uniqueActual.size !== actualStrings.length ||\n      actualSorted.length !== expected.length ||\n      actualSorted.some((value, index) => value !== expected[index])\n    ) {\n      diagnostics.push(orderMismatch(entryPath));\n    }\n  }\n\n  return diagnostics;\n}\n';

// node_modules/@sentropic/diagram-core/dist/presentation-catalog.js
function deepFreezeValue(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Object.isFrozen(value))
    return value;
  const target = value;
  for (const key of Object.keys(target)) {
    const child = target[key];
    if (child !== null && typeof child === "object") {
      deepFreezeValue(child);
    }
  }
  return Object.freeze(value);
}
var PRIVATE_ENTRY_1 = {
  "format": "sentropic.registry-entry/v1",
  "contractVersion": "1.1.4",
  "kind": "ontology",
  "id": "engram-diagram-presentation-1",
  "name": "diagram-presentation@1",
  "description": "Governed typed presentation contract (S1 draft).",
  "entryVersion": "1",
  "publisher": {
    "packageName": "engram-diagram-lot",
    "packageVersion": "0.1.0"
  },
  "compatibility": {
    "entryContract": "1.1.4",
    "packages": [],
    "schemaProfiles": [
      "diagram-presentation-schema/1"
    ],
    "requiredHostFeatures": [
      "ontology-descriptors"
    ],
    "optionalHostFeatures": []
  },
  "parameters": {
    "schemaVersion": "1",
    "schema": {
      "$ref": "engram:diagram-presentation-schema"
    },
    "defaults": {}
  },
  "bindings": [
    {
      "key": "profile",
      "contract": "engram:diagram-profile/1#sha256=60e3997a1f67259219eb8a7a9aa5ab8da4c89b85fe19b96e67326bc7fd386a2a",
      "required": true
    }
  ],
  "assets": [
    {
      "role": "profile-data",
      "path": "contracts/diagram-presentation-1.json",
      "mediaType": "application/json",
      "sha256": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
    }
  ],
  "ontology": {
    "canonicalRef": "engram:diagram-presentation@1",
    "namespace": "diagram",
    "owner": "engram",
    "profileShape": "mechanism-descriptor",
    "artifactKind": "contract",
    "profilePin": {
      "id": "diagram-presentation",
      "version": "1",
      "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
    },
    "stack": [
      {
        "id": "diagram-presentation",
        "version": "1",
        "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
      }
    ],
    "digests": {
      "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae",
      "pinsDigest": "9be4a5ef9dcffa7697ffd3f279d2b062cff799ab36814a80c4371d7cebc41a80",
      "resultEvidence": {
        "evidenceState": "unresolved"
      }
    },
    "ruleSheets": [],
    "lifecycle": "draft",
    "provenance": {
      "sourceRef": "m3/SPEC_EVOL_GD_M3_DIAGRAM_MODEL-FROZEN-deb64b75.md",
      "sourceRevision": "deb64b75e884bfefbdd97de698c899805568271ea1fc521fffe02cbc20288c2f"
    },
    "lineage": {
      "parents": [],
      "mappings": [],
      "migrations": []
    },
    "conflictPolicy": "engram:g0-conflicts@1",
    "completeness": "complete",
    "corpusRef": {
      "ref": "engram:diagram-lot-corpus/1",
      "digest": "e946288de536075611c25e7b5e6078ea3def433b66d7a6ea60c1eb20cfebcf6e"
    },
    "receipts": [],
    "migrations": [],
    "consumers": [],
    "compatibility": {
      "renderer": "transitional:ds-diagram-core-executor-unqualified",
      "adapter": "transitional:ds-schema-adapter-unqualified"
    },
    "visibility": "public",
    "linkedTools": [],
    "artifactBinding": {
      "artifactKind": "contract",
      "schemaPin": {
        "id": "diagram-presentation-schema",
        "version": "1",
        "contentDigest": "f13d595793e17e1e4740c9203b19d8381fc55b90e37121d61f5037cb79f0281a"
      },
      "compatibilityMatrixVersion": "1"
    }
  }
};
var PRIVATE_ENTRY_2 = {
  "format": "sentropic.registry-entry/v1",
  "contractVersion": "1.1.4",
  "kind": "ontology",
  "id": "engram-diagram-presentation-2",
  "name": "diagram-presentation@1",
  "description": "Governed typed presentation contract with qualified DS adapter/renderer refs (entry revision 2; revises entry 1).",
  "entryVersion": "2",
  "publisher": {
    "packageName": "engram-diagram-lot",
    "packageVersion": "0.1.0"
  },
  "compatibility": {
    "entryContract": "1.1.4",
    "packages": [],
    "schemaProfiles": [
      "diagram-presentation-schema/1"
    ],
    "requiredHostFeatures": [
      "ontology-descriptors"
    ],
    "optionalHostFeatures": []
  },
  "parameters": {
    "schemaVersion": "1",
    "schema": {
      "$ref": "engram:diagram-presentation-schema"
    },
    "defaults": {}
  },
  "bindings": [
    {
      "key": "profile",
      "contract": "engram:diagram-profile/1#sha256=60e3997a1f67259219eb8a7a9aa5ab8da4c89b85fe19b96e67326bc7fd386a2a",
      "required": true
    }
  ],
  "assets": [
    {
      "role": "profile-data",
      "path": "contracts/diagram-presentation-1.json",
      "mediaType": "application/json",
      "sha256": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
    }
  ],
  "ontology": {
    "canonicalRef": "engram:diagram-presentation@1",
    "namespace": "diagram",
    "owner": "engram",
    "profileShape": "mechanism-descriptor",
    "artifactKind": "contract",
    "profilePin": {
      "id": "diagram-presentation",
      "version": "1",
      "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
    },
    "stack": [
      {
        "id": "diagram-presentation",
        "version": "1",
        "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
      }
    ],
    "digests": {
      "contentDigest": "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae",
      "pinsDigest": "9be4a5ef9dcffa7697ffd3f279d2b062cff799ab36814a80c4371d7cebc41a80",
      "resultEvidence": {
        "evidenceState": "unresolved"
      }
    },
    "ruleSheets": [],
    "lifecycle": "draft",
    "provenance": {
      "sourceRef": "m3/SPEC_EVOL_GD_M3_DIAGRAM_MODEL-FROZEN-deb64b75.md",
      "sourceRevision": "deb64b75e884bfefbdd97de698c899805568271ea1fc521fffe02cbc20288c2f"
    },
    "lineage": {
      "parents": [],
      "mappings": [],
      "migrations": []
    },
    "conflictPolicy": "engram:g0-conflicts@1",
    "completeness": "complete",
    "corpusRef": {
      "ref": "engram:diagram-lot-corpus/1",
      "digest": "e946288de536075611c25e7b5e6078ea3def433b66d7a6ea60c1eb20cfebcf6e"
    },
    "receipts": [],
    "migrations": [],
    "consumers": [],
    "compatibility": {
      "renderer": "ds:rhanka/sent-tech-design-system/packages/diagram-core/src/presentation-apply.ts@ab7d1a7fd0142217672b5be6d40465b3e5309e50#sha256=28c3607e5c4868d44c137b66fe8e6f6ed99cb578fc52a52f67442cca41802cd8",
      "adapter": "ds:rhanka/sent-tech-design-system/packages/diagram-core/src/presentation-validate.ts@ab7d1a7fd0142217672b5be6d40465b3e5309e50#sha256=488d8499b8f4e624af56d0c4f4c07496cc09863ec1e65e9f522c6fc05a4db06e"
    },
    "visibility": "public",
    "linkedTools": [],
    "artifactBinding": {
      "artifactKind": "contract",
      "schemaPin": {
        "id": "diagram-presentation-schema",
        "version": "1",
        "contentDigest": "f13d595793e17e1e4740c9203b19d8381fc55b90e37121d61f5037cb79f0281a"
      },
      "compatibilityMatrixVersion": "1"
    }
  }
};
var PRIVATE_PACKAGED_CATALOG = {
  compatibilityAdapter: PRIVATE_ENTRY_2.ontology.compatibility.adapter,
  adapterBytes: PINNED_ADAPTER_BYTES,
  schemaPin: PRIVATE_ENTRY_2.ontology.artifactBinding.schemaPin,
  entry: PRIVATE_ENTRY_2,
  predecessor: PRIVATE_ENTRY_1,
  revision: {
    "successor": {
      "id": "engram-diagram-presentation-2",
      "entryVersion": "2"
    },
    "predecessor": {
      "id": "engram-diagram-presentation-1",
      "entryVersion": "1",
      "entryDigest": "a83e2c1d0ea9612d38a0b3ad1a0f0ae4e93e7f7a10fcee49ab57a6a06659da0a"
    }
  }
};
deepFreezeValue(PRIVATE_PACKAGED_CATALOG);
function resolveGovernedCatalog() {
  return PRIVATE_PACKAGED_CATALOG;
}

// node_modules/@sentropic/diagram-core/dist/presentation.js
function deepCloneValue(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneValue(item));
  }
  const source = value;
  const out = {};
  for (const key of Object.keys(source)) {
    out[key] = deepCloneValue(source[key]);
  }
  return out;
}
function deepFreezeValue2(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Object.isFrozen(value))
    return value;
  const target = value;
  for (const key of Object.keys(target)) {
    const child = target[key];
    if (child !== null && typeof child === "object") {
      deepFreezeValue2(child);
    }
  }
  return Object.freeze(value);
}
function frozenCopy(value) {
  return deepFreezeValue2(deepCloneValue(value));
}
var KEY_GRAMMAR = { type: "string", minLength: 1, maxLength: 40, pattern: "^[a-z][a-z0-9-]*$" };
var TOKEN_GRAMMAR = {
  type: "string",
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$"
};
var ICON_GRAMMAR = { type: "string", minLength: 1, maxLength: 40, pattern: "^[a-z][a-z0-9-]*$" };
var PRESENTATION_TEXT_BASE = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 200 },
    kicker: { type: "string", maxLength: 80 },
    body: { type: "string", maxLength: 400 },
    detail: { type: "string", maxLength: 400 },
    subtitle: { type: "string", maxLength: 600 },
    footer: { type: "string", maxLength: 120 }
  },
  additionalProperties: false
};
var ENTITY_PRESENTATION_SCHEMA = {
  type: "object",
  properties: {
    form: { enum: ["card", "container", "legend", "legend-key"] },
    text: PRESENTATION_TEXT_BASE,
    icon: ICON_GRAMMAR,
    categoryRef: { type: "string", minLength: 1 }
  },
  required: ["form", "text"],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { form: { const: "legend-key" } }, required: ["form"] },
      then: {
        properties: { text: { type: "object", properties: { title: { type: "string", maxLength: 120 } } } }
      }
    }
  ]
};
var DIAGRAM_VALUE_PROPERTIES = {
  contractPin: {
    type: "object",
    properties: {
      id: { const: "diagram-presentation" },
      version: { const: "1" },
      contentDigest: { type: "string", pattern: "^[0-9a-f]{64}$" }
    },
    required: ["id", "version", "contentDigest"],
    additionalProperties: false
  },
  entities: { type: "object", additionalProperties: ENTITY_PRESENTATION_SCHEMA },
  legends: {
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        order: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true }
      },
      required: ["order"],
      additionalProperties: false
    }
  },
  categoryTokens: {
    type: "array",
    items: {
      type: "object",
      properties: {
        legendRef: { type: "string", minLength: 1 },
        category: KEY_GRAMMAR,
        token: TOKEN_GRAMMAR
      },
      required: ["legendRef", "category", "token"],
      additionalProperties: false
    }
  }
};
var DIAGRAM_VALUE_REQUIRED = ["contractPin", "entities", "legends", "categoryTokens"];
var PRIVATE_PRESENTATION_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "engram:diagram-presentation-schema/1",
  title: "diagram-presentation@1 contract",
  type: "object",
  properties: DIAGRAM_VALUE_PROPERTIES,
  required: [...DIAGRAM_VALUE_REQUIRED],
  additionalProperties: false
};
deepFreezeValue2(PRIVATE_PRESENTATION_SCHEMA);
var DIAGRAM_PRESENTATION_SCHEMA = frozenCopy(PRIVATE_PRESENTATION_SCHEMA);
var DIAGRAM_PRESENTATION_SCHEMA_DIGEST = sha256Hex(canonicalBytes(PRIVATE_PRESENTATION_SCHEMA));
var PRIVATE_PRESENTATION_SCHEMA_PIN = {
  id: "diagram-presentation-schema",
  version: "1",
  contentDigest: DIAGRAM_PRESENTATION_SCHEMA_DIGEST
};
deepFreezeValue2(PRIVATE_PRESENTATION_SCHEMA_PIN);
var DIAGRAM_PRESENTATION_SCHEMA_PIN = frozenCopy(PRIVATE_PRESENTATION_SCHEMA_PIN);
var DIAGRAM_PRESENTATION_CONTRACT_ID = "diagram-presentation@1";
var DIAGRAM_PRESENTATION_PROFILE_SHAPE = "mechanism-descriptor";
var DIAGRAM_PRESENTATION_ARTIFACT_KIND = "contract";
var DIAGRAM_PRESENTATION_COMPAT_VERSION = "1";
var PRIVATE_CONTRACT_DESCRIPTOR = {
  id: DIAGRAM_PRESENTATION_CONTRACT_ID,
  artifactKind: DIAGRAM_PRESENTATION_ARTIFACT_KIND,
  schemaPin: { ...PRIVATE_PRESENTATION_SCHEMA_PIN },
  compatibilityMatrixVersion: DIAGRAM_PRESENTATION_COMPAT_VERSION
};
deepFreezeValue2(PRIVATE_CONTRACT_DESCRIPTOR);
var DIAGRAM_PRESENTATION_CONTRACT_DESCRIPTOR = frozenCopy(PRIVATE_CONTRACT_DESCRIPTOR);
var DIAGRAM_PRESENTATION_CONTRACT_CONTENT = sha256Hex(canonicalBytes(PRIVATE_CONTRACT_DESCRIPTOR));
var PRIVATE_CONTRACT_PIN = {
  id: "diagram-presentation",
  version: "1",
  contentDigest: DIAGRAM_PRESENTATION_CONTRACT_CONTENT
};
deepFreezeValue2(PRIVATE_CONTRACT_PIN);
var DIAGRAM_PRESENTATION_CONTRACT_PIN = frozenCopy(PRIVATE_CONTRACT_PIN);
var PRIVATE_BINDING = {
  artifactKind: "contract",
  schemaPin: { ...PRIVATE_PRESENTATION_SCHEMA_PIN },
  compatibilityMatrixVersion: "1"
};
deepFreezeValue2(PRIVATE_BINDING);
var DIAGRAM_PRESENTATION_BINDING = frozenCopy(PRIVATE_BINDING);
var DIAGRAM_PRESENTATION_CORPUS_REF = "engram:diagram-lot-corpus/1";
var DIAGRAM_PRESENTATION_CORPUS_DIGEST = "e946288de536075611c25e7b5e6078ea3def433b66d7a6ea60c1eb20cfebcf6e";
function pinsDigestForLayers(layers) {
  return sha256Hex(canonicalBytes({
    deltaDigest: null,
    layers: layers.map((pin) => ({
      contentDigest: pin.contentDigest,
      id: pin.id,
      version: pin.version
    })),
    mappingDigest: null,
    ruleSheets: []
  }));
}
var DIAGRAM_PRESENTATION_PINS_DIGEST = pinsDigestForLayers([PRIVATE_CONTRACT_PIN]);
var PRIVATE_RECORD = {
  namespace: "diagram",
  id: "diagram-presentation",
  version: "1",
  owner: "engram",
  lifecycle: "draft",
  completeness: "complete",
  visibility: "public",
  profileShape: DIAGRAM_PRESENTATION_PROFILE_SHAPE,
  artifactKind: DIAGRAM_PRESENTATION_ARTIFACT_KIND,
  profileRef: {
    canonicalRef: "engram:diagram-presentation@1",
    contentDigest: DIAGRAM_PRESENTATION_CONTRACT_CONTENT
  },
  corpusRef: {
    ref: DIAGRAM_PRESENTATION_CORPUS_REF,
    digest: DIAGRAM_PRESENTATION_CORPUS_DIGEST
  },
  digests: {
    contentDigest: DIAGRAM_PRESENTATION_CONTRACT_CONTENT,
    pinsDigest: DIAGRAM_PRESENTATION_PINS_DIGEST,
    resultEvidence: { evidenceState: "unresolved" }
  },
  lineage: { parents: [], mappings: [], migrations: [] },
  consumers: []
};
deepFreezeValue2(PRIVATE_RECORD);
var DIAGRAM_PRESENTATION_RECORD = frozenCopy(PRIVATE_RECORD);
var DIAGRAM_PRESENTATION_COMPATIBILITY = frozenCopy(resolveGovernedCatalog().entry.ontology.compatibility);
var PRIVATE_PACKAGED_CATALOG_SNAPSHOT = {
  compatibilityAdapter: resolveGovernedCatalog().compatibilityAdapter,
  adapterBytes: resolveGovernedCatalog().adapterBytes,
  schemaPin: { ...resolveGovernedCatalog().schemaPin }
};
deepFreezeValue2(PRIVATE_PACKAGED_CATALOG_SNAPSHOT);
var DIAGRAM_PRESENTATION_PACKAGED_CATALOG = frozenCopy(PRIVATE_PACKAGED_CATALOG_SNAPSHOT);
var DIAGRAM_PRESENTATION_PROFILE_ID = "diagram-presentation@1";
var ENTITY_PRESENTATION_V2_SCHEMA = {
  ...ENTITY_PRESENTATION_SCHEMA,
  properties: {
    ...ENTITY_PRESENTATION_SCHEMA.properties,
    align: { enum: ["left", "center"] }
  }
};
var DIAGRAM_VALUE_V2_PROPERTIES = {
  ...DIAGRAM_VALUE_PROPERTIES,
  contractPin: {
    type: "object",
    properties: {
      id: { const: "diagram-presentation" },
      version: { const: "2" },
      contentDigest: { type: "string", pattern: "^[0-9a-f]{64}$" }
    },
    required: ["id", "version", "contentDigest"],
    additionalProperties: false
  },
  entities: { type: "object", additionalProperties: ENTITY_PRESENTATION_V2_SCHEMA }
};
var PRIVATE_PRESENTATION_V2_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "engram:diagram-presentation-schema/2",
  title: "diagram-presentation@2 contract",
  type: "object",
  properties: DIAGRAM_VALUE_V2_PROPERTIES,
  required: [...DIAGRAM_VALUE_REQUIRED],
  additionalProperties: false
};
deepFreezeValue2(PRIVATE_PRESENTATION_V2_SCHEMA);
var DIAGRAM_PRESENTATION_V2_SCHEMA = frozenCopy(PRIVATE_PRESENTATION_V2_SCHEMA);
var DIAGRAM_PRESENTATION_V2_SCHEMA_DIGEST = sha256Hex(canonicalBytes(PRIVATE_PRESENTATION_V2_SCHEMA));
var PRIVATE_PRESENTATION_V2_SCHEMA_PIN = {
  id: "diagram-presentation-schema",
  version: "2",
  contentDigest: DIAGRAM_PRESENTATION_V2_SCHEMA_DIGEST
};
deepFreezeValue2(PRIVATE_PRESENTATION_V2_SCHEMA_PIN);
var DIAGRAM_PRESENTATION_V2_SCHEMA_PIN = frozenCopy(PRIVATE_PRESENTATION_V2_SCHEMA_PIN);
var DIAGRAM_PRESENTATION_V2_CONTRACT_ID = "diagram-presentation@2";
var DIAGRAM_PRESENTATION_V2_PROFILE_ID = "diagram-presentation@2";
var PRIVATE_CONTRACT_V2_DESCRIPTOR = {
  id: DIAGRAM_PRESENTATION_V2_CONTRACT_ID,
  artifactKind: DIAGRAM_PRESENTATION_ARTIFACT_KIND,
  schemaPin: { ...PRIVATE_PRESENTATION_V2_SCHEMA_PIN },
  compatibilityMatrixVersion: "2"
};
deepFreezeValue2(PRIVATE_CONTRACT_V2_DESCRIPTOR);
var DIAGRAM_PRESENTATION_V2_CONTRACT_DESCRIPTOR = frozenCopy(PRIVATE_CONTRACT_V2_DESCRIPTOR);
var DIAGRAM_PRESENTATION_V2_CONTRACT_CONTENT = sha256Hex(canonicalBytes(PRIVATE_CONTRACT_V2_DESCRIPTOR));
var PRIVATE_CONTRACT_V2_PIN = {
  id: "diagram-presentation",
  version: "2",
  contentDigest: DIAGRAM_PRESENTATION_V2_CONTRACT_CONTENT
};
deepFreezeValue2(PRIVATE_CONTRACT_V2_PIN);
var DIAGRAM_PRESENTATION_V2_CONTRACT_PIN = frozenCopy(PRIVATE_CONTRACT_V2_PIN);
function isPresentationContractProfileId(id) {
  return id === DIAGRAM_PRESENTATION_PROFILE_ID || id === DIAGRAM_PRESENTATION_V2_PROFILE_ID;
}
function isPresentationContractV2Pin(pin) {
  return pin.id === PRIVATE_CONTRACT_V2_PIN.id && pin.version === PRIVATE_CONTRACT_V2_PIN.version && pin.contentDigest === PRIVATE_CONTRACT_V2_PIN.contentDigest;
}

// node_modules/@sentropic/diagram-core/dist/fold.js
function parentOccurrenceOf(view, id) {
  const entity = view.entityOccurrences[id];
  if (entity === void 0 || entity.group === void 0)
    return void 0;
  const group = view.groups[entity.group];
  const parent = group?.occurrence;
  if (parent === void 0 || view.entityOccurrences[parent] === void 0)
    return void 0;
  return parent;
}
function ancestorChain(view, id) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let current = id;
  while (current !== void 0 && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parentOccurrenceOf(view, current);
  }
  return chain;
}
function hiddenByFold(view, collapsed, id) {
  const port = view.portOccurrences[id];
  if (port !== void 0) {
    return hiddenByFold(view, collapsed, port.ownerOccurrence);
  }
  if (view.entityOccurrences[id] === void 0)
    return false;
  const chain = ancestorChain(view, id);
  return chain.slice(1).some((ancestor) => collapsed.has(ancestor));
}
function representativeOf(view, collapsed, id) {
  const chain = ancestorChain(view, id);
  const folded = chain.filter((ancestor) => collapsed.has(ancestor));
  return folded.length === 0 ? id : folded[folded.length - 1];
}
function portRepresentativeOf(view, document, collapsed, id) {
  const port = view.portOccurrences[id];
  if (port === void 0)
    return id;
  const ownerRep = representativeOf(view, collapsed, port.ownerOccurrence);
  if (port.ownerOccurrence === ownerRep && collapsed.has(ownerRep) && document.ports[port.port]?.profile === "erd@1")
    return ownerRep;
  const ownerEntity = view.entityOccurrences[ownerRep]?.entity;
  const original = document.ports[port.port];
  const candidates = Object.values(view.portOccurrences).filter((candidate) => {
    if (candidate.ownerOccurrence !== ownerRep)
      return false;
    const semantic = document.ports[candidate.port];
    if (semantic === void 0 || original === void 0)
      return false;
    if (semantic.owner !== ownerEntity)
      return false;
    return semantic.direction === original.direction;
  });
  return candidates.length === 1 ? candidates[0].id : ownerRep;
}
function drawnTargetOf(view, occurrenceId) {
  const entity = view.entityOccurrences[occurrenceId];
  if (entity !== void 0)
    return entity.entity;
  const port = view.portOccurrences[occurrenceId];
  if (port !== void 0)
    return port.port;
  const relation = view.relationOccurrences[occurrenceId];
  if (relation !== void 0)
    return relation.relation;
  return void 0;
}
function semanticTargetFor(document, relationId, role3, drawn) {
  const relation = document.relations[relationId];
  if (relation === void 0)
    return void 0;
  return relation.endpoints.find((endpoint) => endpoint.role === role3 && endpoint.target === drawn)?.target;
}
function classifyInternalRelations(view, document, collapsed) {
  const internal = /* @__PURE__ */ new Map();
  let progressed = true;
  while (progressed) {
    progressed = false;
    const snapshot = new Map(internal);
    const repOf = (id) => {
      if (view.relationOccurrences[id] !== void 0)
        return snapshot.get(id) ?? id;
      if (view.portOccurrences[id] !== void 0)
        return portRepresentativeOf(view, document, collapsed, id);
      return representativeOf(view, collapsed, id);
    };
    const dependent = (id) => {
      if (view.relationOccurrences[id] !== void 0)
        return snapshot.has(id);
      return hiddenByFold(view, collapsed, id);
    };
    for (const key of Object.keys(view.relationOccurrences).sort()) {
      const id = key;
      if (snapshot.has(id))
        continue;
      const occurrence = view.relationOccurrences[key];
      const representatives = new Set(occurrence.endpoints.map((endpoint) => repOf(endpoint.occurrence)));
      if (representatives.size !== 1)
        continue;
      const sole = [...representatives][0];
      if (!collapsed.has(sole) || view.entityOccurrences[sole] === void 0)
        continue;
      if (!occurrence.endpoints.some((endpoint) => dependent(endpoint.occurrence)))
        continue;
      internal.set(id, sole);
      progressed = true;
    }
  }
  return internal;
}
function collapsedOf(view) {
  return new Set(Object.values(view.groups).filter((group) => group.collapsed === true && group.occurrence !== void 0).map((group) => group.occurrence));
}
function foldGroupId(occurrence) {
  const raw = occurrence;
  const local = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  return `grp.${local.length}.${local}`;
}
function stampGroups(view, collapsed) {
  const groups = {};
  for (const [key, group] of Object.entries(view.groups)) {
    if (group.occurrence === void 0) {
      groups[key] = group;
      continue;
    }
    if (collapsed.has(group.occurrence)) {
      groups[key] = { ...group, collapsed: true };
      continue;
    }
    if (group.collapsed === void 0) {
      const { collapsed: _absent, ...rest } = group;
      void _absent;
      groups[key] = rest;
      continue;
    }
    groups[key] = { ...group, collapsed: false };
  }
  for (const id of collapsed) {
    const bound = Object.keys(groups).find((key) => groups[key]?.occurrence === id);
    if (bound !== void 0)
      continue;
    const generated = foldGroupId(id);
    if (groups[generated] !== void 0)
      continue;
    groups[generated] = { id: generated, occurrence: id, collapsed: true };
  }
  return groups;
}
function projectRelationOccurrences(sourceView, document, collapsed) {
  const internal = classifyInternalRelations(sourceView, document, collapsed);
  const relationOccurrences = {};
  for (const key of Object.keys(sourceView.relationOccurrences).sort()) {
    const occurrence = sourceView.relationOccurrences[key];
    if (internal.has(occurrence.id)) {
      relationOccurrences[key] = {
        id: occurrence.id,
        relation: occurrence.relation,
        endpoints: occurrence.endpoints.map((endpoint) => endpoint.chainProvenance !== void 0 ? endpoint : { role: endpoint.role, occurrence: endpoint.occurrence }),
        ...occurrence.waypoints === void 0 ? {} : { waypoints: occurrence.waypoints.map((point) => ({ ...point })) },
        ...occurrence.strokeStyle === void 0 ? {} : { strokeStyle: occurrence.strokeStyle },
        ...occurrence.arrowhead === void 0 ? {} : { arrowhead: occurrence.arrowhead },
        ...occurrence.emphasis === void 0 ? {} : { emphasis: occurrence.emphasis }
      };
      continue;
    }
    const endpoints = occurrence.endpoints.map((endpoint) => {
      if (endpoint.chainProvenance !== void 0)
        return endpoint;
      const original = endpoint.occurrence;
      const isRelation = sourceView.relationOccurrences[original] !== void 0;
      const hidden = isRelation ? internal.has(original) : hiddenByFold(sourceView, collapsed, original);
      if (!hidden)
        return { role: endpoint.role, occurrence: original };
      const representative = isRelation ? internal.get(original) : sourceView.portOccurrences[original] !== void 0 ? portRepresentativeOf(sourceView, document, collapsed, original) : representativeOf(sourceView, collapsed, original);
      const drawn = drawnTargetOf(sourceView, original);
      const semantic = drawn === void 0 ? void 0 : semanticTargetFor(document, occurrence.relation, endpoint.role, drawn);
      if (semantic === void 0)
        return { role: endpoint.role, occurrence: original };
      return {
        role: endpoint.role,
        occurrence: representative,
        semanticTarget: semantic,
        sourceOccurrence: original
      };
    });
    relationOccurrences[key] = {
      id: occurrence.id,
      relation: occurrence.relation,
      endpoints,
      ...occurrence.waypoints === void 0 ? {} : { waypoints: occurrence.waypoints.map((point) => ({ ...point })) },
      ...occurrence.strokeStyle === void 0 ? {} : { strokeStyle: occurrence.strokeStyle },
      ...occurrence.arrowhead === void 0 ? {} : { arrowhead: occurrence.arrowhead },
      ...occurrence.emphasis === void 0 ? {} : { emphasis: occurrence.emphasis }
    };
  }
  return relationOccurrences;
}
function projectView(document, sourceView, collapsedOccurrenceIds) {
  for (const key of Object.keys(sourceView.relationOccurrences).sort()) {
    const occurrence = sourceView.relationOccurrences[key];
    const index = occurrence.endpoints.findIndex((endpoint) => endpoint.semanticTarget !== void 0 && endpoint.chainProvenance === void 0);
    if (index !== -1) {
      const endpoint = occurrence.endpoints[index];
      const refusal = {
        code: "occurrence-endpoint-mismatch",
        severity: "error",
        path: `relationOccurrences.${occurrence.id}.endpoints[${index}].occurrence`,
        message: `projected endpoint for role ${endpoint.role} fails check projection-source-projected`,
        refs: [occurrence.id, endpoint.occurrence],
        details: { role: endpoint.role, check: "projection-source-projected" }
      };
      throw refusal;
    }
  }
  const collapsed = new Set(collapsedOccurrenceIds);
  return {
    ...sourceView,
    relationOccurrences: projectRelationOccurrences(sourceView, document, collapsed),
    groups: stampGroups(sourceView, collapsed),
    filters: [...sourceView.filters],
    ...sourceView.summaryLabels === void 0 ? {} : { summaryLabels: { ...sourceView.summaryLabels } },
    revision: sourceView.revision
  };
}
function occurrenceScope(view, root) {
  const scope = /* @__PURE__ */ new Set([root]);
  const ownerScope = /* @__PURE__ */ new Map();
  for (const [key, port] of Object.entries(view.portOccurrences)) {
    ownerScope.set(key, port.ownerOccurrence);
  }
  let grown = true;
  while (grown) {
    grown = false;
    for (const key of Object.keys(view.entityOccurrences)) {
      if (scope.has(key))
        continue;
      const parent = parentOccurrenceOf(view, key);
      if (parent !== void 0 && scope.has(parent)) {
        scope.add(key);
        grown = true;
      }
    }
  }
  for (const [portId, owner] of ownerScope) {
    if (scope.has(owner))
      scope.add(portId);
  }
  return scope;
}
function isUndirectedRelation(document, registry, relationId) {
  const relation = document.relations[relationId];
  if (relation === void 0)
    return false;
  const profile = registry.get(relation.profile);
  const declared = profile === void 0 ? void 0 : relationSchema(document, profile, relation);
  if (declared === void 0)
    return false;
  return declared.direction === "undirected";
}
function declaredRoleOrder(document, registry, relationId) {
  const relation = document.relations[relationId];
  if (relation === void 0)
    return void 0;
  const profile = registry.get(relation.profile);
  const declared = profile === void 0 ? void 0 : relationSchema(document, profile, relation);
  if (declared === void 0)
    return void 0;
  return declared.roles.map((role3) => role3.role);
}
function summaryCandidates(view, document, registry, source, target, style) {
  const sourceScope = occurrenceScope(view, source);
  const targetScope = occurrenceScope(view, target);
  const found = [];
  for (const key of Object.keys(view.relationOccurrences).sort()) {
    const occurrence = view.relationOccurrences[key];
    if (occurrence.endpoints.length !== 2)
      continue;
    if ((occurrence.strokeStyle ?? "solid") !== style)
      continue;
    const undirected = isUndirectedRelation(document, registry, occurrence.relation);
    if (undirected) {
      const [first2, second2] = occurrence.endpoints;
      const firstOriginal2 = first2.sourceOccurrence ?? first2.occurrence;
      const secondOriginal2 = second2.sourceOccurrence ?? second2.occurrence;
      const ordered = sourceScope.has(firstOriginal2) && targetScope.has(secondOriginal2);
      const swapped = sourceScope.has(secondOriginal2) && targetScope.has(firstOriginal2);
      if (!ordered && !swapped)
        continue;
      found.push({ occurrence: key, relation: occurrence.relation, style });
      continue;
    }
    const order = declaredRoleOrder(document, registry, occurrence.relation);
    const byRole = new Map(occurrence.endpoints.map((endpoint) => [endpoint.role, endpoint]));
    if (order !== void 0 && order.length >= 2 && byRole.has(order[0]) && byRole.has(order[1])) {
      const firstEndpoint = byRole.get(order[0]);
      const secondEndpoint = byRole.get(order[1]);
      const firstOriginal2 = firstEndpoint.sourceOccurrence ?? firstEndpoint.occurrence;
      const secondOriginal2 = secondEndpoint.sourceOccurrence ?? secondEndpoint.occurrence;
      if (!(sourceScope.has(firstOriginal2) && targetScope.has(secondOriginal2)))
        continue;
      found.push({ occurrence: key, relation: occurrence.relation, style });
      continue;
    }
    const [first, second] = occurrence.endpoints;
    const firstOriginal = first.sourceOccurrence ?? first.occurrence;
    const secondOriginal = second.sourceOccurrence ?? second.occurrence;
    if (!(sourceScope.has(firstOriginal) && targetScope.has(secondOriginal)))
      continue;
    found.push({ occurrence: key, relation: occurrence.relation, style });
  }
  return found;
}
function sortedUnique(values) {
  return [...new Set(values)].sort();
}
function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function analyzeSummaries(view, document, options) {
  const definitions = view.summaryLabels ?? {};
  const registry = options.registry;
  const filterHidden = new Set(options.filters?.hiddenByFilter ?? []);
  const isFilterExcluded = (occurrence) => {
    if (filterHidden.has(occurrence.id))
      return true;
    return occurrence.endpoints.some((endpoint) => filterHidden.has(endpoint.sourceOccurrence ?? endpoint.occurrence) || filterHidden.has(endpoint.occurrence));
  };
  const sourceIssues = [];
  const invalid = /* @__PURE__ */ new Set();
  const seenTriples = /* @__PURE__ */ new Map();
  const validSelections = /* @__PURE__ */ new Map();
  for (const id of Object.keys(definitions).sort()) {
    const definition = definitions[id];
    const style = definition.strokeStyle ?? "solid";
    const triple = `${definition.sourceOccurrence}\0${definition.targetOccurrence}\0${style}`;
    const firstTriple = seenTriples.get(triple);
    if (firstTriple !== void 0) {
      sourceIssues.push({ id, check: "summary-duplicate-key", firstId: firstTriple });
      invalid.add(id);
      continue;
    }
    seenTriples.set(triple, id);
    if (view.entityOccurrences[definition.sourceOccurrence] === void 0 || view.entityOccurrences[definition.targetOccurrence] === void 0) {
      sourceIssues.push({ id, check: "summary-constituents-mismatch" });
      invalid.add(id);
      continue;
    }
    if (definition.relationIds.length === 0) {
      sourceIssues.push({ id, check: "summary-constituents-mismatch" });
      invalid.add(id);
      continue;
    }
    if (definition.relationOccurrences !== void 0) {
      const listed = [...definition.relationOccurrences];
      if (!arraysEqual([...listed].sort(), listed) || new Set(listed).size !== listed.length) {
        sourceIssues.push({ id, check: "summary-constituents-mismatch" });
        invalid.add(id);
        continue;
      }
      const candidates2 = summaryCandidates(view, document, registry, definition.sourceOccurrence, definition.targetOccurrence, style);
      const candidateSet = new Set(candidates2.map((candidate) => candidate.occurrence));
      if (!listed.every((member) => candidateSet.has(member))) {
        sourceIssues.push({ id, check: "summary-constituents-mismatch" });
        invalid.add(id);
        continue;
      }
      const listedRelations = sortedUnique(listed.map((member) => view.relationOccurrences[member].relation));
      const complete = listedRelations.every((relation) => candidates2.filter((candidate) => candidate.relation === relation).every((candidate) => listed.includes(candidate.occurrence)));
      if (!complete || !arraysEqual(definition.relationIds, listedRelations)) {
        sourceIssues.push({ id, check: "summary-constituents-mismatch" });
        invalid.add(id);
        continue;
      }
      validSelections.set(id, [...listed].sort());
      continue;
    }
    const candidates = summaryCandidates(view, document, registry, definition.sourceOccurrence, definition.targetOccurrence, style);
    const byRelation = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const list = byRelation.get(candidate.relation) ?? [];
      list.push(candidate.occurrence);
      byRelation.set(candidate.relation, list);
    }
    const ambiguous = [...byRelation.entries()].filter(([, list]) => list.length > 1).map(([relation]) => relation).sort()[0];
    if (ambiguous !== void 0) {
      sourceIssues.push({ id, check: "summary-occurrence-ambiguous", relationId: ambiguous });
      invalid.add(id);
      continue;
    }
    const selectedRelations = sortedUnique(candidates.map((candidate) => candidate.relation));
    if (!arraysEqual(definition.relationIds, selectedRelations)) {
      sourceIssues.push({ id, check: "summary-constituents-mismatch" });
      invalid.add(id);
      continue;
    }
    validSelections.set(id, candidates.map((candidate) => candidate.occurrence).sort());
  }
  const collapsed = collapsedOf(view);
  const internal = classifyInternalRelations(view, document, collapsed);
  const aggregates = /* @__PURE__ */ new Map();
  for (const key of Object.keys(view.relationOccurrences).sort()) {
    const occurrence = view.relationOccurrences[key];
    if (internal.has(key))
      continue;
    if (isFilterExcluded(occurrence))
      continue;
    if (occurrence.endpoints.length !== 2)
      continue;
    const undirected = isUndirectedRelation(document, registry, occurrence.relation);
    let pair3;
    if (undirected) {
      const [first, second] = occurrence.endpoints;
      const ordered = [first.occurrence, second.occurrence];
      pair3 = ordered[0] <= ordered[1] ? ordered : [ordered[1], ordered[0]];
    } else {
      const order = declaredRoleOrder(document, registry, occurrence.relation);
      const byRole = new Map(occurrence.endpoints.map((endpoint) => [endpoint.role, endpoint.occurrence]));
      if (order !== void 0 && order.length >= 2 && byRole.has(order[0]) && byRole.has(order[1])) {
        pair3 = [byRole.get(order[0]), byRole.get(order[1])];
      } else {
        const [first, second] = occurrence.endpoints;
        const orderRoles = declaredRoleOrder(document, registry, occurrence.relation) ?? [];
        const indexOf = (role3) => {
          const index = orderRoles.indexOf(role3);
          return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        };
        const sorted = [first, second].sort((left, right) => {
          const orderDiff = indexOf(left.role) - indexOf(right.role);
          if (orderDiff !== 0)
            return orderDiff;
          return left.occurrence < right.occurrence ? -1 : left.occurrence > right.occurrence ? 1 : 0;
        });
        pair3 = [sorted[0]?.occurrence, sorted[1]?.occurrence];
      }
    }
    const style = occurrence.strokeStyle ?? "solid";
    const aggregateKey = `(${pair3[0]},${pair3[1]},${style})`;
    const aggregate = aggregates.get(aggregateKey) ?? { members: [], relationIds: [], projected: false };
    aggregate.members.push(key);
    if (!aggregate.relationIds.includes(occurrence.relation))
      aggregate.relationIds.push(occurrence.relation);
    if (occurrence.endpoints.some((endpoint) => endpoint.semanticTarget !== void 0))
      aggregate.projected = true;
    aggregates.set(aggregateKey, aggregate);
  }
  for (const aggregate of aggregates.values()) {
    aggregate.members.sort();
    aggregate.relationIds.sort();
  }
  const active = /* @__PURE__ */ new Map();
  const winners = /* @__PURE__ */ new Map();
  for (const id of Object.keys(definitions).sort()) {
    if (invalid.has(id))
      continue;
    const definition = definitions[id];
    const style = definition.strokeStyle ?? "solid";
    const sourceRep = representativeOfEndpoint(view, document, collapsed, internal, definition.sourceOccurrence);
    const targetRep = representativeOfEndpoint(view, document, collapsed, internal, definition.targetOccurrence);
    const undirected = definition.relationIds.every((relation) => isUndirectedRelation(document, registry, relation) === true);
    const pair3 = undirected && sourceRep > targetRep ? [targetRep, sourceRep] : [sourceRep, targetRep];
    const key = `(${pair3[0]},${pair3[1]},${style})`;
    const aggregate = aggregates.get(key);
    if (aggregate === void 0 || !aggregate.projected)
      continue;
    const selected = validSelections.get(id);
    if (selected.length !== aggregate.members.length)
      continue;
    if (!selected.every((member, index) => member === aggregate.members[index]))
      continue;
    const definitionRelations = [...definition.relationIds].sort();
    if (aggregate.relationIds.length !== definitionRelations.length)
      continue;
    if (!aggregate.relationIds.every((relation, index) => relation === definitionRelations[index]))
      continue;
    const list = winners.get(key) ?? [];
    list.push({ id, definition });
    winners.set(key, list);
  }
  const conflicts = [];
  for (const [key, list] of [...winners.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const ordered = [...list].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const winner = ordered[0];
    if (ordered.length === 1) {
      const aggregate = aggregates.get(key);
      active.set(key, {
        key,
        definitionId: winner.id,
        label: winner.definition.label,
        members: [...aggregate.members],
        relationIds: [...aggregate.relationIds]
      });
    }
    for (const loser of ordered.slice(1)) {
      const style = loser.definition.strokeStyle ?? "solid";
      const sourceRep = representativeOfEndpoint(view, document, collapsed, internal, loser.definition.sourceOccurrence);
      const targetRep = representativeOfEndpoint(view, document, collapsed, internal, loser.definition.targetOccurrence);
      conflicts.push({
        id: loser.id,
        check: "summary-active-key-conflict",
        firstId: winner.id,
        sourceRepresentative: sourceRep,
        targetRepresentative: targetRep,
        strokeStyle: style
      });
    }
  }
  conflicts.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { sourceIssues, conflicts, actives: active };
}
function resolveSummaries(view, document, options) {
  return new Map(analyzeSummaries(view, document, options).actives);
}
function representativeOfEndpoint(view, document, collapsed, internal, id) {
  if (view.relationOccurrences[id] !== void 0)
    return internal.get(id) ?? id;
  if (view.portOccurrences[id] !== void 0)
    return portRepresentativeOf(view, document, collapsed, id);
  if (view.entityOccurrences[id] !== void 0)
    return representativeOf(view, collapsed, id);
  return id;
}

// node_modules/@sentropic/diagram-core/dist/validate.js
function effectiveEntitySchemas(document, profile, typeId) {
  const declared = entityTypeOf(profile, typeId);
  if (declared !== void 0) {
    if (declared.abstract === true) {
      return {
        diagnostic: diagnostic({
          code: "unknown-entity-type",
          path: `profiles.${profile.id}.entityTypes.${typeId}`,
          message: `entity type ${typeId} is abstract and cannot be instantiated`,
          details: { abstract: true }
        })
      };
    }
    return { schemas: declared.attributes };
  }
  const definition = document.typeDefinitions[typeId];
  if (definition === void 0) {
    return {
      diagnostic: diagnostic({
        code: "unknown-entity-type",
        path: `profiles.${profile.id}.entityTypes.${typeId}`,
        message: `neither profile ${profile.id} nor the document declares entity type ${typeId}`,
        details: { type: typeId, profile: profile.id }
      })
    };
  }
  const base = entityTypeOf(profile, definition.baseType);
  if (base === void 0) {
    return {
      diagnostic: diagnostic({
        code: "unknown-entity-type",
        path: `typeDefinitions.${typeId}.baseType`,
        message: `type definition ${typeId} refines ${definition.baseType}, which profile ${profile.id} does not declare`
      })
    };
  }
  return { schemas: [...base.attributes, ...definition.attributes] };
}
function validateAttributeBag(attributes, schemas, document, path, context) {
  const diagnostics = [];
  const byName = new Map(schemas.map((schema) => [schema.name, schema]));
  for (const name of Object.keys(attributes).sort()) {
    const schema = byName.get(name);
    const value = attributes[name];
    if (schema === void 0) {
      diagnostics.push(diagnostic({
        code: "attribute-not-in-schema",
        path: `${path}.${name}`,
        message: `attribute ${name} is not declared by the effective schema (declared: ${[...byName.keys()].sort().join(", ") || "none"})`,
        details: { attribute: name }
      }));
      continue;
    }
    diagnostics.push(...validateAttributeValue(schema, value, `${path}.${name}`));
    if (schema.kind === "struct" && value.kind === "struct" && context !== void 0) {
      diagnostics.push(...validateStructValue(schema, value, `${path}.${name}`, document, context));
    }
    for (const found of referencesOf(schema, value)) {
      const location = found.index === void 0 ? `${path}.${name}` : `${path}.${name}[${found.index}]`;
      diagnostics.push(...resolveReference(document, found.raw, found.refKind, location));
      if (context !== void 0) {
        const slot = schema.kind === "collection" ? schema.item : schema;
        diagnostics.push(...checkReferenceTargetType(document, context, slot, found.raw, location));
      }
    }
  }
  for (const schema of schemas) {
    if (schema.required === true && attributes[schema.name] === void 0) {
      diagnostics.push(diagnostic({
        code: "attribute-required-missing",
        path: `${path}.${schema.name}`,
        message: `attribute ${schema.name} is required by the schema`,
        details: { attribute: schema.name }
      }));
    }
  }
  return diagnostics;
}
function checkReferenceTargetType(document, context, slot, raw, location) {
  if (slot?.kind !== "reference" || slot.refKind !== "entity")
    return [];
  const targetTypes = slot.targetTypes;
  if (targetTypes === void 0 || targetTypes.length === 0)
    return [];
  const target = document.entities[raw];
  if (target === void 0)
    return [];
  const targetProfile = context.registry.get(target.profile);
  if (targetProfile === void 0)
    return [];
  const resolution = context.resolver.resolve(targetProfile, target.type);
  if (!resolution.ok)
    return [];
  if (targetTypes.some((type) => resolution.resolved.ancestry.includes(type)))
    return [];
  return [
    diagnostic({
      code: "reference-target-type",
      path: location,
      message: `reference target ${raw} has type ${target.type}; allowed types are ${targetTypes.join(", ")}`,
      refs: [raw],
      details: { seenType: target.type, allowed: targetTypes.join(",") }
    })
  ];
}
function validateStructValue(schema, value, path, document, context) {
  const resolution = context.resolver.resolve(context.owner, value.type);
  if (!resolution.ok) {
    return [
      diagnostic({
        code: "struct-type-unknown",
        path,
        message: `structured value type ${value.type} is not declared`,
        refs: [],
        details: { type: value.type }
      })
    ];
  }
  if (schema.targetTypes.length > 0 && !schema.targetTypes.includes(value.type)) {
    return [
      diagnostic({
        code: "struct-type-not-allowed",
        path,
        message: `structured type ${value.type} is not allowed here; allowed types are ${schema.targetTypes.join(", ")}`,
        refs: [],
        details: { type: value.type, allowed: schema.targetTypes.join(",") }
      })
    ];
  }
  const effective = resolution.resolved.schemas;
  const diagnostics = [];
  const byName = new Map(effective.map((field) => [field.name, field]));
  for (const name of Object.keys(value.fields).sort()) {
    const fieldSchema = byName.get(name);
    const fieldPath = `${path}.fields.${name}`;
    const fieldValue = value.fields[name];
    if (fieldSchema === void 0) {
      diagnostics.push(diagnostic({
        code: "struct-field-not-in-schema",
        path: fieldPath,
        message: `field ${name} is not declared by structured type ${value.type}`,
        refs: [],
        details: { type: value.type, field: name }
      }));
      continue;
    }
    diagnostics.push(...validateAttributeValue(fieldSchema, fieldValue, fieldPath));
    if (fieldSchema.kind === "struct" && fieldValue.kind === "struct") {
      diagnostics.push(...validateStructValue(fieldSchema, fieldValue, fieldPath, document, context));
    }
    for (const found of referencesOf(fieldSchema, fieldValue)) {
      const location = found.index === void 0 ? fieldPath : `${fieldPath}[${found.index}]`;
      diagnostics.push(...resolveReference(document, found.raw, found.refKind, location));
      const slot = fieldSchema.kind === "collection" ? fieldSchema.item : fieldSchema;
      diagnostics.push(...checkReferenceTargetType(document, context, slot, found.raw, location));
    }
  }
  for (const fieldSchema of effective) {
    if (fieldSchema.required === true && value.fields[fieldSchema.name] === void 0) {
      diagnostics.push(diagnostic({
        code: "attribute-required-missing",
        path: `${path}.fields.${fieldSchema.name}`,
        message: `attribute ${fieldSchema.name} is required by the schema`,
        details: { attribute: fieldSchema.name }
      }));
    }
  }
  return diagnostics;
}
function resolveReference(document, raw, expected, path) {
  const parsed = parseRef(expected, raw, path);
  if (!parsed.ok)
    return [parsed.diagnostic];
  const found = expected === "entity" ? document.entities[raw] : expected === "relation" ? document.relations[raw] : expected === "port" ? document.ports[raw] : expected === "resource" ? document.resources[raw] : void 0;
  if (found !== void 0)
    return [];
  if (expected === "occurrence" || expected === "view" || expected === "document") {
    return [
      diagnostic({
        code: "reference-type-mismatch",
        path,
        message: `a ${expected} reference cannot be resolved from a semantic document`,
        refs: [raw],
        details: { expectedKind: expected }
      })
    ];
  }
  return [
    diagnostic({
      code: "dangling-reference",
      path,
      message: `${raw} resolves to no ${expected} in this document`,
      refs: [raw],
      details: { expectedKind: expected }
    })
  ];
}
function validateEntity(entity, key, document, options, resolver, adapter = LEGACY_CONSTRAINTS_ADAPTER) {
  const path = `entities.${key}`;
  const diagnostics = [...keyMatchesId(key, entity.id, "entity", path)];
  const profile = declaredProfile(document, entity.profile, options, path);
  if ("diagnostic" in profile)
    return [...diagnostics, profile.diagnostic];
  if (adapter !== LEGACY_CONSTRAINTS_ADAPTER && resolver !== void 0) {
    return [...diagnostics, ...validateScopedEntity(entity, path, document, options, profile.profile, resolver)];
  }
  const effective = effectiveEntitySchemas(document, profile.profile, entity.type);
  if ("diagnostic" in effective)
    return [...diagnostics, { ...effective.diagnostic, path: `${path}.type` }];
  diagnostics.push(...validateAttributeBag(entity.attributes, effective.schemas, document, `${path}.attributes`));
  return diagnostics;
}
function validateScopedEntity(entity, path, document, options, profile, resolver) {
  const resolution = resolver.resolve(profile, entity.type);
  if (!resolution.ok) {
    if (resolution.diagnostic.path.startsWith("typeDefinitions."))
      return [];
    return [{ ...resolution.diagnostic, path: `${path}.type` }];
  }
  if (resolution.resolved.abstract) {
    return [
      diagnostic({
        code: "abstract-instantiated",
        severity: "error",
        path: `${path}.type`,
        message: `abstract type ${entity.type} cannot be instantiated as an entity`,
        refs: [entity.id],
        details: { type: entity.type }
      })
    ];
  }
  return validateAttributeBag(entity.attributes, resolution.resolved.schemas, document, `${path}.attributes`, {
    owner: profile,
    registry: options.registry,
    resolver
  });
}
function validatePort(port, key, document, options, resolver, adapter = LEGACY_CONSTRAINTS_ADAPTER) {
  const path = `ports.${key}`;
  const diagnostics = [...keyMatchesId(key, port.id, "port", path)];
  const profile = declaredProfile(document, port.profile, options, path);
  if ("diagnostic" in profile)
    return [...diagnostics, profile.diagnostic];
  diagnostics.push(...resolveReference(document, port.owner, "entity", `${path}.owner`));
  const declared = portTypeOf(profile.profile, port.type);
  if (declared === void 0) {
    diagnostics.push(diagnostic({
      code: "unknown-port-type",
      path: `${path}.type`,
      message: `profile ${port.profile} does not declare port type ${port.type}`,
      details: { type: port.type }
    }));
    return diagnostics;
  }
  if (!declared.directions.includes(port.direction)) {
    diagnostics.push(diagnostic({
      code: "port-direction-not-allowed",
      path: `${path}.direction`,
      message: `port type ${port.type} allows ${declared.directions.join(", ")}, not ${port.direction}`,
      details: { direction: port.direction, allowed: declared.directions.join(",") }
    }));
  }
  const context = adapter !== LEGACY_CONSTRAINTS_ADAPTER && resolver !== void 0 ? { owner: profile.profile, registry: options.registry, resolver } : void 0;
  diagnostics.push(...validateAttributeBag(port.attributes, declared.attributes ?? [], document, `${path}.attributes`, context));
  return diagnostics;
}
function validateRelation(relation, key, document, options, resolver, adapter = LEGACY_CONSTRAINTS_ADAPTER) {
  const path = `relations.${key}`;
  const diagnostics = [...keyMatchesId(key, relation.id, "relation", path)];
  const profile = declaredProfile(document, relation.profile, options, path);
  if ("diagnostic" in profile)
    return [...diagnostics, profile.diagnostic];
  const declared = relationSchema(document, profile.profile, relation);
  if (declared === void 0) {
    diagnostics.push(diagnostic({
      code: "unknown-relation-type",
      path: `${path}.type`,
      message: `profile ${relation.profile} does not declare relation type ${relation.type}`,
      details: { type: relation.type }
    }));
    return diagnostics;
  }
  const maxEndpoints = profile.profile.limits.maxEndpointsPerRelation;
  if (maxEndpoints !== void 0 && relation.endpoints.length > maxEndpoints) {
    diagnostics.push(diagnostic({
      code: "limit-exceeded",
      path: `${path}.endpoints`,
      message: `${relation.endpoints.length} endpoints; profile ${profile.profile.id} allows ${maxEndpoints}`,
      details: { limit: "maxEndpointsPerRelation", seen: relation.endpoints.length, max: maxEndpoints }
    }));
  }
  const perRole = /* @__PURE__ */ new Map();
  relation.endpoints.forEach((endpoint, index) => {
    const endpointPath = `${path}.endpoints[${index}]`;
    const role3 = roleOf(declared, endpoint.role);
    if (role3 === void 0) {
      diagnostics.push(diagnostic({
        code: "endpoint-role-unknown",
        path: `${endpointPath}.role`,
        message: `relation type ${relation.type} declares ${declared.roles.map((entry) => entry.role).join(", ")}, not ${endpoint.role}`,
        details: { role: endpoint.role }
      }));
      return;
    }
    perRole.set(endpoint.role, (perRole.get(endpoint.role) ?? 0) + 1);
    const seenKind = refKindOf(endpoint.target);
    const relationAdmitted = adapter !== LEGACY_CONSTRAINTS_ADAPTER && seenKind === "relation";
    if (seenKind !== "entity" && seenKind !== "port" && !relationAdmitted) {
      diagnostics.push(diagnostic({
        code: seenKind === void 0 ? "malformed-ref" : "reference-type-mismatch",
        path: `${endpointPath}.target`,
        message: `an endpoint targets an entity or a port, not ${seenKind ?? JSON.stringify(endpoint.target)}`,
        refs: [String(endpoint.target)],
        ...seenKind === void 0 ? {} : { details: { seenKind } }
      }));
      return;
    }
    if (!role3.targets.includes(seenKind)) {
      diagnostics.push(diagnostic({
        code: "endpoint-target-not-allowed",
        path: `${endpointPath}.target`,
        message: `role ${endpoint.role} accepts ${role3.targets.join(", ")}, not a ${seenKind}`,
        refs: [endpoint.target],
        details: { seenKind, allowed: role3.targets.join(",") }
      }));
      return;
    }
    const resolution = resolveReference(document, endpoint.target, seenKind, `${endpointPath}.target`);
    diagnostics.push(...resolution);
    if (resolution.length > 0)
      return;
    if (adapter !== LEGACY_CONSTRAINTS_ADAPTER && (seenKind === "entity" || seenKind === "port" || seenKind === "relation")) {
      const targetProfile = seenKind === "entity" ? document.entities[endpoint.target]?.profile : seenKind === "port" ? document.ports[endpoint.target]?.profile : document.relations[endpoint.target]?.profile;
      if (targetProfile !== void 0 && targetProfile !== relation.profile) {
        diagnostics.push(diagnostic({
          code: "endpoint-without-join",
          path: `${endpointPath}.target`,
          message: `relation ${relation.id} applies ${relation.profile} ${relation.type} to ${seenKind} ${endpoint.target} owned by profile ${targetProfile} with no admitted semantic join`,
          refs: [endpoint.target],
          details: { profile: relation.profile, targetProfile }
        }));
        return;
      }
    }
    if (seenKind === "entity" && role3.entityTypes !== void 0) {
      const target = document.entities[endpoint.target];
      const chain = adapter !== LEGACY_CONSTRAINTS_ADAPTER && resolver !== void 0 ? entityAncestry(options.registry, resolver, target) : [target.type];
      if (!role3.entityTypes.some((allowed) => chain.includes(allowed))) {
        diagnostics.push(diagnostic({
          code: "endpoint-target-not-allowed",
          path: `${endpointPath}.target`,
          message: `role ${endpoint.role} accepts entity types ${role3.entityTypes.join(", ")}; ${target.id} is a ${target.type}`,
          refs: [target.id],
          details: { seenType: target.type, allowed: role3.entityTypes.join(",") }
        }));
      }
    }
  });
  for (const role3 of declared.roles) {
    const count = perRole.get(role3.role) ?? 0;
    if (count < role3.cardinality.min || count > role3.cardinality.max) {
      diagnostics.push(diagnostic({
        code: "endpoint-cardinality-violation",
        path: `${path}.endpoints`,
        message: `role ${role3.role} carries ${count} endpoints; the declared cardinality is ${role3.cardinality.min}..${role3.cardinality.max}`,
        details: { role: role3.role, seen: count, min: role3.cardinality.min, max: role3.cardinality.max }
      }));
    }
  }
  const context = adapter !== LEGACY_CONSTRAINTS_ADAPTER && resolver !== void 0 ? { owner: profile.profile, registry: options.registry, resolver } : void 0;
  diagnostics.push(...validateAttributeBag(relation.attributes, declared.attributes ?? [], document, `${path}.attributes`, context));
  return diagnostics;
}
function entityAncestry(registry, resolver, target) {
  const targetProfile = registry.get(target.profile);
  if (targetProfile === void 0)
    return [target.type];
  const resolution = resolver.resolve(targetProfile, target.type);
  if (!resolution.ok)
    return [target.type];
  return resolution.resolved.ancestry;
}
function validateHierarchies(document, relationTypes) {
  const diagnostics = [];
  for (const { profile, declaration: declaration3 } of relationTypes) {
    const hierarchy3 = declaration3.hierarchy;
    if (hierarchy3 === void 0)
      continue;
    const childToParents = /* @__PURE__ */ new Map();
    const children = /* @__PURE__ */ new Map();
    for (const relation of Object.values(document.relations)) {
      if (relation.profile !== profile || (document.typeDefinitions[relation.type]?.baseType ?? relation.type) !== declaration3.id)
        continue;
      const parents = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.parentRole);
      const kids = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.childRole);
      for (const parent of parents) {
        for (const kid of kids) {
          childToParents.set(kid.target, [...childToParents.get(kid.target) ?? [], parent.target]);
          children.set(parent.target, [...children.get(parent.target) ?? [], kid.target]);
        }
      }
    }
    if (hierarchy3.shape === "tree") {
      for (const [child, parents] of [...childToParents.entries()].sort()) {
        if (parents.length > 1) {
          diagnostics.push(diagnostic({
            code: "hierarchy-multiple-parents",
            path: `relations`,
            message: `hierarchy ${hierarchy3.id} is declared a tree; ${child} has ${parents.length} parents (${parents.sort().join(", ")})`,
            refs: [child, ...parents],
            details: { hierarchy: hierarchy3.id, child, parents: parents.length }
          }));
        }
      }
    }
    const state = /* @__PURE__ */ new Map();
    const walk = (start) => {
      const stack = [{ node: start, path: [start] }];
      while (stack.length > 0) {
        const current = stack.pop();
        const status = state.get(current.node);
        if (status === "done")
          continue;
        if (current.path.slice(0, -1).includes(current.node)) {
          const cycle = current.path.slice(current.path.indexOf(current.node));
          diagnostics.push(diagnostic({
            code: "hierarchy-cycle",
            path: "relations",
            message: `hierarchy ${hierarchy3.id} closes a cycle: ${cycle.join(" -> ")}`,
            refs: cycle,
            details: { hierarchy: hierarchy3.id, shape: hierarchy3.shape, length: cycle.length - 1 }
          }));
          continue;
        }
        state.set(current.node, "visiting");
        for (const child of (children.get(current.node) ?? []).slice().sort()) {
          stack.push({ node: child, path: [...current.path, child] });
        }
      }
      for (const [node, status] of state)
        if (status === "visiting")
          state.set(node, "done");
    };
    for (const root of [...children.keys()].sort())
      walk(root);
  }
  return diagnostics;
}
function validateConstraints(document, profile, options, resolver, adapter) {
  const diagnostics = [];
  const entities = Object.values(document.entities).filter((entity) => entity.profile === profile.id);
  for (const constraint of profile.constraints) {
    if (constraint.kind === "erd-keys") {
      diagnostics.push(...validateErdKeys(document, profile, constraint.maxFields));
      continue;
    }
    if (constraint.kind === "acyclic-hierarchy")
      continue;
    if (adapter !== LEGACY_CONSTRAINTS_ADAPTER && resolver !== void 0 && isAddedConstraint(constraint)) {
      diagnostics.push(...validateAddedConstraint(document, profile, options, resolver, constraint, entities));
      continue;
    }
    if (constraint.kind === "max-entities-of-type") {
      const count = entities.filter((entity) => entity.type === constraint.entityType).length;
      if (count > constraint.max) {
        diagnostics.push(diagnostic({
          code: "limit-exceeded",
          path: "entities",
          message: `${count} entities of type ${constraint.entityType}; profile ${profile.id} allows ${constraint.max}`,
          details: { type: constraint.entityType, seen: count, max: constraint.max }
        }));
      }
      continue;
    }
    if (constraint.kind !== "unique-attribute")
      continue;
    if (adapter !== LEGACY_CONSTRAINTS_ADAPTER && constraint.scope !== void 0) {
      diagnostics.push(...validateScopedUniqueness(document, profile, options.registry, resolver, constraint, entities));
      continue;
    }
    const seen = /* @__PURE__ */ new Map();
    const constrained = entities.filter((candidate) => candidate.type === constraint.entityType).slice().sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const entity of constrained) {
      const value = entity.attributes[constraint.attribute];
      if (value === void 0)
        continue;
      const key = tryCanonicalise(value, "value");
      if (!key.ok)
        continue;
      const previous = seen.get(key.text);
      if (previous !== void 0) {
        diagnostics.push(diagnostic({
          code: "unique-attribute-violation",
          path: `entities.${entity.id}.attributes.${constraint.attribute}`,
          message: `attribute ${constraint.attribute} must be unique among ${constraint.entityType} entities; ${previous} carries the same value`,
          refs: [entity.id, previous],
          details: { attribute: constraint.attribute, type: constraint.entityType }
        }));
      } else {
        seen.set(key.text, entity.id);
      }
    }
  }
  return diagnostics;
}
function isAddedConstraint(constraint) {
  switch (constraint.kind) {
    case "acyclic-hierarchy":
    case "unique-attribute":
    case "max-entities-of-type":
      return false;
    default:
      return true;
  }
}
function resolvedChainOfEntity(registry, resolver, entity) {
  const owner = registry.get(entity.profile);
  if (owner === void 0)
    return void 0;
  const resolution = resolver.resolve(owner, entity.type);
  if (!resolution.ok)
    return void 0;
  const familyType = resolution.resolved.ancestry.find((id) => entityTypeOf(owner, id) !== void 0) ?? entity.type;
  return { entity, chain: resolution.resolved.ancestry, familyType };
}
function chainOfEntity(document, registry, resolver, entityId) {
  const entity = document.entities[entityId];
  if (entity === void 0)
    return void 0;
  const owner = registry.get(entity.profile);
  if (owner === void 0)
    return { entity, chain: [entity.type], familyType: entity.type };
  const resolution = resolver.resolve(owner, entity.type);
  if (!resolution.ok)
    return { entity, chain: [entity.type], familyType: entity.type };
  const familyType = resolution.resolved.ancestry.find((id) => entityTypeOf(owner, id) !== void 0) ?? entity.type;
  return { entity, chain: resolution.resolved.ancestry, familyType };
}
function indexHierarchy(document, profile, hierarchyId) {
  const declarations = profile.relationTypes.filter((declaration3) => declaration3.hierarchy?.id === hierarchyId);
  if (declarations.length === 0)
    return void 0;
  const childToParents = /* @__PURE__ */ new Map();
  for (const declaration3 of declarations) {
    const hierarchy3 = declaration3.hierarchy;
    for (const relation of Object.values(document.relations)) {
      if (relation.profile !== profile.id || (document.typeDefinitions[relation.type]?.baseType ?? relation.type) !== declaration3.id)
        continue;
      const parents = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.parentRole);
      const kids = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.childRole);
      for (const parent of parents) {
        if (refKindOf(parent.target) !== "entity")
          continue;
        for (const kid of kids) {
          if (refKindOf(kid.target) !== "entity")
            continue;
          childToParents.set(kid.target, [...childToParents.get(kid.target) ?? [], parent.target]);
        }
      }
    }
  }
  for (const parents of childToParents.values())
    parents.sort();
  return { childToParents };
}
function validateAddedConstraint(document, profile, options, resolver, constraint, entities) {
  switch (constraint.kind) {
    case "hierarchy":
      return [];
    case "parent-family":
      return checkParentFamily(document, profile, options.registry, resolver, constraint);
    case "children-restricted":
      return checkChildrenRestricted(document, profile, options.registry, resolver, constraint);
    case "required-parent":
      return checkRequiredParent(document, profile, options.registry, resolver, constraint, entities);
    case "relationship-matrix":
      return checkRelationshipMatrix(document, profile, options.registry, resolver, constraint);
    case "bound-pair":
      return checkBoundPair(document, profile, options.registry, resolver, constraint);
    case "reference-application":
      return checkReferenceApplication(document, profile, options.registry, resolver, constraint, entities);
    case "incident-type-uniformity":
      return checkIncidentTypeUniformity(document, profile, options.registry, resolver, constraint, entities);
    case "at-most-value":
      return checkAtMostValue(document, profile, constraint);
    case "collection-unique":
      return checkCollectionUnique(document, options.registry, resolver, constraint, entities);
  }
}
function checkParentFamily(document, profile, registry, resolver, constraint) {
  const diagnostics = [];
  for (const declaration3 of profile.relationTypes) {
    if (declaration3.hierarchy?.id !== constraint.hierarchyId)
      continue;
    const hierarchy3 = declaration3.hierarchy;
    const relations = Object.values(document.relations).filter((relation) => relation.profile === profile.id && relationBaseType(document, profile, relation) === declaration3.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const relation of relations) {
      relation.endpoints.forEach((endpoint, index) => {
        if (endpoint.role !== hierarchy3.parentRole)
          return;
        if (refKindOf(endpoint.target) !== "entity")
          return;
        const info = chainOfEntity(document, registry, resolver, endpoint.target);
        if (info === void 0)
          return;
        if (constraint.familyRoots.some((root) => info.chain.includes(root)))
          return;
        diagnostics.push(diagnostic({
          code: "endpoint-target-not-allowed",
          path: `relations.${relation.id}.endpoints[${index}].target`,
          message: `role ${endpoint.role} accepts entity types ${constraint.familyRoots.join(", ")}; ${info.entity.id} is a ${info.entity.type}`,
          refs: [info.entity.id],
          details: { seenType: info.entity.type, allowed: constraint.familyRoots.join(",") }
        }));
      });
    }
  }
  return diagnostics;
}
function checkChildrenRestricted(document, profile, registry, resolver, constraint) {
  const diagnostics = [];
  const reported = /* @__PURE__ */ new Set();
  for (const declaration3 of profile.relationTypes) {
    if (declaration3.hierarchy?.id !== constraint.hierarchyId)
      continue;
    const hierarchy3 = declaration3.hierarchy;
    const relations = Object.values(document.relations).filter((relation) => relation.profile === profile.id && relationBaseType(document, profile, relation) === declaration3.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const relation of relations) {
      const parents = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.parentRole);
      const kids = relation.endpoints.filter((endpoint) => endpoint.role === hierarchy3.childRole);
      for (const parent of parents) {
        if (refKindOf(parent.target) !== "entity")
          continue;
        const parentInfo = chainOfEntity(document, registry, resolver, parent.target);
        if (parentInfo === void 0)
          continue;
        if (!constraint.parentFamilyRoots.some((root) => parentInfo.chain.includes(root)))
          continue;
        const roots = constraint.parentFamilyRoots.join(", ");
        const kinds = constraint.childTypes.join(", ");
        for (const kid of kids) {
          if (refKindOf(kid.target) !== "entity" || reported.has(kid.target))
            continue;
          const kidInfo = chainOfEntity(document, registry, resolver, kid.target);
          if (kidInfo === void 0)
            continue;
          if (constraint.childTypes.some((child) => kidInfo.chain.includes(child)))
            continue;
          reported.add(kid.target);
          diagnostics.push(diagnostic({
            code: "legend-key-parent-invalid",
            path: `entities.${kid.target}`,
            message: `key entity ${kid.target} is contained by ${roots} ${parent.target}; only ${kinds} entities may be contained by a ${roots}`,
            refs: [kid.target, parent.target],
            details: {
              childType: kidInfo.entity.type,
              parentType: parentInfo.entity.type,
              constraint: "children-restricted"
            }
          }));
        }
      }
    }
  }
  return diagnostics;
}
function checkRequiredParent(document, profile, registry, resolver, constraint, entities) {
  const index = indexHierarchy(document, profile, constraint.hierarchyId);
  if (index === void 0)
    return [];
  const diagnostics = [];
  const ordered = [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const entity of ordered) {
    if (!constraint.childTypes.some((child) => entityAncestry(registry, resolver, entity).includes(child)))
      continue;
    const roots = constraint.parentFamilyRoots.join(", ");
    const kinds = constraint.childTypes.join(", ");
    const parents = index.childToParents.get(entity.id) ?? [];
    if (parents.length === 0) {
      diagnostics.push(diagnostic({
        code: "legend-key-parent-invalid",
        path: `entities.${entity.id}`,
        message: `key entity ${entity.id} has no hierarchy parent; a ${kinds} must be contained by a ${roots}`,
        refs: [entity.id],
        details: { childType: entity.type, parentType: "none", constraint: "required-parent" }
      }));
      continue;
    }
    const inside = parents.filter((parent) => {
      const info = chainOfEntity(document, registry, resolver, parent);
      return info !== void 0 && constraint.parentFamilyRoots.some((root) => info.chain.includes(root));
    });
    if (inside.length > 0)
      continue;
    const named = parents[0];
    const parentInfo = chainOfEntity(document, registry, resolver, named);
    if (parentInfo === void 0)
      continue;
    diagnostics.push(diagnostic({
      code: "legend-key-parent-invalid",
      path: `entities.${entity.id}`,
      message: `key entity ${entity.id} is contained by ${named}, which is outside the ${roots} family; a ${kinds} must be contained by a ${roots}`,
      refs: [entity.id, named],
      details: { childType: entity.type, parentType: parentInfo.entity.type, constraint: "required-parent" }
    }));
  }
  return diagnostics;
}
function checkRelationshipMatrix(document, profile, registry, resolver, constraint) {
  const tuples = new Set(constraint.tuples.map((tuple) => `${tuple.relationType}
${tuple.sourceType}
${tuple.targetType}`));
  const diagnostics = [];
  const relations = Object.values(document.relations).filter((relation) => relation.profile === profile.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const relation of relations) {
    const declared = relationSchema(document, profile, relation);
    if (declared === void 0)
      continue;
    const sourceRole = roleOf(declared, constraint.sourceRole);
    const targetRole = roleOf(declared, constraint.targetRole);
    if (sourceRole === void 0 || targetRole === void 0)
      continue;
    const sources = relation.endpoints.filter((endpoint) => endpoint.role === constraint.sourceRole);
    const targets = relation.endpoints.filter((endpoint) => endpoint.role === constraint.targetRole);
    if (sources.length !== 1 || targets.length !== 1)
      continue;
    const source = sources[0];
    const target = targets[0];
    const sourceKind = refKindOf(source.target);
    const targetKind = refKindOf(target.target);
    if (sourceKind !== "entity" && sourceKind !== "relation")
      continue;
    if (targetKind !== "entity" && targetKind !== "relation")
      continue;
    if (!sourceRole.targets.includes(sourceKind) || !targetRole.targets.includes(targetKind))
      continue;
    const counts = /* @__PURE__ */ new Map();
    for (const endpoint of relation.endpoints) {
      counts.set(endpoint.role, (counts.get(endpoint.role) ?? 0) + 1);
    }
    const sourceCount = counts.get(constraint.sourceRole) ?? 0;
    const targetCount = counts.get(constraint.targetRole) ?? 0;
    if (sourceCount < sourceRole.cardinality.min || sourceCount > sourceRole.cardinality.max)
      continue;
    if (targetCount < targetRole.cardinality.min || targetCount > targetRole.cardinality.max)
      continue;
    let sourceType;
    if (sourceKind === "entity") {
      const sourceEntity = document.entities[source.target];
      if (sourceEntity === void 0)
        continue;
      const sourceInfo = resolvedChainOfEntity(registry, resolver, sourceEntity);
      if (sourceInfo === void 0)
        continue;
      if (sourceRole.entityTypes !== void 0 && !sourceRole.entityTypes.some((allowed) => sourceInfo.chain.includes(allowed))) {
        continue;
      }
      sourceType = sourceInfo.familyType;
    } else {
      sourceType = "@relation";
    }
    let targetType;
    if (targetKind === "entity") {
      const targetEntity = document.entities[target.target];
      if (targetEntity === void 0)
        continue;
      const targetInfo = resolvedChainOfEntity(registry, resolver, targetEntity);
      if (targetInfo === void 0)
        continue;
      if (targetRole.entityTypes !== void 0 && !targetRole.entityTypes.some((allowed) => targetInfo.chain.includes(allowed))) {
        continue;
      }
      targetType = targetInfo.familyType;
    } else {
      targetType = "@relation";
    }
    if (tuples.has(`${relationBaseType(document, profile, relation)}
${sourceType}
${targetType}`))
      continue;
    diagnostics.push(diagnostic({
      code: "relationship-matrix-violation",
      path: `relations.${relation.id}.endpoints`,
      message: `relation ${relation.id} of type ${relation.type} is not allowed from ${sourceType} to ${targetType} by matrix ${constraint.matrixId}`,
      refs: [relation.id, source.target, target.target],
      details: {
        matrixId: constraint.matrixId,
        relationType: relation.type,
        sourceType,
        targetType
      }
    }));
  }
  return diagnostics;
}
function scopedRecordSchemas(resolver, owner, recordType) {
  const resolution = resolver.resolve(owner, recordType);
  if (!resolution.ok)
    return void 0;
  return resolution.resolved.schemas;
}
function checkBoundPair(document, profile, registry, resolver, constraint) {
  const diagnostics = [];
  const checkValue = (value, valuePath) => {
    if (value.kind !== "struct")
      return;
    if (value.type === constraint.valueType) {
      const lower = value.fields[constraint.lowerField];
      const upper = value.fields[constraint.upperField];
      const structSchemas = scopedRecordSchemas(resolver, profile, value.type);
      const lowerSchema = structSchemas?.find((schema) => schema.name === constraint.lowerField);
      const upperSchema = structSchemas?.find((schema) => schema.name === constraint.upperField);
      const lowerValid = lower !== void 0 && lowerSchema !== void 0 && validateAttributeValue(lowerSchema, lower, `${valuePath}.fields.${constraint.lowerField}`).length === 0;
      const upperValid = upper !== void 0 && upperSchema !== void 0 && validateAttributeValue(upperSchema, upper, `${valuePath}.fields.${constraint.upperField}`).length === 0;
      if (lowerValid && upperValid && lower?.kind === "quantity" && upper?.kind === "quantity" && typeof lower.value === "number" && typeof upper.value === "number" && Number.isFinite(lower.value) && Number.isFinite(upper.value) && upper.value !== constraint.unboundedUpper && lower.value > upper.value) {
        diagnostics.push(diagnostic({
          code: "multiplicity-invalid",
          path: valuePath,
          message: `multiplicity lower ${String(lower.value)} exceeds finite upper ${String(upper.value)}`,
          refs: [],
          details: { lower: lower.value, upper: upper.value, constraint: "bound-pair" }
        }));
      }
    }
    for (const name of Object.keys(value.fields).sort()) {
      checkValue(value.fields[name], `${valuePath}.fields.${name}`);
    }
  };
  const checkRecord = (recordPath, attributes) => {
    for (const name of Object.keys(attributes).sort()) {
      checkValue(attributes[name], `${recordPath}.attributes.${name}`);
    }
  };
  for (const entity of Object.values(document.entities).filter((candidate) => candidate.profile === profile.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (scopedRecordSchemas(resolver, profile, entity.type) === void 0)
      continue;
    checkRecord(`entities.${entity.id}`, entity.attributes);
  }
  for (const relation of Object.values(document.relations).filter((candidate) => candidate.profile === profile.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (relationSchema(document, profile, relation) === void 0)
      continue;
    checkRecord(`relations.${relation.id}`, relation.attributes);
  }
  for (const port of Object.values(document.ports).filter((candidate) => candidate.profile === profile.id).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (portTypeOf(profile, port.type) === void 0)
      continue;
    checkRecord(`ports.${port.id}`, port.attributes);
  }
  return diagnostics;
}
function checkReferenceApplication(document, profile, registry, resolver, constraint, entities) {
  const diagnostics = [];
  const ordered = [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const entity of ordered) {
    const schemas = scopedRecordSchemas(resolver, profile, entity.type);
    if (schemas === void 0)
      continue;
    const schema = schemas.find((candidate) => candidate.name === constraint.attribute);
    if (schema === void 0)
      continue;
    const value = entity.attributes[constraint.attribute];
    if (value === void 0)
      continue;
    const slot = schema.kind === "collection" ? schema.item : schema;
    if (slot.kind !== "reference")
      continue;
    const items = value.kind === "collection" ? value.items.map((item, index) => ({ item, index })) : [{ item: value, index: void 0 }];
    for (const { item, index } of items) {
      if (item.kind !== "reference")
        continue;
      const itemPath = index === void 0 ? `entities.${entity.id}.attributes.${constraint.attribute}` : `entities.${entity.id}.attributes.${constraint.attribute}[${index}]`;
      const target = document.entities[item.value];
      if (target === void 0)
        continue;
      const targetProfile = registry.get(target.profile);
      if (targetProfile === void 0)
        continue;
      const targetResolution = resolver.resolve(targetProfile, target.type);
      if (!targetResolution.ok)
        continue;
      const allowedSet = slot.targetTypes;
      if (allowedSet !== void 0 && allowedSet.length > 0 && !allowedSet.some((type) => targetResolution.resolved.ancestry.includes(type))) {
        continue;
      }
      const declaration3 = targetResolution.resolved.schemas.find((candidate) => candidate.name === constraint.allowedTypesField);
      if (declaration3?.kind !== "collection" || declaration3.item.kind !== "enum")
        continue;
      const targetValue = target.attributes[constraint.allowedTypesField];
      if (targetValue?.kind !== "collection")
        continue;
      const allowed = targetValue.items.flatMap((entry) => entry.kind === "enum" ? [entry.value] : []);
      const source = chainOfEntity(document, registry, resolver, entity.id);
      if (source === void 0)
        continue;
      if (allowed.some((type) => source.chain.includes(type)))
        continue;
      diagnostics.push(diagnostic({
        code: "stereotype-application-invalid",
        path: itemPath,
        message: `stereotype ${target.id} cannot be applied to type ${source.familyType}`,
        refs: [entity.id, target.id],
        details: { attribute: constraint.attribute, targetType: source.familyType, allowed: allowed.join(",") }
      }));
    }
  }
  return diagnostics;
}
function checkIncidentTypeUniformity(document, profile, registry, resolver, constraint, entities) {
  const diagnostics = [];
  const ordered = [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const relations = Object.values(document.relations).filter((relation) => relation.profile === profile.id && constraint.relationTypes.includes(relationBaseType(document, profile, relation))).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const entity of ordered) {
    if (!entityAncestry(registry, resolver, entity).includes(constraint.entityType))
      continue;
    const incident = relations.filter((relation) => relation.endpoints.some((endpoint) => endpoint.target === entity.id));
    const distinct = [...new Set(incident.map((relation) => relationBaseType(document, profile, relation)))].sort();
    if (distinct.length <= 1)
      continue;
    diagnostics.push(diagnostic({
      code: "relationship-matrix-violation",
      path: `entities.${entity.id}`,
      message: `junction ${entity.id} connects incompatible relation types ${distinct.join(", ")}`,
      refs: [entity.id, ...incident.map((relation) => relation.id)],
      details: {
        matrixId: constraint.matrixId,
        constraint: "incident-type-uniformity",
        relationTypes: distinct.join(",")
      }
    }));
  }
  return diagnostics;
}
function checkAtMostValue(document, profile, constraint) {
  const diagnostics = [];
  const relations = Object.values(document.relations).filter((relation) => relation.profile === profile.id && relationBaseType(document, profile, relation) === constraint.relationType).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const relation of relations) {
    const count = constraint.attributes.filter((attribute) => {
      const value = relation.attributes[attribute];
      return value !== void 0 && value.kind === "enum" && value.value === constraint.value;
    }).length;
    if (count <= constraint.max)
      continue;
    diagnostics.push(diagnostic({
      code: "multiplicity-invalid",
      path: `relations.${relation.id}.attributes`,
      message: `relation ${relation.id} has ${count} ${constraint.value} ends; at most ${constraint.max} is allowed`,
      refs: [relation.id],
      details: { count, max: constraint.max, constraint: "at-most-value" }
    }));
  }
  return diagnostics;
}
function checkCollectionUnique(document, registry, resolver, constraint, entities) {
  const diagnostics = [];
  const ordered = [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const entity of ordered) {
    if (!entityAncestry(registry, resolver, entity).includes(constraint.entityType))
      continue;
    const value = entity.attributes[constraint.attribute];
    if (value?.kind !== "collection")
      continue;
    const seen = /* @__PURE__ */ new Map();
    value.items.forEach((item, index) => {
      const key = tryCanonicalise(item, "value");
      if (!key.ok)
        return;
      const first = seen.get(key.text);
      if (first !== void 0) {
        diagnostics.push(diagnostic({
          code: "collection-bound-exceeded",
          path: `entities.${entity.id}.attributes.${constraint.attribute}[${index}]`,
          message: `collection ${constraint.attribute} repeats item ${index}; first occurrence is ${first}`,
          refs: [],
          details: { constraint: "collection-unique", firstIndex: first, duplicateIndex: index }
        }));
      } else {
        seen.set(key.text, index);
      }
    });
  }
  return diagnostics;
}
function validateScopedUniqueness(document, profile, registry, resolver, constraint, entities) {
  const scope = constraint.scope ?? "document";
  const scopeText = scope === "document" ? "document" : scope === "siblings" ? "siblings" : `within:${scope.withinType}`;
  let keyOf;
  if (scope === "document") {
    keyOf = () => "document";
  } else {
    const selection = selectGroupingHierarchy(profile, constraint.entityType, scope === "siblings" ? void 0 : scope.withinType);
    if (selection === void 0)
      return [];
    const index = indexHierarchy(document, profile, selection.hierarchyId);
    if (index === void 0)
      return [];
    if (scope === "siblings") {
      keyOf = (entityId) => index.childToParents.get(entityId)?.[0] ?? "roots";
    } else {
      keyOf = (entityId) => nearestWithinTypeAncestor(document, registry, resolver, index, entityId, scope.withinType);
    }
  }
  const keyFor = keyOf;
  const ordered = [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const groups = /* @__PURE__ */ new Map();
  for (const entity of ordered) {
    if (!entityAncestry(registry, resolver, entity).includes(constraint.entityType))
      continue;
    const group = keyFor(entity.id);
    groups.set(group, [...groups.get(group) ?? [], entity.id]);
  }
  const diagnostics = [];
  for (const ids of groups.values()) {
    const seen = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const entity = document.entities[id];
      const value = entity.attributes[constraint.attribute];
      if (value === void 0)
        continue;
      const key = tryCanonicalise(value, "value");
      if (!key.ok)
        continue;
      const previous = seen.get(key.text);
      if (previous !== void 0) {
        diagnostics.push(diagnostic({
          code: "unique-attribute-violation",
          path: `entities.${id}.attributes.${constraint.attribute}`,
          message: `attribute ${constraint.attribute} must be unique among ${constraint.entityType} entities in scope ${scopeText}; ${previous} carries the same value`,
          refs: [id, previous],
          details: { attribute: constraint.attribute, type: constraint.entityType, scope: scopeText }
        }));
      } else {
        seen.set(key.text, id);
      }
    }
  }
  return diagnostics;
}
function nearestWithinTypeAncestor(document, registry, resolver, index, entityId, withinType) {
  let level = [entityId];
  const visited = /* @__PURE__ */ new Set([entityId]);
  while (level.length > 0) {
    const next = [];
    for (const current of [...level].sort()) {
      for (const parent of index.childToParents.get(current) ?? []) {
        if (visited.has(parent))
          continue;
        visited.add(parent);
        const info = chainOfEntity(document, registry, resolver, parent);
        if (info !== void 0 && info.chain.includes(withinType))
          return parent;
        next.push(parent);
      }
    }
    level = next;
  }
  return `none:${entityId}`;
}
function validateExtensions(document) {
  const diagnostics = [];
  let seenProcessFlow = false;
  document.extensions.forEach((extension, index) => {
    const path = `extensions[${index}]`;
    if (extension.validation === "unsupported") {
      diagnostics.push(diagnostic({
        code: "extension-unsupported",
        path,
        message: `extension ${extension.namespace}@${extension.schemaVersion} is unsupported: preserved for inspection and export, refused for write`,
        details: { namespace: extension.namespace, schemaVersion: extension.schemaVersion }
      }));
    }
    const target = scopeTargetOf(extension.scope);
    if (target !== void 0) {
      const kind = extension.scope.kind;
      diagnostics.push(...resolveReference(document, target, kind, `${path}.scope.target`));
    }
    if (extension.contentHash.length === 0) {
      diagnostics.push(diagnostic({ code: "extension-hash-mismatch", path: `${path}.contentHash`, message: "an extension carries its content hash" }));
    } else if (extension.source !== void 0 && hashContent(extension.source) !== extension.contentHash) {
      diagnostics.push(diagnostic({
        code: "extension-hash-mismatch",
        path: `${path}.contentHash`,
        message: `recorded hash ${extension.contentHash} is not the hash of the retained source (${hashContent(extension.source)})`,
        details: { recorded: extension.contentHash, computed: hashContent(extension.source) }
      }));
    }
    if (extension.namespace === PROCESS_FLOW_EXTENSION_NAMESPACE && extension.validation !== "unsupported") {
      if (seenProcessFlow) {
        diagnostics.push(diagnostic({
          code: "duplicate-id",
          path,
          message: `duplicate ${PROCESS_FLOW_EXTENSION_NAMESPACE} extension`
        }));
      } else {
        seenProcessFlow = true;
        diagnostics.push(...validateProcessFlowExtension(extension, path));
      }
    }
  });
  return diagnostics;
}
function keyMatchesId(key, id, kind, path) {
  const diagnostics = [];
  const parsed = parseRef(kind, id, `${path}.id`);
  if (!parsed.ok)
    diagnostics.push(parsed.diagnostic);
  if (key !== id) {
    diagnostics.push(diagnostic({
      code: "record-key-mismatch",
      path,
      message: `record key ${key} is not the element's own id ${id}`,
      refs: [key, id]
    }));
  }
  return diagnostics;
}
function declaredProfile(document, id, options, path) {
  if (!document.profileRefs.includes(id)) {
    return {
      diagnostic: diagnostic({
        code: "profile-not-declared",
        path: `${path}.profile`,
        message: `profile ${id} is used but not declared by the document (declared: ${document.profileRefs.join(", ") || "none"})`,
        details: { profile: id }
      })
    };
  }
  const profile = options.registry.get(id);
  if (profile === void 0) {
    return {
      diagnostic: diagnostic({
        code: "unknown-profile",
        path: `${path}.profile`,
        message: `profile ${id} is not in the registry (registered: ${options.registry.list().join(", ") || "none"})`,
        details: { profile: id }
      })
    };
  }
  return { profile };
}
function validateDocument(document, options) {
  if (typeof document !== "object" || document === null) {
    return [diagnostic({ code: "document-not-an-object", path: "document", message: "a document is an object" })];
  }
  const contractProfileRef = Array.isArray(document.profileRefs) ? document.profileRefs.find((id) => isPresentationContractProfileId(id)) : void 0;
  if (contractProfileRef !== void 0) {
    return [
      diagnostic({
        code: "unknown-profile",
        severity: "error",
        path: "profileRefs",
        message: `profile ${contractProfileRef} is not a diagram profile; ${contractProfileRef} is a contract artifact, not a semantic profile`,
        details: { profile: contractProfileRef }
      })
    ];
  }
  const contractBindingRow = options.bindings !== void 0 ? options.bindings.rows.find((row) => isPresentationContractProfileId(row.profileId)) : void 0;
  if (contractBindingRow !== void 0) {
    const profileId = contractBindingRow.profileId;
    return [
      diagnostic({
        code: "type-definition-conflict",
        severity: "error",
        path: `bindings.${profileId}`,
        message: `executor binding for ${profileId} is refused; a contract artifact is never a family layer`,
        details: { profile: profileId }
      })
    ];
  }
  if (options.bindings !== void 0) {
    const bindingDiagnostics = verifyExecutorBindings(options.bindings, options.registry);
    if (bindingDiagnostics.length > 0)
      return bindingDiagnostics;
    for (const id of document.profileRefs) {
      if (adapterFor(options.bindings, id) === void 0) {
        return [
          diagnostic({
            code: "type-definition-conflict",
            path: `bindings.${id}`,
            message: `no executor binding row selects an adapter for profile ${id}`,
            details: { profile: id }
          })
        ];
      }
    }
  } else {
    for (const id of document.profileRefs) {
      if (!isRetainedLegacyProfileId(id)) {
        return [
          diagnostic({
            code: "type-definition-conflict",
            path: `bindings.${id}`,
            message: `no executor binding row selects an adapter for profile ${id}`,
            details: { profile: id }
          })
        ];
      }
    }
    const effectiveDefaults = {
      schemaVersion: "1",
      rows: retainedExecutorBindings.rows.filter((row) => document.profileRefs.includes(row.profileId) && options.registry.get(row.profileId) !== void 0)
    };
    const defaultDiagnostics = verifyExecutorBindings(effectiveDefaults, options.registry);
    if (defaultDiagnostics.length > 0)
      return defaultDiagnostics;
  }
  const diagnostics = [];
  const version = document.schemaVersion;
  if (typeof version !== "object" || !Number.isInteger(version.major) || !Number.isInteger(version.minor) || version.major < 1 || version.minor < 0) {
    diagnostics.push(diagnostic({
      code: "schema-version-malformed",
      path: "schemaVersion",
      message: `expected { major, minor } integers, got ${JSON.stringify(version)}`
    }));
  } else if (version.major !== CURRENT_SCHEMA_VERSION.major) {
    diagnostics.push(diagnostic({
      code: "unknown-schema-major",
      path: "schemaVersion",
      message: `schema major ${version.major} is not writable by this build (current ${CURRENT_SCHEMA_VERSION.major}.${CURRENT_SCHEMA_VERSION.minor}); preserved for inspection and export`,
      details: { seenMajor: version.major, currentMajor: CURRENT_SCHEMA_VERSION.major }
    }));
  } else if (version.minor !== CURRENT_SCHEMA_VERSION.minor) {
    diagnostics.push(diagnostic({
      code: "schema-migration-required",
      path: "schemaVersion",
      message: `schema ${version.major}.${version.minor} must be migrated to ${CURRENT_SCHEMA_VERSION.major}.${CURRENT_SCHEMA_VERSION.minor} before it is written`,
      details: { seenMinor: version.minor, currentMinor: CURRENT_SCHEMA_VERSION.minor }
    }));
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    diagnostics.push(diagnostic({
      code: "value-not-finite",
      path: "revision",
      message: `a revision is a non-negative integer, got ${String(document.revision)}`
    }));
  }
  const documentIdParsed = parseRef("document", document.documentId, "documentId");
  if (!documentIdParsed.ok)
    diagnostics.push(documentIdParsed.diagnostic);
  if (document.profileRefs.length === 0) {
    diagnostics.push(diagnostic({ code: "profile-not-declared", path: "profileRefs", message: "a document declares at least one profile" }));
  }
  const adapterOf = (id) => adapterFor(options.bindings, id) ?? LEGACY_CONSTRAINTS_ADAPTER;
  const resolver = createTypeResolver(document);
  const profiles = [];
  for (const id of document.profileRefs) {
    const profile = options.registry.get(id);
    if (profile === void 0) {
      diagnostics.push(diagnostic({
        code: "unknown-profile",
        path: "profileRefs",
        message: `profile ${id} is not in the registry (registered: ${options.registry.list().join(", ") || "none"})`,
        details: { profile: id }
      }));
      continue;
    }
    profiles.push(profile);
    diagnostics.push(...validateProfile(profile, adapterOf(id)));
  }
  const emittedDefinitionPaths = /* @__PURE__ */ new Set();
  for (const key of Object.keys(document.typeDefinitions).sort()) {
    const definition = document.typeDefinitions[key];
    const path = `typeDefinitions.${key}`;
    if (definition.id !== key) {
      diagnostics.push(diagnostic({ code: "record-key-mismatch", path, message: `record key ${key} is not the definition id ${definition.id}` }));
    }
    const profile = declaredProfile(document, definition.profile, options, path);
    if ("diagnostic" in profile) {
      diagnostics.push(profile.diagnostic);
      continue;
    }
    const entityBase = entityTypeOf(profile.profile, definition.baseType);
    const relationBase = relationTypeOf(profile.profile, definition.baseType);
    if (entityTypeOf(profile.profile, key) !== void 0 || relationTypeOf(profile.profile, key) !== void 0) {
      diagnostics.push(diagnostic({ code: "type-definition-reserved", path, message: `definition ${key} shadows a profile type` }));
      continue;
    }
    if (entityBase !== void 0 && relationBase !== void 0) {
      diagnostics.push(diagnostic({ code: "type-definition-ambiguous", path: `${path}.baseType`, message: `base ${definition.baseType} exists in both namespaces` }));
      continue;
    }
    if (adapterOf(definition.profile) === LEGACY_CONSTRAINTS_ADAPTER || relationBase !== void 0) {
      const base = entityBase ?? relationBase;
      if (base === void 0) {
        diagnostics.push(diagnostic({
          code: "unknown-entity-type",
          path: `${path}.baseType`,
          message: `profile ${definition.profile} does not declare base type ${definition.baseType}`
        }));
        continue;
      }
      const baseNames = new Set((base.attributes ?? []).map((attribute) => attribute.name));
      for (const attribute of definition.attributes) {
        diagnostics.push(...qualifyAttributeSchema(attribute, `${path}.attributes.${attribute.name}`));
        if (relationBase !== void 0 && attribute.required === true)
          diagnostics.push(diagnostic({ code: "type-definition-conflict", path: `${path}.attributes.${attribute.name}`, message: "refinements add optional attributes only" }));
        if (baseNames.has(attribute.name)) {
          diagnostics.push(diagnostic({
            code: "type-definition-conflict",
            path: `${path}.attributes.${attribute.name}`,
            message: `type definition ${key} redeclares ${attribute.name}, which base type ${definition.baseType} already declares; refinements are additive only`,
            details: { attribute: attribute.name, baseType: definition.baseType }
          }));
        }
        baseNames.add(attribute.name);
      }
      continue;
    }
    const resolution = resolver.resolve(profile.profile, key);
    if (!resolution.ok) {
      if (!emittedDefinitionPaths.has(resolution.diagnostic.path)) {
        emittedDefinitionPaths.add(resolution.diagnostic.path);
        diagnostics.push(resolution.diagnostic);
      }
      continue;
    }
    definition.attributes.forEach((schema, schemaIndex) => {
      diagnostics.push(...qualifyAttributeSchema(schema, `${path}.attributes[${schemaIndex}]`));
    });
  }
  for (const key of Object.keys(document.entities).sort()) {
    const entity = document.entities[key];
    diagnostics.push(...validateEntity(entity, key, document, options, resolver, adapterOf(entity.profile)));
  }
  for (const key of Object.keys(document.ports).sort()) {
    const port = document.ports[key];
    diagnostics.push(...validatePort(port, key, document, options, resolver, adapterOf(port.profile)));
  }
  for (const key of Object.keys(document.relations).sort()) {
    const relation = document.relations[key];
    diagnostics.push(...validateRelation(relation, key, document, options, resolver, adapterOf(relation.profile)));
  }
  for (const key of Object.keys(document.resources).sort()) {
    const resource = document.resources[key];
    const path = `resources.${key}`;
    diagnostics.push(...keyMatchesId(key, resource.id, "resource", path));
    if (resource.uri.length === 0) {
      diagnostics.push(diagnostic({ code: "value-not-serialisable", path: `${path}.uri`, message: "a resource carries a uri" }));
    }
    if (resource.contentHash.length === 0) {
      diagnostics.push(diagnostic({ code: "extension-hash-mismatch", path: `${path}.contentHash`, message: "a resource carries its content hash" }));
    }
    if (resource.byteLength !== void 0 && (!Number.isInteger(resource.byteLength) || resource.byteLength < 0)) {
      diagnostics.push(diagnostic({ code: "value-not-finite", path: `${path}.byteLength`, message: `byteLength is a non-negative integer` }));
    }
  }
  diagnostics.push(...validateHierarchies(document, profiles.flatMap((profile) => profile.relationTypes.map((declaration3) => ({ profile: profile.id, declaration: declaration3 })))));
  for (const profile of profiles) {
    diagnostics.push(...validateConstraints(document, profile, options, resolver, adapterOf(profile.id)));
  }
  diagnostics.push(...validateExtensions(document));
  for (const profile of profiles) {
    const entityCount = Object.values(document.entities).filter((entity) => entity.profile === profile.id).length;
    const relationCount = Object.values(document.relations).filter((relation) => relation.profile === profile.id).length;
    if (profile.limits.maxEntities !== void 0 && entityCount > profile.limits.maxEntities) {
      diagnostics.push(diagnostic({
        code: "limit-exceeded",
        path: "entities",
        message: `${entityCount} entities of profile ${profile.id}; the declared limit is ${profile.limits.maxEntities}`,
        details: { limit: "maxEntities", seen: entityCount, max: profile.limits.maxEntities }
      }));
    }
    if (profile.limits.maxRelations !== void 0 && relationCount > profile.limits.maxRelations) {
      diagnostics.push(diagnostic({
        code: "limit-exceeded",
        path: "relations",
        message: `${relationCount} relations of profile ${profile.id}; the declared limit is ${profile.limits.maxRelations}`,
        details: { limit: "maxRelations", seen: relationCount, max: profile.limits.maxRelations }
      }));
    }
  }
  const canonical = tryCanonicalise(document, "document");
  if (!canonical.ok)
    diagnostics.push(...canonical.diagnostics);
  return diagnostics;
}

// node_modules/@sentropic/diagram-core/dist/view.js
var DEFAULT_PRESENTATION = { camera: { x: 0, y: 0, zoom: 1 } };
function createView(input) {
  return {
    viewId: input.viewId,
    semanticDocumentId: input.semanticDocumentId,
    revision: input.revision ?? 0,
    entityOccurrences: {},
    relationOccurrences: {},
    portOccurrences: {},
    groups: {},
    filters: [],
    presentation: input.presentation ?? DEFAULT_PRESENTATION
  };
}

// node_modules/@sentropic/diagram-core/dist/flows.js
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function flowIndex(document) {
  const scenarios = /* @__PURE__ */ new Map();
  const scenarioEntities = Object.values(document.entities).filter((e) => e.type === "flow-scenario").sort((a, b) => cmp(a.id, b.id));
  for (const entity of scenarioEntities) {
    const name = entity.attributes["name"];
    const order = entity.attributes["order"];
    scenarios.set(entity.id, { id: entity.id, label: name?.kind === "text" ? name.value : entity.id, ...order?.kind === "quantity" ? { order: order.value } : {}, steps: [] });
  }
  const byRelation = {};
  const byEntity = {};
  for (const relation of Object.values(document.relations).filter((r) => r.type === "flow-step").sort((a, b) => cmp(a.id, b.id))) {
    const attrs = relation.attributes;
    const step = attrs["step"];
    if (step?.kind !== "quantity" || !Number.isInteger(step.value) || step.value < 1 || step.value > 999)
      continue;
    const owner = (role3) => {
      const end = relation.endpoints.find((e) => e.role === role3)?.target;
      return end?.startsWith("port:") ? document.ports[end]?.owner : end?.startsWith("entity:") ? end : void 0;
    };
    const source = owner("source"), target = owner("target");
    if (source === void 0 || target === void 0)
      continue;
    const scenario = attrs["scenario"]?.kind === "reference" ? attrs["scenario"].value : "";
    if (scenario === "" && !scenarios.has(""))
      scenarios.set("", { id: "", label: "", steps: [] });
    const group = scenarios.get(scenario);
    if (group === void 0)
      continue;
    const branch = attrs["branch"]?.kind === "text" ? attrs["branch"].value : void 0;
    const label = attrs["label"]?.kind === "text" ? attrs["label"].value : void 0;
    const kind = attrs["kind"]?.kind === "enum" ? attrs["kind"].value : void 0;
    const realises = attrs["realises"]?.kind === "text" ? attrs["realises"].value : void 0;
    group.steps.push({
      relation: relation.id,
      scenario,
      step: step.value,
      ...branch === void 0 ? {} : { branch },
      ordinal: 0,
      badge: String(step.value) + (branch ?? ""),
      source,
      target,
      self: source === target,
      ...label === void 0 ? {} : { label },
      ...kind === void 0 ? {} : { kind },
      ...realises === void 0 ? {} : { realises }
    });
  }
  const ordered = [...scenarios.values()].sort((a, b) => a.id === "" ? -1 : b.id === "" ? 1 : (a.order ?? Infinity) - (b.order ?? Infinity) || cmp(a.id, b.id));
  for (const scenario of ordered) {
    scenario.steps.sort((a, b) => a.step - b.step || cmp(a.branch ?? "", b.branch ?? "") || cmp(a.relation, b.relation));
    scenario.steps = scenario.steps.map((step, ordinal) => ({ ...step, ordinal }));
    for (const step of scenario.steps) {
      byRelation[step.relation] = step;
      for (const entity of /* @__PURE__ */ new Set([step.source, step.target]))
        (byEntity[entity] ??= []).push(step.relation);
    }
  }
  return { scenarios: ordered, byRelation, byEntity };
}
function validateFlows(document) {
  const diagnostics = [];
  const groups = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const scenarios = new Set(Object.values(document.entities).filter((e) => e.type === "flow-scenario").map((e) => e.id));
  const add = (code, relation, severity = "error") => {
    diagnostics.push(diagnostic({ code, path: "relations." + relation, refs: [relation], severity, message: code }));
  };
  for (const relation of Object.values(document.relations).sort((a, b) => cmp(a.id, b.id))) {
    for (const end of relation.endpoints) {
      const owner = end.target.startsWith("port:") ? document.ports[end.target]?.owner : end.target;
      if (owner !== void 0 && scenarios.has(owner)) {
        add("flow-scenario-misused", relation.id);
        if (relation.type === "flow-step")
          add("flow-step-end-invalid", relation.id);
      }
    }
    if (relation.type !== "flow-step")
      continue;
    const step = relation.attributes["step"];
    if (step === void 0) {
      add("flow-step-missing", relation.id);
      continue;
    }
    if (step.kind !== "quantity")
      continue;
    const scenarioAttr = relation.attributes["scenario"];
    const scenario = scenarioAttr?.kind === "reference" ? scenarioAttr.value : "";
    if (scenario !== "" && !scenarios.has(scenario))
      add("flow-scenario-unknown", relation.id);
    const branch = relation.attributes["branch"];
    const key = JSON.stringify([scenario, step.value, branch?.kind === "text" ? branch.value : ""]);
    if (seen.has(key))
      add("flow-step-duplicate", relation.id);
    seen.add(key);
    const groupKey = JSON.stringify([scenario, step.value]);
    const group = groups.get(groupKey) ?? [];
    group.push(relation);
    groups.set(groupKey, group);
  }
  for (const group of groups.values()) {
    if (group.length > 26)
      add("flow-branch-overflow", group[0].id);
    for (const relation of group) {
      if (group.length === 1 === (relation.attributes["branch"] !== void 0))
        add("flow-branch-without-sibling", relation.id, "warning");
    }
  }
  const numbers = /* @__PURE__ */ new Map();
  for (const group of groups.values()) {
    const first = group[0];
    const attr = first.attributes["scenario"];
    const scenario = attr?.kind === "reference" ? attr.value : "";
    const step = first.attributes["step"];
    if (step?.kind === "quantity")
      (numbers.get(scenario) ?? numbers.set(scenario, /* @__PURE__ */ new Set()).get(scenario)).add(step.value);
  }
  for (const [scenario, values] of numbers) {
    if ([...values].sort((a, b) => a - b).some((value, i) => value !== i + 1))
      diagnostics.push(diagnostic({ code: "flow-step-gap", severity: "warning", path: "flows." + scenario, message: "step numbers are not consecutive from 1" }));
  }
  return diagnostics;
}

// node_modules/@sentropic/diagram-core/dist/erd.js
var erdEntityOccurrence = (entity) => occurrenceRef("e." + entity.slice(7));
var erdPortOccurrence = (port, side = "east") => occurrenceRef("p." + side + "." + port.slice(5));

// node_modules/@sentropic/diagram-core/dist/notation-resolve.js
function evaluateSlot(slot, attributes) {
  if (slot === void 0)
    return void 0;
  if (typeof slot === "string")
    return slot;
  const raw = attributes[slot.attribute];
  if (raw !== void 0 && "value" in raw) {
    const key = String(raw.value);
    if (Object.prototype.hasOwnProperty.call(slot.values, key))
      return slot.values[key];
  }
  return slot.default;
}
function resolveNotationEntity(block, entity) {
  const node = block.entityTypes[entity.type];
  if (node === void 0)
    return void 0;
  const variant = evaluateSlot(node.variant, entity.attributes);
  const defaultVariant = variant ?? DIAGRAM_NOTATION_RULES.variants[node.nature][0];
  const icon = evaluateSlot(node.icon, entity.attributes);
  const kicker = evaluateSlot(node.kicker, entity.attributes);
  return {
    role: node.role,
    nature: node.nature,
    ...defaultVariant === void 0 ? {} : { variant: defaultVariant },
    ...icon === void 0 ? {} : { icon },
    ...kicker === void 0 ? {} : { kicker }
  };
}
function resolveNotationRelation(block, profile, relation) {
  const relNode = block.relationTypes[relation.type];
  if (relNode === void 0)
    return void 0;
  const declared = relationTypeOf(profile, relation.type);
  const ends = relNode.encoding === "arrow" ? relNode.ends ?? DIAGRAM_NOTATION_RULES.endsDefault[declared?.direction ?? "directed"] : relNode.ends;
  let provisional = false;
  if (relNode.provisional !== void 0) {
    const attr = relation.attributes[relNode.provisional.attribute];
    if (attr !== void 0 && "value" in attr && String(attr.value) === relNode.provisional.equals) {
      provisional = true;
    }
  }
  return {
    encoding: relNode.encoding,
    ...ends === void 0 ? {} : { ends },
    provisional,
    ...relNode.on === void 0 ? {} : { on: relNode.on },
    ...relNode.label === void 0 ? {} : { label: relNode.label }
  };
}
function resolveNotation(block, profile, document) {
  const entities = {};
  for (const [id, entity] of Object.entries(document.entities)) {
    if (entity.profile !== profile.id)
      continue;
    const resolved = resolveNotationEntity(block, entity);
    if (resolved !== void 0)
      entities[id] = resolved;
  }
  const relations = {};
  for (const [id, relation] of Object.entries(document.relations)) {
    if (relation.profile !== profile.id)
      continue;
    const resolved = resolveNotationRelation(block, profile, relation);
    if (resolved !== void 0)
      relations[id] = resolved;
  }
  return { entities, relations };
}
function notationForProfile(profileId) {
  return profileId === PROCESS_PROFILE_ID ? processNotation : void 0;
}

// node_modules/@sentropic/diagram-canvas/dist/visibility.js
var REASON_KEYS = {
  "endpoint-hidden": true,
  "filtered-out": true,
  "geometry-not-finite": true,
  "group-collapsed": true,
  "not-included": true,
  "owner-hidden": true,
  "unresolved-reference": true
};
var EXCLUSION_REASONS = Object.keys(REASON_KEYS).sort();
function textsOf(value) {
  if (value.kind === "collection")
    return value.items.map((item) => String(item.value));
  if (value.kind === "struct")
    return [];
  return [String(value.value)];
}
function attributeMatches(attributes, attribute, expected) {
  const value = attributes[attribute];
  if (value === void 0)
    return false;
  return textsOf(value).includes(expected);
}
var VISIBLE = { visible: true };
function verdictFor(filters, matches) {
  let includeCount = 0;
  let included = false;
  for (const filter of filters) {
    if (filter.mode === "exclude") {
      if (matches(filter))
        return { visible: false, reason: "filtered-out", cause: filter.id };
      continue;
    }
    includeCount += 1;
    if (matches(filter))
      included = true;
  }
  if (includeCount > 0 && !included)
    return { visible: false, reason: "not-included" };
  return VISIBLE;
}
function combine(verdicts) {
  for (const verdict of verdicts)
    if (!verdict.visible)
      return verdict;
  return VISIBLE;
}
function filtersOfKind(view, kind) {
  return (view.filters ?? []).filter((filter) => filter.kind === kind);
}
function entityVerdict(view, entity) {
  return combine([
    verdictFor(filtersOfKind(view, "entity-type"), (filter) => filter.kind === "entity-type" ? filter.types.includes(entity.type) : false),
    verdictFor(filtersOfKind(view, "attribute-equals"), (filter) => filter.kind === "attribute-equals" ? attributeMatches(entity.attributes, filter.attribute, filter.value) : false)
  ]);
}
function relationVerdict(view, relation, document) {
  const definition = document?.typeDefinitions?.[relation.type];
  return combine([
    verdictFor(filtersOfKind(view, "relation-type"), (filter) => filter.kind === "relation-type" ? filter.types.includes(relation.type) || definition?.profile === relation.profile && filter.types.includes(definition.baseType) : false),
    verdictFor(filtersOfKind(view, "attribute-equals"), (filter) => filter.kind === "attribute-equals" ? attributeMatches(relation.attributes, filter.attribute, filter.value) : false)
  ]);
}
function collapsedAncestorGroupOf(view, occurrenceId) {
  const seen = /* @__PURE__ */ new Set();
  let currentId = occurrenceId;
  while (currentId !== void 0 && !seen.has(currentId)) {
    seen.add(currentId);
    const current = view.entityOccurrences[currentId];
    if (current === void 0 || current.group === void 0)
      return void 0;
    const group = view.groups[current.group];
    if (group === void 0)
      return void 0;
    if (group.collapsed === true)
      return group.id;
    currentId = group.occurrence;
  }
  return void 0;
}
function evaluateVisibility({ document, view }) {
  const visible = /* @__PURE__ */ new Set();
  const exclusions = [];
  for (const key of Object.keys(view.entityOccurrences).sort()) {
    const occurrence = view.entityOccurrences[key];
    const entity = document.entities[occurrence.entity];
    if (entity === void 0) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "entity",
        reason: "unresolved-reference",
        cause: occurrence.entity
      });
      continue;
    }
    const collapsedGroup = collapsedAncestorGroupOf(view, occurrence.id);
    if (collapsedGroup !== void 0) {
      exclusions.push({ occurrence: occurrence.id, kind: "entity", reason: "group-collapsed", cause: collapsedGroup });
      continue;
    }
    const verdict = entityVerdict(view, entity);
    if (!verdict.visible) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "entity",
        reason: verdict.reason,
        ...verdict.cause === void 0 ? {} : { cause: verdict.cause }
      });
      continue;
    }
    visible.add(occurrence.id);
  }
  for (const key of Object.keys(view.portOccurrences).sort()) {
    const occurrence = view.portOccurrences[key];
    if (document.ports[occurrence.port] === void 0) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "port",
        reason: "unresolved-reference",
        cause: occurrence.port
      });
      continue;
    }
    const foldedErd = document.ports[occurrence.port]?.profile === "erd@1" && Object.values(view.groups).some((group) => group.occurrence === occurrence.ownerOccurrence && group.collapsed);
    if (foldedErd || !visible.has(occurrence.ownerOccurrence)) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "port",
        reason: "owner-hidden",
        cause: occurrence.ownerOccurrence
      });
      continue;
    }
    visible.add(occurrence.id);
  }
  for (const key of Object.keys(view.relationOccurrences).sort()) {
    const occurrence = view.relationOccurrences[key];
    const relation = document.relations[occurrence.relation];
    if (relation === void 0) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "relation",
        reason: "unresolved-reference",
        cause: occurrence.relation
      });
      continue;
    }
    const verdict = relationVerdict(view, relation, document);
    if (!verdict.visible) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "relation",
        reason: verdict.reason,
        ...verdict.cause === void 0 ? {} : { cause: verdict.cause }
      });
      continue;
    }
    const hidden = occurrence.endpoints.find((endpoint) => !visible.has(endpoint.occurrence));
    if (hidden !== void 0) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "relation",
        reason: "endpoint-hidden",
        cause: hidden.occurrence
      });
      continue;
    }
    visible.add(occurrence.id);
  }
  exclusions.sort((left, right) => left.occurrence < right.occurrence ? -1 : left.occurrence > right.occurrence ? 1 : 0);
  return { visible, exclusions };
}

// node_modules/@sentropic/diagram-canvas/dist/scene.js
var DEFAULT_PORT_SIZE = 8;
var KIND_RANK = { edge: 0, node: 1, port: 2 };
function portAnchorPoint(ownerRect, side, anchor) {
  const box = normaliseRect(ownerRect);
  const clamped = anchor < 0 ? 0 : anchor > 1 ? 1 : anchor;
  switch (side) {
    case "north":
      return { x: box.x + clamped * box.width, y: box.y };
    case "south":
      return { x: box.x + clamped * box.width, y: box.y + box.height };
    case "east":
      return { x: box.x + box.width, y: box.y + clamped * box.height };
    case "west":
      return { x: box.x, y: box.y + clamped * box.height };
  }
}
function squareAround(center, size) {
  return { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size };
}
var UnknownViewError = class extends Error {
  view;
  constructor(view) {
    super(`view ${view} is not in this state`);
    this.name = "UnknownViewError";
    this.view = view;
  }
};
function buildScene(state, viewRef2, options = {}) {
  const view = state.views[viewRef2];
  if (view === void 0)
    throw new UnknownViewError(viewRef2);
  const portSize = options.portSize ?? DEFAULT_PORT_SIZE;
  const { visible, exclusions: visibilityExclusions } = evaluateVisibility({ document: state.document, view });
  const exclusions = [...visibilityExclusions];
  const diagnostics = [];
  const nodes = /* @__PURE__ */ new Map();
  for (const key of Object.keys(view.entityOccurrences).sort()) {
    const occurrence = view.entityOccurrences[key];
    if (!visible.has(occurrence.id))
      continue;
    if (!isFiniteRect(occurrence.geometry)) {
      exclusions.push({ occurrence: occurrence.id, kind: "entity", reason: "geometry-not-finite" });
      diagnostics.push(diagnostic({
        code: "value-not-finite",
        path: `entityOccurrences.${key}.geometry`,
        message: "a scene cannot place a non-finite rectangle (study invariant 8)",
        refs: [occurrence.id]
      }));
      continue;
    }
    nodes.set(occurrence.id, {
      kind: "node",
      occurrence: occurrence.id,
      entity: occurrence.entity,
      rect: normaliseRect(occurrence.geometry),
      z: occurrence.z ?? 0,
      ...occurrence.group === void 0 ? {} : { group: occurrence.group }
    });
  }
  const ports = /* @__PURE__ */ new Map();
  for (const key of Object.keys(view.portOccurrences).sort()) {
    const occurrence = view.portOccurrences[key];
    if (!visible.has(occurrence.id))
      continue;
    const owner = nodes.get(occurrence.ownerOccurrence);
    if (owner === void 0) {
      exclusions.push({
        occurrence: occurrence.id,
        kind: "port",
        reason: "owner-hidden",
        cause: occurrence.ownerOccurrence
      });
      continue;
    }
    if (!Number.isFinite(occurrence.anchor) || !Number.isFinite(occurrence.order)) {
      exclusions.push({ occurrence: occurrence.id, kind: "port", reason: "geometry-not-finite" });
      diagnostics.push(diagnostic({
        code: "value-not-finite",
        path: `portOccurrences.${key}`,
        message: "a port needs a finite anchor and order to be placed",
        refs: [occurrence.id]
      }));
      continue;
    }
    const anchorPoint = portAnchorPoint(owner.rect, occurrence.side, occurrence.anchor);
    ports.set(occurrence.id, {
      kind: "port",
      occurrence: occurrence.id,
      port: occurrence.port,
      ownerOccurrence: occurrence.ownerOccurrence,
      side: occurrence.side,
      order: occurrence.order,
      anchorPoint,
      rect: squareAround(anchorPoint, portSize),
      z: owner.z
    });
  }
  const edges = [];
  for (const key of Object.keys(view.relationOccurrences).sort()) {
    const occurrence = view.relationOccurrences[key];
    if (!visible.has(occurrence.id))
      continue;
    const ends = [...occurrence.endpoints].sort((left, right) => left.role < right.role ? -1 : left.role > right.role ? 1 : left.occurrence < right.occurrence ? -1 : 1);
    const anchors = [];
    let planes = [];
    let missing;
    for (const end of ends) {
      const port = ports.get(end.occurrence);
      if (port !== void 0) {
        anchors.push(port.anchorPoint);
        planes.push(port.z);
        continue;
      }
      const node = nodes.get(end.occurrence);
      if (node !== void 0) {
        anchors.push(rectCenter(node.rect));
        planes.push(node.z);
        continue;
      }
      missing = end.occurrence;
      break;
    }
    if (missing !== void 0) {
      exclusions.push({ occurrence: occurrence.id, kind: "relation", reason: "endpoint-hidden", cause: missing });
      continue;
    }
    const waypoints = (occurrence.waypoints ?? []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if ((occurrence.waypoints ?? []).length !== waypoints.length) {
      diagnostics.push(diagnostic({
        code: "value-not-finite",
        path: `relationOccurrences.${key}.waypoints`,
        message: "a non-finite waypoint is dropped from the route and reported",
        refs: [occurrence.id]
      }));
    }
    const path = anchors.length <= 1 ? anchors : [anchors[0], ...waypoints.map((point) => ({ x: point.x, y: point.y })), ...anchors.slice(1)];
    const bounds2 = rectFromPoints(path);
    if (bounds2 === void 0) {
      exclusions.push({ occurrence: occurrence.id, kind: "relation", reason: "geometry-not-finite" });
      continue;
    }
    if (planes.length === 0)
      planes = [0];
    edges.push({
      kind: "edge",
      occurrence: occurrence.id,
      relation: occurrence.relation,
      path,
      bounds: bounds2,
      z: Math.min(...planes)
    });
  }
  const items = [...edges, ...nodes.values(), ...ports.values()].sort(comparePaintOrder);
  let bounds;
  for (const item of items) {
    const box = item.kind === "edge" ? item.bounds : item.rect;
    bounds = bounds === void 0 ? box : rectUnion(bounds, box);
  }
  exclusions.sort((left, right) => left.occurrence < right.occurrence ? -1 : left.occurrence > right.occurrence ? 1 : left.reason < right.reason ? -1 : 1);
  const payload = {
    view: view.viewId,
    semanticDocument: view.semanticDocumentId,
    documentRevision: state.document.revision,
    viewRevision: view.revision,
    items,
    ...bounds === void 0 ? {} : { bounds },
    exclusions,
    diagnostics
  };
  return { sceneRevision: hashContent(canonicalise(payload, "scene")), ...payload };
}
function comparePaintOrder(left, right) {
  if (left.z !== right.z)
    return left.z - right.z;
  const rank = KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (rank !== 0)
    return rank;
  if (left.kind === "port" && right.kind === "port" && left.order !== right.order)
    return left.order - right.order;
  return left.occurrence < right.occurrence ? -1 : left.occurrence > right.occurrence ? 1 : 0;
}
var sceneNodes = (frame) => frame.items.filter((item) => item.kind === "node");

// node_modules/@sentropic/diagram-canvas/dist/layout/labels.js
var LABEL_CLEARANCE_REFERENCE_SCALE = 0.45;
function segmentLength(route, segment) {
  const a = route[segment];
  const b = route[segment + 1];
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}
function labelBoxOnSegment(route, segment, size) {
  const a = route[segment];
  const b = route[segment + 1];
  const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    segment,
    centre,
    box: { x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height }
  };
}
function edgeLabelCandidates(route) {
  const indexes = route.slice(1).map((_, index) => index);
  indexes.sort((left, right) => segmentLength(route, right) - segmentLength(route, left) || left - right);
  return indexes;
}
function edgeLabelPlacement(route, size) {
  const candidates = edgeLabelCandidates(route);
  const best = candidates[0];
  if (best === void 0)
    return void 0;
  return labelBoxOnSegment(route, best, size);
}
function placeEdgeLabels(entries, shapes, margin) {
  const placed = /* @__PURE__ */ new Map();
  const taken = [];
  for (const entry of entries) {
    let choice;
    for (const segment of edgeLabelCandidates(entry.route)) {
      const candidate = labelBoxOnSegment(entry.route, segment, entry.size);
      if (!segmentHolds(candidate, entry.route, segment, entry.size, shapes, taken, margin))
        continue;
      choice = candidate;
      break;
    }
    placed.set(entry.id, choice);
    if (choice !== void 0)
      taken.push(choice.box);
  }
  return placed;
}
function segmentHolds(candidate, route, segment, size, shapes, taken, margin) {
  const a = route[segment];
  const b = route[segment + 1];
  const horizontal = a.y === b.y;
  const along = horizontal ? size.width : size.height;
  if (segmentLength(route, segment) < along + 2 * margin)
    return false;
  const padded = pad(candidate.box, margin);
  return !shapes.some((shape) => rectsIntersect(shape, padded)) && !taken.some((box) => rectsIntersect(box, padded));
}
function pad(box, margin) {
  return { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin };
}
function relationRoute(view, occurrence) {
  const relation = view.relationOccurrences[occurrence];
  if (relation === void 0)
    return void 0;
  const ends = [...relation.endpoints].sort((left, right) => left.role < right.role ? -1 : left.role > right.role ? 1 : 0);
  const anchor = (endpointOccurrence) => {
    const port = view.portOccurrences[endpointOccurrence];
    if (port === void 0)
      return [];
    const owner = view.entityOccurrences[port.ownerOccurrence];
    return owner === void 0 ? [] : [portAnchorPoint(owner.geometry, port.side, port.anchor)];
  };
  const first = ends[0];
  const last = ends[ends.length - 1];
  return [
    ...first === void 0 ? [] : anchor(first.occurrence),
    ...(relation.waypoints ?? []).map((point) => ({ x: point.x, y: point.y })),
    ...last === void 0 || last === first ? [] : anchor(last.occurrence)
  ];
}
function placePackedLabel(entry, shapes, taken, inset, marginY = inset) {
  const { width, height } = entry.size;
  for (const segment of entry.segmentOrder === "route-order" ? entry.route.slice(1).map((_, i) => i) : edgeLabelCandidates(entry.route)) {
    const a = entry.route[segment];
    const b = entry.route[segment + 1];
    const horizontal = a.y === b.y;
    if (!horizontal && a.x !== b.x)
      continue;
    const preferred = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const alongPad = inset;
    const acrossPad = marginY;
    const padX = horizontal ? alongPad : acrossPad;
    const padY = horizontal ? acrossPad : alongPad;
    const shiftX = horizontal ? width / 4 : Math.max(0, width / 2 - inset);
    const shiftY = horizontal ? Math.max(0, height / 2 - inset) : height / 4;
    const xRange = [Math.min(a.x, b.x) - shiftX, Math.max(a.x, b.x) + shiftX];
    const yRange = [Math.min(a.y, b.y) - shiftY, Math.max(a.y, b.y) + shiftY];
    const reach = {
      x: xRange[0] - width / 2 - padX,
      y: yRange[0] - height / 2 - padY,
      width: xRange[1] - xRange[0] + width + 2 * padX,
      height: yRange[1] - yRange[0] + height + 2 * padY
    };
    const near = [...shapes, ...taken].filter((shape) => rectsIntersect(shape, reach));
    const xs = /* @__PURE__ */ new Set([preferred.x, xRange[0], xRange[1]]);
    const ys = /* @__PURE__ */ new Set([preferred.y, yRange[0], yRange[1]]);
    for (const shape of near) {
      xs.add(shape.x + shape.width + padX + width / 2);
      xs.add(shape.x - padX - width / 2);
      ys.add(shape.y + shape.height + padY + height / 2);
      ys.add(shape.y - padY - height / 2);
    }
    const bounds = [entry.within, entry.limit].filter((rect) => rect !== void 0);
    for (const rect of bounds) {
      xs.add(rect.x + width / 2);
      xs.add(rect.x + rect.width - width / 2);
      ys.add(rect.y + height / 2);
      ys.add(rect.y + rect.height - height / 2);
    }
    const inRange = (values, range) => [...values].filter((value) => value >= range[0] && value <= range[1]);
    const candidates = [];
    for (const x of inRange(xs, xRange)) {
      for (const y of inRange(ys, yRange)) {
        const dx = Math.abs(x - preferred.x);
        const dy = Math.abs(y - preferred.y);
        candidates.push({ x, y, cost: dx + dy, across: horizontal ? dy : dx });
      }
    }
    candidates.sort((left, right) => left.cost - right.cost || left.across - right.across || left.x - right.x || left.y - right.y);
    for (const candidate of candidates) {
      const box = { x: candidate.x - width / 2, y: candidate.y - height / 2, width, height };
      if (bounds.some((rect) => box.x < rect.x || box.y < rect.y || box.x + box.width > rect.x + rect.width || box.y + box.height > rect.y + rect.height)) {
        continue;
      }
      const padded = { x: box.x - padX, y: box.y - padY, width: width + 2 * padX, height: height + 2 * padY };
      if (near.some((shape) => rectsIntersect(shape, padded)))
        continue;
      return { segment, centre: { x: candidate.x, y: candidate.y }, box };
    }
  }
  return void 0;
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/erd.js
var ERD_GEOMETRY = {
  "width": 460,
  "headerHeight": 64,
  "rowHeight": 32,
  "lineHeight": 24,
  "padding": 12,
  "keyWidth": 56,
  "nameWidth": 170,
  "typeWidth": 170,
  "fontSize": 18,
  "titleFontSize": 24,
  "markerLength": 24,
  "markerHalfWidth": 8,
  "markerRadius": 4,
  "markerGap": 4,
  "strokeWidth": 1.5,
  "gapInline": 160,
  "gapBlock": 120,
  "labelWidth": 240
};
var escapeErdXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function erdText(attributes, key) {
  const value = attributes[key];
  return value && "value" in value ? String(value.value) : "";
}
var erdFlag = (p, key) => p.attributes[key]?.kind === "boolean" && p.attributes[key].value === true;
function erdFields(document, entity) {
  return Object.values(document.ports).filter((p) => p.owner === entity).sort((a, b) => Number(erdText(a.attributes, "ordinal")) - Number(erdText(b.attributes, "ordinal")) || (a.id < b.id ? -1 : 1));
}
function wrapErdText(text3, width, measure2, fontSize = ERD_GEOMETRY.fontSize) {
  const size = (value) => Math.max(Array.from(value).length * fontSize * 0.6, measure2 ? measure2({ text: value, role: "edge-label", availableWidth: Number.MAX_SAFE_INTEGER, allocatedLines: 1, folded: false }).width * fontSize / ERD_GEOMETRY.fontSize : 0);
  const lines = [];
  let line = "";
  for (const word of text3.replace(/([a-z0-9])([A-Z])/g, "$1\u200B$2").split(/(?<=[_|(),.s​])/u)) {
    const clean5 = word.replaceAll("\u200B", "");
    if (line && size(line + clean5) > width) {
      lines.push(line);
      line = "";
    }
    for (const ch of clean5) {
      if (line && size(line + ch) > width) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line || !lines.length)
    lines.push(line);
  return lines;
}
function measureErdCard(document, entity, collapsed = false, measure2) {
  const t = ERD_GEOMETRY, title = erdText(document.entities[entity].attributes, "name");
  const titleLines = wrapErdText(title, t.width - 2 * t.padding - t.titleFontSize, measure2, t.titleFontSize);
  const headerHeight = Math.max(t.headerHeight, titleLines.length * t.lineHeight + 2 * t.padding);
  let y = headerHeight;
  const rows = collapsed ? [] : erdFields(document, entity).map((field) => {
    const name = wrapErdText(field.name, t.nameWidth, measure2), type = wrapErdText(erdText(field.attributes, "dataType"), t.typeWidth, measure2);
    const target = document.ports[erdText(field.attributes, "fk")];
    const fk = target ? wrapErdText("\u2192 " + erdText(document.entities[target.owner].attributes, "name") + "." + target.name, t.width - 2 * t.padding, measure2) : [];
    const height = Math.max(t.rowHeight, (Math.max(name.length, type.length) + fk.length) * t.lineHeight + t.padding);
    const row = { field, y, height, name, type, fk };
    y += height;
    return row;
  });
  return { title, titleLines, width: t.width, height: y, headerHeight, rows, collapsed };
}
var ink = "var(--st-semantic-text-primary)";
var paper = "var(--st-semantic-surface-default)";
var border = "var(--st-semantic-border-strong)";
var strokeWidth = "var(--st-component-diagramErd-strokeWidth)";
function renderErdCardSvg(card) {
  const t = ERD_GEOMETRY;
  const text3 = (lines, x, y, size = "fontSize", attributes = "") => lines.map((line, i) => '<text x="' + x + '" y="' + (y + i * t.lineHeight) + '" font-size="var(--st-component-diagramErd-' + size + ')"' + attributes + ">" + escapeErdXml(line) + "</text>").join("");
  let body = '<rect width="' + card.width + '" height="' + card.height + '" fill="' + paper + '" stroke="' + border + '" stroke-width="' + strokeWidth + '"/>' + text3(card.titleLines, t.padding, t.padding + t.lineHeight, "titleFontSize");
  body += text3([card.collapsed ? "+" : "\u2212"], card.width - t.padding, t.padding + t.lineHeight, "titleFontSize", ' data-erd-fold-indicator="" text-anchor="end"');
  for (const row of card.rows) {
    body += '<g data-erd-field="' + escapeErdXml(row.field.id) + '"><path d="M0 ' + row.y + "H" + card.width + '" stroke="' + border + '" stroke-width="' + strokeWidth + '"/>';
    body += text3([[erdFlag(row.field, "pk") ? "PK" : "", row.field.attributes.fk ? "FK" : ""].filter(Boolean).join("/")], t.padding, row.y + t.lineHeight);
    body += text3(row.name, t.padding + t.keyWidth, row.y + t.lineHeight) + text3(row.type, t.padding + t.keyWidth + t.nameWidth, row.y + t.lineHeight);
    body += text3([erdFlag(row.field, "nullable") ? "?" : "NN"], card.width - t.padding, row.y + t.lineHeight, "fontSize", ' text-anchor="end"');
    body += text3(row.fk, t.padding, row.y + (Math.max(row.name.length, row.type.length) + 1) * t.lineHeight) + "</g>";
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" class="st-diagramErdCard" aria-hidden="true" width="100%" height="100%" viewBox="0 0 ' + card.width + " " + card.height + '" style="color:' + ink + ';font-family:var(--st-component-diagramErd-fontFamily);fill:currentColor">' + body + "</svg>";
}
function erdMarkerGeometry(cardinality, anchor, direction, tokens = ERD_GEOMETRY) {
  const n = Math.hypot(direction.x, direction.y) || 1, dx = direction.x / n, dy = direction.y / n;
  const p = (along, across) => ({ x: anchor.x + dx * along - dy * across, y: anchor.y + dy * along + dx * across });
  const l = tokens.markerLength, h = tokens.markerHalfWidth, g = tokens.markerGap;
  const many = cardinality.endsWith("n"), optional = cardinality.startsWith("0");
  const lines = many ? [[p(l / 2, 0), p(g, -h)], [p(l / 2, 0), p(g, 0)], [p(l / 2, 0), p(g, h)]] : [[p(g, -h), p(g, h)]];
  if (!optional)
    lines.push([p(l - g, -h), p(l - g, h)]);
  return { lines, ...optional ? { circle: { center: p(l - tokens.markerRadius, 0), radius: tokens.markerRadius } } : {} };
}
function renderErdMarkerSvg(cardinality, anchor, direction) {
  const marker = erdMarkerGeometry(cardinality, anchor, direction);
  return '<g data-erd-marker="' + cardinality + '" stroke="' + border + '" stroke-width="' + strokeWidth + '" fill="none">' + marker.lines.map(([a, b]) => '<path d="M' + a.x + " " + a.y + "L" + b.x + " " + b.y + '"/>').join("") + (marker.circle ? '<circle cx="' + marker.circle.center.x + '" cy="' + marker.circle.center.y + '" r="' + marker.circle.radius + '" fill="' + paper + '"/>' : "") + "</g>";
}
function placeErdRoleLabels(entries, blockers, margin) {
  const out = /* @__PURE__ */ new Map(), occupied = [...blockers];
  const normal = placeEdgeLabels(entries, blockers, margin);
  for (const entry of entries) {
    const placement = normal.get(entry.id);
    if (placement) {
      out.set(entry.id, { box: placement.box });
      occupied.push(placement.box);
    }
  }
  const free = (box) => occupied.every((b) => !rectsIntersect({ x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }, b));
  for (const entry of entries) {
    if (out.has(entry.id))
      continue;
    const initial = edgeLabelPlacement(entry.route, entry.size);
    if (!initial)
      continue;
    let box;
    for (let ring = 1; ring <= 64 && !box; ring++)
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const candidate = { ...initial.box, x: initial.box.x + dx * ring * ERD_GEOMETRY.rowHeight, y: initial.box.y + dy * ring * ERD_GEOMETRY.rowHeight };
        if (free(candidate)) {
          box = candidate;
          break;
        }
      }
    if (!box)
      box = { ...initial.box, x: Math.max(0, ...occupied.map((b) => b.x + b.width)) + ERD_GEOMETRY.padding };
    const end = { x: Math.max(box.x, Math.min(initial.centre.x, box.x + box.width)), y: Math.max(box.y, Math.min(initial.centre.y, box.y + box.height)) };
    out.set(entry.id, { box, leader: [initial.centre, end] });
    occupied.push(box);
  }
  return out;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/process.js
var PROCESS_LAYOUT_SPACING = {
  rankGap: 48,
  siblingGap: 24,
  lanePadding: 16,
  laneHeaderSize: 36,
  corridorGap: 24,
  parallelOffset: 10
};
var PROCESS_BOX_BOUNDS = {
  minWidth: 140,
  maxWidth: 220,
  minHeight: 52,
  maxHeight: 84,
  paddingX: 16,
  paddingY: 10,
  titleSize: 14,
  titleLineHeight: 18,
  subtitleSize: 12,
  subtitleLineHeight: 16,
  badgeSize: 20,
  badgeGap: 8,
  cornerRadius: 10
};
var byCodeUnit = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function attrText(entityOrRel, key) {
  const attr = entityOrRel.attributes[key];
  return attr !== void 0 && attr.kind === "text" && attr.value !== "" ? attr.value : void 0;
}
function attrEnum(entityOrRel, key) {
  const attr = entityOrRel.attributes[key];
  return attr !== void 0 && attr.kind === "enum" ? attr.value : void 0;
}
function attrQuantity(entityOrRel, key) {
  const attr = entityOrRel.attributes[key];
  return attr !== void 0 && attr.kind === "quantity" ? attr.value : void 0;
}
function approxTextWidth(value, fontSize) {
  return Array.from(value).length * fontSize * 0.56;
}
function wrapLines(textValue, maxWidth, maxLines, fontSize, measureLines2) {
  const measureWidth = (candidate) => {
    const fallbackW = approxTextWidth(candidate, fontSize);
    if (measureLines2 === void 0)
      return fallbackW;
    const baseSize = fontSize >= 14 ? 32 : 24;
    const measured = measureLines2({
      text: candidate,
      role: fontSize >= 14 ? "title" : "subtitle",
      availableWidth: Number.MAX_SAFE_INTEGER,
      allocatedLines: 1,
      folded: false
    });
    return Math.max(fallbackW, measured.width * (fontSize / baseSize));
  };
  const ellipsizeToFit = (value, forceEllipsis = false) => {
    if (!forceEllipsis && measureWidth(value) <= maxWidth)
      return value;
    const chars = Array.from(value);
    while (chars.length > 1 && measureWidth(`${chars.join("")}\u2026`) > maxWidth) {
      chars.pop();
    }
    return `${chars.join("").trimEnd()}\u2026`;
  };
  const words = textValue.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0)
    return [];
  const lines = [];
  let current = "";
  let truncated = false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && measureWidth(candidate) > maxWidth) {
      if (lines.length + 1 < maxLines) {
        lines.push(current);
        current = word;
      } else {
        lines.push(ellipsizeToFit(current, true));
        current = "";
        truncated = true;
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (!truncated && current !== "") {
    lines.push(measureWidth(current) > maxWidth ? ellipsizeToFit(current, true) : current);
  }
  return lines.slice(0, maxLines);
}
function measureProcessStepBox(title, subtitle, numbered, measureLines2) {
  const b = PROCESS_BOX_BOUNDS;
  const badgeReserve = numbered ? b.badgeSize + b.badgeGap : 0;
  const titleW = approxTextWidth(title, b.titleSize);
  const subW = subtitle ? approxTextWidth(subtitle, b.subtitleSize) : 0;
  const idealWidth = Math.max(titleW, subW) + b.paddingX * 2 + badgeReserve;
  const width = Math.max(b.minWidth, Math.min(b.maxWidth, Math.ceil(idealWidth)));
  const innerWidth = Math.max(40, width - b.paddingX * 2 - badgeReserve);
  const titleLines = wrapLines(title, innerWidth, 2, b.titleSize, measureLines2);
  const subtitleLines = subtitle ? wrapLines(subtitle, innerWidth, 1, b.subtitleSize, measureLines2) : [];
  const textHeight = Math.max(1, titleLines.length) * b.titleLineHeight + (subtitleLines.length > 0 ? 2 + subtitleLines.length * b.subtitleLineHeight : 0);
  const height = Math.max(b.minHeight, Math.min(b.maxHeight, Math.ceil(textHeight + b.paddingY * 2)));
  return { width, height, titleLines, subtitleLines };
}
function reachesInDag(adj, from, to) {
  if (from === to)
    return true;
  const seen = /* @__PURE__ */ new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const next of adj.get(current) ?? []) {
      if (next === to)
        return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}
function breakCyclesDfs(steps, edges, resolvedEntities) {
  const stepIds = steps.map((s) => s.id).sort(byCodeUnit);
  const selfLoops = [];
  const nonSelf = [];
  for (const edge of edges) {
    if (edge.from === edge.to)
      selfLoops.push(edge);
    else
      nonSelf.push(edge);
  }
  const normalInDegree = new Map(stepIds.map((id) => [id, 0]));
  const totalInDegree = new Map(stepIds.map((id) => [id, 0]));
  const normalOutgoing = new Map(stepIds.map((id) => [id, []]));
  const provisionalEdges = [];
  for (const edge of nonSelf) {
    totalInDegree.set(edge.to, (totalInDegree.get(edge.to) ?? 0) + 1);
    if (edge.provisional) {
      provisionalEdges.push(edge);
    } else {
      normalInDegree.set(edge.to, (normalInDegree.get(edge.to) ?? 0) + 1);
      normalOutgoing.get(edge.from)?.push(edge);
    }
  }
  for (const list of normalOutgoing.values()) {
    list.sort((a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.id, b.id));
  }
  const startPriority = (id) => {
    const variant = resolvedEntities[id]?.variant;
    if (variant === "start")
      return 0;
    if ((totalInDegree.get(id) ?? 0) === 0)
      return 1;
    if ((normalInDegree.get(id) ?? 0) === 0)
      return 2;
    return 3;
  };
  const roots = [...stepIds].sort((a, b) => startPriority(a) - startPriority(b) || (normalInDegree.get(a) ?? 0) - (normalInDegree.get(b) ?? 0) || byCodeUnit(a, b));
  const color = new Map(stepIds.map((id) => [id, 0]));
  const reversedIds = /* @__PURE__ */ new Set();
  const dagAdj = new Map(stepIds.map((id) => [id, []]));
  const visit = (nodeId) => {
    color.set(nodeId, 1);
    for (const edge of normalOutgoing.get(nodeId) ?? []) {
      const targetColor = color.get(edge.to) ?? 0;
      if (targetColor === 1) {
        reversedIds.add(edge.id);
      } else {
        dagAdj.get(edge.from)?.push(edge.to);
        if (targetColor === 0)
          visit(edge.to);
      }
    }
    color.set(nodeId, 2);
  };
  for (const root of roots) {
    if (color.get(root) === 0)
      visit(root);
  }
  for (const edge of [...provisionalEdges].sort((a, b) => byCodeUnit(a.id, b.id))) {
    if (reachesInDag(dagAdj, edge.to, edge.from)) {
      reversedIds.add(edge.id);
    } else {
      dagAdj.get(edge.from)?.push(edge.to);
    }
  }
  const forwardEdges = nonSelf.filter((edge) => !reversedIds.has(edge.id));
  const backEdges = nonSelf.filter((edge) => reversedIds.has(edge.id));
  return { forwardEdges, backEdges, selfLoops, reversedIds };
}
function rankAndOrderForwardGraph(stepIds, forwardEdges) {
  const sortedIds = [...stepIds].sort(byCodeUnit);
  const adj = new Map(sortedIds.map((id) => [id, []]));
  const indegree = new Map(sortedIds.map((id) => [id, 0]));
  for (const edge of forwardEdges) {
    adj.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const rankOf = new Map(sortedIds.map((id) => [id, 0]));
  const ready = sortedIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  while (ready.length > 0) {
    ready.sort(byCodeUnit);
    const current = ready.shift();
    for (const next of adj.get(current) ?? []) {
      rankOf.set(next, Math.max(rankOf.get(next) ?? 0, (rankOf.get(current) ?? 0) + 1));
      const rem = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, rem);
      if (rem === 0)
        ready.push(next);
    }
  }
  const rankCount = sortedIds.length === 0 ? 0 : Math.max(...rankOf.values()) + 1;
  const ranks = Array.from({ length: rankCount }, () => []);
  for (const id of sortedIds)
    ranks[rankOf.get(id) ?? 0].push(id);
  const dummies = /* @__PURE__ */ new Set();
  const segments = [];
  for (const edge of forwardEdges) {
    const fromRank = rankOf.get(edge.from) ?? 0;
    const toRank = rankOf.get(edge.to) ?? 0;
    let prev = edge.from;
    for (let r = fromRank + 1; r < toRank; r += 1) {
      const dummyId = `~${edge.id}~${r}`;
      dummies.add(dummyId);
      rankOf.set(dummyId, r);
      ranks[r].push(dummyId);
      segments.push({ edgeId: edge.id, from: prev, to: dummyId });
      prev = dummyId;
    }
    segments.push({ edgeId: edge.id, from: prev, to: edge.to });
  }
  for (const rank of ranks)
    rank.sort(byCodeUnit);
  const down = /* @__PURE__ */ new Map();
  const up = /* @__PURE__ */ new Map();
  for (const seg of segments) {
    (down.get(seg.from) ?? down.set(seg.from, []).get(seg.from)).push(seg.to);
    (up.get(seg.to) ?? up.set(seg.to, []).get(seg.to)).push(seg.from);
  }
  const countCrossings = (order2) => {
    const pos = /* @__PURE__ */ new Map();
    for (const rank of order2)
      rank.forEach((key, idx) => pos.set(key, idx));
    let total = 0;
    for (let r = 0; r + 1 < order2.length; r += 1) {
      const pairs = segments.filter((seg) => rankOf.get(seg.from) === r).map((seg) => [pos.get(seg.from) ?? 0, pos.get(seg.to) ?? 0]);
      for (let i = 0; i < pairs.length; i += 1) {
        for (let j = i + 1; j < pairs.length; j += 1) {
          if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0)
            total += 1;
        }
      }
    }
    return total;
  };
  const reorderRank = (order2, r, neighbors, adjacent) => {
    const adjPos = /* @__PURE__ */ new Map();
    order2[adjacent].forEach((key, idx) => adjPos.set(key, idx));
    const current = order2[r];
    const weight = /* @__PURE__ */ new Map();
    current.forEach((key, idx) => {
      const linked = neighbors.get(key) ?? [];
      weight.set(key, linked.length === 0 ? idx : linked.reduce((sum, other) => sum + (adjPos.get(other) ?? 0), 0) / linked.length);
    });
    current.sort((left, right) => weight.get(left) - weight.get(right) || byCodeUnit(left, right));
  };
  let order = ranks.map((rank) => [...rank]);
  let best = order.map((rank) => [...rank]);
  let bestCrossings = countCrossings(best);
  for (let sweep = 0; sweep < 24 && bestCrossings > 0; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let r = 1; r < order.length; r += 1)
        reorderRank(order, r, up, r - 1);
    } else {
      for (let r = order.length - 2; r >= 0; r -= 1)
        reorderRank(order, r, down, r + 1);
    }
    const crossings = countCrossings(order);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = order.map((rank) => [...rank]);
    }
  }
  return { rankOf, ranks: best, dummies, segments };
}
function buildGeometryForDirection(direction, steps, lanes, laneOfStep, ranked, boxes, forwardEdges, backEdges, selfLoops, measureLines2) {
  const s = PROCESS_LAYOUT_SPACING;
  const lr = direction === "left-to-right";
  const rankCount = ranked.ranks.length;
  const rankAlongSize = Array.from({ length: rankCount }, () => 0);
  for (let r = 0; r < rankCount; r += 1) {
    for (const key of ranked.ranks[r]) {
      if (ranked.dummies.has(key))
        continue;
      const box = boxes.get(key);
      rankAlongSize[r] = Math.max(rankAlongSize[r], lr ? box.width : box.height);
    }
    if (rankAlongSize[r] === 0)
      rankAlongSize[r] = lr ? PROCESS_BOX_BOUNDS.minWidth : PROCESS_BOX_BOUNDS.minHeight;
  }
  const rankGaps = Array.from({ length: Math.max(0, rankCount - 1) }, () => s.rankGap);
  if (lr) {
    for (const edge of forwardEdges) {
      if (!edge.label)
        continue;
      const rFrom = ranked.rankOf.get(edge.from) ?? 0;
      const rTo = ranked.rankOf.get(edge.to) ?? 0;
      if (rTo - rFrom !== 1)
        continue;
      const labelW = measureLines2 ? measureLines2({ text: edge.label, role: "edge-label", availableWidth: 400, allocatedLines: 1, folded: false }).width : approxTextWidth(edge.label, 12);
      const needed = Math.min(160, Math.max(s.rankGap, Math.ceil(labelW + 24)));
      rankGaps[rFrom] = Math.max(rankGaps[rFrom], needed);
    }
  }
  const rankAlongPos = [];
  let alongCursor = 0;
  for (let r = 0; r < rankCount; r += 1) {
    rankAlongPos.push(alongCursor);
    alongCursor += rankAlongSize[r] + (r + 1 < rankCount ? rankGaps[r] : 0);
  }
  const totalAlong = alongCursor;
  const initialCrossIdx = /* @__PURE__ */ new Map();
  for (let r = 0; r < rankCount; r += 1) {
    ranked.ranks[r].forEach((key, idx) => initialCrossIdx.set(key, idx));
  }
  const crossCenter = /* @__PURE__ */ new Map();
  const stepRects = /* @__PURE__ */ new Map();
  const laneRects = /* @__PURE__ */ new Map();
  const rankSpanOf = (edge) => {
    const r1 = ranked.rankOf.get(edge.from) ?? 0;
    const r2 = ranked.rankOf.get(edge.to) ?? 0;
    return { min: Math.min(r1, r2), max: Math.max(r1, r2) };
  };
  const intervalsInterleave = (a, b) => a.min < b.min && b.min < a.max && a.max < b.max || b.min < a.min && a.min < b.max && b.max < a.max;
  const assignCorridorTracks = (edges) => {
    const sorted = [...edges].sort((a, b) => {
      const sa = rankSpanOf(a);
      const sb = rankSpanOf(b);
      return sa.max - sa.min - (sb.max - sb.min) || sa.min - sb.min || byCodeUnit(a.id, b.id);
    });
    const tracks = [];
    const spansByTrack = [];
    const trackOf = /* @__PURE__ */ new Map();
    for (const edge of sorted) {
      const span = rankSpanOf(edge);
      let chosen = -1;
      for (let t = 0; t < tracks.length; t += 1) {
        const conflict = spansByTrack[t].some((other) => Math.max(span.min, other.min) < Math.min(span.max, other.max));
        if (!conflict) {
          chosen = t;
          break;
        }
      }
      if (chosen === -1) {
        chosen = tracks.length;
        tracks.push([]);
        spansByTrack.push([]);
      }
      tracks[chosen].push(edge);
      spansByTrack[chosen].push(span);
      trackOf.set(edge.id, chosen);
    }
    return { tracks, trackOf };
  };
  const splitSidesNonInterleaving = (edges, preferSide) => {
    const low = [];
    const high = [];
    const sorted = [...edges].sort((a, b) => {
      const sa = rankSpanOf(a);
      const sb = rankSpanOf(b);
      return sa.max - sa.min - (sb.max - sb.min) || sa.min - sb.min || byCodeUnit(a.id, b.id);
    });
    for (const edge of sorted) {
      const span = rankSpanOf(edge);
      const pref = preferSide(edge);
      const alt = pref === "low" ? "high" : "low";
      const prefList = pref === "low" ? low : high;
      const altList = alt === "low" ? low : high;
      const prefInterleaves = prefList.some((other) => intervalsInterleave(span, rankSpanOf(other)));
      const altInterleaves = altList.some((other) => intervalsInterleave(span, rankSpanOf(other)));
      if (prefInterleaves && !altInterleaves)
        altList.push(edge);
      else
        prefList.push(edge);
    }
    return { low, high };
  };
  let mainCrossExtent = 0;
  const intraCorridors = [];
  let globalBackEdges = [];
  if (lanes.length === 0) {
    globalBackEdges = backEdges;
    const rankCrossHeights = [];
    for (let r = 0; r < rankCount; r += 1) {
      let totalCross = 0;
      const items = ranked.ranks[r];
      items.forEach((key, idx) => {
        const size = ranked.dummies.has(key) ? 24 : lr ? boxes.get(key).height : boxes.get(key).width;
        totalCross += size + (idx + 1 < items.length ? s.siblingGap : 0);
      });
      rankCrossHeights.push(totalCross);
      mainCrossExtent = Math.max(mainCrossExtent, totalCross);
    }
    for (let r = 0; r < rankCount; r += 1) {
      const items = ranked.ranks[r];
      let cursor = (mainCrossExtent - rankCrossHeights[r]) / 2;
      for (const key of items) {
        if (ranked.dummies.has(key)) {
          crossCenter.set(key, cursor + 12);
          cursor += 24 + s.siblingGap;
          continue;
        }
        const id = key;
        const box = boxes.get(id);
        const stepWidth = lr ? rankAlongSize[r] : box.width;
        const stepHeight = lr ? box.height : rankAlongSize[r];
        const x = lr ? rankAlongPos[r] : cursor;
        const y = lr ? cursor : rankAlongPos[r];
        stepRects.set(id, { x, y, width: stepWidth, height: stepHeight });
        crossCenter.set(id, lr ? y + stepHeight / 2 : x + stepWidth / 2);
        cursor += (lr ? stepHeight : stepWidth) + s.siblingGap;
      }
    }
  } else {
    const stepPosById = /* @__PURE__ */ new Map();
    for (const step of steps)
      stepPosById.set(step.id, initialCrossIdx.get(step.id) ?? 0);
    const laneBarycentre = (laneId) => {
      const members = steps.filter((step) => laneOfStep.get(step.id) === laneId);
      if (members.length === 0)
        return Number.POSITIVE_INFINITY;
      return members.reduce((sum, step) => sum + (stepPosById.get(step.id) ?? 0), 0) / members.length;
    };
    const sortedLanes = [...lanes].sort((a, b) => {
      const ordA = attrQuantity(a, "order");
      const ordB = attrQuantity(b, "order");
      if (ordA !== void 0 && ordB !== void 0)
        return ordA - ordB || byCodeUnit(a.id, b.id);
      if (ordA !== void 0)
        return -1;
      if (ordB !== void 0)
        return 1;
      return laneBarycentre(a.id) - laneBarycentre(b.id) || byCodeUnit(a.id, b.id);
    });
    const unlanedSteps = steps.filter((step) => laneOfStep.get(step.id) === void 0);
    const bandIds = [
      ...sortedLanes.map((l) => l.id),
      ...unlanedSteps.length > 0 ? [void 0] : []
    ];
    const bandIndexOfLane = new Map(bandIds.map((id, idx) => [id, idx]));
    const dummiesByBandRank = /* @__PURE__ */ new Map();
    const hasStepInBandRank = /* @__PURE__ */ new Set();
    for (const step of steps) {
      const b = laneOfStep.get(step.id);
      const r = ranked.rankOf.get(step.id) ?? 0;
      hasStepInBandRank.add(`${b ?? ""}
${r}`);
    }
    for (const edge of forwardEdges) {
      const rFrom = ranked.rankOf.get(edge.from) ?? 0;
      const rTo = ranked.rankOf.get(edge.to) ?? 0;
      if (rTo - rFrom < 2)
        continue;
      const laneFrom = laneOfStep.get(edge.from);
      const laneTo = laneOfStep.get(edge.to);
      for (let r = rFrom + 1; r < rTo; r += 1) {
        const dummyId = `~${edge.id}~${r}`;
        let assigned;
        let otherBand;
        if (laneFrom === laneTo) {
          assigned = laneFrom;
          otherBand = laneFrom;
        } else {
          const fromBusy = hasStepInBandRank.has(`${laneFrom ?? ""}
${r}`);
          const toBusy = hasStepInBandRank.has(`${laneTo ?? ""}
${r}`);
          if (!fromBusy && toBusy) {
            assigned = laneFrom;
            otherBand = laneTo;
          } else if (fromBusy && !toBusy) {
            assigned = laneTo;
            otherBand = laneFrom;
          } else {
            assigned = r - rFrom <= rTo - r ? laneFrom : laneTo;
            otherBand = assigned === laneFrom ? laneTo : laneFrom;
          }
        }
        const key = `${assigned ?? ""}
${r}`;
        (dummiesByBandRank.get(key) ?? dummiesByBandRank.set(key, []).get(key)).push({ id: dummyId, edge, otherBand });
      }
    }
    const intraEdgesByBand = /* @__PURE__ */ new Map();
    const crossLaneBacks = [];
    for (const edge of backEdges) {
      const lFrom = laneOfStep.get(edge.from);
      const lTo = laneOfStep.get(edge.to);
      if (lFrom === lTo) {
        (intraEdgesByBand.get(lFrom) ?? intraEdgesByBand.set(lFrom, []).get(lFrom)).push(edge);
      } else {
        crossLaneBacks.push(edge);
      }
    }
    globalBackEdges = crossLaneBacks;
    const alongStart = s.laneHeaderSize;
    let bandCursor = 0;
    for (const laneId of bandIds) {
      const bandSteps = new Set(steps.filter((st) => laneOfStep.get(st.id) === laneId).map((st) => st.id));
      const bandItemsByRank = [];
      let maxBandCross = lr ? PROCESS_BOX_BOUNDS.minHeight : PROCESS_BOX_BOUNDS.minWidth;
      for (let r = 0; r < rankCount; r += 1) {
        const rankOrder = new Map(ranked.ranks[r].map((k, idx) => [k, idx]));
        const realInRank = ranked.ranks[r].filter((k) => !ranked.dummies.has(k) && bandSteps.has(k));
        const dummiesInRank = dummiesByBandRank.get(`${laneId ?? ""}
${r}`) ?? [];
        const myIdx = bandIndexOfLane.get(laneId) ?? 0;
        const beforeDummies = dummiesInRank.filter((d) => d.otherBand !== laneId && (bandIndexOfLane.get(d.otherBand) ?? 0) < myIdx).sort((a, b) => (rankOrder.get(a.id) ?? 0) - (rankOrder.get(b.id) ?? 0));
        const sameLaneDummies = dummiesInRank.filter((d) => d.otherBand === laneId);
        const afterDummies = dummiesInRank.filter((d) => d.otherBand !== laneId && (bandIndexOfLane.get(d.otherBand) ?? 0) > myIdx).sort((a, b) => (rankOrder.get(a.id) ?? 0) - (rankOrder.get(b.id) ?? 0));
        const middleMerged = [...realInRank, ...sameLaneDummies.map((d) => d.id)].sort((a, b) => (rankOrder.get(a) ?? 0) - (rankOrder.get(b) ?? 0));
        const keys = [...beforeDummies.map((d) => d.id), ...middleMerged, ...afterDummies.map((d) => d.id)];
        const hasRealOrMultiple = realInRank.length > 0 || keys.length > 1;
        let sum = 0;
        if (hasRealOrMultiple) {
          keys.forEach((key, idx) => {
            const size = ranked.dummies.has(key) ? 16 : lr ? boxes.get(key).height : boxes.get(key).width;
            sum += size + (idx + 1 < keys.length ? s.siblingGap : 0);
          });
        }
        bandItemsByRank.push({ keys, hasRealOrMultiple, totalSize: sum });
        maxBandCross = Math.max(maxBandCross, sum);
      }
      const bandIntra = intraEdgesByBand.get(laneId) ?? [];
      const myBandIdx = bandIndexOfLane.get(laneId) ?? 0;
      const preferIntraSide = (edge) => {
        const span = rankSpanOf(edge);
        let lowCross = 0;
        let highCross = 0;
        for (const fEdge of forwardEdges) {
          const rf = ranked.rankOf.get(fEdge.from) ?? 0;
          const rt = ranked.rankOf.get(fEdge.to) ?? 0;
          if (Math.max(span.min, rf) >= Math.min(span.max, rt))
            continue;
          const bf = bandIndexOfLane.get(laneOfStep.get(fEdge.from)) ?? myBandIdx;
          const bt = bandIndexOfLane.get(laneOfStep.get(fEdge.to)) ?? myBandIdx;
          if (bf === myBandIdx && bt < myBandIdx || bt === myBandIdx && bf < myBandIdx || bf < myBandIdx && bt > myBandIdx || bt < myBandIdx && bf > myBandIdx) {
            lowCross += 1;
          }
          if (bf === myBandIdx && bt > myBandIdx || bt === myBandIdx && bf > myBandIdx || bf < myBandIdx && bt > myBandIdx || bt < myBandIdx && bf > myBandIdx) {
            highCross += 1;
          }
        }
        return lowCross < highCross ? "low" : "high";
      };
      const intraSides = splitSidesNonInterleaving(bandIntra, preferIntraSide);
      const lowIntra = assignCorridorTracks(intraSides.low);
      const highIntra = assignCorridorTracks(intraSides.high);
      const lowIntraSpace = lowIntra.tracks.length * s.corridorGap;
      const highIntraSpace = highIntra.tracks.length * s.corridorGap;
      const bandSpan = maxBandCross + s.lanePadding * 2 + lowIntraSpace + highIntraSpace;
      if (laneId !== void 0) {
        const rect = lr ? { x: 0, y: bandCursor, width: alongStart + totalAlong + s.lanePadding, height: bandSpan } : { x: bandCursor, y: 0, width: bandSpan, height: alongStart + totalAlong + s.lanePadding };
        laneRects.set(laneId, rect);
      }
      for (let r = 0; r < rankCount; r += 1) {
        const { keys, hasRealOrMultiple, totalSize } = bandItemsByRank[r];
        let cursor = bandCursor + s.lanePadding + lowIntraSpace + (maxBandCross - totalSize) / 2;
        for (const key of keys) {
          if (ranked.dummies.has(key)) {
            const dummySize = hasRealOrMultiple ? 16 : 0;
            crossCenter.set(key, cursor + dummySize / 2);
            cursor += dummySize + s.siblingGap;
            continue;
          }
          const id = key;
          const box = boxes.get(id);
          const stepWidth = lr ? rankAlongSize[r] : box.width;
          const stepHeight = lr ? box.height : rankAlongSize[r];
          const x = lr ? alongStart + rankAlongPos[r] : cursor;
          const y = lr ? cursor : alongStart + rankAlongPos[r];
          stepRects.set(id, { x, y, width: stepWidth, height: stepHeight });
          crossCenter.set(id, lr ? y + stepHeight / 2 : x + stepWidth / 2);
          cursor += (lr ? stepHeight : stepWidth) + s.siblingGap;
        }
      }
      const scope = laneId ?? "unlaned";
      for (const edge of intraSides.low) {
        const t = lowIntra.trackOf.get(edge.id) ?? 0;
        const pos = bandCursor + s.lanePadding + (lowIntra.tracks.length - 1 - t) * s.corridorGap;
        intraCorridors.push({ edge, scope, side: "low", trackIndex: t, corridorPos: pos });
      }
      for (const edge of intraSides.high) {
        const t = highIntra.trackOf.get(edge.id) ?? 0;
        const pos = bandCursor + s.lanePadding + lowIntraSpace + maxBandCross + (t + 1) * s.corridorGap;
        intraCorridors.push({ edge, scope, side: "high", trackIndex: t, corridorPos: pos });
      }
      bandCursor += bandSpan;
    }
    mainCrossExtent = bandCursor;
  }
  const parallelBuckets = /* @__PURE__ */ new Map();
  for (const edge of [...forwardEdges, ...backEdges]) {
    const key = `${edge.from}
${edge.to}`;
    (parallelBuckets.get(key) ?? parallelBuckets.set(key, []).get(key)).push(edge);
  }
  const parallelShift = /* @__PURE__ */ new Map();
  for (const list of parallelBuckets.values()) {
    list.sort((a, b) => byCodeUnit(a.id, b.id));
    list.forEach((edge, idx) => {
      parallelShift.set(edge.id, (idx - (list.length - 1) / 2) * s.parallelOffset);
    });
  }
  const gutterEdges = /* @__PURE__ */ new Map();
  for (const edge of forwardEdges) {
    const rFrom = ranked.rankOf.get(edge.from) ?? 0;
    const rTo = ranked.rankOf.get(edge.to) ?? 0;
    if (rTo - rFrom === 1) {
      (gutterEdges.get(rFrom) ?? gutterEdges.set(rFrom, []).get(rFrom)).push(edge);
    }
  }
  const gutterSlot = /* @__PURE__ */ new Map();
  for (const list of gutterEdges.values()) {
    const angled = list.filter((e) => Math.abs((crossCenter.get(e.from) ?? 0) - (crossCenter.get(e.to) ?? 0)) > 1e-3).sort((a, b) => (crossCenter.get(a.from) ?? 0) - (crossCenter.get(b.from) ?? 0) || (crossCenter.get(a.to) ?? 0) - (crossCenter.get(b.to) ?? 0) || byCodeUnit(a.id, b.id));
    angled.forEach((edge, idx) => {
      const denom = angled.length + 1;
      gutterSlot.set(edge.id, (idx + 1) / denom);
    });
  }
  const waypointsByRelation = /* @__PURE__ */ new Map();
  for (const edge of forwardEdges) {
    const r1 = stepRects.get(edge.from);
    const r2 = stepRects.get(edge.to);
    const shift = parallelShift.get(edge.id) ?? 0;
    const rFrom = ranked.rankOf.get(edge.from) ?? 0;
    const rTo = ranked.rankOf.get(edge.to) ?? 0;
    if (lr) {
      const startDock = { x: r1.x + r1.width, y: r1.y + r1.height / 2 + shift };
      const endDock = { x: r2.x, y: r2.y + r2.height / 2 + shift };
      if (Math.abs(startDock.y - endDock.y) <= 1e-6 && rTo - rFrom === 1) {
        waypointsByRelation.set(edge.id, [startDock, endDock]);
      } else if (rTo - rFrom === 1) {
        const frac = gutterSlot.get(edge.id) ?? 0.5;
        const midX = startDock.x + (endDock.x - startDock.x) * frac;
        waypointsByRelation.set(edge.id, [startDock, { x: midX, y: startDock.y }, { x: midX, y: endDock.y }, endDock]);
      } else {
        const points = [startDock];
        let prevX = startDock.x;
        let prevY = startDock.y;
        for (let r = rFrom + 1; r < rTo; r += 1) {
          const dummyY = (crossCenter.get(`~${edge.id}~${r}`) ?? startDock.y) + shift;
          const rankLeft = (lanes.length > 0 ? s.laneHeaderSize : 0) + rankAlongPos[r];
          const rankRight = rankLeft + rankAlongSize[r];
          const entryX = rankLeft - rankGaps[r - 1] / 2;
          if (Math.abs(dummyY - prevY) > 1e-6) {
            points.push({ x: entryX, y: prevY }, { x: entryX, y: dummyY });
          }
          prevX = rankRight + rankGaps[r] / 2;
          prevY = dummyY;
        }
        if (Math.abs(endDock.y - prevY) > 1e-6) {
          points.push({ x: prevX, y: prevY }, { x: prevX, y: endDock.y });
        }
        points.push(endDock);
        waypointsByRelation.set(edge.id, points);
      }
    } else {
      const startDock = { x: r1.x + r1.width / 2 + shift, y: r1.y + r1.height };
      const endDock = { x: r2.x + r2.width / 2 + shift, y: r2.y };
      if (Math.abs(startDock.x - endDock.x) <= 1e-6 && rTo - rFrom === 1) {
        waypointsByRelation.set(edge.id, [startDock, endDock]);
      } else if (rTo - rFrom === 1) {
        const frac = gutterSlot.get(edge.id) ?? 0.5;
        const midY = startDock.y + (endDock.y - startDock.y) * frac;
        waypointsByRelation.set(edge.id, [startDock, { x: startDock.x, y: midY }, { x: endDock.x, y: midY }, endDock]);
      } else {
        const points = [startDock];
        let prevX = startDock.x;
        let prevY = startDock.y;
        for (let r = rFrom + 1; r < rTo; r += 1) {
          const dummyX = (crossCenter.get(`~${edge.id}~${r}`) ?? startDock.x) + shift;
          const rankTop = (lanes.length > 0 ? s.laneHeaderSize : 0) + rankAlongPos[r];
          const rankBottom = rankTop + rankAlongSize[r];
          const entryY = rankTop - rankGaps[r - 1] / 2;
          if (Math.abs(dummyX - prevX) > 1e-6) {
            points.push({ x: prevX, y: entryY }, { x: dummyX, y: entryY });
          }
          prevX = dummyX;
          prevY = rankBottom + rankGaps[r] / 2;
        }
        if (Math.abs(endDock.x - prevX) > 1e-6) {
          points.push({ x: prevX, y: prevY }, { x: endDock.x, y: prevY });
        }
        points.push(endDock);
        waypointsByRelation.set(edge.id, points);
      }
    }
  }
  const midCross = mainCrossExtent / 2;
  const globalSides = splitSidesNonInterleaving(globalBackEdges, (edge) => {
    const avg = ((crossCenter.get(edge.from) ?? midCross) + (crossCenter.get(edge.to) ?? midCross)) / 2;
    return avg < midCross - 1 ? "low" : "high";
  });
  const globalLowTracks = assignCorridorTracks(globalSides.low);
  const globalHighTracks = assignCorridorTracks(globalSides.high);
  let minCross = 0;
  let maxCross = mainCrossExtent;
  const allCorridorAssignments = [
    ...intraCorridors,
    ...globalSides.low.map((edge) => {
      const t = globalLowTracks.trackOf.get(edge.id) ?? 0;
      const pos = -(t + 1) * s.corridorGap;
      minCross = Math.min(minCross, pos);
      return { edge, scope: "global", side: "low", trackIndex: t, corridorPos: pos };
    }),
    ...globalSides.high.map((edge) => {
      const t = globalHighTracks.trackOf.get(edge.id) ?? 0;
      const pos = mainCrossExtent + (t + 1) * s.corridorGap;
      maxCross = Math.max(maxCross, pos);
      return { edge, scope: "global", side: "high", trackIndex: t, corridorPos: pos };
    })
  ];
  const isCrossLegBlocked = (alongCenter, fromCross, toCross, ignoreId) => {
    const lo = Math.min(fromCross, toCross);
    const hi = Math.max(fromCross, toCross);
    for (const [id, rect] of stepRects) {
      if (id === ignoreId)
        continue;
      const rAlongStart = lr ? rect.x : rect.y;
      const rAlongEnd = lr ? rect.x + rect.width : rect.y + rect.height;
      const rCrossStart = lr ? rect.y : rect.x;
      const rCrossEnd = lr ? rect.y + rect.height : rect.x + rect.width;
      if (alongCenter > rAlongStart - 1 && alongCenter < rAlongEnd + 1 && lo < rCrossEnd - 1 && hi > rCrossStart + 1) {
        return true;
      }
    }
    return false;
  };
  const alongOrigin = lanes.length > 0 ? s.laneHeaderSize : 0;
  const dockAlongByEdgeEnd = /* @__PURE__ */ new Map();
  const gutterEscapeCount = /* @__PURE__ */ new Map();
  const directDockBuckets = /* @__PURE__ */ new Map();
  const endPlans = /* @__PURE__ */ new Map();
  for (const item of allCorridorAssignments) {
    const r1 = stepRects.get(item.edge.from);
    const r2 = stepRects.get(item.edge.to);
    const c1Along = lr ? r1.x + r1.width / 2 : r1.y + r1.height / 2;
    const c1Cross = item.side === "low" ? lr ? r1.y : r1.x : lr ? r1.y + r1.height : r1.x + r1.width;
    const c2Along = lr ? r2.x + r2.width / 2 : r2.y + r2.height / 2;
    const c2Cross = item.side === "low" ? lr ? r2.y : r2.x : lr ? r2.y + r2.height : r2.x + r2.width;
    const startBypass = isCrossLegBlocked(c1Along, c1Cross, item.corridorPos, item.edge.from);
    const endBypass = isCrossLegBlocked(c2Along, c2Cross, item.corridorPos, item.edge.to);
    endPlans.set(item.edge.id, { startBypass, endBypass });
    if (!startBypass) {
      const k = `${item.edge.from}
${item.side}`;
      (directDockBuckets.get(k) ?? directDockBuckets.set(k, []).get(k)).push({
        item,
        isIncoming: false,
        stepId: item.edge.from,
        gutterBypass: false
      });
    }
    if (!endBypass) {
      const k = `${item.edge.to}
${item.side}`;
      (directDockBuckets.get(k) ?? directDockBuckets.set(k, []).get(k)).push({
        item,
        isIncoming: true,
        stepId: item.edge.to,
        gutterBypass: false
      });
    }
  }
  for (const list of directDockBuckets.values()) {
    list.sort((a, b) => {
      if (a.isIncoming !== b.isIncoming)
        return a.isIncoming ? 1 : -1;
      const tDiff = a.isIncoming ? b.item.trackIndex - a.item.trackIndex : a.item.trackIndex - b.item.trackIndex;
      return tDiff || byCodeUnit(a.item.edge.id, b.item.edge.id);
    });
    const rect = stepRects.get(list[0].stepId);
    const alongStart = lr ? rect.x : rect.y;
    const alongSpan = lr ? rect.width : rect.height;
    const center = alongStart + alongSpan / 2;
    const spacing = list.length <= 1 ? 0 : Math.min(s.parallelOffset, Math.max(4, (alongSpan - 24) / (list.length - 1)));
    list.forEach((plan, idx) => {
      const pos = center + (idx - (list.length - 1) / 2) * spacing;
      dockAlongByEdgeEnd.set(`${plan.item.edge.id}
${plan.isIncoming ? "to" : "from"}`, pos);
    });
  }
  for (const item of allCorridorAssignments) {
    const { edge, side, corridorPos } = item;
    const r1 = stepRects.get(edge.from);
    const r2 = stepRects.get(edge.to);
    const { startBypass, endBypass } = endPlans.get(edge.id);
    const rFrom = ranked.rankOf.get(edge.from) ?? 0;
    const rTo = ranked.rankOf.get(edge.to) ?? 0;
    const makePoint = (along, cross) => lr ? { x: along, y: cross } : { x: cross, y: along };
    const stepCrossBounds = (rect) => lr ? { start: rect.y, size: rect.height } : { start: rect.x, size: rect.width };
    const stepAlongBounds = (rect) => lr ? { start: rect.x, size: rect.width } : { start: rect.y, size: rect.height };
    const b1Cross = stepCrossBounds(r1);
    const b2Cross = stepCrossBounds(r2);
    const b1Along = stepAlongBounds(r1);
    const b2Along = stepAlongBounds(r2);
    const nextEscapeIdx = (key) => {
      const cur = gutterEscapeCount.get(key) ?? 0;
      gutterEscapeCount.set(key, cur + 1);
      return cur;
    };
    const pts = [];
    if (startBypass && rFrom > 0) {
      const esc = nextEscapeIdx(`${edge.from}
from`);
      const crossDir = side === "low" ? -1 : 1;
      const dockCross = b1Cross.start + b1Cross.size / 2 + crossDir * Math.min(b1Cross.size * 0.3, 8 + esc * 6);
      const gutterAlong = alongOrigin + rankAlongPos[rFrom] - rankGaps[rFrom - 1] * Math.max(0.15, 0.25 - esc * 0.05);
      pts.push(makePoint(b1Along.start, dockCross), makePoint(gutterAlong, dockCross), makePoint(gutterAlong, corridorPos));
    } else {
      const startAlong = dockAlongByEdgeEnd.get(`${edge.id}
from`) ?? b1Along.start + b1Along.size / 2;
      const startCross = side === "low" ? b1Cross.start : b1Cross.start + b1Cross.size;
      pts.push(makePoint(startAlong, startCross), makePoint(startAlong, corridorPos));
    }
    if (endBypass && rTo + 1 < rankCount) {
      const esc = nextEscapeIdx(`${edge.to}
to`);
      const crossDir = side === "low" ? -1 : 1;
      const dockCross = b2Cross.start + b2Cross.size / 2 + crossDir * Math.min(b2Cross.size * 0.3, 8 + esc * 6);
      const gutterAlong = alongOrigin + rankAlongPos[rTo] + rankAlongSize[rTo] + rankGaps[rTo] * Math.max(0.15, 0.25 - esc * 0.05);
      pts.push(makePoint(gutterAlong, corridorPos), makePoint(gutterAlong, dockCross), makePoint(b2Along.start + b2Along.size, dockCross));
    } else {
      const endAlong = dockAlongByEdgeEnd.get(`${edge.id}
to`) ?? b2Along.start + b2Along.size / 2;
      const endCross = side === "low" ? b2Cross.start : b2Cross.start + b2Cross.size;
      pts.push(makePoint(endAlong, corridorPos), makePoint(endAlong, endCross));
    }
    waypointsByRelation.set(edge.id, pts);
  }
  selfLoops.forEach((edge, idx) => {
    const r1 = stepRects.get(edge.from);
    const out = s.corridorGap + idx * 12;
    if (lr) {
      const startDock = { x: r1.x + r1.width * 0.75, y: r1.y };
      const endDock = { x: r1.x + r1.width * 0.25, y: r1.y };
      const topY = r1.y - out;
      minCross = Math.min(minCross, topY);
      waypointsByRelation.set(edge.id, [startDock, { x: startDock.x, y: topY }, { x: endDock.x, y: topY }, endDock]);
    } else {
      const startDock = { x: r1.x + r1.width, y: r1.y + r1.height * 0.75 };
      const endDock = { x: r1.x + r1.width, y: r1.y + r1.height * 0.25 };
      const rightX = r1.x + r1.width + out;
      maxCross = Math.max(maxCross, rightX);
      waypointsByRelation.set(edge.id, [startDock, { x: rightX, y: startDock.y }, { x: rightX, y: endDock.y }, endDock]);
    }
  });
  const crossShift = minCross < 0 ? -minCross : 0;
  if (crossShift > 0) {
    for (const [id, rect] of stepRects) {
      stepRects.set(id, lr ? { ...rect, y: rect.y + crossShift } : { ...rect, x: rect.x + crossShift });
    }
    for (const [id, rect] of laneRects) {
      laneRects.set(id, lr ? { ...rect, y: rect.y + crossShift } : { ...rect, x: rect.x + crossShift });
    }
    for (const [id, pts] of waypointsByRelation) {
      waypointsByRelation.set(id, pts.map((pt) => lr ? { x: pt.x, y: pt.y + crossShift } : { x: pt.x + crossShift, y: pt.y }));
    }
  }
  const alongExtent = (lanes.length > 0 ? s.laneHeaderSize + s.lanePadding : 0) + totalAlong;
  const crossExtent = maxCross - minCross;
  return {
    direction,
    stepRects,
    laneRects,
    waypointsByRelation,
    width: lr ? alongExtent : crossExtent,
    height: lr ? crossExtent : alongExtent
  };
}
function layoutProcess(document, options, source) {
  const diagnostics = validateDocument(document, {
    registry: options.registry,
    ...options.bindings ? { bindings: options.bindings } : {}
  });
  if (diagnostics.some((d) => d.severity === "error")) {
    return {
      status: "refused",
      refusals: [{ code: "document-invalid", path: "document", message: "Invalid process document" }],
      diagnostics
    };
  }
  if (!Number.isFinite(options.targetWidth) || options.targetWidth <= 0) {
    return {
      status: "refused",
      refusals: [
        {
          code: "target-width-invalid",
          path: "targetWidth",
          message: `the target width is a positive number of CSS px, got ${String(options.targetWidth)}`
        }
      ],
      diagnostics: []
    };
  }
  const profile = options.registry.get(PROCESS_PROFILE_ID);
  const notationBlock = notationForProfile(PROCESS_PROFILE_ID);
  if (profile === void 0 || notationBlock === void 0) {
    return {
      status: "refused",
      refusals: [{ code: "entity-profile-unsupported", path: "profileRefs", message: "process@1 profile not registered" }],
      diagnostics: []
    };
  }
  const resolvedNotation = resolveNotation(notationBlock, profile, document);
  const flowExt = parseProcessFlowExtension(document);
  const numbered = flowExt?.numbered ?? true;
  const entities = Object.values(document.entities).sort((a, b) => byCodeUnit(a.id, b.id));
  const steps = [];
  const lanes = [];
  for (const entity of entities) {
    const resolved = resolvedNotation.entities[entity.id];
    if (resolved?.role === "lane")
      lanes.push(entity);
    else
      steps.push(entity);
  }
  const laneOfStep = /* @__PURE__ */ new Map();
  const edges = [];
  for (const relation of Object.values(document.relations).sort((a, b) => byCodeUnit(a.id, b.id))) {
    const resolvedRel = resolvedNotation.relations[relation.id];
    if (resolvedRel?.encoding === "containment") {
      const laneEnd = relation.endpoints.find((ep) => ep.role === "lane")?.target;
      const stepEnd = relation.endpoints.find((ep) => ep.role === "step")?.target;
      if (laneEnd !== void 0 && stepEnd !== void 0)
        laneOfStep.set(stepEnd, laneEnd);
      continue;
    }
    const from = relation.endpoints.find((ep) => ep.role === "source")?.target;
    const to = relation.endpoints.find((ep) => ep.role === "target")?.target;
    if (from === void 0 || to === void 0)
      continue;
    const kind = attrEnum(relation, "kind");
    const emphasis = attrEnum(relation, "emphasis") === "emphasis" ? "emphasis" : "default";
    const label = attrText(relation, "label");
    edges.push({
      id: relation.id,
      relation,
      from,
      to,
      provisional: resolvedRel?.provisional === true || kind === "exception",
      emphasis,
      ...label === void 0 ? {} : { label }
    });
  }
  const boxes = /* @__PURE__ */ new Map();
  for (const step of steps) {
    const title = attrText(step, "name") ?? step.id;
    const subtitle = attrText(step, "subtitle");
    boxes.set(step.id, measureProcessStepBox(title, subtitle, numbered, options.measureLines));
  }
  const cycleBroken = breakCyclesDfs(steps, edges, resolvedNotation.entities);
  const ranked = rankAndOrderForwardGraph(steps.map((s) => s.id), cycleBroken.forwardEdges);
  const lrGeometry = buildGeometryForDirection("left-to-right", steps, lanes, laneOfStep, ranked, boxes, cycleBroken.forwardEdges, cycleBroken.backEdges, cycleBroken.selfLoops, options.measureLines);
  const chosenDirection = flowExt?.direction === "LR" ? "left-to-right" : flowExt?.direction === "TB" ? "top-to-bottom" : lrGeometry.width <= options.targetWidth ? "left-to-right" : "top-to-bottom";
  const placed = chosenDirection === "left-to-right" ? lrGeometry : buildGeometryForDirection("top-to-bottom", steps, lanes, laneOfStep, ranked, boxes, cycleBroken.forwardEdges, cycleBroken.backEdges, cycleBroken.selfLoops, options.measureLines);
  const entityOccurrences = {};
  const stepOccIdByEntity = /* @__PURE__ */ new Map();
  for (const lane of lanes) {
    const occId = Object.values(source?.entityOccurrences ?? {}).find((o) => o.entity === lane.id)?.id ?? occurrenceRef(`e.${lane.id.slice(lane.id.indexOf(":") + 1)}`);
    const rect = placed.laneRects.get(lane.id) ?? { x: 0, y: 0, width: 140, height: 60 };
    entityOccurrences[occId] = { id: occId, entity: lane.id, geometry: rect, z: -1 };
  }
  for (const step of steps) {
    const occId = Object.values(source?.entityOccurrences ?? {}).find((o) => o.entity === step.id)?.id ?? occurrenceRef(`e.${step.id.slice(step.id.indexOf(":") + 1)}`);
    stepOccIdByEntity.set(step.id, occId);
    const rect = placed.stepRects.get(step.id) ?? { x: 0, y: 0, width: PROCESS_BOX_BOUNDS.minWidth, height: PROCESS_BOX_BOUNDS.minHeight };
    entityOccurrences[occId] = { id: occId, entity: step.id, geometry: rect };
  }
  const relationOccurrences = {};
  for (const edge of edges) {
    const occId = Object.values(source?.relationOccurrences ?? {}).find((o) => o.relation === edge.id)?.id ?? occurrenceRef(`r.${edge.id.slice(edge.id.indexOf(":") + 1)}`);
    const fromOcc = stepOccIdByEntity.get(edge.from);
    const toOcc = stepOccIdByEntity.get(edge.to);
    const resolvedRel = resolvedNotation.relations[edge.id];
    const waypoints = placed.waypointsByRelation.get(edge.id) ?? [];
    relationOccurrences[occId] = {
      id: occId,
      relation: edge.relation.id,
      endpoints: [
        { role: "source", occurrence: fromOcc },
        { role: "target", occurrence: toOcc }
      ],
      waypoints,
      strokeStyle: edge.provisional ? "dashed" : "solid",
      arrowhead: resolvedRel?.ends === "none" ? "none" : "arrow",
      ...edge.emphasis === "emphasis" ? { emphasis: "emphasis" } : {}
    };
  }
  const view = {
    ...createView({
      viewId: options.viewId ?? source?.viewId ?? viewRef("process"),
      semanticDocumentId: document.documentId,
      revision: document.revision
    }),
    entityOccurrences,
    relationOccurrences
  };
  const width = Math.max(1, placed.width);
  const height = Math.max(1, placed.height);
  const zoom = Math.min(1, options.targetWidth / width);
  const warnings = [];
  return {
    status: "laid-out",
    view,
    fit: {
      direction: chosenDirection,
      width,
      height,
      zoom,
      pans: width * zoom > options.targetWidth + 0.5,
      phone: options.targetWidth <= 390
    },
    warnings,
    orientations: { root: chosenDirection === "left-to-right" ? "columns" : "rows" }
  };
}
function computeProcessStepNumbers(document, steps) {
  const profileNotation = notationForProfile(PROCESS_PROFILE_ID);
  const edges = [];
  const resolvedEntities = {};
  for (const step of steps) {
    const kind = attrEnum(step, "kind");
    resolvedEntities[step.id] = {
      role: "flow-node",
      nature: "activity",
      variant: kind ?? "task"
    };
  }
  for (const rel of Object.values(document.relations).sort((a, b) => byCodeUnit(a.id, b.id))) {
    if (rel.type !== "transition")
      continue;
    const from = rel.endpoints.find((e) => e.role === "source")?.target;
    const to = rel.endpoints.find((e) => e.role === "target")?.target;
    if (!from || !to)
      continue;
    const kind = attrEnum(rel, "kind");
    const provisional = profileNotation !== void 0 && kind !== void 0 && kind === "retry";
    edges.push({
      id: rel.id,
      relation: rel,
      from,
      to,
      provisional: provisional || kind === "exception",
      emphasis: "default"
    });
  }
  const broken = breakCyclesDfs(steps, edges, resolvedEntities);
  const ranked = rankAndOrderForwardGraph(steps.map((s) => s.id), broken.forwardEdges);
  const numbers = /* @__PURE__ */ new Map();
  ranked.ranks.forEach((rank, rankIdx) => {
    const realIds = rank.filter((id) => !ranked.dummies.has(id));
    realIds.forEach((id, pos) => {
      const step = document.entities[id];
      const authored = step ? attrText(step, "stepNumber") : void 0;
      if (authored !== void 0) {
        numbers.set(id, authored);
      } else if (realIds.length === 1) {
        numbers.set(id, String(rankIdx + 1));
      } else {
        const suffix = pos < 26 ? String.fromCharCode(97 + pos) : `.${pos + 1}`;
        numbers.set(id, `${rankIdx + 1}${suffix}`);
      }
    });
  });
  return numbers;
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/process.js
var PROCESS_BOX_GEOMETRY = {
  ...PROCESS_BOX_BOUNDS,
  laneHeaderSize: PROCESS_LAYOUT_SPACING.laneHeaderSize
};
var byCodeUnit2 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var escapeProcessXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function textAttr(entityOrRel, key) {
  const attr = entityOrRel.attributes[key];
  return attr !== void 0 && attr.kind === "text" && attr.value !== "" ? attr.value : void 0;
}
function measureProcessBox(document, entityId, options = {}) {
  const entity = document.entities[entityId];
  const title = (entity ? textAttr(entity, "name") : void 0) ?? entityId;
  const subtitle = entity ? textAttr(entity, "subtitle") : void 0;
  const direction = options.direction ?? "left-to-right";
  const notationBlock = entity ? notationForProfile(entity.profile) : notationForProfile(PROCESS_PROFILE_ID);
  const resolved = entity && notationBlock ? resolveNotationEntity(notationBlock, entity) : void 0;
  if (resolved?.role === "lane" || entity?.type === "lane") {
    return {
      kind: "lane",
      variant: "lane",
      title,
      titleLines: [title],
      subtitleLines: [],
      width: options.width ?? PROCESS_BOX_GEOMETRY.minWidth,
      height: options.height ?? PROCESS_BOX_GEOMETRY.minHeight,
      direction,
      ...options.bandIndex === void 0 ? {} : { bandIndex: options.bandIndex }
    };
  }
  const variant = resolved?.variant === "start" || resolved?.variant === "end" || resolved?.variant === "decision" || resolved?.variant === "subprocess" ? resolved.variant : "task";
  const stepNumber = options.stepNumber ?? (entity ? textAttr(entity, "stepNumber") : void 0);
  const measured = measureProcessStepBox(title, subtitle, stepNumber !== void 0, options.measureLines);
  return {
    kind: "flow-node",
    variant,
    title,
    titleLines: measured.titleLines,
    ...subtitle === void 0 ? {} : { subtitle },
    subtitleLines: measured.subtitleLines,
    ...stepNumber === void 0 ? {} : { stepNumber },
    width: options.width ?? measured.width,
    height: options.height ?? measured.height,
    direction
  };
}
function renderProcessBoxSvg(box) {
  const g = PROCESS_BOX_GEOMETRY;
  const w = box.width;
  const h = box.height;
  if (box.kind === "lane") {
    const surface = (box.bandIndex ?? 0) % 2 === 1 ? "var(--st-component-diagramZone-surface2, #f8fafc)" : "var(--st-component-diagramZone-surface1, #ffffff)";
    const border2 = "var(--st-semantic-border-subtle, #cbd5e1)";
    const textFill = "var(--st-semantic-text-secondary, #475569)";
    const header = g.laneHeaderSize;
    const divider = box.direction === "left-to-right" ? `<path d="M${header} 0V${h}" stroke="${border2}" stroke-width="1"/>` : `<path d="M0 ${header}H${w}" stroke="${border2}" stroke-width="1"/>`;
    const label = box.direction === "left-to-right" ? `<text x="${header / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${header / 2} ${h / 2})" font-size="12" font-weight="600" fill="${textFill}">${escapeProcessXml(box.title)}</text>` : `<text x="${w / 2}" y="${header / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" fill="${textFill}">${escapeProcessXml(box.title)}</text>`;
    return `<g class="st-diagramProcessLane" data-process-lane="${escapeProcessXml(box.title)}"><rect x="0.5" y="0.5" width="${Math.max(1, w - 1)}" height="${Math.max(1, h - 1)}" rx="6" fill="${surface}" stroke="${border2}" stroke-width="1"/>${divider}${label}</g>`;
  }
  const fill = "var(--st-semantic-surface-raised, #ffffff)";
  const stroke = "var(--st-semantic-border-strong, #64748b)";
  const ink2 = "var(--st-semantic-text-primary, #172033)";
  const muted = "var(--st-semantic-text-secondary, #475569)";
  let shapeSvg = "";
  if (box.variant === "start" || box.variant === "end") {
    const rx = Math.max(10, (h - 2) / 2);
    const strokeWidth2 = box.variant === "end" ? 2.5 : 1.5;
    shapeSvg = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth2}"/>`;
  } else if (box.variant === "decision") {
    const chamfer = Math.min(18, Math.round(h * 0.3));
    const pts = `${chamfer},1 ${w - chamfer},1 ${w - 1},${h / 2} ${w - chamfer},${h - 1} ${chamfer},${h - 1} 1,${h / 2}`;
    shapeSvg = `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`;
  } else if (box.variant === "subprocess") {
    shapeSvg = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${g.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><rect x="5" y="5" width="${Math.max(1, w - 10)}" height="${Math.max(1, h - 10)}" rx="${Math.max(4, g.cornerRadius - 3)}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
  } else {
    shapeSvg = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${g.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  const badgeWidth = box.stepNumber !== void 0 ? Math.max(g.badgeSize, Array.from(box.stepNumber).length * 7 + 10) : 0;
  const badgeSvg = box.stepNumber === void 0 ? "" : `<rect x="8" y="6" width="${badgeWidth}" height="${g.badgeSize}" rx="${g.badgeSize / 2}" fill="var(--st-semantic-surface-subtle, #f1f5f9)" stroke="var(--st-semantic-border-subtle, #cbd5e1)" stroke-width="1"/><text x="${8 + badgeWidth / 2}" y="${6 + g.badgeSize / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${muted}" data-process-step-badge="">${escapeProcessXml(box.stepNumber)}</text>`;
  const titleLines = box.titleLines.length > 0 ? box.titleLines : [box.title];
  const subLines = box.subtitleLines;
  const totalTextHeight = titleLines.length * g.titleLineHeight + (subLines.length > 0 ? 2 + subLines.length * g.subtitleLineHeight : 0);
  const blockTop = (h - totalTextHeight) / 2;
  const maxTitleChars = Math.max(...titleLines.map((line) => Array.from(line).length), 0);
  const approxHalfW = maxTitleChars * g.titleSize * 0.56 / 2;
  const badgeClearX = box.stepNumber !== void 0 ? 8 + badgeWidth + 4 : 0;
  const textX = badgeClearX > 0 && w / 2 - approxHalfW < badgeClearX ? Math.min(w - 12, (badgeClearX + w - 8) / 2) : w / 2;
  let textSvg = "";
  titleLines.forEach((line, idx) => {
    const baseline = Math.round((blockTop + idx * g.titleLineHeight + g.titleSize) * 100) / 100;
    textSvg += `<text x="${textX}" y="${baseline}" text-anchor="middle" font-size="${g.titleSize}" font-weight="600" fill="${ink2}">${escapeProcessXml(line)}</text>`;
  });
  subLines.forEach((line, idx) => {
    const baseline = Math.round((blockTop + titleLines.length * g.titleLineHeight + 2 + idx * g.subtitleLineHeight + g.subtitleSize) * 100) / 100;
    textSvg += `<text x="${textX}" y="${baseline}" text-anchor="middle" font-size="${g.subtitleSize}" font-weight="400" fill="${muted}">${escapeProcessXml(line)}</text>`;
  });
  return `<g class="st-diagramProcessBox" data-process-variant="${escapeProcessXml(box.variant)}"><title>${escapeProcessXml(box.title)}</title>${shapeSvg}${badgeSvg}${textSvg}</g>`;
}
function renderProcessTable(document) {
  const e = escapeProcessXml;
  const entities = Object.values(document.entities).sort((a, b) => byCodeUnit2(a.id, b.id));
  const steps = entities.filter((entity) => entity.type === "step");
  const stepNumbers = computeProcessStepNumbers(document, steps);
  const laneByStep = /* @__PURE__ */ new Map();
  const transitionsBySource = /* @__PURE__ */ new Map();
  for (const relation of Object.values(document.relations).sort((a, b) => byCodeUnit2(a.id, b.id))) {
    if (relation.type === "inLane") {
      const laneId = relation.endpoints.find((ep) => ep.role === "lane")?.target;
      const stepId = relation.endpoints.find((ep) => ep.role === "step")?.target;
      if (laneId !== void 0 && stepId !== void 0) {
        const lane = document.entities[laneId];
        laneByStep.set(stepId, (lane ? textAttr(lane, "name") : void 0) ?? laneId);
      }
      continue;
    }
    if (relation.type === "transition") {
      const sourceId = relation.endpoints.find((ep) => ep.role === "source")?.target;
      const targetId = relation.endpoints.find((ep) => ep.role === "target")?.target;
      if (sourceId !== void 0 && targetId !== void 0) {
        const target = document.entities[targetId];
        const targetName = (target ? textAttr(target, "name") : void 0) ?? targetId;
        const label = textAttr(relation, "label");
        const kindAttr = relation.attributes["kind"];
        const kind = kindAttr?.kind === "enum" && kindAttr.value !== "normal" ? kindAttr.value : void 0;
        const list = transitionsBySource.get(sourceId) ?? [];
        list.push({ targetName, ...label === void 0 ? {} : { label }, ...kind === void 0 ? {} : { kind } });
        transitionsBySource.set(sourceId, list);
      }
    }
  }
  const orderedSteps = [...steps].sort((a, b) => {
    const na = stepNumbers.get(a.id) ?? "";
    const nb = stepNumbers.get(b.id) ?? "";
    const pa = Number.parseInt(na, 10);
    const pb = Number.parseInt(nb, 10);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb)
      return pa - pb;
    return byCodeUnit2(na, nb) || byCodeUnit2(a.id, b.id);
  });
  let rows = "";
  for (const step of orderedSteps) {
    const num = stepNumbers.get(step.id) ?? "\u2014";
    const laneName = laneByStep.get(step.id) ?? "\u2014";
    const name = textAttr(step, "name") ?? step.id;
    const subtitle = textAttr(step, "subtitle");
    const action = subtitle ? `${name} (${subtitle})` : name;
    const outgoing = transitionsBySource.get(step.id) ?? [];
    const nextText = outgoing.length === 0 ? "\u2014" : outgoing.map((t) => {
      const cond = [t.label, t.kind].filter(Boolean).join(", ");
      return cond ? `${t.targetName} [${cond}]` : t.targetName;
    }).join("; ");
    rows += `<tr data-process-table-step="${e(step.id)}"><td>${e(num)}</td><td>${e(laneName)}</td><th scope="row">${e(action)}</th><td>${e(nextText)}</td></tr>`;
  }
  return `<details class="st-diagramProcessTable"><summary>Process steps and transitions</summary><table><caption>Process flow</caption><thead><tr><th scope="col">Step</th><th scope="col">Lane</th><th scope="col">Action</th><th scope="col">Next / Condition</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

// node_modules/@sentropic/diagram-canvas/dist/camera.js
var DEFAULT_MAX_DISPLAY_SCALE = 0.62;
var DEFAULT_MIN_READABLE_SCALE = 0.3;
var DEFAULT_EDGE_LABEL_SIZE = 18;
var DEFAULT_LINK_STROKE_WIDTH = 2.5;
var DEFAULT_LINK_RELATED_STROKE_WIDTH = 3;
var DEFAULT_LINK_EMPHASIS_STROKE_WIDTH = 3.5;
var MIN_EDGE_LABEL_CSS_PX = 8;
var FIT_WINDOW_HEIGHT_SHARE = 0.85;
var FIT_WINDOW_MARGIN_PX = 24;
var FIT_ASPECT = 16 / 9;
var FIT_PAINT_INSET = 1;
function floorToQuantum(value, quantum) {
  if (!(quantum > 0) || !Number.isFinite(quantum) || !Number.isFinite(value))
    return value;
  const perUnit = 1 / quantum;
  let steps = Math.floor(value * perUnit);
  if (steps / perUnit > value)
    steps -= 1;
  else if ((steps + 1) / perUnit <= value)
    steps += 1;
  return steps / perUnit;
}
function fitBox(viewWidth, windowHeight, fitToWindow = false) {
  if (fitToWindow) {
    return {
      width: viewWidth,
      height: Number.isFinite(windowHeight) ? Math.max(0, windowHeight - FIT_WINDOW_MARGIN_PX) : viewWidth / FIT_ASPECT
    };
  }
  return { width: viewWidth, height: Math.min(viewWidth / FIT_ASPECT, FIT_WINDOW_HEIGHT_SHARE * windowHeight) };
}
function cameraFit(input) {
  const maxZoom = Math.max(DEFAULT_MIN_READABLE_SCALE, input.maxDisplayScale ?? DEFAULT_MAX_DISPLAY_SCALE);
  const readableFloor = Math.min(maxZoom, Math.max(DEFAULT_MIN_READABLE_SCALE, input.minReadableScale ?? DEFAULT_MIN_READABLE_SCALE));
  const hasExplicitHeight = input.viewHeight !== void 0 && Number.isFinite(input.viewHeight) && input.viewHeight >= 0;
  const frame = hasExplicitHeight ? { width: input.viewWidth, height: input.viewHeight } : fitBox(input.viewWidth, input.windowHeight, input.fitToWindow ?? false);
  const box = { width: frame.width, height: Math.max(0, frame.height - (input.scrollbarHeight ?? 0)) };
  const bounds = input.bounds;
  if (bounds === void 0 || !(bounds.width > 0) || !(bounds.height > 0)) {
    return { fitWidth: box.width, fitHeight: box.height, zoomFit: maxZoom, zoom: maxZoom, minZoom: maxZoom, maxZoom, pans: false };
  }
  const zoomFit = Math.min(Math.max(0, box.width - 2 * FIT_PAINT_INSET) / bounds.width, Math.max(0, box.height - 2 * FIT_PAINT_INSET) / bounds.height, maxZoom);
  const applied = input.zoomQuantum === void 0 || zoomFit >= maxZoom ? zoomFit : floorToQuantum(zoomFit, input.zoomQuantum);
  const zoom = input.unconstrained === true || input.fitToWindow === true ? applied > 0 ? applied : zoomFit > 0 ? zoomFit : readableFloor : Math.max(readableFloor, applied);
  const fitHeight = hasExplicitHeight ? box.height : Math.min(box.height, Math.ceil((bounds.height * zoom + 2 * FIT_PAINT_INSET) * 64) / 64);
  return { fitWidth: box.width, fitHeight, zoomFit, zoom, minZoom: zoom, maxZoom, pans: zoom > zoomFit };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/connectorStyle.js
var ARROWHEAD_MARKER_GEOMETRY = Object.freeze({
  arrow: Object.freeze({
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerUnits: "userSpaceOnUse",
    markerWidth: 10.5,
    markerHeight: 10.5,
    orient: "auto-start-reverse",
    path: "M0 0L10 5L0 10Z"
  })
});
var LINK_EMPHASIS_STROKE_FALLBACK = "#001f33";
var LINK_EMPHASIS_STROKE = `var(--st-component-diagramScene-linkEmphasisStroke, var(--st-semantic-border-interactive, ${LINK_EMPHASIS_STROKE_FALLBACK}))`;
function connectorMarkerIds(baseArrowId) {
  return {
    filled: baseArrowId,
    filledEmphasis: `${baseArrowId}-emphasis`
  };
}
function connectorDashArray(strokeStyle) {
  const descriptor = resolveDashPattern(strokeStyle);
  if (descriptor === void 0 || descriptor.dashArray.length === 0)
    return void 0;
  return descriptor.dashArray.join(" ");
}
function connectorDashPaint(strokeStyle) {
  const fallback = connectorDashArray(strokeStyle);
  if (fallback === void 0)
    return void 0;
  const token = strokeStyle === "dashed" ? "linkDashDashed" : "linkDashDotted";
  return `stroke-dasharray:var(--st-component-diagramScene-${token}, ${fallback})`;
}
function connectorStrokeWidth(edge, widths) {
  if (edge.emphasis === "emphasis")
    return widths?.linkEmphasisStrokeWidth ?? DEFAULT_LINK_EMPHASIS_STROKE_WIDTH;
  if (edge.arrowhead === "none")
    return widths?.linkRelatedStrokeWidth ?? DEFAULT_LINK_RELATED_STROKE_WIDTH;
  return widths?.linkStrokeWidth ?? DEFAULT_LINK_STROKE_WIDTH;
}
function connectorMarkerKind(arrowhead) {
  return resolveArrowhead(arrowhead)?.canonicalKind ?? "arrow";
}
function connectorMarkerRef(edge, ids) {
  if (edge.markers !== void 0 || edge.directed === true)
    return void 0;
  const kind = connectorMarkerKind(edge.arrowhead);
  if (kind === "none")
    return void 0;
  const emphasized = edge.emphasis === "emphasis";
  return `url(#${emphasized ? ids.filledEmphasis : ids.filled})`;
}
function extraConnectorMarkers(edges, ids) {
  let needFilledEmphasis = false;
  for (const edge of edges) {
    if (edge.markers !== void 0 || edge.directed === true)
      continue;
    const kind = connectorMarkerKind(edge.arrowhead);
    if (kind === "none")
      continue;
    if (edge.emphasis === "emphasis") {
      needFilledEmphasis = true;
    }
  }
  const specs = [];
  if (needFilledEmphasis) {
    specs.push({
      id: ids.filledEmphasis,
      kind: "arrow",
      emphasis: "emphasis",
      ...ARROWHEAD_MARKER_GEOMETRY.arrow,
      fill: LINK_EMPHASIS_STROKE
    });
  }
  return specs;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/flows.js
var DEFAULT_FLOW_TOKENS = Object.freeze({ flowBadgeSize: 28, flowBadgePaddingX: 6, flowArrowLength: 10, flowArrowWidth: 10, flowTargetMinSize: 24, flowFanOutMax: 4, flowArrowPath: "M0 0L10 5L0 10Z" });
var cmp2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function planFlows(document, view, registry, options, forced) {
  const index = flowIndex(document), targets = {}, suppressed = /* @__PURE__ */ new Set();
  const ranks = /* @__PURE__ */ new Map(), members = [], groups = /* @__PURE__ */ new Map();
  const ordered = index.scenarios.flatMap((s) => s.steps);
  const rank = new Map(ordered.map((s, i) => [s.relation, i]));
  const visible = evaluateVisibility({ document, view }).visible;
  const collapsed = new Set(options.collapsed ?? Object.values(view.groups).filter((g) => g.collapsed).map((g) => g.occurrence));
  const boxOf = (id) => representativeOf(view, collapsed, view.portOccurrences[id]?.ownerOccurrence ?? id);
  for (const occurrence of Object.values(view.relationOccurrences).sort((a, b) => (rank.get(a.relation) ?? Infinity) - (rank.get(b.relation) ?? Infinity) || cmp2(a.id, b.id))) {
    const step = index.byRelation[occurrence.relation];
    if (step === void 0)
      continue;
    suppressed.add(occurrence.id);
    if (!relationVerdict(view, document.relations[occurrence.relation], document).visible)
      continue;
    const sourceEnd = occurrence.endpoints.find((e) => e.role === "source"), targetEnd = occurrence.endpoints.find((e) => e.role === "target");
    if (sourceEnd === void 0 || targetEnd === void 0)
      continue;
    const source = boxOf(sourceEnd.occurrence), target = boxOf(targetEnd.occurrence);
    if (!visible.has(source) || !visible.has(target))
      continue;
    if (source === target || step.self) {
      suppressed.add(occurrence.id);
      targets[step.relation] = { kind: "internal", box: source };
      continue;
    }
    const key = "flow:" + [source, target].sort().join("|") + "|" + (occurrence.strokeStyle ?? "solid");
    const member = { occurrence: occurrence.id, step, source, target, retargeted: occurrence.endpoints.some((e) => e.semanticTarget !== void 0), key, rank: rank.get(step.relation) };
    suppressed.delete(occurrence.id);
    members.push(member);
    ranks.set(occurrence.id, member.rank);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(member);
    targets[step.relation] = { kind: "edge", occurrence: occurrence.id, badge: false };
  }
  const bundles = [];
  const summaries = members.length === 0 ? /* @__PURE__ */ new Map() : resolveSummaries(view, document, { registry });
  const cap = options.flows?.fanOutMax ?? options.flowTokens?.flowFanOutMax ?? DEFAULT_FLOW_TOKENS.flowFanOutMax;
  for (const [key, group] of groups) {
    const reason = group.length >= 2 && group.some((m) => m.retargeted) ? "fold" : group.length > cap ? "fan-out" : group.length >= 2 && forced.has(key) ? "obstructed" : void 0;
    if (reason === void 0)
      continue;
    const carrier = group[0];
    const entries = group.map((m) => ({ occurrence: m.occurrence, relation: m.step.relation, direction: m.source === carrier.source ? "forward" : "backward", source: m.step.source, target: m.step.target }));
    const bundle = {
      id: key,
      reason,
      carrier: carrier.occurrence,
      members: entries,
      forward: entries.filter((m) => m.direction === "forward").length,
      backward: entries.filter((m) => m.direction === "backward").length,
      summaries: [...summaries].filter(([, s]) => s.members.some((m) => group.some((g) => g.occurrence === m))).map(([, summary]) => summary.definitionId).sort(cmp2)
    };
    bundles.push(bundle);
    for (const m of group) {
      if (m !== carrier)
        suppressed.add(m.occurrence);
      targets[m.step.relation] = { kind: "bundle", id: key, occurrence: carrier.occurrence, badge: false };
    }
  }
  return { index, members, groups, bundles, suppressed, targets, ranks };
}
function arrowAt(route, start, tokens) {
  const points = start ? [...route].reverse() : route;
  const tip = points.at(-1);
  if (tip === void 0)
    return void 0;
  const previous = [...points].reverse().find((p) => p.x !== tip.x || p.y !== tip.y);
  if (previous === void 0)
    return void 0;
  const angle = previous.y === tip.y ? previous.x < tip.x ? 0 : 180 : previous.y < tip.y ? 90 : 270;
  const length = tokens.flowArrowLength, width = tokens.flowArrowWidth;
  const box = angle === 0 ? { x: tip.x - length, y: tip.y - width / 2, width: length, height: width } : angle === 180 ? { x: tip.x, y: tip.y - width / 2, width: length, height: width } : angle === 90 ? { x: tip.x - width / 2, y: tip.y - length, width, height: length } : { x: tip.x - width / 2, y: tip.y, width, height: length };
  return { tip, angle, box };
}
function placeFlowMarks(input) {
  const { plan } = input, tokens = { ...DEFAULT_FLOW_TOKENS, ...input.options.flowTokens };
  const arrows = {}, badges = {}, targets = { ...plan.targets };
  const warnings = [], taken = [];
  for (const m of plan.members) {
    if (plan.suppressed.has(m.occurrence))
      continue;
    const route = input.routes.get(m.occurrence);
    if (route === void 0)
      continue;
    const bundle = plan.bundles.find((b) => b.carrier === m.occurrence);
    const atEnd = arrowAt(route, false, tokens), atStart = bundle !== void 0 && bundle.backward > 0 ? arrowAt(route, true, tokens) : void 0;
    arrows[m.occurrence] = [atEnd, atStart].filter((a) => a !== void 0);
    taken.push(...arrows[m.occurrence].map((a) => a.box));
  }
  for (const m of plan.members) {
    if (plan.suppressed.has(m.occurrence))
      continue;
    const route = input.routes.get(m.occurrence);
    if (route === void 0)
      continue;
    const bundle = plan.bundles.find((b) => b.carrier === m.occurrence);
    const text3 = bundle === void 0 ? m.step.badge : (input.options.flows?.countTemplate ?? "{n}").replaceAll("{n}", String(bundle.members.length));
    const measured = input.measure({ text: text3, role: "flow-badge", availableWidth: Number.MAX_SAFE_INTEGER, allocatedLines: 1, folded: false });
    const size = { width: Math.max(tokens.flowBadgeSize, measured.width + 2 * tokens.flowBadgePaddingX), height: tokens.flowBadgeSize };
    const within = input.within.get(m.occurrence);
    const entry = { id: m.occurrence, route, size, segmentOrder: "route-order", ...within === void 0 ? {} : { within }, ...input.limit === void 0 ? {} : { limit: input.limit } };
    const placement = placePackedLabel(entry, input.shapes, taken, input.margin);
    if (placement !== void 0) {
      badges[m.occurrence] = placement.box;
      taken.push(placement.box);
    } else
      warnings.push({ code: "badge-unplaced", refs: [m.occurrence], message: "no segment holds the flow badge" });
    for (const member of bundle?.members ?? [{ relation: m.step.relation }]) {
      const target = targets[member.relation];
      if (target !== void 0 && target.kind !== "internal")
        targets[member.relation] = { ...target, badge: placement !== void 0 };
    }
  }
  for (const b of plan.bundles)
    warnings.push({ code: "flow-bundled", refs: b.members.map((m) => m.occurrence), message: b.reason });
  return { arrows, badges, targets, warnings, taken };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/flowModel.js
var INITIAL_FLOW_STATE = Object.freeze({ selection: null, hover: null, focus: null, muted: false });
var DEFAULT_FLOW_STRINGS = Object.freeze({ step: "Step", scenario: "Scenario", count: "{n}", node: "Component", "navigator": "Flow navigation", previous: "Previous step", next: "Next step", allScenarios: "All scenarios" });

// node_modules/@sentropic/diagram-canvas/dist/r7Mode.js
function diagramAnatomyOf(presentation, view, occurrence) {
  const entry = presentation.entities?.[occurrence];
  return entry?.anatomy ?? view?.presentation?.entityAnatomy?.[occurrence] ?? view?.presentation?.anatomy ?? "v1";
}
function isR7ConnectorPresentation(presentation, view, document) {
  if (document?.profileRefs?.length === 1 && document.profileRefs[0] === "erd@1")
    return false;
  if (document?.profileRefs?.length === 1 && document.profileRefs[0] === "process@1")
    return true;
  const hasFilters = (view?.filters?.length ?? 0) > 0;
  const occurrences = view == null ? [] : Object.values(view.relationOccurrences ?? {}).filter((occ) => {
    if (occ == null)
      return false;
    if (!hasFilters)
      return true;
    const relation = document?.relations?.[occ.relation];
    if (relation !== void 0 && !relationVerdict(view, relation, document).visible)
      return false;
    if (document?.entities != null && view.entityOccurrences != null) {
      for (const endpoint of occ.endpoints ?? []) {
        const ownerOccId = view.portOccurrences?.[endpoint.occurrence]?.ownerOccurrence ?? endpoint.occurrence;
        const entityId = view.entityOccurrences[ownerOccId]?.entity;
        const entity = entityId === void 0 ? void 0 : document.entities[entityId];
        if (entity !== void 0 && !entityVerdict(view, entity).visible)
          return false;
      }
    }
    return true;
  });
  if (document != null) {
    const relations = view == null ? Object.values(document.relations ?? {}) : occurrences.map((occ) => document.relations?.[occ.relation]);
    const types = relations.flatMap((relation) => relation == null ? [] : [relation.type]);
    if (types.includes("flow-step") && types.every((type) => type === "flow-step" || type === "contains"))
      return false;
  }
  const effectivePresentation = presentation ?? view?.presentation?.diagram;
  if (effectivePresentation != null) {
    const entities = view?.entityOccurrences ?? effectivePresentation.entities;
    if (Object.keys(entities ?? {}).some((id) => diagramAnatomyOf(effectivePresentation, view, id) === "v2"))
      return true;
  }
  if (view?.presentation?.anatomy === "v2" && effectivePresentation == null)
    return true;
  const styles = presentation?.relations;
  if (view == null && Object.keys(styles ?? {}).length > 0)
    return true;
  const authoredPin = view?.presentation?.diagram?.contractPin;
  const suppliedPin = presentation?.contractPin;
  const unpinnedDashes = authoredPin === void 0 && (suppliedPin === void 0 || isPresentationContractV2Pin(suppliedPin));
  return occurrences.some((occ) => styles?.[occ.id] != null || styles?.[occ.relation] != null || occ.strokeStyle === "dotted" || occ.strokeStyle === "dashed" && unpinnedDashes || occ.arrowhead !== void 0 || occ.emphasis !== void 0);
}

// node_modules/@sentropic/diagram-canvas/dist/layout/conventions.js
var ARROW_DIRECTION_CONVENTION = "source-is-initiator";
var DEFAULT_ZONE_TAG_ACRONYM_ALLOWLIST = [
  "H2A",
  "SENTROPIC",
  "ENGRAM",
  "DESIGN SYSTEM",
  "SENTROPIC & 3RD PARTIES",
  "SENTROPIC & TIERS"
];
function normalizeTag(value) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
function buildAllowlist(extra) {
  const set = /* @__PURE__ */ new Set();
  for (const entry of DEFAULT_ZONE_TAG_ACRONYM_ALLOWLIST)
    set.add(normalizeTag(entry));
  if (extra !== void 0) {
    for (const entry of extra)
      set.add(normalizeTag(entry));
  }
  return set;
}
var BARE_ACRONYM_PART = /^(?:(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,5}|[A-Z]{1,5}\d+[A-Z0-9]*)$/;
function isBareAcronymToken(token) {
  if (token.length === 0)
    return false;
  if (/[a-z\u00e0-\u00ff]/.test(token))
    return false;
  if (!/[A-Z]/.test(token))
    return false;
  const parts = token.split(/[/-]+/).filter((part) => part.length > 0);
  if (parts.length === 0)
    return false;
  return parts.every((part) => BARE_ACRONYM_PART.test(part) || /^\d+$/.test(part));
}
function isOpaqueAcronymZoneTag(tag, allowlist) {
  const trimmed = tag.trim();
  if (trimmed.length === 0)
    return false;
  if (buildAllowlist(allowlist).has(normalizeTag(trimmed)))
    return false;
  const tokens = trimmed.split(/(?:\s+[—–-]\s+|\s*[·—–:|(),]+\s*|\s+)/).map((token) => token.trim()).filter((token) => token.length > 0 && token !== "&");
  if (tokens.length === 0)
    return false;
  return tokens.every(isBareAcronymToken);
}
function normalizeEndpointId(ref) {
  const trimmed = ref.trim();
  if (trimmed.startsWith("entity:"))
    return trimmed.slice("entity:".length);
  if (trimmed.startsWith("occurrence:e."))
    return trimmed.slice("occurrence:e.".length);
  if (trimmed.startsWith("occurrence:"))
    return trimmed.slice("occurrence:".length);
  return trimmed;
}
function matchesEndpoint(declared, candidates) {
  const trimmed = declared.trim();
  const normalized = normalizeEndpointId(trimmed);
  for (const candidate of candidates) {
    if (candidate === void 0)
      continue;
    if (candidate === trimmed || normalizeEndpointId(candidate) === normalized)
      return true;
  }
  return false;
}
function readInitiatorAttribute(relation) {
  if (relation === void 0)
    return void 0;
  const attr = relation.attributes["initiator"];
  if (attr !== void 0 && attr.kind === "text" && attr.value.trim().length > 0) {
    return attr.value.trim();
  }
  return void 0;
}
function lintArrowDirection(input) {
  const warnings = [];
  for (const edge of input.edges) {
    if (edge.arrowhead === "none")
      continue;
    const relation = edge.relationId !== void 0 ? input.document?.relations[edge.relationId] : void 0;
    const declared = edge.initiator ?? input.initiators?.[edge.id] ?? (edge.relationId !== void 0 ? input.initiators?.[edge.relationId] : void 0) ?? readInitiatorAttribute(relation);
    if (declared === void 0 || declared.trim().length === 0)
      continue;
    const sourceCandidates = [edge.sourceEntity, edge.sourceOccurrence, edge.semanticSourceEntity];
    const targetCandidates = [edge.targetEntity, edge.targetOccurrence, edge.semanticTargetEntity];
    if (matchesEndpoint(declared, sourceCandidates))
      continue;
    const inverted = matchesEndpoint(declared, targetCandidates);
    warnings.push({
      severity: "info",
      code: "arrow-direction-convention",
      refs: [edge.id],
      message: inverted ? `edge ${edge.id} points from ${edge.sourceEntity} to ${edge.targetEntity}, but ${declared} is declared as initiator (convention: source = initiator)` : `edge ${edge.id} declares initiator ${declared} which does not match source ${edge.sourceEntity} (convention: source = initiator)`,
      details: {
        convention: ARROW_DIRECTION_CONVENTION,
        reason: inverted ? "source-not-initiator" : "initiator-not-endpoint",
        source: edge.sourceEntity,
        target: edge.targetEntity,
        initiator: declared
      }
    });
  }
  return warnings;
}
function lintZoneTagAcronyms(input) {
  const warnings = [];
  for (const zone of input.zones) {
    if (zone.tag === void 0)
      continue;
    if (!isOpaqueAcronymZoneTag(zone.tag, input.allowlist))
      continue;
    warnings.push({
      severity: "info",
      code: "zone-tag-opaque-acronym",
      refs: [zone.id],
      message: `zone ${zone.id} uses opaque acronym tag "${zone.tag.trim()}" without a descriptive label`,
      details: {
        zone: zone.id,
        tag: zone.tag.trim()
      }
    });
  }
  return warnings;
}
function lintDiagramConventions(input) {
  const opts = input.options;
  if (opts === void 0)
    return [];
  const warnings = [];
  if (opts.arrowDirection === true && input.edges !== void 0) {
    warnings.push(...lintArrowDirection({
      ...input.document === void 0 ? {} : { document: input.document },
      edges: input.edges,
      ...opts.initiators === void 0 ? {} : { initiators: opts.initiators }
    }));
  }
  if (opts.zoneTagAcronyms === true && input.zones !== void 0) {
    warnings.push(...lintZoneTagAcronyms({
      zones: input.zones,
      ...opts.zoneTagAcronymAllowlist === void 0 ? {} : { allowlist: opts.zoneTagAcronymAllowlist }
    }));
  }
  return warnings;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/bundleLabel.js
function measureBundleLabel(relations, measure2, maxWidth = 320, relationCount = relations.length) {
  const line = (text3, width) => measure2({
    text: text3,
    role: "edge-label",
    availableWidth: width,
    allocatedLines: Number.MAX_SAFE_INTEGER,
    folded: false
  });
  const header = `${relationCount} liaisons`;
  const heading = line(header, maxWidth - 8);
  let top = heading.height + 8;
  const groups = relations.map((text3) => {
    const measured = line(text3, maxWidth - 24);
    const group = { lines: measured.lines, top, height: measured.height + 8 };
    top += group.height;
    return group;
  });
  const layout = { lines: [header, ...groups.flatMap((group) => group.lines)], width: maxWidth, height: top, overflow: false };
  return { header, groups, layout };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/spacing.generated.js
var DIAGRAM_SCENE_SPACING = {
  gapMin: 96,
  gapMinBlock: 72,
  gapBase: 64,
  gapBaseBlock: 8,
  trackSpacing: 14,
  trackSpacingBlock: 7,
  labelBand: 30,
  gapMax: 240,
  containerPadding: 16,
  zoneGutter: 96,
  routeSpacing: 24,
  routeBorderClearance: 15
};

// node_modules/@sentropic/diagram-canvas/dist/layout/channels.js
function channelMetrics(metrics, horizontal) {
  return {
    gapMin: (horizontal ? metrics.gapMin : metrics.gapMinBlock) ?? (horizontal ? DIAGRAM_SCENE_SPACING.gapMin : DIAGRAM_SCENE_SPACING.gapMinBlock),
    gapBase: (horizontal ? metrics.gapBase : metrics.gapBaseBlock) ?? (horizontal ? DIAGRAM_SCENE_SPACING.gapBase : DIAGRAM_SCENE_SPACING.gapBaseBlock),
    trackSpacing: (horizontal ? metrics.trackSpacing : metrics.trackSpacingBlock) ?? (horizontal ? DIAGRAM_SCENE_SPACING.trackSpacing : DIAGRAM_SCENE_SPACING.trackSpacingBlock),
    labelBand: metrics.labelBand ?? DIAGRAM_SCENE_SPACING.labelBand,
    gapMax: (horizontal ? metrics.gapInlineMax : metrics.gapBlockMax) ?? metrics.gapMax ?? DIAGRAM_SCENE_SPACING.gapMax
  };
}
function channelGap(n, labelled, metrics) {
  return n === 0 ? metrics.gapMin : Math.min(metrics.gapMax, Math.max(metrics.gapMin, metrics.gapBase + n * metrics.trackSpacing + (labelled ? metrics.labelBand : 0)));
}
function channelCapacity(gap, routeSpacing = DIAGRAM_SCENE_SPACING.routeSpacing, borderClearance = DIAGRAM_SCENE_SPACING.routeBorderClearance) {
  const usable = gap - 2 * borderClearance;
  if (usable < 0)
    return 0;
  if (!(routeSpacing > 0))
    return 1;
  return Math.floor(usable / routeSpacing) + 1;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/routeSpacing.js
var DEFAULT_ROUTE_SPACING = DIAGRAM_SCENE_SPACING.routeSpacing;
var DEFAULT_ROUTE_BORDER_CLEARANCE = DIAGRAM_SCENE_SPACING.routeBorderClearance;
var EPS = 1e-4;
function segmentsOf(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS)
      continue;
    if (Math.abs(a.y - b.y) <= EPS) {
      out.push({
        horizontal: true,
        coord: (a.y + b.y) / 2,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
        index: i,
        a,
        b
      });
    } else if (Math.abs(a.x - b.x) <= EPS) {
      out.push({
        horizontal: false,
        coord: (a.x + b.x) / 2,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
        index: i,
        a,
        b
      });
    }
  }
  return out;
}
function segmentToRectDistance(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const rRight = rect.x + rect.width;
  const rBottom = rect.y + rect.height;
  const dx = maxX < rect.x ? rect.x - maxX : minX > rRight ? minX - rRight : 0;
  const dy = maxY < rect.y ? rect.y - maxY : minY > rBottom ? minY - rBottom : 0;
  return Math.hypot(dx, dy);
}
function segmentToPassableBorderDistance(a, b, rect) {
  const rRight = rect.x + rect.width;
  const rBottom = rect.y + rect.height;
  if (Math.abs(a.y - b.y) <= EPS && Math.abs(a.x - b.x) > EPS) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    const y = (a.y + b.y) / 2;
    const dx = hi < rect.x ? rect.x - hi : lo > rRight ? lo - rRight : 0;
    return Math.min(Math.hypot(dx, Math.abs(y - rect.y)), Math.hypot(dx, Math.abs(y - rBottom)));
  }
  if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) > EPS) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    const x = (a.x + b.x) / 2;
    const dy = hi < rect.y ? rect.y - hi : lo > rBottom ? lo - rBottom : 0;
    return Math.min(Math.hypot(Math.abs(x - rect.x), dy), Math.hypot(Math.abs(x - rRight), dy));
  }
  return Number.POSITIVE_INFINITY;
}
function samePoint(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y) <= EPS;
}
function sharedPortStub(left, leftSegIndex, leftLastIndex, right, rightSegIndex, rightLastIndex) {
  if (leftSegIndex === 0 && rightSegIndex === 0 && left.source === right.source && left.sourcePort !== void 0 && left.sourcePort === right.sourcePort && samePoint(left.points[0], right.points[0])) {
    return true;
  }
  if (leftSegIndex === leftLastIndex && rightSegIndex === rightLastIndex && left.target === right.target && left.targetPort !== void 0 && left.targetPort === right.targetPort && samePoint(left.points.at(-1), right.points.at(-1))) {
    return true;
  }
  if (leftSegIndex === 0 && rightSegIndex === rightLastIndex && left.source === right.target && left.sourcePort !== void 0 && left.sourcePort === right.targetPort && samePoint(left.points[0], right.points.at(-1))) {
    return true;
  }
  if (leftSegIndex === leftLastIndex && rightSegIndex === 0 && left.target === right.source && left.targetPort !== void 0 && left.targetPort === right.sourcePort && samePoint(left.points.at(-1), right.points[0])) {
    return true;
  }
  return false;
}
function checkRouteSpacing(input) {
  const routeSpacing = input.routeSpacing ?? DEFAULT_ROUTE_SPACING;
  const borderClearance = input.borderClearance ?? DEFAULT_ROUTE_BORDER_CLEARANCE;
  const conflicts = [];
  const parsed = input.routes.map((route) => ({
    route,
    segments: segmentsOf(route.points),
    elbows: route.points.length > 2 ? route.points.slice(1, -1) : []
  }));
  for (let i = 0; i < parsed.length; i += 1) {
    const left = parsed[i];
    const leftLast = Math.max(0, left.route.points.length - 2);
    for (let s1 = 0; s1 < left.segments.length; s1 += 1) {
      const segA = left.segments[s1];
      for (let s2 = s1 + 2; s2 < left.segments.length; s2 += 1) {
        const segB = left.segments[s2];
        if (segA.horizontal !== segB.horizontal)
          continue;
        const overlap = Math.min(segA.hi, segB.hi) - Math.max(segA.lo, segB.lo);
        if (overlap <= EPS)
          continue;
        const sep = Math.abs(segA.coord - segB.coord);
        if (sep <= EPS) {
          conflicts.push({
            kind: "segment-overlap",
            routes: [left.route.id],
            actual: 0,
            required: routeSpacing,
            message: `route ${left.route.id} folds back onto itself with overlapping segments`
          });
        } else if (sep < routeSpacing - EPS) {
          conflicts.push({
            kind: "parallel-segment-spacing",
            routes: [left.route.id],
            actual: Math.round(sep * 1e3) / 1e3,
            required: routeSpacing,
            message: `parallel segments of ${left.route.id} are ${sep.toFixed(1)} apart (< ${routeSpacing})`
          });
        }
      }
    }
    for (let j = i + 1; j < parsed.length; j += 1) {
      const right = parsed[j];
      const sameComb = left.route.combGroupId !== void 0 && left.route.combGroupId === right.route.combGroupId;
      const rightLast = Math.max(0, right.route.points.length - 2);
      let reportedOverlap = false;
      let minParallelGap = Number.POSITIVE_INFINITY;
      for (const segA of left.segments) {
        for (const segB of right.segments) {
          if (segA.horizontal !== segB.horizontal)
            continue;
          const overlap = Math.min(segA.hi, segB.hi) - Math.max(segA.lo, segB.lo);
          if (overlap <= EPS)
            continue;
          const sep = Math.abs(segA.coord - segB.coord);
          if (sameComb && sep <= EPS)
            continue;
          if (overlap <= routeSpacing + borderClearance + EPS && (leftLast > 0 || rightLast > 0) && sharedPortStub(left.route, segA.index, leftLast, right.route, segB.index, rightLast))
            continue;
          if (sep <= EPS) {
            reportedOverlap = true;
          } else if (sep < routeSpacing - EPS && sep < minParallelGap) {
            minParallelGap = sep;
          }
        }
      }
      if (reportedOverlap) {
        conflicts.push({
          kind: "segment-overlap",
          routes: [left.route.id, right.route.id],
          actual: 0,
          required: routeSpacing,
          message: `routes ${left.route.id} and ${right.route.id} share an overlapping segment`
        });
      } else if (minParallelGap < routeSpacing - EPS) {
        conflicts.push({
          kind: "parallel-segment-spacing",
          routes: [left.route.id, right.route.id],
          actual: Math.round(minParallelGap * 1e3) / 1e3,
          required: routeSpacing,
          message: `parallel segments of ${left.route.id} and ${right.route.id} are ${minParallelGap.toFixed(1)} apart (< ${routeSpacing})`
        });
      }
      let minElbowDist = Number.POSITIVE_INFINITY;
      for (const e1 of left.elbows) {
        for (const e2 of right.elbows) {
          const dist = Math.hypot(e1.x - e2.x, e1.y - e2.y);
          if (sameComb && dist <= EPS)
            continue;
          if (dist < minElbowDist)
            minElbowDist = dist;
        }
      }
      if (minElbowDist < routeSpacing - EPS) {
        conflicts.push({
          kind: "elbow-spacing",
          routes: [left.route.id, right.route.id],
          actual: Math.round(minElbowDist * 1e3) / 1e3,
          required: routeSpacing,
          message: `neighbouring elbows of ${left.route.id} and ${right.route.id} are ${minElbowDist.toFixed(1)} apart (< ${routeSpacing})`
        });
      }
    }
  }
  const docksByEntity = /* @__PURE__ */ new Map();
  const arrowheads = [];
  for (const { route } of parsed) {
    if (route.points.length < 2)
      continue;
    const start = route.points[0];
    const end = route.points[route.points.length - 1];
    const hasStartArrow = route.startArrowhead === true;
    const hasEndArrow = route.arrowhead !== "none";
    const pushDock = (entry) => {
      const list = docksByEntity.get(entry.entity) ?? [];
      list.push(entry);
      docksByEntity.set(entry.entity, list);
    };
    const startEntry = {
      routeId: route.id,
      entity: route.source,
      point: start,
      port: route.sourcePort,
      isArrowhead: hasStartArrow,
      combGroupId: route.combGroupId
    };
    const endEntry = {
      routeId: route.id,
      entity: route.target,
      point: end,
      port: route.targetPort,
      isArrowhead: hasEndArrow,
      combGroupId: route.combGroupId
    };
    pushDock(startEntry);
    pushDock(endEntry);
    if (hasStartArrow)
      arrowheads.push(startEntry);
    if (hasEndArrow)
      arrowheads.push(endEntry);
  }
  for (const [entity, docks] of docksByEntity) {
    for (let i = 0; i < docks.length; i += 1) {
      const a = docks[i];
      for (let j = i + 1; j < docks.length; j += 1) {
        const b = docks[j];
        if (a.port !== void 0 && a.port === b.port && samePoint(a.point, b.point))
          continue;
        if (a.combGroupId !== void 0 && a.combGroupId === b.combGroupId && samePoint(a.point, b.point))
          continue;
        if (a.isArrowhead && b.isArrowhead)
          continue;
        const dist = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
        if (dist < routeSpacing - EPS) {
          conflicts.push({
            kind: "port-spacing",
            routes: a.routeId === b.routeId ? [a.routeId] : [a.routeId, b.routeId],
            entity,
            actual: Math.round(dist * 1e3) / 1e3,
            required: routeSpacing,
            message: `ports on ${entity} for ${a.routeId} and ${b.routeId} are ${dist.toFixed(1)} apart (< ${routeSpacing})`
          });
        }
      }
    }
  }
  for (let i = 0; i < arrowheads.length; i += 1) {
    const a = arrowheads[i];
    for (let j = i + 1; j < arrowheads.length; j += 1) {
      const b = arrowheads[j];
      if (a.entity === b.entity && a.port !== void 0 && a.port === b.port && samePoint(a.point, b.point))
        continue;
      const dist = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
      if (dist < routeSpacing - EPS) {
        conflicts.push({
          kind: "arrowhead-spacing",
          routes: a.routeId === b.routeId ? [a.routeId] : [a.routeId, b.routeId],
          ...a.entity === b.entity ? { entity: a.entity } : {},
          actual: Math.round(dist * 1e3) / 1e3,
          required: routeSpacing,
          message: `arrowheads of ${a.routeId} and ${b.routeId} are ${dist.toFixed(1)} apart (< ${routeSpacing})`
        });
      }
    }
  }
  for (const { route, segments } of parsed) {
    const lastIdx = Math.max(0, route.points.length - 2);
    for (const [entity, rect] of input.rects) {
      const isPassable = route.passable?.has(entity) === true;
      let minDist = Number.POSITIVE_INFINITY;
      for (const seg of segments) {
        if (entity === route.source && seg.index === 0)
          continue;
        if (entity === route.target && seg.index === lastIdx)
          continue;
        const dist = isPassable ? segmentToPassableBorderDistance(seg.a, seg.b, rect) : segmentToRectDistance(seg.a, seg.b, rect);
        if (dist < minDist)
          minDist = dist;
      }
      if (minDist < borderClearance - EPS) {
        conflicts.push({
          kind: "link-to-border",
          routes: [route.id],
          entity,
          actual: Math.round(minDist * 1e3) / 1e3,
          required: borderClearance,
          message: `route ${route.id} clears ${entity} by ${minDist.toFixed(1)} (< ${borderClearance})`
        });
      }
    }
    for (let bIdx = 0; bIdx < (input.barriers?.length ?? 0); bIdx += 1) {
      const rawBarrier = input.barriers[bIdx];
      const barrier = "rect" in rawBarrier ? rawBarrier.rect : rawBarrier;
      const barrierEntity = "rect" in rawBarrier ? rawBarrier.entity : void 0;
      let minDist = Number.POSITIVE_INFINITY;
      for (const seg of segments) {
        if (barrierEntity !== void 0) {
          if (barrierEntity === route.source && seg.index === 0)
            continue;
          if (barrierEntity === route.target && seg.index === lastIdx)
            continue;
        }
        const dist = segmentToRectDistance(seg.a, seg.b, barrier);
        if (dist < minDist)
          minDist = dist;
      }
      if (minDist < borderClearance - EPS) {
        conflicts.push({
          kind: "link-to-border",
          routes: [route.id],
          entity: barrierEntity ?? `barrier:${String(bIdx)}`,
          actual: Math.round(minDist * 1e3) / 1e3,
          required: borderClearance,
          message: `route ${route.id} clears title barrier ${bIdx} by ${minDist.toFixed(1)} (< ${borderClearance})`
        });
      }
    }
  }
  const channelSummary = {};
  const rectList = [...input.rects.values()];
  for (const channel of input.channels ?? []) {
    const cap = channelCapacity(channel.gap, routeSpacing, borderClearance);
    const wantHorizontal = channel.axis === "vertical";
    const events = [];
    const longitudinalRoutes = /* @__PURE__ */ new Set();
    const boundedSpansOf = (strip) => {
      const crossLo = wantHorizontal ? strip.y : strip.x;
      const crossHi = wantHorizontal ? strip.y + strip.height : strip.x + strip.width;
      const stripLo = wantHorizontal ? strip.x : strip.y;
      const stripHi = wantHorizontal ? strip.x + strip.width : strip.y + strip.height;
      const sideA = [];
      const sideB = [];
      for (const r of rectList) {
        const rCrossLo = wantHorizontal ? r.y : r.x;
        const rCrossHi = wantHorizontal ? r.y + r.height : r.x + r.width;
        const rLongLo = wantHorizontal ? r.x : r.y;
        const rLongHi = wantHorizontal ? r.x + r.width : r.y + r.height;
        const lo = Math.max(stripLo, rLongLo);
        const hi = Math.min(stripHi, rLongHi);
        if (hi - lo <= EPS)
          continue;
        if (Math.abs(rCrossHi - crossLo) <= 1)
          sideA.push([lo, hi]);
        if (Math.abs(rCrossLo - crossHi) <= 1)
          sideB.push([lo, hi]);
      }
      if (sideA.length === 0 || sideB.length === 0)
        return [[stripLo, stripHi]];
      const raw = [];
      for (const [a0, a1] of sideA) {
        for (const [b0, b1] of sideB) {
          const lo = Math.max(a0, b0);
          const hi = Math.min(a1, b1);
          if (hi - lo > EPS)
            raw.push([lo, hi]);
        }
      }
      if (raw.length === 0)
        return [[stripLo, stripHi]];
      raw.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
      const merged = [raw[0]];
      for (let k = 1; k < raw.length; k += 1) {
        const prev = merged[merged.length - 1];
        const curr = raw[k];
        if (curr[0] <= prev[1] + EPS)
          prev[1] = Math.max(prev[1], curr[1]);
        else
          merged.push([curr[0], curr[1]]);
      }
      return merged;
    };
    const combTrackIntervals = /* @__PURE__ */ new Map();
    for (const strip of channel.strips) {
      const spans = boundedSpansOf(strip);
      for (const { route, segments } of parsed) {
        for (const seg of segments) {
          if (seg.horizontal !== wantHorizontal)
            continue;
          const insideCross = wantHorizontal ? seg.coord >= strip.y - EPS && seg.coord <= strip.y + strip.height + EPS : seg.coord >= strip.x - EPS && seg.coord <= strip.x + strip.width + EPS;
          if (!insideCross)
            continue;
          for (const [spanLo, spanHi] of spans) {
            const lo = Math.max(seg.lo, spanLo);
            const hi = Math.min(seg.hi, spanHi);
            if (hi - lo <= EPS)
              continue;
            longitudinalRoutes.add(route.id);
            if (route.combGroupId !== void 0) {
              const trackKey = `${route.combGroupId}|${String(Math.round(seg.coord * 100) / 100)}`;
              const list = combTrackIntervals.get(trackKey) ?? [];
              list.push([lo, hi]);
              combTrackIntervals.set(trackKey, list);
            } else {
              events.push({ pos: lo, delta: 1, routeId: route.id });
              events.push({ pos: hi, delta: -1, routeId: route.id });
            }
          }
        }
      }
    }
    for (const [trackKey, rawIntervals] of combTrackIntervals) {
      rawIntervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const merged = [rawIntervals[0]];
      for (let k = 1; k < rawIntervals.length; k += 1) {
        const prev = merged[merged.length - 1];
        const curr = rawIntervals[k];
        if (curr[0] <= prev[1] + EPS)
          prev[1] = Math.max(prev[1], curr[1]);
        else
          merged.push([curr[0], curr[1]]);
      }
      for (const [lo, hi] of merged) {
        events.push({ pos: lo, delta: 1, routeId: trackKey });
        events.push({ pos: hi, delta: -1, routeId: trackKey });
      }
    }
    events.sort((a, b) => a.pos - b.pos || a.delta - b.delta);
    let active = 0;
    let peak = 0;
    for (const event of events) {
      active += event.delta;
      if (active > peak)
        peak = active;
    }
    channelSummary[channel.id] = { capacity: cap, demand: peak, gap: channel.gap };
    if (peak > cap) {
      conflicts.push({
        kind: "channel-capacity-exceeded",
        routes: [...longitudinalRoutes].sort(),
        channelId: channel.id,
        actual: peak,
        required: cap,
        message: `channel ${channel.id} (gap ${channel.gap}) carries ${peak} parallel tracks, exceeding capacity ${cap}`
      });
    }
  }
  return {
    conflictCount: conflicts.length,
    conflicts,
    routeSpacing,
    borderClearance,
    channelCapacity: channelSummary
  };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/pack.js
var PACK_FILL_TOLERANCE = 0.5;
var PACK_SCORE_EPSILON = 1e-9;
function fillShelves(along, across, limit, gapAlong, gapAcross) {
  const shelves = [];
  const lengths = [];
  const thicknesses = [];
  let current = [];
  let length = 0;
  let thickness = 0;
  for (let index = 0; index < along.length; index += 1) {
    const size = along[index];
    const next = current.length === 0 ? size : length + gapAlong + size;
    if (current.length > 0 && next > limit + PACK_FILL_TOLERANCE) {
      shelves.push(current);
      lengths.push(length);
      thicknesses.push(thickness);
      current = [index];
      length = size;
      thickness = across[index];
    } else {
      current.push(index);
      length = next;
      thickness = Math.max(thickness, across[index]);
    }
  }
  if (current.length > 0) {
    shelves.push(current);
    lengths.push(length);
    thicknesses.push(thickness);
  }
  const main = Math.max(0, ...lengths);
  let cross = 0;
  let slack = 0;
  thicknesses.forEach((value, index) => {
    cross += value + (index > 0 ? gapAcross : 0);
    slack += (main - lengths[index]) * value;
  });
  return { shelves, main, cross, slack };
}
function packScore(width, height, slack, options) {
  const outerWidth = width + options.chromeWidth;
  const outerHeight = height + options.chromeHeight;
  if (outerWidth <= 0 || outerHeight <= 0)
    return 0;
  const ratio = outerWidth / outerHeight / options.targetAspect;
  const distance = Math.abs(Math.log(ratio));
  const biased = ratio < 1 ? distance * options.tallBias : distance;
  const area = width * height;
  return biased + (area > 0 ? options.emptyPenaltyWeight * (slack / area) : 0);
}
function pack(boxes, options, orientation) {
  const count = boxes.length;
  if (count === 0)
    return { width: 0, height: 0, rows: [], positions: [], score: 0 };
  const rows = orientation === "rows";
  const along = boxes.map((box) => rows ? box.width : box.height);
  const across = boxes.map((box) => rows ? box.height : box.width);
  const gapAlong = rows ? options.gapX : options.gapY;
  const gapAcross = rows ? options.gapY : options.gapX;
  let best;
  let fallback;
  const seen = /* @__PURE__ */ new Set();
  let prefix = 0;
  for (let index = 0; index < count; index += 1) {
    prefix += along[index] + (index > 0 ? gapAlong : 0);
    const shelves = fillShelves(along, across, prefix, gapAlong, gapAcross);
    const key = shelves.shelves.map((shelf) => shelf.length).join(",");
    if (seen.has(key))
      continue;
    seen.add(key);
    if (count >= 2 && (rows ? shelves.shelves.length === count : shelves.shelves.length === 1)) {
      fallback ??= shelves;
      continue;
    }
    const width = rows ? shelves.main : shelves.cross;
    const height = rows ? shelves.cross : shelves.main;
    const score = count === 1 ? 0 : packScore(width, height, shelves.slack, options);
    if (best === void 0 || score < best.score - PACK_SCORE_EPSILON || Math.abs(score - best.score) <= PACK_SCORE_EPSILON && width > best.width) {
      best = { shelves, score, width };
    }
  }
  if (best === void 0) {
    const shelves = fallback;
    const width = rows ? shelves.main : shelves.cross;
    const height = rows ? shelves.cross : shelves.main;
    best = { shelves, score: packScore(width, height, shelves.slack, options), width };
  }
  const chosen = best.shelves;
  const positions = new Array(count);
  let crossCursor = 0;
  chosen.shelves.forEach((shelf, shelfIndex) => {
    let alongCursor = 0;
    let thickness = 0;
    shelf.forEach((boxIndex, slot) => {
      positions[boxIndex] = rows ? { x: alongCursor, y: crossCursor, row: shelfIndex, col: slot } : { x: crossCursor, y: alongCursor, row: shelfIndex, col: slot };
      alongCursor += along[boxIndex] + gapAlong;
      thickness = Math.max(thickness, across[boxIndex]);
    });
    crossCursor += thickness + gapAcross;
  });
  return {
    width: rows ? chosen.main : chosen.cross,
    height: rows ? chosen.cross : chosen.main,
    rows: chosen.shelves,
    positions,
    score: best.score
  };
}
function packRows(boxes, options) {
  return pack(boxes, options, "rows");
}
function packColumns(boxes, options) {
  return pack(boxes, options, "columns");
}
function seatShelves(boxes, shelves, orientation, alongGap, acrossGap) {
  const rows = orientation === "rows";
  const positions = new Array(boxes.length);
  let crossCursor = 0;
  let main = 0;
  let cross = 0;
  shelves.forEach((shelf, shelfIndex) => {
    let alongCursor = 0;
    let thickness = 0;
    shelf.forEach((boxIndex, slot) => {
      const box = boxes[boxIndex];
      positions[boxIndex] = rows ? { x: alongCursor, y: crossCursor } : { x: crossCursor, y: alongCursor };
      const length = rows ? box.width : box.height;
      main = Math.max(main, alongCursor + length);
      alongCursor += length + (slot + 1 < shelf.length ? alongGap(shelfIndex, slot) : 0);
      thickness = Math.max(thickness, rows ? box.height : box.width);
    });
    cross = crossCursor + thickness;
    crossCursor += thickness + (shelfIndex + 1 < shelves.length ? acrossGap(shelfIndex) : 0);
  });
  return { positions, width: rows ? main : cross, height: rows ? cross : main };
}
function chooseOrientation(boxes, options, hysteresis, previous) {
  const rows = packRows(boxes, options);
  if (boxes.length <= 1)
    return { orientation: "rows", result: rows, scoreRows: rows.score, scoreColumns: rows.score };
  const columns = packColumns(boxes, options);
  const gap = Math.abs(rows.score - columns.score);
  let orientation;
  if (previous !== void 0 && gap < hysteresis)
    orientation = previous;
  else if (gap <= PACK_SCORE_EPSILON)
    orientation = "rows";
  else
    orientation = rows.score < columns.score ? "rows" : "columns";
  return {
    orientation,
    result: orientation === "rows" ? rows : columns,
    scoreRows: rows.score,
    scoreColumns: columns.score
  };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/flow-order.js
function permuteFlowRuns(sequence, keyOf, rankOf, reverse = () => false) {
  const result = [...sequence], groups = /* @__PURE__ */ new Map();
  sequence.forEach((entry, i) => {
    const key = keyOf(entry);
    if (key !== void 0)
      (groups.get(key) ?? groups.set(key, []).get(key)).push(i);
  });
  for (const positions of groups.values()) {
    const entries = positions.map((i) => sequence[i]).sort((a, b) => rankOf(a) - rankOf(b));
    if (reverse(entries[0]))
      entries.reverse();
    positions.forEach((position, i) => {
      result[position] = entries[i];
    });
  }
  return result;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/route.js
function routesConflict(left, right) {
  return fullSharesSegment(left, right) || left.slice(1).some((point, i) => right.slice(1).some((other, j) => segmentsCrossTransversal(left[i], point, right[j], other)));
}
var SPACING_EPS = 1e-4;
function subdivideChannelTracks(low, high, routeSpacing) {
  const span = high - low;
  if (!(span >= 0) || !Number.isFinite(span))
    return [];
  const mid = (low + high) / 2;
  if (!(routeSpacing > 0) || !Number.isFinite(routeSpacing) || span < routeSpacing - SPACING_EPS) {
    return [mid];
  }
  const count = Math.min(16, Math.floor((span + SPACING_EPS) / routeSpacing) + 1);
  if (count <= 1)
    return [mid];
  const tracks = [];
  for (let k = 0; k < count; k += 1) {
    tracks.push(mid + (k - (count - 1) / 2) * routeSpacing);
  }
  return tracks;
}
function labelDetour(input) {
  const { request, shapes, earlier } = input;
  const step = input.step ?? 2;
  const routeSpacing = input.routeSpacing ?? 0;
  const borderClearance = input.borderClearance ?? 0;
  const allFixed = input.allFixed ?? [];
  const passableZones = input.passableZones ?? [];
  const s = { x: request.start.x + step * request.startExit.x, y: request.start.y + step * request.startExit.y };
  const t = { x: request.end.x + step * request.endExit.x, y: request.end.y + step * request.endExit.y };
  const clear = (points) => {
    const within = request.within;
    if (within !== void 0 && points.some((p) => p.x < within.x || p.x > within.x + within.width || p.y < within.y || p.y > within.y + within.height))
      return false;
    const lastIdx = points.length - 1;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (shapes.some((r) => a.y === b.y ? a.y > r.y && a.y < r.y + r.height && Math.max(Math.min(a.x, b.x), r.x) < Math.min(Math.max(a.x, b.x), r.x + r.width) : a.x > r.x && a.x < r.x + r.width && Math.max(Math.min(a.y, b.y), r.y) < Math.min(Math.max(a.y, b.y), r.y + r.height)))
        return false;
      if (borderClearance > 0) {
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        const isFirst = i === 1;
        const isLast = i === lastIdx;
        for (const r of shapes) {
          if (isFirst && pointOnRectBorder(request.start, r))
            continue;
          if (isLast && pointOnRectBorder(request.end, r))
            continue;
          const dx = maxX < r.x ? r.x - maxX : minX > r.x + r.width ? minX - (r.x + r.width) : 0;
          const dy = maxY < r.y ? r.y - maxY : minY > r.y + r.height ? minY - (r.y + r.height) : 0;
          if (Math.hypot(dx, dy) < borderClearance - SPACING_EPS)
            return false;
        }
        for (const z of passableZones) {
          if (isFirst && pointOnRectBorder(request.start, z))
            continue;
          if (isLast && pointOnRectBorder(request.end, z))
            continue;
          if (Math.abs(a.y - b.y) <= SPACING_EPS && Math.abs(a.x - b.x) > SPACING_EPS) {
            const y = (a.y + b.y) / 2;
            const dx = maxX < z.x ? z.x - maxX : minX > z.x + z.width ? minX - (z.x + z.width) : 0;
            if (Math.hypot(dx, Math.abs(y - z.y)) < borderClearance - SPACING_EPS || Math.hypot(dx, Math.abs(y - (z.y + z.height))) < borderClearance - SPACING_EPS)
              return false;
          } else if (Math.abs(a.x - b.x) <= SPACING_EPS && Math.abs(a.y - b.y) > SPACING_EPS) {
            const x = (a.x + b.x) / 2;
            const dy = maxY < z.y ? z.y - maxY : minY > z.y + z.height ? minY - (z.y + z.height) : 0;
            if (Math.hypot(Math.abs(x - z.x), dy) < borderClearance - SPACING_EPS || Math.hypot(Math.abs(x - (z.x + z.width)), dy) < borderClearance - SPACING_EPS)
              return false;
          }
        }
      }
      if (sharesSamePair(a, b, earlier) || crossesSamePair(a, b, earlier))
        return false;
      if (routeSpacing > 0 && violatesParallelSpacing(a, b, allFixed, routeSpacing))
        return false;
      for (let j = 1; j < i - 1; j += 1) {
        const c = points[j - 1];
        const d = points[j];
        if (fullSharesSegment([a, b], [c, d]) || segmentsCrossTransversal(a, b, c, d))
          return false;
        if (routeSpacing > 0 && segmentsCloserThan(a, b, c, d, routeSpacing))
          return false;
      }
    }
    if (routeSpacing > 0 && points.length > 2) {
      for (let i = 1; i < points.length - 1; i += 1) {
        const elbow = points[i];
        for (const other of allFixed) {
          for (let k = 1; k < other.length - 1; k += 1) {
            if (Math.hypot(elbow.x - other[k].x, elbow.y - other[k].y) < routeSpacing - SPACING_EPS)
              return false;
          }
        }
      }
    }
    const first = points[1];
    const last = points[points.length - 2];
    return (first.x - request.start.x) * request.startExit.x + (first.y - request.start.y) * request.startExit.y > 0 && (last.x - request.end.x) * request.endExit.x + (last.y - request.end.y) * request.endExit.y > 0;
  };
  let best;
  let bestLength = Infinity;
  const tryRoute = (middle) => {
    const points = simplifyRoute([request.start, s, ...middle, t, request.end]);
    if (best !== void 0 && points.length > best.length)
      return;
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
    if (best !== void 0 && points.length === best.length && length >= bestLength)
      return;
    if (!clear(points) || !input.accepts(points))
      return;
    best = points;
    bestLength = length;
  };
  for (const y of input.ys) {
    tryRoute([{ x: s.x, y }, { x: t.x, y }]);
    for (const x of input.xs) {
      tryRoute([{ x, y: s.y }, { x, y }, { x: t.x, y }]);
      tryRoute([{ x: s.x, y }, { x, y }, { x, y: t.y }]);
    }
  }
  return best;
}
var OVERLAP_PENALTY = 2;
var DX = [1, 0, -1, 0];
var DY = [0, 1, 0, -1];
function pointOnRectBorder(point, rect) {
  const onX = (Math.abs(point.x - rect.x) <= SPACING_EPS || Math.abs(point.x - (rect.x + rect.width)) <= SPACING_EPS) && point.y >= rect.y - SPACING_EPS && point.y <= rect.y + rect.height + SPACING_EPS;
  const onY = (Math.abs(point.y - rect.y) <= SPACING_EPS || Math.abs(point.y - (rect.y + rect.height)) <= SPACING_EPS) && point.x >= rect.x - SPACING_EPS && point.x <= rect.x + rect.width + SPACING_EPS;
  return onX || onY;
}
function segmentsCloserThan(a1, a2, b1, b2, minSpacing) {
  if (Math.abs(a1.y - a2.y) <= SPACING_EPS && Math.abs(b1.y - b2.y) <= SPACING_EPS) {
    if (Math.abs(a1.y - b1.y) >= minSpacing - SPACING_EPS)
      return false;
    const overlap = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
    return overlap > SPACING_EPS;
  }
  if (Math.abs(a1.x - a2.x) <= SPACING_EPS && Math.abs(b1.x - b2.x) <= SPACING_EPS) {
    if (Math.abs(a1.x - b1.x) >= minSpacing - SPACING_EPS)
      return false;
    const overlap = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
    return overlap > SPACING_EPS;
  }
  return false;
}
function violatesParallelSpacing(a1, a2, routes, minSpacing) {
  if (Math.abs(a1.x - a2.x) <= SPACING_EPS && Math.abs(a1.y - a2.y) <= SPACING_EPS)
    return false;
  for (const route of routes) {
    for (let j = 1; j < route.length; j += 1) {
      if (segmentsCloserThan(a1, a2, route[j - 1], route[j], minSpacing))
        return true;
    }
  }
  return false;
}
function fullSharesSegment(left, right) {
  for (let i = 1; i < left.length; i += 1) {
    for (let j = 1; j < right.length; j += 1) {
      const a1 = left[i - 1];
      const a2 = left[i];
      const b1 = right[j - 1];
      const b2 = right[j];
      if (a1.y === a2.y && b1.y === b2.y && a1.y === b1.y) {
        const overlap = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
        if (overlap > 0)
          return true;
      }
      if (a1.x === a2.x && b1.x === b2.x && a1.x === b1.x) {
        const overlap = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
        if (overlap > 0)
          return true;
      }
    }
  }
  return false;
}
function segmentsCrossTransversal(a1, a2, b1, b2) {
  const aHoriz = a1.y === a2.y && a1.x !== a2.x;
  const aVert = a1.x === a2.x && a1.y !== a2.y;
  const bHoriz = b1.y === b2.y && b1.x !== b2.x;
  const bVert = b1.x === b2.x && b1.y !== b2.y;
  if (aHoriz && bVert) {
    const x = b1.x;
    const y = a1.y;
    return x > Math.min(a1.x, a2.x) && x < Math.max(a1.x, a2.x) && y > Math.min(b1.y, b2.y) && y < Math.max(b1.y, b2.y);
  }
  if (aVert && bHoriz) {
    const x = a1.x;
    const y = b1.y;
    return x > Math.min(b1.x, b2.x) && x < Math.max(b1.x, b2.x) && y > Math.min(a1.y, a2.y) && y < Math.max(a1.y, a2.y);
  }
  return false;
}
function crossesSamePair(a1, a2, earlier) {
  if (a1.x === a2.x && a1.y === a2.y)
    return false;
  for (const route of earlier) {
    for (let j = 1; j < route.length; j += 1) {
      if (segmentsCrossTransversal(a1, a2, route[j - 1], route[j]))
        return true;
    }
  }
  return false;
}
function sharesSamePair(a1, a2, earlier) {
  if (a1.x === a2.x && a1.y === a2.y)
    return false;
  for (const route of earlier) {
    for (let j = 1; j < route.length; j += 1) {
      const b1 = route[j - 1];
      const b2 = route[j];
      if (a1.y === a2.y && b1.y === b2.y && a1.y === b1.y) {
        const overlap = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
        if (overlap > 0)
          return true;
      } else if (a1.x === a2.x && b1.x === b2.x && a1.x === b1.x) {
        const overlap = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
        if (overlap > 0)
          return true;
      }
    }
  }
  return false;
}
var headingOf = (vector) => vector.x > 0 ? 0 : vector.y > 0 ? 1 : vector.x < 0 ? 2 : 3;
function turnsLowerBound(px, py, h, tx, ty, ht) {
  const vx = tx - px;
  const vy = ty - py;
  if (vx === 0 && vy === 0)
    return h === ht ? 0 : (h + 2) % 4 === ht ? 2 : 1;
  const along = vx * DX[h] + vy * DY[h];
  const across = vx * DY[h] - vy * DX[h];
  if (h === ht && across === 0 && along > 0)
    return 0;
  if (h % 2 !== ht % 2 && along >= 0 && vx * DX[ht] + vy * DY[ht] >= 0)
    return 1;
  return 2;
}
function simplifyRoute(points) {
  const unique = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (last === void 0 || last.x !== point.x || last.y !== point.y)
      unique.push(point);
  }
  const result = [];
  for (const point of unique) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const collinear = a.x === b.x && b.x === point.x || a.y === b.y && b.y === point.y;
      if (!collinear)
        break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}
var LexHeap = class {
  bends = [];
  lens = [];
  states = [];
  count = 0;
  get size() {
    return this.count;
  }
  clear() {
    this.count = 0;
  }
  push(estBends, estLen, state) {
    const bends = this.bends;
    const lens = this.lens;
    const states = this.states;
    let index = this.count++;
    if (index < bends.length) {
      bends[index] = estBends;
      lens[index] = estLen;
      states[index] = state;
    } else {
      bends.push(estBends);
      lens.push(estLen);
      states.push(state);
    }
    while (index > 0) {
      const parent = index - 1 >> 1;
      const pb = bends[parent];
      const pl = lens[parent];
      const ps = states[parent];
      const less = estBends !== pb ? estBends < pb : estLen !== pl ? estLen < pl : state < ps;
      if (!less)
        break;
      bends[index] = pb;
      lens[index] = pl;
      states[index] = ps;
      index = parent;
    }
    bends[index] = estBends;
    lens[index] = estLen;
    states[index] = state;
  }
  pop() {
    const bends = this.bends;
    const lens = this.lens;
    const states = this.states;
    const top = states[0];
    const length = --this.count;
    const lastB = bends[length];
    const lastL = lens[length];
    const lastS = states[length];
    if (length > 0) {
      let index = 0;
      for (; ; ) {
        const left = 2 * index + 1;
        if (left >= length)
          break;
        const right = left + 1;
        let child = left;
        if (right < length) {
          const lb = bends[left];
          const ll = lens[left];
          const ls = states[left];
          const rb = bends[right];
          const rl = lens[right];
          const rs = states[right];
          const rightLess = rb !== lb ? rb < lb : rl !== ll ? rl < ll : rs < ls;
          if (rightLess)
            child = right;
        }
        const cb = bends[child];
        const cl = lens[child];
        const cs = states[child];
        const childLess = cb !== lastB ? cb < lastB : cl !== lastL ? cl < lastL : cs < lastS;
        if (!childLess)
          break;
        bends[index] = cb;
        lens[index] = cl;
        states[index] = cs;
        index = child;
      }
      bends[index] = lastB;
      lens[index] = lastL;
      states[index] = lastS;
    }
    return top;
  }
};
function routeEdges(input) {
  const { rects, requests, clearance } = input;
  const routeSpacing = input.routeSpacing !== void 0 && input.routeSpacing > 0 ? input.routeSpacing : 0;
  const useSpacing = routeSpacing > 0;
  const barrierPad = input.barrierClearance ?? clearance;
  const entities = [...rects.keys()].sort();
  const grow = (id, rect, pad2 = clearance) => ({
    id,
    left: rect.x - pad2,
    right: rect.x + rect.width + pad2,
    top: rect.y - pad2,
    bottom: rect.y + rect.height + pad2
  });
  const grown = [
    ...entities.map((id) => grow(id, rects.get(id), clearance)),
    // Synthetic ids: never an entity reference, hence never in `passable`.
    ...(input.barriers ?? []).map((rect, index) => grow(`barrier:${String(index)}`, rect, barrierPad))
  ];
  const withChannels = (pairs) => {
    const starts = /* @__PURE__ */ new Set();
    const ends = /* @__PURE__ */ new Set();
    const values = [];
    for (const [lo, hi] of pairs) {
      starts.add(lo);
      ends.add(hi);
      values.push(lo, hi);
    }
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const tracks = [];
    for (let index = 1; index < sorted.length; index += 1) {
      const low = sorted[index - 1];
      const high = sorted[index];
      const span = high - low;
      if (useSpacing) {
        const isCorridor = ends.has(low) && starts.has(high);
        if (isCorridor && span <= 300) {
          tracks.push(...subdivideChannelTracks(low, high, routeSpacing));
        } else {
          tracks.push((low + high) / 2);
          if (isCorridor) {
            if (low + routeSpacing < high - routeSpacing) {
              tracks.push(low + routeSpacing, high - routeSpacing);
            }
          }
        }
      } else {
        tracks.push((low + high) / 2);
      }
    }
    return [...sorted, ...tracks];
  };
  const clearancePoint = (point, exit) => ({
    x: point.x + exit.x * clearance,
    y: point.y + exit.y * clearance
  });
  const xValues = withChannels(grown.map((box) => [box.left, box.right]));
  const yValues = withChannels(grown.map((box) => [box.top, box.bottom]));
  if (useSpacing && rects.size > 0) {
    const passableIds = /* @__PURE__ */ new Set();
    for (const req of requests)
      for (const id of req.passable)
        passableIds.add(id);
    for (const id of passableIds) {
      const r = rects.get(id);
      if (r === void 0)
        continue;
      if (r.width > 2 * clearance)
        xValues.push(r.x + clearance, r.x + r.width - clearance);
      if (r.height > 2 * clearance)
        yValues.push(r.y + clearance, r.y + r.height - clearance);
    }
    if (requests.length > 1) {
      const rawList = [...rects.values()];
      const minX = Math.min(...rawList.map((r) => r.x)) - clearance;
      const maxX = Math.max(...rawList.map((r) => r.x + r.width)) + clearance;
      const minY = Math.min(...rawList.map((r) => r.y)) - clearance;
      const maxY = Math.max(...rawList.map((r) => r.y + r.height)) + clearance;
      const perimeterTracks = Math.min(Math.max(4, Math.ceil(requests.length / 3)), 6);
      for (let k = 1; k <= perimeterTracks; k += 1) {
        xValues.push(minX - k * routeSpacing, maxX + k * routeSpacing);
        yValues.push(minY - k * routeSpacing, maxY + k * routeSpacing);
      }
    }
  }
  for (const request of requests) {
    for (const point of [clearancePoint(request.start, request.startExit), clearancePoint(request.end, request.endExit)]) {
      xValues.push(point.x);
      yValues.push(point.y);
    }
  }
  for (const x of input.lanes?.xs ?? [])
    xValues.push(x);
  for (const y of input.lanes?.ys ?? [])
    yValues.push(y);
  const xs = [...new Set(xValues)].sort((a, b) => a - b);
  const ys = [...new Set(yValues)].sort((a, b) => a - b);
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  const nx = xs.length;
  const ny = ys.length;
  const obstacles = grown.map((box) => ({
    id: box.id,
    iL: xIndex.get(box.left),
    iR: xIndex.get(box.right),
    jT: yIndex.get(box.top),
    jB: yIndex.get(box.bottom)
  }));
  const stride = nx + 1;
  const diffH = new Int32Array((nx + 1) * (ny + 1));
  const diffV = new Int32Array((nx + 1) * (ny + 1));
  const addRange = (diff, i0, i1, j0, j1) => {
    if (i0 > i1 || j0 > j1)
      return;
    diff[j0 * stride + i0] += 1;
    diff[j0 * stride + i1 + 1] -= 1;
    diff[(j1 + 1) * stride + i0] -= 1;
    diff[(j1 + 1) * stride + i1 + 1] += 1;
  };
  for (const o of obstacles) {
    addRange(diffH, o.iL, o.iR - 1, o.jT + 1, o.jB - 1);
    addRange(diffV, o.iL + 1, o.iR - 1, o.jT, o.jB - 1);
  }
  const coverH = new Int32Array(nx * ny);
  const coverV = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    let rowH = 0;
    let rowV = 0;
    for (let i = 0; i < nx; i += 1) {
      rowH += diffH[j * stride + i];
      rowV += diffV[j * stride + i];
      const above = j > 0 ? 1 : 0;
      coverH[j * nx + i] = rowH + (above ? coverH[(j - 1) * nx + i] : 0);
      coverV[j * nx + i] = rowV + (above ? coverV[(j - 1) * nx + i] : 0);
    }
  }
  const coversH = (o, i, j) => i >= o.iL && i <= o.iR - 1 && j > o.jT && j < o.jB;
  const coversV = (o, i, j) => i > o.iL && i < o.iR && j >= o.jT && j <= o.jB - 1;
  const nPoints = nx * ny;
  const nStates = nPoints * 4;
  const gBends = new Int32Array(nStates);
  const gLen = new Float64Array(nStates);
  const runSI = new Int32Array(nStates);
  const runSJ = new Int32Array(nStates);
  const stamp = new Int32Array(nStates);
  const closed2 = new Int32Array(nStates);
  const parent = new Int32Array(nStates);
  const pairIds = /* @__PURE__ */ new Map();
  const firstUser = new Int32Array(2 * nx * ny);
  const extraUsers = /* @__PURE__ */ new Map();
  const isOccupied = (unit) => firstUser[unit] !== 0;
  const isUsedBy = (unit, pid) => {
    const first = firstUser[unit];
    if (first === 0)
      return false;
    if (first === pid + 1)
      return true;
    const extra = extraUsers.get(unit);
    return extra !== void 0 && extra.includes(pid);
  };
  const addUser = (unit, pid) => {
    const first = firstUser[unit];
    if (first === 0) {
      firstUser[unit] = pid + 1;
      return;
    }
    if (first === pid + 1)
      return;
    const extra = extraUsers.get(unit);
    if (extra === void 0)
      extraUsers.set(unit, [pid]);
    else if (!extra.includes(pid))
      extra.push(pid);
  };
  const reserveGridPath = (points, pid) => {
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1];
      const b = points[k];
      const ai = xIndex.get(a.x);
      const aj = yIndex.get(a.y);
      const bi = xIndex.get(b.x);
      const bj = yIndex.get(b.y);
      if (ai === void 0 || aj === void 0 || bi === void 0 || bj === void 0)
        continue;
      if (aj === bj) {
        const lo = Math.min(ai, bi);
        const hi = Math.max(ai, bi);
        for (let u = lo; u < hi; u += 1)
          addUser((aj * nx + u) * 2, pid);
      } else if (ai === bi) {
        const lo = Math.min(aj, bj);
        const hi = Math.max(aj, bj);
        for (let u = lo; u < hi; u += 1)
          addUser((u * nx + ai) * 2 + 1, pid);
      }
    }
  };
  const pairFull = /* @__PURE__ */ new Map();
  const fixedH = [];
  const fixedV = [];
  const fixedElbows = [];
  const recordFixedRoute = (full) => {
    if (!useSpacing)
      return;
    for (let k = 1; k < full.length; k += 1) {
      const a = full[k - 1];
      const b = full[k];
      if (Math.abs(a.y - b.y) <= SPACING_EPS && Math.abs(a.x - b.x) > SPACING_EPS) {
        fixedH.push({ y: (a.y + b.y) / 2, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      } else if (Math.abs(a.x - b.x) <= SPACING_EPS && Math.abs(a.y - b.y) > SPACING_EPS) {
        fixedV.push({ x: (a.x + b.x) / 2, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      }
    }
    for (let k = 1; k + 1 < full.length; k += 1) {
      fixedElbows.push(full[k]);
    }
  };
  for (const reserved of input.reservedRoutes ?? []) {
    recordFixedRoute(reserved);
  }
  let generation = 0;
  const heap = new LexHeap();
  const routes = /* @__PURE__ */ new Map();
  const obstructed = [];
  const escaped = [];
  const elbowFor = (startPoint, endPoint, startExit) => {
    if (startPoint.x === endPoint.x || startPoint.y === endPoint.y)
      return [];
    return startExit.x !== 0 ? [{ x: endPoint.x, y: startPoint.y }] : [{ x: startPoint.x, y: endPoint.y }];
  };
  const rawRects = [...rects.values(), ...input.barriers ?? []];
  const throughRaw = (a, b) => {
    let hits = 0;
    for (const rect of rawRects) {
      const left = rect.x;
      const right = rect.x + rect.width;
      const top = rect.y;
      const bottom = rect.y + rect.height;
      if (a.y === b.y) {
        if (a.y > top && a.y < bottom && Math.max(Math.min(a.x, b.x), left) < Math.min(Math.max(a.x, b.x), right))
          hits += 1;
      } else if (a.x === b.x) {
        if (a.x > left && a.x < right && Math.max(Math.min(a.y, b.y), top) < Math.min(Math.max(a.y, b.y), bottom))
          hits += 1;
      }
    }
    return hits;
  };
  const crossingsOf = (points) => {
    let total = 0;
    for (let i = 1; i < points.length; i += 1)
      total += throughRaw(points[i - 1], points[i]);
    return total;
  };
  const bestFallback = (start, startPoint, endPoint, end, startExit) => {
    const candidates = [];
    if (startPoint.x !== endPoint.x && startPoint.y !== endPoint.y) {
      candidates.push([{ x: endPoint.x, y: startPoint.y }]);
      candidates.push([{ x: startPoint.x, y: endPoint.y }]);
    }
    if (rawRects.length > 0) {
      const minX = Math.min(...rawRects.map((r) => r.x)) - clearance - 4;
      const maxX = Math.max(...rawRects.map((r) => r.x + r.width)) + clearance + 4;
      const minY = Math.min(...rawRects.map((r) => r.y)) - clearance - 4;
      const maxY = Math.max(...rawRects.map((r) => r.y + r.height)) + clearance + 4;
      candidates.push([
        { x: startPoint.x, y: minY },
        { x: endPoint.x, y: minY }
      ]);
      candidates.push([
        { x: startPoint.x, y: maxY },
        { x: endPoint.x, y: maxY }
      ]);
      candidates.push([
        { x: minX, y: startPoint.y },
        { x: minX, y: endPoint.y }
      ]);
      candidates.push([
        { x: maxX, y: startPoint.y },
        { x: maxX, y: endPoint.y }
      ]);
    }
    let best = elbowFor(startPoint, endPoint, startExit);
    let bestScore = Number.POSITIVE_INFINITY;
    for (const elbow of candidates) {
      const full = simplifyRoute([start, startPoint, ...elbow, endPoint, end]);
      const score = crossingsOf(full);
      if (score < bestScore) {
        bestScore = score;
        best = elbow;
        if (score === 0)
          break;
      }
    }
    return best;
  };
  const priority = input.priority;
  const orderedRequests = permuteFlowRuns([...requests].sort((a, b) => {
    if (useSpacing) {
      if (priority !== void 0) {
        const aPri = priority.has(a.id) ? 0 : 1;
        const bPri = priority.has(b.id) ? 0 : 1;
        if (aPri !== bPri)
          return aPri - bPri;
      }
      const aInternal = a.within !== void 0 ? 0 : 1;
      const bInternal = b.within !== void 0 ? 0 : 1;
      if (aInternal !== bInternal)
        return aInternal - bInternal;
      const aDist = Math.abs(a.start.x - a.end.x) + Math.abs(a.start.y - a.end.y);
      const bDist = Math.abs(b.start.x - b.end.x) + Math.abs(b.start.y - b.end.y);
      if (Math.abs(aDist - bDist) > SPACING_EPS)
        return aDist - bDist;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }), (request) => request.flowRun, (request) => request.flowRank);
  const samePoint2 = (a, b) => Math.abs(a.x - b.x) <= SPACING_EPS && Math.abs(a.y - b.y) <= SPACING_EPS;
  const dockStubs = orderedRequests.map((req) => {
    const sp = clearancePoint(req.start, req.startExit);
    const ep = clearancePoint(req.end, req.endExit);
    return { start: req.start, startPoint: sp, end: req.end, endPoint: ep };
  });
  const sharedBlockedElbow = useSpacing ? new Uint8Array(nx * ny) : void 0;
  const sharedStrictH = useSpacing ? new Uint8Array(nx * ny) : void 0;
  const sharedStrictV = useSpacing ? new Uint8Array(nx * ny) : void 0;
  const lowerBound = (arr, target) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (arr[mid] < target)
        lo = mid + 1;
      else
        hi = mid;
    }
    return lo;
  };
  for (let reqIndex = 0; reqIndex < orderedRequests.length; reqIndex += 1) {
    const request = orderedRequests[reqIndex];
    let goalParent = -1;
    let pairId = pairIds.get(request.pairKey);
    if (pairId === void 0) {
      pairId = pairIds.size;
      pairIds.set(request.pairKey, pairId);
    }
    const pid = pairId;
    const earlier = pairFull.get(request.pairKey) ?? [];
    const hasSamePair = earlier.length > 0;
    const startPoint = dockStubs[reqIndex].startPoint;
    const endPoint = dockStubs[reqIndex].endPoint;
    let nearH;
    let nearV;
    let blockedElbow;
    let strictUnitH;
    let strictUnitV;
    const futurePointH = [];
    const futurePointV = [];
    if (useSpacing) {
      const futureH = [];
      const futureV = [];
      const futureClearancePts = [];
      const pushStub = (dock, cp) => {
        if (samePoint2(dock, request.start) || samePoint2(dock, request.end))
          return;
        if (Math.abs(dock.y - cp.y) <= SPACING_EPS && Math.abs(dock.x - cp.x) > SPACING_EPS) {
          futureH.push({ y: (dock.y + cp.y) / 2, lo: Math.min(dock.x, cp.x), hi: Math.max(dock.x, cp.x) });
          futurePointV.push({ x: cp.x, y: cp.y });
        } else if (Math.abs(dock.x - cp.x) <= SPACING_EPS && Math.abs(dock.y - cp.y) > SPACING_EPS) {
          futureV.push({ x: (dock.x + cp.x) / 2, lo: Math.min(dock.y, cp.y), hi: Math.max(dock.y, cp.y) });
          futurePointH.push({ y: cp.y, x: cp.x });
        }
        futureClearancePts.push(cp);
      };
      for (let otherIdx = reqIndex + 1; otherIdx < dockStubs.length; otherIdx += 1) {
        const stub = dockStubs[otherIdx];
        pushStub(stub.start, stub.startPoint);
        pushStub(stub.end, stub.endPoint);
      }
      const allH = futureH.length > 0 ? [...fixedH, ...futureH] : fixedH;
      const allV = futureV.length > 0 ? [...fixedV, ...futureV] : fixedV;
      const allElbows = futureClearancePts.length > 0 ? [...fixedElbows, ...futureClearancePts] : fixedElbows;
      if (allH.length > 0 || allV.length > 0 || allElbows.length > 0) {
        const r = routeSpacing - SPACING_EPS;
        nearH = Array.from({ length: ny }, () => []);
        strictUnitH = sharedStrictH;
        strictUnitH.fill(0);
        for (const seg of allH) {
          const iLo = Math.max(0, lowerBound(xs, seg.lo + SPACING_EPS) - 1);
          for (let j = lowerBound(ys, seg.y - r); j < ny && ys[j] < seg.y + r; j += 1) {
            nearH[j].push(seg);
            const rowOff = j * nx;
            for (let ui = iLo; ui < nx - 1 && xs[ui] < seg.hi - SPACING_EPS; ui += 1) {
              if (xs[ui + 1] > seg.lo + SPACING_EPS)
                strictUnitH[rowOff + ui] = 1;
            }
          }
        }
        for (const pt of futurePointH) {
          const j = yIndex.get(pt.y);
          if (j === void 0)
            continue;
          const rowOff = j * nx;
          const iStart = Math.max(0, lowerBound(xs, pt.x - SPACING_EPS) - 1);
          for (let ui = iStart; ui < nx - 1 && xs[ui] <= pt.x + SPACING_EPS; ui += 1) {
            if (xs[ui + 1] >= pt.x - SPACING_EPS)
              strictUnitH[rowOff + ui] = 1;
          }
        }
        nearV = Array.from({ length: nx }, () => []);
        strictUnitV = sharedStrictV;
        strictUnitV.fill(0);
        for (const seg of allV) {
          const jLo = Math.max(0, lowerBound(ys, seg.lo + SPACING_EPS) - 1);
          for (let i = lowerBound(xs, seg.x - r); i < nx && xs[i] < seg.x + r; i += 1) {
            nearV[i].push(seg);
            for (let uj = jLo; uj < ny - 1 && ys[uj] < seg.hi - SPACING_EPS; uj += 1) {
              if (ys[uj + 1] > seg.lo + SPACING_EPS)
                strictUnitV[uj * nx + i] = 1;
            }
          }
        }
        for (const pt of futurePointV) {
          const i = xIndex.get(pt.x);
          if (i === void 0)
            continue;
          const jStart = Math.max(0, lowerBound(ys, pt.y - SPACING_EPS) - 1);
          for (let uj = jStart; uj < ny - 1 && ys[uj] <= pt.y + SPACING_EPS; uj += 1) {
            if (ys[uj + 1] >= pt.y - SPACING_EPS)
              strictUnitV[uj * nx + i] = 1;
          }
        }
        blockedElbow = sharedBlockedElbow;
        blockedElbow.fill(0);
        if (allElbows.length > 0) {
          const r2 = r * r;
          for (const e of allElbows) {
            const jStart = lowerBound(ys, e.y - r);
            const iStart = lowerBound(xs, e.x - r);
            for (let j = jStart; j < ny && ys[j] < e.y + r; j += 1) {
              const dy = ys[j] - e.y;
              const dy2 = dy * dy;
              const rowOff = j * nx;
              for (let i = iStart; i < nx && xs[i] < e.x + r; i += 1) {
                const dx = xs[i] - e.x;
                if (dx * dx + dy2 < r2)
                  blockedElbow[rowOff + i] = 1;
              }
            }
          }
        }
      }
    }
    const violatesFixedH = (j, xA, xB) => {
      const list2 = nearH?.[j];
      const lo = Math.min(xA, xB);
      const hi = Math.max(xA, xB);
      if (hi - lo <= SPACING_EPS)
        return false;
      if (list2 !== void 0) {
        for (const seg of list2) {
          if (Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS)
            return true;
        }
      }
      const y = ys[j];
      for (const pt of futurePointH) {
        if (Math.abs(y - pt.y) <= SPACING_EPS && pt.x >= lo - SPACING_EPS && pt.x <= hi + SPACING_EPS) {
          return true;
        }
      }
      return false;
    };
    const violatesFixedV = (i, yA, yB) => {
      const list2 = nearV?.[i];
      const lo = Math.min(yA, yB);
      const hi = Math.max(yA, yB);
      if (hi - lo <= SPACING_EPS)
        return false;
      if (list2 !== void 0) {
        for (const seg of list2) {
          if (Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS)
            return true;
        }
      }
      const x = xs[i];
      for (const pt of futurePointV) {
        if (Math.abs(x - pt.x) <= SPACING_EPS && pt.y >= lo - SPACING_EPS && pt.y <= hi + SPACING_EPS) {
          return true;
        }
      }
      return false;
    };
    const violatesFixedSegment = (a, b) => {
      if (Math.abs(a.y - b.y) <= SPACING_EPS) {
        const j = yIndex.get(a.y);
        if (j !== void 0)
          return violatesFixedH(j, a.x, b.x);
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        return hi - lo > SPACING_EPS && fixedH.some((seg) => Math.abs(seg.y - a.y) < routeSpacing - SPACING_EPS && Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS);
      }
      if (Math.abs(a.x - b.x) <= SPACING_EPS) {
        const i = xIndex.get(a.x);
        if (i !== void 0)
          return violatesFixedV(i, a.y, b.y);
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        return hi - lo > SPACING_EPS && fixedV.some((seg) => Math.abs(seg.x - a.x) < routeSpacing - SPACING_EPS && Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS);
      }
      return false;
    };
    const overlapsAnyFixedSegment = (a, b) => {
      if (Math.abs(a.y - b.y) <= SPACING_EPS) {
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        if (hi - lo <= SPACING_EPS)
          return false;
        const j = yIndex.get(a.y);
        const list2 = j !== void 0 ? nearH?.[j] : fixedH;
        return list2 !== void 0 && list2.some((seg) => Math.abs(seg.y - a.y) <= SPACING_EPS && Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS);
      }
      if (Math.abs(a.x - b.x) <= SPACING_EPS) {
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (hi - lo <= SPACING_EPS)
          return false;
        const i = xIndex.get(a.x);
        const list2 = i !== void 0 ? nearV?.[i] : fixedV;
        return list2 !== void 0 && list2.some((seg) => Math.abs(seg.x - a.x) <= SPACING_EPS && Math.min(hi, seg.hi) - Math.max(lo, seg.lo) > SPACING_EPS);
      }
      return false;
    };
    const tiers = [];
    if (useSpacing) {
      const hasOtherGeometry = nearH !== void 0;
      if (request.within !== void 0) {
        if (hasOtherGeometry) {
          tiers.push({ clamp: request.within, strictSpacing: true, allowCrossPairOverlap: false });
        }
        tiers.push({ clamp: request.within, strictSpacing: false, allowCrossPairOverlap: false });
        tiers.push({ clamp: request.within, strictSpacing: false, allowCrossPairOverlap: true });
        if (hasOtherGeometry) {
          tiers.push({ clamp: void 0, strictSpacing: true, allowCrossPairOverlap: false });
        }
        tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: false });
        tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: true });
      } else {
        if (hasOtherGeometry) {
          tiers.push({ clamp: void 0, strictSpacing: true, allowCrossPairOverlap: false });
        }
        tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: false });
        tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: true });
      }
    } else if (request.within !== void 0) {
      tiers.push({ clamp: request.within, strictSpacing: false, allowCrossPairOverlap: true });
      tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: true });
    } else {
      tiers.push({ clamp: void 0, strictSpacing: false, allowCrossPairOverlap: true });
    }
    let terminalObstructed = false;
    let winningClamp = request.within;
    const excluded = obstacles.filter((o) => request.passable.has(o.id));
    const excludedEmpty = excluded.length === 0;
    const passableRects = useSpacing ? excluded.map((o) => rects.get(o.id)).filter((r) => r !== void 0) : [];
    const passWallRow = passableRects.length > 0 ? new Uint8Array(ny) : void 0;
    const passWallCol = passableRects.length > 0 ? new Uint8Array(nx) : void 0;
    if (passWallRow !== void 0 && passWallCol !== void 0) {
      const c = clearance - SPACING_EPS;
      for (const r of passableRects) {
        for (const wy of [r.y, r.y + r.height]) {
          for (let j = lowerBound(ys, wy - c); j < ny && ys[j] < wy + c; j += 1)
            passWallRow[j] = 1;
        }
        for (const wx of [r.x, r.x + r.width]) {
          for (let i = lowerBound(xs, wx - c); i < nx && xs[i] < wx + c; i += 1)
            passWallCol[i] = 1;
        }
      }
    }
    const passableWallBlockedH = (ui, j) => {
      if (passWallRow[j] === 0)
        return false;
      const y = ys[j];
      const xLo = xs[ui];
      const xHi = xs[ui + 1];
      for (const r of passableRects) {
        if (xHi <= r.x - clearance + SPACING_EPS || xLo >= r.x + r.width + clearance - SPACING_EPS)
          continue;
        if (Math.abs(y - r.y) < clearance - SPACING_EPS || Math.abs(y - (r.y + r.height)) < clearance - SPACING_EPS) {
          return true;
        }
      }
      return false;
    };
    const passableWallBlockedV = (i, uj) => {
      if (passWallCol[i] === 0)
        return false;
      const x = xs[i];
      const yLo = ys[uj];
      const yHi = ys[uj + 1];
      for (const r of passableRects) {
        if (yHi <= r.y - clearance + SPACING_EPS || yLo >= r.y + r.height + clearance - SPACING_EPS)
          continue;
        if (Math.abs(x - r.x) < clearance - SPACING_EPS || Math.abs(x - (r.x + r.width)) < clearance - SPACING_EPS) {
          return true;
        }
      }
      return false;
    };
    const startViolatesStrict = useSpacing && violatesFixedSegment(request.start, startPoint);
    const endViolatesStrict = useSpacing && violatesFixedSegment(endPoint, request.end);
    for (const tier of tiers) {
      if (goalParent >= 0 || terminalObstructed)
        break;
      const { clamp, strictSpacing, allowCrossPairOverlap } = tier;
      if (strictSpacing && (startViolatesStrict || endViolatesStrict))
        continue;
      const insideClamp = (x, y) => clamp === void 0 || x >= clamp.x && x <= clamp.x + clamp.width && y >= clamp.y && y <= clamp.y + clamp.height;
      if (!insideClamp(startPoint.x, startPoint.y) || !insideClamp(endPoint.x, endPoint.y))
        continue;
      generation += 1;
      heap.clear();
      const blockedH = (i, j) => {
        let count = coverH[j * nx + i];
        for (const o of excluded)
          if (coversH(o, i, j))
            count -= 1;
        if (count > 0)
          return true;
        return passableRects.length > 0 && passableWallBlockedH(i, j);
      };
      const blockedV = (i, j) => {
        let count = coverV[j * nx + i];
        for (const o of excluded)
          if (coversV(o, i, j))
            count -= 1;
        if (count > 0)
          return true;
        return passableRects.length > 0 && passableWallBlockedV(i, j);
      };
      const blockedHFast = (i, j) => coverH[j * nx + i] > 0;
      const blockedVFast = (i, j) => coverV[j * nx + i] > 0;
      const isBlockedH = excludedEmpty ? blockedHFast : blockedH;
      const isBlockedV = excludedEmpty ? blockedVFast : blockedV;
      const si = xIndex.get(startPoint.x);
      const sj = yIndex.get(startPoint.y);
      const ti = xIndex.get(endPoint.x);
      const tj = yIndex.get(endPoint.y);
      const startHeading = headingOf(request.startExit);
      const arrival = headingOf({ x: -request.endExit.x, y: -request.endExit.y });
      if (strictSpacing && blockedElbow !== void 0 && blockedElbow[tj * nx + ti] === 1 && !(si === ti && sj === tj && startHeading === arrival)) {
        const pi = ti - DX[arrival];
        const pj = tj - DY[arrival];
        let straightIncomingOk = pi >= 0 && pj >= 0 && pi < nx && pj < ny && insideClamp(xs[pi], ys[pj]);
        if (straightIncomingOk) {
          if (arrival % 2 === 0) {
            const ui = Math.min(pi, ti);
            const u = (tj * nx + ui) * 2;
            if (isBlockedH(ui, tj) || isOccupied(u) || strictUnitH !== void 0 && strictUnitH[tj * nx + ui] === 1) {
              straightIncomingOk = false;
            }
          } else {
            const uj = Math.min(pj, tj);
            const u = (uj * nx + ti) * 2 + 1;
            if (isBlockedV(ti, uj) || isOccupied(u) || strictUnitV !== void 0 && strictUnitV[uj * nx + ti] === 1) {
              straightIncomingOk = false;
            }
          }
        }
        if (!straightIncomingOk)
          continue;
      }
      const goalState = nStates;
      const terminalBlocked = hasSamePair && (sharesSamePair(request.start, startPoint, earlier) || crossesSamePair(request.start, startPoint, earlier) || sharesSamePair(endPoint, request.end, earlier) || crossesSamePair(endPoint, request.end, earlier));
      if (terminalBlocked) {
        terminalObstructed = true;
        break;
      }
      const heuristicB = (i, j, h) => turnsLowerBound(xs[i], ys[j], h, endPoint.x, endPoint.y, arrival);
      const heuristicL = (i, j) => Math.abs(endPoint.x - xs[i]) + Math.abs(endPoint.y - ys[j]);
      const startState = (sj * nx + si) * 4 + startHeading;
      gBends[startState] = 0;
      gLen[startState] = 0;
      runSI[startState] = si;
      runSJ[startState] = sj;
      stamp[startState] = generation;
      parent[startState] = -1;
      heap.push(heuristicB(si, sj, startHeading), heuristicL(si, sj), startState);
      let goalBends = Number.POSITIVE_INFINITY;
      let goalLen = Number.POSITIVE_INFINITY;
      let pops = 0;
      while (heap.size > 0) {
        const state = heap.pop();
        if (state === goalState)
          break;
        if (closed2[state] === generation)
          continue;
        closed2[state] = generation;
        if (strictSpacing && ++pops > 24e3)
          break;
        const h = state & 3;
        const point = state >> 2;
        const i = point % nx;
        const j = (point - i) / nx;
        const gb = gBends[state];
        const gl = gLen[state];
        if (i === ti && j === tj) {
          if ((h + 2) % 4 !== arrival) {
            let closeAllowed = true;
            if (strictSpacing) {
              if (h === arrival) {
                const straightStart = runSI[state] === si && runSJ[state] === sj && h === startHeading;
                const a1 = straightStart ? request.start : { x: xs[runSI[state]], y: ys[runSJ[state]] };
                if (violatesFixedSegment(a1, request.end))
                  closeAllowed = false;
              } else {
                if (blockedElbow !== void 0 && blockedElbow[tj * nx + ti] === 1)
                  closeAllowed = false;
                else if (violatesFixedSegment(endPoint, request.end))
                  closeAllowed = false;
                else if (si === ti && sj === tj && violatesFixedSegment(request.start, startPoint))
                  closeAllowed = false;
              }
            } else if (!allowCrossPairOverlap) {
              if (h === arrival) {
                const straightStart = runSI[state] === si && runSJ[state] === sj && h === startHeading;
                const a1 = straightStart ? request.start : { x: xs[runSI[state]], y: ys[runSJ[state]] };
                if (overlapsAnyFixedSegment(a1, request.end))
                  closeAllowed = false;
              } else if (overlapsAnyFixedSegment(endPoint, request.end)) {
                closeAllowed = false;
              }
            }
            if (!closeAllowed) {
            } else if (hasSamePair && h === arrival) {
              const a1 = { x: xs[runSI[state]], y: ys[runSJ[state]] };
              if (crossesSamePair(a1, request.end, earlier) || sharesSamePair(a1, request.end, earlier)) {
              } else {
                const totalB = gb;
                const totalL = gl;
                if (totalB < goalBends || totalB === goalBends && totalL < goalLen) {
                  goalBends = totalB;
                  goalLen = totalL;
                  goalParent = state;
                  heap.push(totalB, totalL, goalState);
                }
              }
            } else {
              const totalB = gb + (h === arrival ? 0 : 1);
              const totalL = gl;
              if (totalB < goalBends || totalB === goalBends && totalL < goalLen) {
                goalBends = totalB;
                goalLen = totalL;
                goalParent = state;
                heap.push(totalB, totalL, goalState);
              }
            }
          }
        }
        const rsx = runSI[state];
        const rsy = runSJ[state];
        for (let nh = 0; nh < 4; nh += 1) {
          if (nh === (h + 2) % 4)
            continue;
          const ni = i + DX[nh];
          const nj = j + DY[nh];
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny)
            continue;
          if (clamp !== void 0 && !insideClamp(xs[ni], ys[nj]))
            continue;
          let unit;
          let length;
          if (nh % 2 === 0) {
            const ui = Math.min(i, ni);
            if (isBlockedH(ui, j))
              continue;
            unit = (j * nx + ui) * 2;
            length = xs[ui + 1] - xs[ui];
          } else {
            const uj = Math.min(j, nj);
            if (isBlockedV(i, uj))
              continue;
            unit = (uj * nx + i) * 2 + 1;
            length = ys[uj + 1] - ys[uj];
          }
          const occupied = isOccupied(unit);
          if (occupied && (!allowCrossPairOverlap || isUsedBy(unit, pid)))
            continue;
          let nrsx;
          let nrsy;
          if (nh === h) {
            nrsx = rsx;
            nrsy = rsy;
          } else {
            nrsx = i;
            nrsy = j;
          }
          if (strictSpacing) {
            if (nh !== h) {
              if (blockedElbow !== void 0 && blockedElbow[j * nx + i] === 1)
                continue;
              if (i === si && j === sj && violatesFixedSegment(request.start, startPoint))
                continue;
            }
            if (nh % 2 === 0) {
              if (strictUnitH !== void 0 && strictUnitH[j * nx + Math.min(i, ni)] === 1)
                continue;
              if (i === si && j === sj && nh === startHeading && violatesFixedH(j, request.start.x, startPoint.x))
                continue;
            } else {
              if (strictUnitV !== void 0 && strictUnitV[Math.min(j, nj) * nx + i] === 1)
                continue;
              if (i === si && j === sj && nh === startHeading && violatesFixedV(i, request.start.y, startPoint.y))
                continue;
            }
          } else if (!allowCrossPairOverlap) {
            if (i === si && j === sj && nh === startHeading && overlapsAnyFixedSegment(request.start, startPoint))
              continue;
          }
          if (hasSamePair) {
            const straightStart = nrsx === si && nrsy === sj && nh === startHeading;
            const a1 = straightStart ? request.start : { x: xs[nrsx], y: ys[nrsy] };
            const a2 = { x: xs[ni], y: ys[nj] };
            if (crossesSamePair(a1, a2, earlier) || sharesSamePair(a1, a2, earlier))
              continue;
          }
          const nb = gb + (nh === h ? 0 : 1);
          const hb = heuristicB(ni, nj, nh);
          if (strictSpacing && nb + hb > 12)
            continue;
          const nl = gl + length * (occupied ? 1 + OVERLAP_PENALTY : 1);
          const next = (nj * nx + ni) * 4 + nh;
          if (stamp[next] === generation) {
            const rb = gBends[next];
            const rl = gLen[next];
            if (nb > rb || nb === rb && nl >= rl)
              continue;
          }
          if (closed2[next] === generation)
            continue;
          stamp[next] = generation;
          gBends[next] = nb;
          gLen[next] = nl;
          runSI[next] = nrsx;
          runSJ[next] = nrsy;
          parent[next] = state;
          heap.push(nb + hb, nl + heuristicL(ni, nj), next);
        }
      }
      if (goalParent >= 0)
        winningClamp = clamp;
    }
    if (goalParent >= 0 && winningClamp === void 0 && request.within !== void 0) {
      escaped.push(request.id);
    }
    if (goalParent < 0) {
      obstructed.push(request.id);
      const elbow = input.avoidFallbackInteriors === true ? bestFallback(request.start, startPoint, endPoint, request.end, request.startExit) : elbowFor(startPoint, endPoint, request.startExit);
      const full2 = simplifyRoute([request.start, startPoint, ...elbow, endPoint, request.end]);
      routes.set(request.id, full2);
      const list2 = pairFull.get(request.pairKey) ?? [];
      list2.push(full2);
      pairFull.set(request.pairKey, list2);
      recordFixedRoute(full2);
      reserveGridPath([startPoint, ...elbow, endPoint], pid);
      continue;
    }
    const chain = [];
    for (let state = goalParent; state >= 0; state = parent[state])
      chain.push(state);
    chain.reverse();
    const corners = [];
    const pending = [];
    for (let index = 0; index < chain.length; index += 1) {
      const point = chain[index] >> 2;
      const i = point % nx;
      const j = (point - i) / nx;
      corners.push({ x: xs[i], y: ys[j] });
      if (index > 0) {
        const previous = chain[index - 1] >> 2;
        const pi = previous % nx;
        const pj = (previous - pi) / nx;
        pending.push(pj === j ? (j * nx + Math.min(i, pi)) * 2 : (Math.min(j, pj) * nx + i) * 2 + 1);
      }
    }
    const full = simplifyRoute([request.start, ...corners, request.end]);
    let violates = false;
    if (hasSamePair) {
      for (const other of earlier) {
        if (fullSharesSegment(full, other)) {
          violates = true;
          break;
        }
        let crossed = false;
        for (let a = 1; a < full.length && !crossed; a += 1) {
          for (let b = 1; b < other.length; b += 1) {
            if (segmentsCrossTransversal(full[a - 1], full[a], other[b - 1], other[b])) {
              crossed = true;
              break;
            }
          }
        }
        if (crossed) {
          violates = true;
          break;
        }
      }
    }
    if (violates) {
      obstructed.push(request.id);
      const elbow = input.avoidFallbackInteriors === true ? bestFallback(request.start, startPoint, endPoint, request.end, request.startExit) : elbowFor(startPoint, endPoint, request.startExit);
      const fallback = simplifyRoute([request.start, startPoint, ...elbow, endPoint, request.end]);
      routes.set(request.id, fallback);
      const list2 = pairFull.get(request.pairKey) ?? [];
      list2.push(fallback);
      pairFull.set(request.pairKey, list2);
      recordFixedRoute(fallback);
      reserveGridPath([startPoint, ...elbow, endPoint], pid);
      continue;
    }
    for (const unit of pending)
      addUser(unit, pid);
    routes.set(request.id, full);
    const list = pairFull.get(request.pairKey) ?? [];
    list.push(full);
    pairFull.set(request.pairKey, list);
    recordFixedRoute(full);
  }
  return { routes, obstructed, escaped };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/types.js
var DEFAULT_ROW_PACK = {
  targetAspect: 1.78,
  tallBias: 1.6,
  emptyPenaltyWeight: 0.4,
  orientationHysteresis: 0.08
};
var DEFAULT_ROW_GAP = DIAGRAM_SCENE_SPACING.gapMin;
var DEFAULT_ROW_GAP_MAX = DIAGRAM_SCENE_SPACING.gapMax;
var DEFAULT_ZONE_GUTTER = DIAGRAM_SCENE_SPACING.zoneGutter;
var ROOT_LEVEL_KEY = "root";
function resolveRowPack(options) {
  return {
    targetAspect: options?.targetAspect ?? DEFAULT_ROW_PACK.targetAspect,
    tallBias: options?.tallBias ?? DEFAULT_ROW_PACK.tallBias,
    emptyPenaltyWeight: options?.emptyPenaltyWeight ?? DEFAULT_ROW_PACK.emptyPenaltyWeight,
    orientationHysteresis: options?.orientationHysteresis ?? DEFAULT_ROW_PACK.orientationHysteresis
  };
}
function validateRowPack(resolved) {
  const refusals = [];
  const refuse = (field, rule) => {
    refusals.push({
      code: "row-pack-invalid",
      path: "rowPack",
      message: `rowPack.${field} ${rule}, got ${String(resolved[field])}`
    });
  };
  if (!Number.isFinite(resolved.targetAspect) || resolved.targetAspect <= 0)
    refuse("targetAspect", "is a positive finite number");
  for (const field of ["tallBias", "emptyPenaltyWeight", "orientationHysteresis"]) {
    if (!Number.isFinite(resolved[field]) || resolved[field] < 0)
      refuse(field, "is a non-negative finite number");
  }
  return refusals;
}
var DEFAULT_LAYOUT_METRICS = {
  nodePaddingX: 12,
  nodePaddingY: 8,
  nodeMinWidth: 64,
  nodeMinHeight: 32,
  containerPadding: DIAGRAM_SCENE_SPACING.containerPadding,
  titlePaddingY: 6,
  rankGap: 56,
  nodeGap: 24,
  slotSpacing: 12,
  clearance: 8,
  labelMargin: 4
};
var PHONE_MAX_WIDTH = 390;
var MIN_ZOOM = 0.75;

// node_modules/@sentropic/diagram-canvas/dist/layout/erd.js
function layoutErd(document, options, source) {
  const diagnostics = validateDocument(document, { registry: options.registry, ...options.bindings ? { bindings: options.bindings } : {} });
  if (diagnostics.some((d) => d.severity === "error"))
    return { status: "refused", refusals: [{ code: "document-invalid", path: "document", message: "Invalid ERD document" }], diagnostics };
  if (!Number.isFinite(options.targetWidth) || options.targetWidth <= 0)
    return { status: "refused", refusals: [{ code: "target-width-invalid", path: "targetWidth", message: "Positive finite width required" }], diagnostics: [] };
  const objective = resolveRowPack(options.rowPack), refusals = validateRowPack(objective);
  if (refusals.length)
    return { status: "refused", refusals, diagnostics: [] };
  const collapsed = new Set(options.collapsed ?? Object.values(source?.groups ?? {}).filter((g) => g.collapsed).map((g) => g.occurrence));
  const entities = Object.values(document.entities).sort((a, b) => a.id < b.id ? -1 : 1);
  const ids = new Map(entities.map((e) => [e.id, Object.values(source?.entityOccurrences ?? {}).find((o) => o.entity === e.id)?.id ?? erdEntityOccurrence(e.id)]));
  const cards = entities.map((e) => measureErdCard(document, e.id, collapsed.has(ids.get(e.id)), options.measureLines));
  const packed = packRows(cards, { targetAspect: objective.targetAspect, tallBias: objective.tallBias, emptyPenaltyWeight: objective.emptyPenaltyWeight, gapX: Math.max(ERD_GEOMETRY.gapInline, options.metrics?.rowGapInline ?? 0), gapY: Math.max(ERD_GEOMETRY.gapBlock, options.metrics?.rowGapBlock ?? 0), chromeWidth: 0, chromeHeight: 0 });
  const entityOccurrences = {}, portOccurrences = {}, relationOccurrences = {}, groups = {};
  const rects = /* @__PURE__ */ new Map(), headers = /* @__PURE__ */ new Map();
  entities.forEach((entity, index) => {
    const id = ids.get(entity.id), card = cards[index], pos = packed.positions[index];
    const geometry = { x: pos.x + ERD_GEOMETRY.gapInline, y: pos.y + ERD_GEOMETRY.gapBlock, width: card.width, height: card.height };
    entityOccurrences[id] = { id, entity: entity.id, geometry };
    rects.set(entity.id, geometry);
    headers.set(entity.id, card.headerHeight);
    groups["fold." + id.slice(11)] = { id: "fold." + id.slice(11), occurrence: id, collapsed: collapsed.has(id) };
    for (const field of erdFields(document, entity.id))
      for (const side of ["west", "east"]) {
        const row = card.rows.find((r) => r.field.id === field.id), idp = erdPortOccurrence(field.id, side);
        portOccurrences[idp] = { id: idp, port: field.id, ownerOccurrence: id, side, order: row ? card.rows.indexOf(row) : 0, anchor: row ? (row.y + row.height / 2) / card.height : 0.5 };
      }
  });
  const relations = Object.values(document.relations).sort((a, b) => a.id < b.id ? -1 : 1);
  const ends = relations.flatMap((r) => ["from", "to"].map((role3) => {
    const end = r.endpoints.find((e) => e.role === role3), other = r.endpoints.find((e) => e.role !== role3);
    const entity = document.ports[end.target]?.owner ?? end.target, peer = document.ports[other.target]?.owner ?? other.target;
    const rect = rects.get(entity), rectOther = rects.get(peer);
    return { entity, side: rectOther.x + rectOther.width / 2 < rect.x + rect.width / 2 ? "west" : "east", target: end.target, role: role3, relation: r.id };
  }));
  const requests = [], selfRoutes = /* @__PURE__ */ new Map();
  const selfCountByEntity = /* @__PURE__ */ new Map();
  for (const relation of relations) {
    const occurrence = Object.values(source?.relationOccurrences ?? {}).find((o) => o.relation === relation.id)?.id ?? occurrenceRef(relation.id.slice(9));
    const points = [], exits = [], eps = [];
    for (const end of ends.filter((e) => e.relation === relation.id)) {
      const owner = ids.get(end.entity), rect = rects.get(end.entity), port = document.ports[end.target];
      const folded = collapsed.has(owner), po = port ? erdPortOccurrence(port.id, end.side) : void 0;
      const slots = ends.filter((e) => e.entity === end.entity && e.side === end.side && (collapsed.has(owner) || !document.ports[e.target]));
      const slot = slots.indexOf(end), header = headers.get(end.entity);
      const y = port && !folded ? rect.y + portOccurrences[po].anchor * rect.height : rect.y + ERD_GEOMETRY.markerHalfWidth + (slot + 1) * (header - 2 * ERD_GEOMETRY.markerHalfWidth) / (slots.length + 1);
      points.push({ x: rect.x + (end.side === "east" ? rect.width : 0), y });
      exits.push({ x: end.side === "east" ? 1 : -1, y: 0 });
      eps.push({ role: end.role, occurrence: port && !folded ? po : owner, ...port && folded ? { semanticTarget: port.id, sourceOccurrence: po } : {} });
    }
    relationOccurrences[occurrence] = { id: occurrence, relation: relation.id, endpoints: eps };
    const pair3 = ends.filter((e) => e.relation === relation.id).map((e) => e.entity);
    if (pair3[0] === pair3[1]) {
      const entity = pair3[0], selfIndex = (selfCountByEntity.get(entity) ?? 0) + 1;
      selfCountByEntity.set(entity, selfIndex);
      const rect = rects.get(entity), lane = rect.x + rect.width + ERD_GEOMETRY.markerLength + ERD_GEOMETRY.markerGap * selfIndex * 2;
      const start = points[0], end = points[1];
      selfRoutes.set(relation.id, start.y === end.y ? [start, { x: lane, y: start.y }, { x: lane, y: start.y + ERD_GEOMETRY.rowHeight }, { x: lane + ERD_GEOMETRY.markerGap, y: start.y + ERD_GEOMETRY.rowHeight }, { x: lane + ERD_GEOMETRY.markerGap, y: end.y }, end] : [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end]);
    } else
      requests.push({ id: relation.id, pairKey: relation.id, start: points[0], end: points[1], startExit: exits[0], endExit: exits[1], passable: /* @__PURE__ */ new Set() });
  }
  const routed = routeEdges({ rects, requests, clearance: ERD_GEOMETRY.markerLength + ERD_GEOMETRY.markerGap });
  const warnings = routed.obstructed.map((id) => ({ code: "route-obstructed", refs: [id], message: "Dense ERD routing uses an elbow fallback" }));
  for (const o of Object.values(relationOccurrences)) {
    const route = selfRoutes.get(o.relation) ?? routed.routes.get(o.relation) ?? [];
    const fromPort = portOccurrences[o.endpoints[0].occurrence], toPort = portOccurrences[o.endpoints[1].occurrence];
    relationOccurrences[o.id] = { ...o, waypoints: route.slice(fromPort ? 1 : 0, toPort ? route.length - 1 : route.length) };
  }
  const view = { ...createView({ viewId: options.viewId ?? source?.viewId ?? viewRef("erd"), semanticDocumentId: document.documentId, revision: document.revision }), entityOccurrences, portOccurrences, relationOccurrences, groups };
  return { status: "laid-out", view, fit: { direction: "left-to-right", width: packed.width + 2 * ERD_GEOMETRY.gapInline, height: packed.height + 2 * ERD_GEOMETRY.gapBlock, zoom: 1, pans: packed.width > options.targetWidth, phone: options.targetWidth <= 390 }, warnings, orientations: { root: "rows" } };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/graph.js
function ancestorsOf(graph, id) {
  const found = [];
  for (let cursor = graph.nodes.get(id)?.parent; cursor !== void 0; cursor = graph.nodes.get(cursor)?.parent) {
    found.push(cursor);
  }
  return found;
}
function isAncestor(graph, ancestor, of) {
  return ancestorsOf(graph, of).includes(ancestor);
}

// node_modules/@sentropic/diagram-canvas/dist/layout/place.js
function slotSpacingFor(metrics, labelThickness) {
  return labelThickness > 0 ? Math.max(metrics.slotSpacing, labelThickness + metrics.labelMargin) : metrics.slotSpacing;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/dock.js
var SIDE_NORMAL = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 }
};
var byString = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var centreOf = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
function sideToward(self, other, direction) {
  const right = other.x - (self.x + self.width);
  const left = self.x - (other.x + other.width);
  const below = other.y - (self.y + self.height);
  const above = self.y - (other.y + other.height);
  const horizontal = right >= 0 ? "east" : left >= 0 ? "west" : void 0;
  const vertical = below >= 0 ? "south" : above >= 0 ? "north" : void 0;
  const first = direction === "left-to-right" ? horizontal ?? vertical : vertical ?? horizontal;
  if (first !== void 0)
    return first;
  const a = centreOf(self);
  const b = centreOf(other);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}
var U_TURN_OFFSET = 1e9;
var WALL_ORDER = ["east", "south", "west", "north"];
function nearestWall(inner, outer) {
  const distance = {
    east: outer.x + outer.width - (inner.x + inner.width),
    south: outer.y + outer.height - (inner.y + inner.height),
    west: inner.x - outer.x,
    north: inner.y - outer.y
  };
  let best = "east";
  for (const side of WALL_ORDER)
    if (distance[side] < distance[best])
      best = side;
  return best;
}
function parallelRelations(graph) {
  const pairCount = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    const key = [edge.source.entity, edge.target.entity].sort().join("|");
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  const found = /* @__PURE__ */ new Set();
  for (const edge of graph.edges) {
    const key = [edge.source.entity, edge.target.entity].sort().join("|");
    if ((pairCount.get(key) ?? 0) > 1)
      found.add(edge.id);
  }
  return found;
}
function dockEdges(input) {
  const { graph, rects, direction, metrics, labelSizes, fixed } = input;
  const leftToRight = direction === "left-to-right";
  const ends = [];
  for (const edge of graph.edges) {
    const source = edge.source.entity;
    const target = edge.target.entity;
    const label = labelSizes.get(edge.id);
    const push = (role3, entity, other, side, inner) => ends.push({
      slot: edge[role3].slot,
      edge: edge.id,
      role: role3,
      entity,
      other,
      port: role3 === "source" ? edge.source.port : edge.target.port,
      side,
      inner,
      label
    });
    if (source === target) {
      push("source", source, target, leftToRight ? "east" : "south", false);
      push("target", target, source, leftToRight ? "north" : "west", false);
    } else if (isAncestor(graph, source, target) || isAncestor(graph, target, source)) {
      const outerIsSource = isAncestor(graph, source, target);
      const outer = outerIsSource ? source : target;
      const innerEntity = outerIsSource ? target : source;
      const wall = nearestWall(rects.get(innerEntity), rects.get(outer));
      push("source", source, target, wall, outerIsSource);
      push("target", target, source, wall, !outerIsSource);
    } else {
      const imposed = input.sideOverrides?.get(edge.id);
      push("source", source, target, imposed?.source ?? sideToward(rects.get(source), rects.get(target), direction), false);
      push("target", target, source, imposed?.target ?? sideToward(rects.get(target), rects.get(source), direction), false);
    }
  }
  const parallel = parallelRelations(graph);
  const portSide = /* @__PURE__ */ new Map();
  for (const end of [...ends].sort((left, right) => byString(left.edge, right.edge) || byString(left.role, right.role))) {
    if (end.port === void 0)
      continue;
    if (!portSide.has(end.port))
      portSide.set(end.port, end.side);
  }
  for (const end of ends) {
    if (end.port === void 0)
      continue;
    end.side = portSide.get(end.port);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const end of ends) {
    const key = `${end.entity}|${end.side}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(end);
  }
  const placed = /* @__PURE__ */ new Map();
  const demands = [];
  const fixedOverflows = [];
  for (const key of [...groups.keys()].sort(byString)) {
    const group = groups.get(key);
    const entity = group[0].entity;
    const side = group[0].side;
    const rect = rects.get(entity);
    const vertical = side === "east" || side === "west";
    const slotKey = (end) => end.slot !== void 0 ? "~" + end.slot : end.port !== void 0 && !parallel.has(end.edge) ? `~${end.port}` : `${end.edge}#${end.role}`;
    const representative = (members) => [...members].sort((left, right) => byString(left.edge, right.edge) || byString(left.role, right.role))[0];
    const turns = (end) => input.sideOverrides?.get(end.edge)?.turn === true;
    const selfCentre = centreOf(rect);
    const position = (end) => {
      const other = centreOf(rects.get(end.other));
      const at = vertical ? other.y : other.x;
      if (!turns(end))
        return at;
      return (at < (vertical ? selfCentre.y : selfCentre.x) ? -U_TURN_OFFSET : U_TURN_OFFSET) - at;
    };
    const slots = /* @__PURE__ */ new Map();
    for (const end of group)
      (slots.get(slotKey(end)) ?? slots.set(slotKey(end), []).get(slotKey(end))).push(end);
    const sortedKeys = [...slots.keys()].sort((left, right) => {
      const first = representative(slots.get(left));
      const second = representative(slots.get(right));
      const a = position(first);
      const b = position(second);
      if (a !== b)
        return a - b;
      if (turns(first) && turns(second) && a > 0)
        return byString(right, left);
      return byString(left, right);
    });
    const flowEdge = new Map(graph.edges.filter((edge) => edge.flowRank !== void 0 && edge.source.slot === void 0 && edge.target.slot === void 0).map((edge) => [edge.id, edge]));
    const runOf = (key2) => {
      const members = slots.get(key2);
      const end = representative(members);
      const edge = flowEdge.get(end.edge);
      return members.length !== 1 || edge === void 0 ? void 0 : [edge.source.entity, edge.target.entity].sort().join("|") + "|" + String(turns(end));
    };
    const orderedKeys = permuteFlowRuns(sortedKeys, runOf, (key2) => flowEdge.get(representative(slots.get(key2)).edge).flowRank, (key2) => {
      const end = representative(slots.get(key2));
      return turns(end) && position(end) > 0;
    });
    const flowRun = sortedKeys.some((key2) => runOf(key2) !== void 0 && sortedKeys.filter((other) => runOf(other) === runOf(key2)).length > 1);
    const thickness = group.reduce((widest, end) => end.label === void 0 ? widest : Math.max(widest, vertical ? end.label.height : end.label.width), 0);
    const length = vertical ? rect.height : rect.width;
    const count = orderedKeys.length;
    const wanted = Math.max(slotSpacingFor(metrics, count >= 2 ? thickness : 0), flowRun ? (input.flowBadgeSize ?? 0) + metrics.labelMargin : 0);
    if (fixed === true) {
      const inset = input.cornerInset !== void 0 && input.cornerInset > 0 ? Math.min(input.cornerInset, length / 2) : 0;
      const usableLength = Math.max(0, length - 2 * inset);
      const capacity = Math.max(1, Math.floor(usableLength / wanted) + 1);
      const centre2 = centreOf(rect);
      const pointFor = (offset) => side === "east" ? { x: rect.x + rect.width, y: centre2.y + offset } : side === "west" ? { x: rect.x, y: centre2.y + offset } : side === "north" ? { x: centre2.x + offset, y: rect.y } : { x: centre2.x + offset, y: rect.y + rect.height };
      const anchorFor = (point) => vertical ? (point.y - rect.y) / rect.height : (point.x - rect.x) / rect.width;
      const reserved = input.reservedSlots?.get(key);
      if (reserved !== void 0 && reserved.length > 0 && count <= capacity) {
        const minCoord = (vertical ? rect.y : rect.x) + inset;
        const maxCoord = (vertical ? rect.y + rect.height : rect.x + rect.width) - inset;
        const usedCoords = [...reserved];
        orderedKeys.forEach((slot, index) => {
          const ideal = (vertical ? centre2.y : centre2.x) + (index - (count - 1) / 2) * wanted;
          let chosen = Math.max(minCoord, Math.min(maxCoord, ideal));
          const isFree = (c) => c >= minCoord - 1e-4 && c <= maxCoord + 1e-4 && usedCoords.every((u) => Math.abs(u - c) >= wanted - 1e-4);
          if (!isFree(chosen)) {
            for (let step = 1; step <= 24; step += 1) {
              const plus = chosen + step * wanted;
              if (isFree(plus)) {
                chosen = plus;
                break;
              }
              const minus = chosen - step * wanted;
              if (isFree(minus)) {
                chosen = minus;
                break;
              }
            }
          }
          usedCoords.push(chosen);
          const point = pointFor(chosen - (vertical ? centre2.y : centre2.x));
          const anchor = anchorFor(point);
          for (const end of slots.get(slot)) {
            const normal = SIDE_NORMAL[side];
            placed.set(`${end.edge}#${end.role}`, {
              entity,
              point,
              side,
              exit: end.inner ? { x: -normal.x, y: -normal.y } : normal,
              order: index,
              anchor,
              ...end.port === void 0 ? {} : { port: end.port }
            });
          }
        });
      } else if (count <= capacity) {
        orderedKeys.forEach((slot, index) => {
          const offset = (index - (count - 1) / 2) * wanted;
          const point = pointFor(offset);
          const anchor = anchorFor(point);
          for (const end of slots.get(slot)) {
            const normal = SIDE_NORMAL[side];
            placed.set(`${end.edge}#${end.role}`, {
              entity,
              point,
              side,
              exit: end.inner ? { x: -normal.x, y: -normal.y } : normal,
              order: index,
              anchor,
              ...end.port === void 0 ? {} : { port: end.port }
            });
          }
        });
      } else {
        const declared = [...slots.keys()].sort(byString);
        const fittedSet = new Set(declared.slice(0, capacity));
        const fittedOrdered = orderedKeys.filter((slot) => fittedSet.has(slot));
        const fittedPoints = /* @__PURE__ */ new Map();
        fittedOrdered.forEach((slot, index) => {
          const offset = (index - (fittedOrdered.length - 1) / 2) * wanted;
          const point = pointFor(offset);
          const anchor = anchorFor(point);
          fittedPoints.set(slot, { point, anchor, order: index });
          for (const end of slots.get(slot)) {
            const normal = SIDE_NORMAL[side];
            placed.set(`${end.edge}#${end.role}`, {
              entity,
              point,
              side,
              exit: end.inner ? { x: -normal.x, y: -normal.y } : normal,
              order: index,
              anchor,
              ...end.port === void 0 ? {} : { port: end.port }
            });
          }
        });
        const fullIndex = /* @__PURE__ */ new Map();
        orderedKeys.forEach((slot, index) => fullIndex.set(slot, index));
        const fittedList = [...fittedPoints.entries()];
        for (const slot of declared.slice(capacity)) {
          const idealOffset = ((fullIndex.get(slot) ?? 0) - (count - 1) / 2) * wanted;
          const ideal = vertical ? centre2.y + idealOffset : centre2.x + idealOffset;
          let best = fittedList[0];
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const [, fitted] of fittedList) {
            const at = vertical ? fitted.point.y : fitted.point.x;
            const distance = Math.abs(at - ideal);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = fittedList.find(([, candidate]) => candidate === fitted);
            }
          }
          const nearest = best[1];
          for (const end of slots.get(slot)) {
            const normal = SIDE_NORMAL[side];
            placed.set(`${end.edge}#${end.role}`, {
              entity,
              point: nearest.point,
              side,
              exit: end.inner ? { x: -normal.x, y: -normal.y } : normal,
              order: nearest.order,
              anchor: nearest.anchor,
              ...end.port === void 0 ? {} : { port: end.port }
            });
          }
        }
        fixedOverflows.push({ entity, side, required: count, fitted: capacity });
      }
      continue;
    }
    if (count >= 2 && wanted * (count + 1) > length) {
      demands.push({ entity, side, needed: wanted * (count + 1), available: length });
    }
    const spacing = Math.min(wanted, length / (count + 1));
    const centre = centreOf(rect);
    orderedKeys.forEach((slot, index) => {
      const offset = (index - (count - 1) / 2) * spacing;
      const point = side === "east" ? { x: rect.x + rect.width, y: centre.y + offset } : side === "west" ? { x: rect.x, y: centre.y + offset } : side === "north" ? { x: centre.x + offset, y: rect.y } : { x: centre.x + offset, y: rect.y + rect.height };
      const anchor = vertical ? (point.y - rect.y) / rect.height : (point.x - rect.x) / rect.width;
      for (const end of slots.get(slot)) {
        const normal = SIDE_NORMAL[side];
        placed.set(`${end.edge}#${end.role}`, {
          entity,
          point,
          side,
          exit: end.inner ? { x: -normal.x, y: -normal.y } : normal,
          order: index,
          anchor,
          ...end.port === void 0 ? {} : { port: end.port }
        });
      }
    });
  }
  const docks = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    docks.set(edge.id, { source: placed.get(`${edge.id}#source`), target: placed.get(`${edge.id}#target`) });
  }
  return { docks, demands, fixedOverflows };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/comb.js
var byString2 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var clean = (value) => value === 0 ? 0 : value;
var EPS2 = 1e-4;
function groupCombCandidates(candidates, options) {
  const formed = [];
  const fallbacks = [];
  const claimed = /* @__PURE__ */ new Set();
  const processMode = (kind, pool) => {
    const byKey = /* @__PURE__ */ new Map();
    for (const edge of pool) {
      const hubEnd = kind === "fan-in" ? edge.target : edge.source;
      const hub = String(hubEnd.port ?? hubEnd.entity);
      const key = `${hub}\0${edge.styleKey}`;
      let bucket = byKey.get(key);
      if (bucket === void 0) {
        bucket = {
          hub,
          hubEntity: hubEnd.entity,
          ...hubEnd.port === void 0 ? {} : { hubPort: hubEnd.port },
          styleKey: edge.styleKey,
          members: []
        };
        byKey.set(key, bucket);
      }
      bucket.members.push(edge);
    }
    const orderedKeys = [...byKey.keys()].sort((left, right) => {
      const a = byKey.get(left);
      const b = byKey.get(right);
      return byString2(a.hub, b.hub) || byString2(String(a.styleKey), String(b.styleKey));
    });
    for (const key of orderedKeys) {
      const bucket = byKey.get(key);
      if (bucket.members.length < 2)
        continue;
      bucket.members.sort((a, b) => byString2(a.occurrence, b.occurrence));
      const distinctLabels = /* @__PURE__ */ new Set();
      for (const m of bucket.members) {
        const trimmed = m.label?.trim();
        if (trimmed !== void 0 && trimmed.length > 0)
          distinctLabels.add(trimmed);
      }
      if (distinctLabels.size >= 2) {
        fallbacks.push({
          hub: bucket.hub,
          members: bucket.members.map((m) => String(m.occurrence)),
          reason: "labels"
        });
        continue;
      }
      for (const m of bucket.members)
        claimed.add(m.occurrence);
      if (!options.r7Routing) {
        fallbacks.push({
          hub: bucket.hub,
          members: bucket.members.map((m) => String(m.occurrence)),
          reason: "v1-path"
        });
        continue;
      }
      const singleLabel = [...distinctLabels][0];
      formed.push({
        id: `${kind}|${bucket.hub}|${bucket.styleKey}`,
        kind,
        hub: bucket.hub,
        hubEntity: bucket.hubEntity,
        ...bucket.hubPort === void 0 ? {} : { hubPort: bucket.hubPort },
        styleKey: bucket.styleKey,
        arrowhead: bucket.members[0].arrowhead,
        ...singleLabel === void 0 ? {} : { label: singleLabel },
        members: bucket.members
      });
    }
  };
  if (options.fanIn === "comb") {
    processMode("fan-in", candidates);
  }
  if (options.fanOut === "comb") {
    processMode("fan-out", candidates.filter((c) => !claimed.has(c.occurrence)));
  }
  return { formed, fallbacks };
}
function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
function ancestorChainOf(entity, parentOf) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let cur = entity;
  while (cur !== void 0 && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentOf(cur);
  }
  return chain;
}
function lowestCommonScope(entities, parentOf) {
  if (entities.length === 0)
    return "root";
  const chains = entities.map((e) => ancestorChainOf(e, parentOf).slice(1).reverse());
  const first = chains[0];
  let common2;
  for (let depth = 0; depth < first.length; depth += 1) {
    const candidate = first[depth];
    if (chains.every((chain) => chain[depth] === candidate)) {
      common2 = candidate;
    } else {
      break;
    }
  }
  return common2 ?? "root";
}
function directChildInScope(entity, scope, parentOf) {
  let cur = entity;
  while (true) {
    const p = parentOf(cur);
    if (scope === "root") {
      if (p === void 0)
        return cur;
    } else if (p === scope) {
      return cur;
    } else if (p === void 0) {
      return cur;
    }
    cur = p;
  }
}
function gutterCrossBounds(gutter) {
  if (gutter.strips.length === 0)
    return void 0;
  const first = gutter.strips[0];
  return gutter.horizontal ? { lo: first.y, hi: first.y + first.height } : { lo: first.x, hi: first.x + first.width };
}
function selectBoundaryChoice(args) {
  const { group, rects, placementParentOf, gridReports, gutters } = args;
  const memberEntities = group.members.map((m) => group.kind === "fan-in" ? m.source.entity : m.target.entity);
  const hubEntity = group.hubEntity;
  const hubRect = rects.get(hubEntity);
  if (hubRect === void 0)
    return void 0;
  const memberRects = memberEntities.map((e) => rects.get(e)).filter((r) => r !== void 0);
  if (memberRects.length !== memberEntities.length)
    return void 0;
  const lca = lowestCommonScope([hubEntity, ...memberEntities], placementParentOf);
  const grid = gridReports[lca];
  const matchGridGutter = (horizontal, lo, hi, gridSpanLo, gridSpanHi, ascending, runKeyPrefix) => {
    const match = gutters.find((g) => {
      if (g.horizontal !== horizontal)
        return false;
      if (runKeyPrefix !== void 0 && !g.id.startsWith(`${runKeyPrefix}|`))
        return false;
      const b3 = gutterCrossBounds(g);
      return b3 !== void 0 && Math.abs(b3.lo - lo) <= 1.5 && Math.abs(b3.hi - hi) <= 1.5;
    });
    if (match === void 0)
      return void 0;
    const b2 = gutterCrossBounds(match);
    return { gutter: match, horizontal, gutterLo: b2.lo, gutterHi: b2.hi, gridSpanLo, gridSpanHi, ascending };
  };
  if (grid !== void 0 && grid.columns.length > 0 && grid.bands.length > 0) {
    const cellByEntity = new Map(grid.cells.map((c) => [c.entity, c]));
    const hubDirect = directChildInScope(hubEntity, lca, placementParentOf);
    const hubCell = cellByEntity.get(hubDirect);
    const memberCells = memberEntities.map((e) => cellByEntity.get(directChildInScope(e, lca, placementParentOf)));
    if (hubCell !== void 0 && memberCells.every((c) => c !== void 0)) {
      const mCells = memberCells;
      const gridMinX = Math.min(...grid.columns.map((c) => c.start));
      const gridMaxX = Math.max(...grid.columns.map((c) => c.start + c.size));
      const gridMinY = Math.min(...grid.bands.map((b2) => b2.start));
      const gridMaxY = Math.max(...grid.bands.map((b2) => b2.start + b2.size));
      const isPeripheralCell = (c) => {
        if (c.colStart < 0)
          return false;
        const kind = grid.columns[c.colStart]?.kind;
        return kind === "peripheral-start" || kind === "peripheral-end";
      };
      const hubCenter2 = centerOf(hubRect);
      const allInOneBand = mCells.every((c) => !isPeripheralCell(c) && c.bandStart >= 0 && c.bandStart === c.bandEnd) && mCells.every((c) => c.bandStart === mCells[0].bandStart);
      if (allInOneBand) {
        const b2 = mCells[0].bandStart;
        const hubInBand = !isPeripheralCell(hubCell) && hubCell.bandStart <= b2 && hubCell.bandEnd >= b2;
        if (!hubInBand) {
          const band = grid.bands[b2];
          const hubBelow = hubCenter2.y > band.start + band.size / 2;
          if (hubBelow && b2 + 1 < grid.bands.length) {
            const nextBand = grid.bands[b2 + 1];
            return matchGridGutter(true, band.start + band.size, nextBand.start, gridMinX, gridMaxX, true, grid.runKey);
          }
          if (!hubBelow && b2 - 1 >= 0) {
            const prevBand = grid.bands[b2 - 1];
            return matchGridGutter(true, prevBand.start + prevBand.size, band.start, gridMinX, gridMaxX, false, grid.runKey);
          }
        }
      }
      const allInOneCol = mCells.every((c) => c.colStart >= 0 && c.colStart === c.colEnd) && mCells.every((c) => c.colStart === mCells[0].colStart);
      if (allInOneCol) {
        const colIdx = mCells[0].colStart;
        const hubInCol = hubCell.colStart >= 0 && hubCell.colStart <= colIdx && hubCell.colEnd >= colIdx;
        if (!hubInCol) {
          const col = grid.columns[colIdx];
          const hubRight = hubCenter2.x > col.start + col.size / 2;
          if (hubRight && colIdx + 1 < grid.columns.length) {
            const nextCol = grid.columns[colIdx + 1];
            return matchGridGutter(false, col.start + col.size, nextCol.start, gridMinY, gridMaxY, true, grid.runKey);
          }
          if (!hubRight && colIdx - 1 >= 0) {
            const prevCol = grid.columns[colIdx - 1];
            return matchGridGutter(false, prevCol.start + prevCol.size, col.start, gridMinY, gridMaxY, false, grid.runKey);
          }
        }
      }
      const mMinX2 = Math.min(...memberRects.map((r) => r.x));
      const mMaxX2 = Math.max(...memberRects.map((r) => r.x + r.width));
      const mMinY2 = Math.min(...memberRects.map((r) => r.y));
      const mMaxY2 = Math.max(...memberRects.map((r) => r.y + r.height));
      const mCx = (mMinX2 + mMaxX2) / 2;
      const mCy = (mMinY2 + mMaxY2) / 2;
      const vx2 = mCx - hubCenter2.x;
      const vy2 = mCy - hubCenter2.y;
      const horizontalAxis2 = Math.abs(vx2) >= Math.abs(vy2);
      if (horizontalAxis2) {
        const side2 = vx2 > EPS2 ? "east" : "west";
        if (side2 === "east" && hubCell.colEnd >= 0 && hubCell.colEnd + 1 < grid.columns.length) {
          const colA = grid.columns[hubCell.colEnd];
          const colB = grid.columns[hubCell.colEnd + 1];
          return matchGridGutter(false, colA.start + colA.size, colB.start, gridMinY, gridMaxY, true, grid.runKey);
        }
        if (side2 === "west" && hubCell.colStart > 0) {
          const colA = grid.columns[hubCell.colStart - 1];
          const colB = grid.columns[hubCell.colStart];
          return matchGridGutter(false, colA.start + colA.size, colB.start, gridMinY, gridMaxY, false, grid.runKey);
        }
      } else {
        const side2 = vy2 > 0 ? "south" : "north";
        if (side2 === "south" && hubCell.bandEnd >= 0 && hubCell.bandEnd + 1 < grid.bands.length) {
          const bandA = grid.bands[hubCell.bandEnd];
          const bandB = grid.bands[hubCell.bandEnd + 1];
          return matchGridGutter(true, bandA.start + bandA.size, bandB.start, gridMinX, gridMaxX, true, grid.runKey);
        }
        if (side2 === "north" && hubCell.bandStart > 0) {
          const bandA = grid.bands[hubCell.bandStart - 1];
          const bandB = grid.bands[hubCell.bandStart];
          return matchGridGutter(true, bandA.start + bandA.size, bandB.start, gridMinX, gridMaxX, false, grid.runKey);
        }
      }
      return void 0;
    }
  }
  const hubCenter = centerOf(hubRect);
  const mMinX = Math.min(...memberRects.map((r) => r.x));
  const mMaxX = Math.max(...memberRects.map((r) => r.x + r.width));
  const mMinY = Math.min(...memberRects.map((r) => r.y));
  const mMaxY = Math.max(...memberRects.map((r) => r.y + r.height));
  const vx = (mMinX + mMaxX) / 2 - hubCenter.x;
  const vy = (mMinY + mMaxY) / 2 - hubCenter.y;
  const horizontalAxis = Math.abs(vx) >= Math.abs(vy);
  const side = horizontalAxis ? vx > EPS2 ? "east" : "west" : vy > 0 ? "south" : "north";
  const wantHorizontalGutter = side === "north" || side === "south";
  const hubEdge = side === "east" ? hubRect.x + hubRect.width : side === "west" ? hubRect.x : side === "south" ? hubRect.y + hubRect.height : hubRect.y;
  const matching = gutters.filter((g) => {
    if (g.horizontal !== wantHorizontalGutter)
      return false;
    const b2 = gutterCrossBounds(g);
    if (b2 === void 0)
      return false;
    if (side === "east" || side === "south")
      return Math.abs(b2.lo - hubEdge) <= 2;
    return Math.abs(b2.hi - hubEdge) <= 2;
  });
  const chosen = matching[0];
  if (chosen === void 0)
    return void 0;
  const b = gutterCrossBounds(chosen);
  const spanLo = Math.min(...chosen.strips.map((s) => wantHorizontalGutter ? s.x : s.y));
  const spanHi = Math.max(...chosen.strips.map((s) => wantHorizontalGutter ? s.x + s.width : s.y + s.height));
  return {
    gutter: chosen,
    horizontal: wantHorizontalGutter,
    gutterLo: b.lo,
    gutterHi: b.hi,
    gridSpanLo: spanLo,
    gridSpanHi: spanHi,
    ascending: side === "east" || side === "south"
  };
}
function isCoveredByStrips(gutter, extentLo, extentHi, gridSpanLo, gridSpanHi) {
  const checkLo = Math.max(extentLo, gridSpanLo);
  const checkHi = Math.min(extentHi, gridSpanHi);
  if (checkHi - checkLo <= EPS2)
    return true;
  const intervals = gutter.strips.map((s) => gutter.horizontal ? [s.x, s.x + s.width] : [s.y, s.y + s.height]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (intervals.length === 0)
    return false;
  const merged = [[intervals[0][0], intervals[0][1]]];
  for (let i = 1; i < intervals.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr[0] <= prev[1] + 1.5)
      prev[1] = Math.max(prev[1], curr[1]);
    else
      merged.push([curr[0], curr[1]]);
  }
  return merged.some(([lo, hi]) => checkLo >= lo - 1.5 && checkHi <= hi + 1.5);
}
function segmentClearsObstacles(a, b, rects, barriers, passable, endpointEntities, borderClearance, isEndpointSegment) {
  for (const [entity, rect] of rects) {
    if (endpointEntities.has(entity) && isEndpointSegment)
      continue;
    if (passable.has(entity)) {
      const horiz = Math.abs(a.y - b.y) <= EPS2;
      if (horiz) {
        const y = a.y;
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        if (hi > rect.x + EPS2 && lo < rect.x + rect.width - EPS2) {
          if (Math.abs(y - rect.y) < borderClearance - EPS2 || Math.abs(y - (rect.y + rect.height)) < borderClearance - EPS2) {
            return false;
          }
        }
      } else {
        const x = a.x;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (hi > rect.y + EPS2 && lo < rect.y + rect.height - EPS2) {
          if (Math.abs(x - rect.x) < borderClearance - EPS2 || Math.abs(x - (rect.x + rect.width)) < borderClearance - EPS2) {
            return false;
          }
        }
      }
      continue;
    }
    if (segmentToRectDistance(a, b, rect) < borderClearance - EPS2)
      return false;
  }
  for (const barrier of barriers) {
    if (isEndpointSegment && barrier.entity !== void 0 && endpointEntities.has(barrier.entity)) {
      continue;
    }
    if (segmentToRectDistance(a, b, barrier.rect) < borderClearance - EPS2)
      return false;
  }
  return true;
}
function dockForPoint(entity, rect, side, point, port) {
  const vertical = side === "east" || side === "west";
  const anchor = vertical ? rect.height > 0 ? (point.y - rect.y) / rect.height : 0.5 : rect.width > 0 ? (point.x - rect.x) / rect.width : 0.5;
  return {
    entity,
    point: { x: clean(point.x), y: clean(point.y) },
    side,
    exit: SIDE_NORMAL[side],
    order: 0,
    anchor: clean(anchor),
    ...port === void 0 ? {} : { port }
  };
}
function pickFreeDockCoordinate(rect, side, ideal, reserved, spacing, cornerInset) {
  const vertical = side === "east" || side === "west";
  const lo = (vertical ? rect.y : rect.x) + cornerInset;
  const hi = (vertical ? rect.y + rect.height : rect.x + rect.width) - cornerInset;
  if (hi < lo - EPS2)
    return void 0;
  const clamped = Math.max(lo, Math.min(hi, ideal));
  const isFree = (coord) => coord >= lo - EPS2 && coord <= hi + EPS2 && reserved.every((r) => Math.abs(r - coord) >= spacing - EPS2);
  if (isFree(clamped))
    return clamped;
  for (let step = 1; step <= 12; step += 1) {
    const plus = clamped + step * spacing;
    if (isFree(plus))
      return plus;
    const minus = clamped - step * spacing;
    if (isFree(minus))
      return minus;
  }
  return void 0;
}
function splitTrunkSegments(horizontal, trunkCoord, joinPositions) {
  const unique = [...new Set(joinPositions.map((p) => Math.round(p * 1e3) / 1e3))].sort((a, b) => a - b);
  if (unique.length < 2)
    return [];
  const pt = (pos) => horizontal ? { x: clean(pos), y: clean(trunkCoord) } : { x: clean(trunkCoord), y: clean(pos) };
  const sub = [];
  for (let i = 0; i + 1 < unique.length; i += 1) {
    if (unique[i + 1] - unique[i] > EPS2) {
      sub.push([pt(unique[i]), pt(unique[i + 1])]);
    }
  }
  sub.sort((a, b) => {
    const la = Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y);
    const lb = Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y);
    if (Math.abs(la - lb) > EPS2)
      return lb - la;
    return horizontal ? a[0].x - b[0].x : a[0].y - b[0].y;
  });
  const full = [pt(unique[0]), pt(unique[unique.length - 1])];
  if (sub.length !== 1)
    sub.push(full);
  return sub;
}
function solveCombs(input) {
  const { candidates, fanIn, fanOut, r7Routing, rects, placementParentOf, gridReports, gutters, barriers, isNorthBlockedByTitle, routeSpacing, borderClearance, cornerInset } = input;
  const grouped = groupCombCandidates(candidates, { fanIn, fanOut, r7Routing });
  const groups = [];
  const fallbacks = [...grouped.fallbacks];
  const memberRoutes = /* @__PURE__ */ new Map();
  const memberDocks = /* @__PURE__ */ new Map();
  const memberCombId = /* @__PURE__ */ new Map();
  const suppressedLabels = /* @__PURE__ */ new Set();
  const suppressedArrowheads = /* @__PURE__ */ new Set();
  const carrierLabels = /* @__PURE__ */ new Map();
  const reservedSlots = /* @__PURE__ */ new Map();
  const reservedPolylines = [];
  const committedChecked = [];
  const reservedTracks = /* @__PURE__ */ new Map();
  const reserveSlot = (entity, side, coord) => {
    const key = `${entity}#${side}`;
    const list = reservedSlots.get(key) ?? [];
    list.push(coord);
    reservedSlots.set(key, list);
  };
  for (const group of grouped.formed) {
    const boundary = selectBoundaryChoice({ group, rects, placementParentOf, gridReports, gutters });
    if (boundary === void 0) {
      fallbacks.push({
        hub: group.hub,
        members: group.members.map((m) => String(m.occurrence)),
        reason: "gutter-full"
      });
      continue;
    }
    const { gutter, horizontal, gutterLo, gutterHi, gridSpanLo, gridSpanHi, ascending } = boundary;
    const cap = channelCapacity(gutter.gap, routeSpacing, borderClearance);
    if (cap <= 0) {
      fallbacks.push({
        hub: group.hub,
        members: group.members.map((m) => String(m.occurrence)),
        reason: "gutter-full"
      });
      continue;
    }
    const rawTracks = subdivideChannelTracks(gutterLo + borderClearance, gutterHi - borderClearance, routeSpacing).slice(0, cap);
    const orderedTracks = ascending ? rawTracks : [...rawTracks].reverse();
    const hubRect = rects.get(group.hubEntity);
    const hubCenter = centerOf(hubRect);
    const hubPassable = new Set(ancestorChainOf(group.hubEntity, placementParentOf).slice(1));
    const routeEndToTrunk = (entity, rect, port, preferredSide, trunkCoord, targetAlong, passable, within, localReservedSlots, extraReservedPolylines) => {
      const targetPt = horizontal ? { x: clean(targetAlong), y: clean(trunkCoord) } : { x: clean(trunkCoord), y: clean(targetAlong) };
      const faceReserved = (side) => [
        ...reservedSlots.get(`${entity}#${side}`) ?? [],
        ...localReservedSlots.get(`${entity}#${side}`) ?? []
      ];
      if (!(preferredSide === "north" && isNorthBlockedByTitle(entity))) {
        const dockCoord = pickFreeDockCoordinate(rect, preferredSide, targetAlong, faceReserved(preferredSide), routeSpacing, cornerInset);
        if (dockCoord !== void 0) {
          const dockPt = preferredSide === "east" ? { x: rect.x + rect.width, y: dockCoord } : preferredSide === "west" ? { x: rect.x, y: dockCoord } : preferredSide === "north" ? { x: dockCoord, y: rect.y } : { x: dockCoord, y: rect.y + rect.height };
          const straightJoin = horizontal ? { x: dockCoord, y: trunkCoord } : { x: trunkCoord, y: dockCoord };
          const clear = segmentClearsObstacles(dockPt, straightJoin, rects, barriers, passable, /* @__PURE__ */ new Set([entity]), borderClearance, true);
          if (clear) {
            return {
              dock: dockForPoint(entity, rect, preferredSide, dockPt, port),
              points: [dockPt, straightJoin],
              joinAlong: dockCoord
            };
          }
        }
      }
      const arrivalDir = horizontal ? { x: 0, y: centerOf(rect).y < trunkCoord ? -1 : 1 } : { x: centerOf(rect).x < trunkCoord ? -1 : 1, y: 0 };
      const candidateSides = [preferredSide, "south", "north", "west", "east"];
      const allSides = candidateSides.filter((s, idx, arr) => arr.indexOf(s) === idx && !(s === "north" && isNorthBlockedByTitle(entity)));
      const barrierRects = barriers.map((b) => b.rect);
      for (const side of allSides) {
        const idealCoord = side === "east" || side === "west" ? centerOf(rect).y : centerOf(rect).x;
        const dockCoord = pickFreeDockCoordinate(rect, side, idealCoord, faceReserved(side), routeSpacing, cornerInset);
        if (dockCoord === void 0)
          continue;
        const dockPt = side === "east" ? { x: rect.x + rect.width, y: dockCoord } : side === "west" ? { x: rect.x, y: dockCoord } : side === "north" ? { x: dockCoord, y: rect.y } : { x: dockCoord, y: rect.y + rect.height };
        const dock = dockForPoint(entity, rect, side, dockPt, port);
        const endPt = targetPt;
        const outcome = routeEdges({
          rects,
          requests: [
            {
              id: "__comb_seg__",
              pairKey: `${entity}|__trunk__`,
              start: dock.point,
              startExit: dock.exit,
              end: endPt,
              endExit: arrivalDir,
              passable: /* @__PURE__ */ new Set([...passable, entity]),
              ...within === void 0 ? {} : { within }
            }
          ],
          clearance: borderClearance,
          routeSpacing,
          barriers: barrierRects,
          avoidFallbackInteriors: true,
          reservedRoutes: [...reservedPolylines, ...extraReservedPolylines],
          lanes: horizontal ? { xs: [], ys: [trunkCoord] } : { xs: [trunkCoord], ys: [] }
        });
        if (outcome.obstructed.length > 0)
          continue;
        const routedPts = outcome.routes.get("__comb_seg__");
        if (routedPts === void 0 || routedPts.length < 2)
          continue;
        return { dock, points: routedPts, joinAlong: targetAlong };
      }
      return void 0;
    };
    const crossGutterMids = gutters.filter((g) => g.horizontal !== horizontal).map((g) => {
      const b = gutterCrossBounds(g);
      return b === void 0 ? void 0 : (b.lo + b.hi) / 2;
    }).filter((v) => v !== void 0);
    let committed = false;
    for (let tIdx = 0; tIdx < orderedTracks.length; tIdx += 1) {
      const trackCoord = orderedTracks[tIdx];
      const trackKey = `${gutter.id}|${String(tIdx)}`;
      const localSlots = /* @__PURE__ */ new Map();
      const addLocalSlot = (entity, side, coord) => {
        const k = `${entity}#${side}`;
        const list = localSlots.get(k) ?? [];
        list.push(coord);
        localSlots.set(k, list);
      };
      const branchResults = [];
      let branchesOk = true;
      const localBranchPolys = [];
      for (const edge of group.members) {
        const memberEnd = group.kind === "fan-in" ? edge.source : edge.target;
        const mRect = rects.get(memberEnd.entity);
        const mCenter = centerOf(mRect);
        const facingSide = horizontal ? mCenter.y < trackCoord ? "south" : "north" : mCenter.x < trackCoord ? "east" : "west";
        const idealAlong = horizontal ? mCenter.x : mCenter.y;
        const mPassable = new Set(ancestorChainOf(memberEnd.entity, placementParentOf).slice(1));
        const res = routeEndToTrunk(memberEnd.entity, mRect, memberEnd.port, facingSide, trackCoord, idealAlong, mPassable, edge.within, localSlots, localBranchPolys);
        if (res === void 0) {
          branchesOk = false;
          break;
        }
        addLocalSlot(memberEnd.entity, res.dock.side, horizontal ? res.dock.point.x : res.dock.point.y);
        localBranchPolys.push(res.points);
        branchResults.push({ edge, entity: memberEnd.entity, ...res });
      }
      if (!branchesOk || branchResults.length < 2)
        continue;
      const minMemberPos = Math.min(...branchResults.map((b) => b.joinAlong));
      const maxMemberPos = Math.max(...branchResults.map((b) => b.joinAlong));
      const hubFacingSide = horizontal ? hubCenter.y < trackCoord ? "south" : "north" : hubCenter.x < trackCoord ? "east" : "west";
      const hubAlongIdeal = horizontal ? hubCenter.x : hubCenter.y;
      const hubJoinCandidates = [
        hubAlongIdeal,
        ...[...crossGutterMids].sort((a, b) => Math.abs(a - hubAlongIdeal) - Math.abs(b - hubAlongIdeal)),
        Math.max(minMemberPos, Math.min(maxMemberPos, hubAlongIdeal)),
        (minMemberPos + maxMemberPos) / 2,
        minMemberPos,
        maxMemberPos
      ];
      let hubSeg;
      for (const candidateAlong of hubJoinCandidates) {
        const candidate = routeEndToTrunk(group.hubEntity, hubRect, group.hubPort, hubFacingSide, trackCoord, candidateAlong, hubPassable, group.members[0].within, localSlots, localBranchPolys);
        if (candidate !== void 0) {
          hubSeg = candidate;
          break;
        }
      }
      if (hubSeg === void 0)
        continue;
      const extentLo = Math.min(minMemberPos, hubSeg.joinAlong);
      const extentHi = Math.max(maxMemberPos, hubSeg.joinAlong);
      if (!isCoveredByStrips(gutter, extentLo, extentHi, gridSpanLo, gridSpanHi))
        continue;
      const existingIntervals = reservedTracks.get(trackKey) ?? [];
      if (existingIntervals.some(([lo, hi]) => extentLo < hi + routeSpacing - EPS2 && extentHi > lo - routeSpacing + EPS2)) {
        continue;
      }
      const trunkStart = horizontal ? { x: clean(extentLo), y: clean(trackCoord) } : { x: clean(trackCoord), y: clean(extentLo) };
      const trunkEnd = horizontal ? { x: clean(extentHi), y: clean(trackCoord) } : { x: clean(trackCoord), y: clean(extentHi) };
      const allPassable = /* @__PURE__ */ new Set([...hubPassable]);
      for (const edge of group.members)
        for (const p of edge.passable)
          allPassable.add(p);
      if (!segmentClearsObstacles(trunkStart, trunkEnd, rects, barriers, allPassable, /* @__PURE__ */ new Set(), borderClearance, false)) {
        continue;
      }
      const candidateMemberPolys = /* @__PURE__ */ new Map();
      const candidateDocks = /* @__PURE__ */ new Map();
      const candidateChecked = [];
      const carrier = group.members[0].occurrence;
      const hubToTrunkPts = hubSeg.points;
      const trunkToHubPts = [...hubToTrunkPts].reverse();
      const hubJoinPt = horizontal ? { x: clean(hubSeg.joinAlong), y: clean(trackCoord) } : { x: clean(trackCoord), y: clean(hubSeg.joinAlong) };
      for (const br of branchResults) {
        const occId = br.edge.occurrence;
        const memberJoinPt = horizontal ? { x: clean(br.joinAlong), y: clean(trackCoord) } : { x: clean(trackCoord), y: clean(br.joinAlong) };
        const rawPoints = group.kind === "fan-in" ? [...br.points, memberJoinPt, hubJoinPt, ...trunkToHubPts] : [...hubToTrunkPts, hubJoinPt, memberJoinPt, ...[...br.points].reverse()];
        const simplified = simplifyRoute(rawPoints).map((p) => ({ x: clean(p.x), y: clean(p.y) }));
        candidateMemberPolys.set(occId, simplified);
        candidateDocks.set(occId, group.kind === "fan-in" ? { source: br.dock, target: hubSeg.dock } : { source: hubSeg.dock, target: br.dock });
        const suppressArrow = group.kind === "fan-in" && br.edge.occurrence !== carrier;
        candidateChecked.push({
          id: String(br.edge.occurrence),
          source: String(br.edge.source.entity),
          target: String(br.edge.target.entity),
          points: simplified,
          ...br.edge.source.port === void 0 ? {} : { sourcePort: String(br.edge.source.port) },
          ...br.edge.target.port === void 0 ? {} : { targetPort: String(br.edge.target.port) },
          arrowhead: suppressArrow ? "none" : br.edge.arrowhead,
          passable: new Set([...br.edge.passable].map(String)),
          combGroupId: group.id
        });
      }
      const audit = checkRouteSpacing({
        rects,
        routes: [...committedChecked, ...candidateChecked],
        routeSpacing,
        borderClearance,
        barriers
      });
      if (audit.conflictCount > 0)
        continue;
      existingIntervals.push([extentLo, extentHi]);
      reservedTracks.set(trackKey, existingIntervals);
      reserveSlot(group.hubEntity, hubSeg.dock.side, horizontal ? hubSeg.dock.point.x : hubSeg.dock.point.y);
      for (const br of branchResults) {
        reserveSlot(br.entity, br.dock.side, horizontal ? br.dock.point.x : br.dock.point.y);
      }
      for (const [occId, poly] of candidateMemberPolys) {
        memberRoutes.set(occId, poly);
        reservedPolylines.push(poly);
      }
      for (const [occId, docks] of candidateDocks) {
        memberDocks.set(occId, docks);
      }
      for (const checked of candidateChecked)
        committedChecked.push(checked);
      for (const m of group.members) {
        memberCombId.set(String(m.occurrence), group.id);
        if (m.occurrence !== carrier) {
          suppressedLabels.add(String(m.occurrence));
          if (group.kind === "fan-in")
            suppressedArrowheads.add(String(m.occurrence));
        }
      }
      if (group.label !== void 0)
        carrierLabels.set(String(carrier), group.label);
      const joinPositions = [...branchResults.map((b) => b.joinAlong), hubSeg.joinAlong];
      groups.push({
        id: group.id,
        kind: group.kind,
        hub: group.hub,
        carrier,
        members: group.members.map((m) => m.occurrence),
        styleKey: group.styleKey,
        arrowhead: group.arrowhead,
        ...group.label === void 0 ? {} : { label: group.label },
        trunkGutterId: gutter.id,
        trunk: [trunkStart, trunkEnd],
        trunkSegments: splitTrunkSegments(horizontal, trackCoord, joinPositions)
      });
      committed = true;
      break;
    }
    if (!committed) {
      fallbacks.push({
        hub: group.hub,
        members: group.members.map((m) => String(m.occurrence)),
        reason: "gutter-full"
      });
    }
  }
  return {
    groups,
    fallbacks,
    memberRoutes,
    memberDocks,
    memberCombId,
    suppressedLabels,
    suppressedArrowheads,
    carrierLabels,
    reservedSlots,
    reservedPolylines
  };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/compose.js
var clean2 = (value) => value === 0 ? 0 : value;
function distributeWholeExcess(sizes, start, end, rawExcess) {
  if (!(rawExcess > 0))
    return;
  const total = Math.ceil(rawExcess);
  const count = end - start + 1;
  const share = Math.floor(total / count);
  const remainder = total - share * count;
  for (let idx = start; idx <= end; idx += 1) {
    sizes[idx] = (sizes[idx] ?? 0) + share + (idx === end ? remainder : 0);
  }
}
function effectiveAlign(authored, expandedContainer) {
  const chosen = authored ?? (expandedContainer ? "stretch" : "center");
  if (!expandedContainer && chosen === "stretch")
    return "center";
  return chosen;
}
function alignWithin(slotStart, slotSize, naturalSize, align, expandedContainer) {
  if (align === "stretch" && expandedContainer) {
    return { pos: slotStart, size: Math.max(naturalSize, slotSize), stretched: true };
  }
  const slack = Math.max(0, slotSize - naturalSize);
  if (align === "start")
    return { pos: slotStart, size: naturalSize, stretched: false };
  if (align === "end")
    return { pos: slotStart + slack, size: naturalSize, stretched: false };
  return { pos: slotStart + slack / 2, size: naturalSize, stretched: false };
}
function resolveBoundaryGap(boundaryId, hasZone, cardGap, zoneGutter, maxCap, widen) {
  if (hasZone)
    return { gap: zoneGutter, base: zoneGutter };
  const requested = widen?.get(boundaryId) ?? 0;
  return { gap: Math.min(maxCap, Math.max(cardGap, requested)), base: cardGap };
}
function findFirstEmptyRootCell(grid, visibleChildren) {
  const visibleSet = new Set(visibleChildren);
  const stageCols = Array.isArray(grid.stage_columns) ? grid.stage_columns : void 0;
  const bandIds = grid.transverse_bands.map((b) => b.id);
  const coveredBands = /* @__PURE__ */ new Set();
  const coveredCols = /* @__PURE__ */ new Set();
  const occupiedStage = /* @__PURE__ */ new Set();
  if (stageCols !== void 0) {
    grid.transverse_bands.forEach((band, bandIdx) => {
      for (const item of band.items) {
        if (!visibleSet.has(item))
          continue;
        const cell = grid.cells?.[item];
        if (cell?.column === void 0)
          continue;
        const c0 = stageCols.indexOf(cell.column);
        const c1 = cell.to_column === void 0 ? c0 : stageCols.indexOf(cell.to_column);
        const b1 = cell.to_band === void 0 ? bandIdx : bandIds.indexOf(cell.to_band);
        if (c0 < 0 || c1 < c0 || b1 < bandIdx)
          continue;
        for (let b = bandIdx; b <= b1; b += 1) {
          coveredBands.add(b);
          for (let c = c0; c <= c1; c += 1) {
            coveredCols.add(c);
            occupiedStage.add(`${String(b)}|${String(c)}`);
          }
        }
      }
    });
  } else {
    grid.transverse_bands.forEach((band, bandIdx) => {
      if (band.items.some((item) => visibleSet.has(item)))
        coveredBands.add(bandIdx);
    });
  }
  const activeBandDecl = [...coveredBands].sort((a, b) => a - b);
  if (activeBandDecl.length === 0)
    return void 0;
  const declBandToActive = new Map(activeBandDecl.map((decl, active) => [decl, active]));
  const activeStageDecl = [...coveredCols].sort((a, b) => a - b);
  const resolvePeripheral = (side) => (grid.peripheral_columns ?? []).filter((col) => col.side === side && col.items.some((item) => visibleSet.has(item))).map((col) => {
    let fromActive = 0;
    if (col.from_band !== void 0) {
      const declIdx = bandIds.indexOf(col.from_band);
      if (declIdx >= 0) {
        let found;
        for (let b = declIdx; b < bandIds.length; b += 1) {
          const aIdx = declBandToActive.get(b);
          if (aIdx !== void 0) {
            found = aIdx;
            break;
          }
        }
        fromActive = found ?? activeBandDecl.length - 1;
      }
    }
    return { id: col.id, fromActive };
  });
  const startPeripherals = resolvePeripheral("start");
  const endPeripherals = resolvePeripheral("end");
  for (let activeBandIdx = 0; activeBandIdx < activeBandDecl.length; activeBandIdx += 1) {
    const bandDeclIdx = activeBandDecl[activeBandIdx];
    const bandId = bandIds[bandDeclIdx];
    for (const p of startPeripherals) {
      if (activeBandIdx < p.fromActive)
        return { bandId, colId: p.id };
    }
    if (stageCols !== void 0) {
      for (const colDeclIdx of activeStageDecl) {
        if (!occupiedStage.has(`${String(bandDeclIdx)}|${String(colDeclIdx)}`)) {
          return { bandId, colId: stageCols[colDeclIdx] };
        }
      }
    }
    for (const p of endPeripherals) {
      if (activeBandIdx < p.fromActive)
        return { bandId, colId: p.id };
    }
  }
  return void 0;
}
function layoutGridScope(input) {
  const { scope, runKey, grid, visibleChildren, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen, sigmaCols, sigmaBands, freeCellItem, inheritedContributions, onStageColumnsResolved } = input;
  const visibleSet = new Set(visibleChildren);
  const declaredPlaced = /* @__PURE__ */ new Set();
  for (const band of grid.transverse_bands) {
    for (const item of band.items)
      declaredPlaced.add(item);
  }
  for (const col of grid.peripheral_columns ?? []) {
    for (const item of col.items)
      declaredPlaced.add(item);
  }
  const unplaced = visibleChildren.filter((entity) => !declaredPlaced.has(entity));
  const stageCols = Array.isArray(grid.stage_columns) ? grid.stage_columns : void 0;
  const staged = stageCols !== void 0;
  const startPeripheralsRaw = (grid.peripheral_columns ?? []).filter((c) => c.side === "start");
  const endPeripheralsRaw = (grid.peripheral_columns ?? []).filter((c) => c.side === "end");
  const buildPeripheral = (column, declBandToActive, activeBandCount) => {
    const visibleItems = column.items.filter((item) => visibleSet.has(item));
    if (visibleItems.length === 0)
      return void 0;
    const measured = visibleItems.map((entity) => {
      const sz = sizeOf(entity);
      return {
        entity,
        width: sz.width,
        height: sz.height,
        isContainer: isContainer(entity),
        isExpanded: isExpandedContainer(entity)
      };
    });
    const width = Math.max(...measured.map((item) => item.width));
    const itemGaps = [];
    let naturalHeight = measured.reduce((sum, item) => sum + item.height, 0);
    for (let i = 0; i < measured.length - 1; i += 1) {
      const z = measured[i].isContainer || measured[i + 1].isContainer;
      const id = `${runKey}|peripheral|${column.id}|${String(i)}`;
      const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
      itemGaps.push({ id, gap, base, zone: z });
      naturalHeight += gap;
    }
    let fromBandActive = 0;
    if (column.from_band !== void 0 && activeBandCount > 0) {
      const declIdx = grid.transverse_bands.findIndex((band) => band.id === column.from_band);
      if (declIdx >= 0) {
        let found;
        for (let b = declIdx; b < grid.transverse_bands.length; b += 1) {
          const activeIdx = declBandToActive.get(b);
          if (activeIdx !== void 0) {
            found = activeIdx;
            break;
          }
        }
        fromBandActive = found ?? activeBandCount - 1;
      }
    }
    return {
      column,
      items: measured,
      width,
      naturalHeight,
      itemGaps,
      hasContainer: measured.some((item) => item.isContainer),
      fromBandActive
    };
  };
  if (staged) {
    return layoutStagedGrid({
      scope,
      runKey,
      grid,
      stageCols,
      visibleSet,
      unplaced,
      startPeripheralsRaw,
      endPeripheralsRaw,
      buildPeripheral,
      sizeOf,
      isContainer,
      isExpandedContainer,
      rowGaps,
      zoneGutter,
      widen,
      sigmaCols,
      sigmaBands,
      freeCellItem,
      inheritedContributions,
      onStageColumnsResolved
    });
  }
  return layoutUnstagedGrid({
    scope,
    runKey,
    grid,
    visibleSet,
    unplaced,
    startPeripheralsRaw,
    endPeripheralsRaw,
    buildPeripheral,
    sizeOf,
    isContainer,
    isExpandedContainer,
    rowGaps,
    zoneGutter,
    widen,
    sigmaCols,
    sigmaBands,
    freeCellItem
  });
}
function placePeripheralItems(peripheral, colX, colIndex, topY, bandsBottom, lastBandIdx, placements, gutterCollectors, rowGaps) {
  const targetHeight = Math.max(peripheral.naturalHeight, Math.max(0, bandsBottom - topY));
  const extraHeight = targetHeight - peripheral.naturalHeight;
  const expandedIndices = peripheral.items.map((item, idx) => item.isExpanded ? idx : -1).filter((idx) => idx >= 0);
  const heights = peripheral.items.map((item) => item.height);
  if (extraHeight > 0 && expandedIndices.length > 0) {
    const share = Math.floor(extraHeight / expandedIndices.length);
    const rem = extraHeight - share * expandedIndices.length;
    expandedIndices.forEach((idx, k) => {
      heights[idx] = heights[idx] + share + (k === expandedIndices.length - 1 ? rem : 0);
    });
  }
  let cursorY = topY;
  peripheral.items.forEach((item, idx) => {
    const h = heights[idx];
    const w = item.isExpanded ? Math.max(item.width, peripheral.width) : item.width;
    const x = item.isExpanded ? colX : colX + (peripheral.width - w) / 2;
    const slotRelRect = { x: colX, y: cursorY, width: peripheral.width, height: h };
    placements.push({
      entity: item.entity,
      relX: clean2(x),
      relY: clean2(cursorY),
      width: w,
      height: h,
      slotRelRect,
      stretchX: item.isExpanded && w > item.width,
      stretchY: item.isExpanded && h > item.height,
      isPeripheral: true,
      colStart: colIndex,
      colEnd: colIndex,
      bandStart: peripheral.fromBandActive,
      bandEnd: Math.max(peripheral.fromBandActive, lastBandIdx)
    });
    cursorY += h;
    const gapInfo = peripheral.itemGaps[idx];
    if (gapInfo !== void 0) {
      const gy = cursorY;
      gutterCollectors.push((originX, originY) => ({
        id: gapInfo.id,
        horizontal: true,
        strips: [{ x: originX + colX, y: originY + gy, width: peripheral.width, height: gapInfo.gap }],
        gap: gapInfo.gap,
        base: gapInfo.base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: gapInfo.zone
      }));
      cursorY += gapInfo.gap;
    }
  });
  return cursorY;
}
function layoutTrailingBand(runKey, unplaced, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen) {
  let cursorX = 0;
  let height = 0;
  let hasContainer = false;
  const measured = unplaced.map((entity) => {
    const sz = sizeOf(entity);
    const cont = isContainer(entity);
    if (cont)
      hasContainer = true;
    height = Math.max(height, sz.height);
    return { entity, width: sz.width, height: sz.height, isContainer: cont, isExpanded: isExpandedContainer(entity) };
  });
  const items = [];
  const gaps = [];
  measured.forEach((item, idx) => {
    items.push({ entity: item.entity, relX: cursorX, width: item.width, height: item.height, isExpanded: item.isExpanded });
    cursorX += item.width;
    const next = measured[idx + 1];
    if (next !== void 0) {
      const z = item.isContainer || next.isContainer;
      const id = `${runKey}|along|__trailing__|${String(idx)}`;
      const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardX, zoneGutter, rowGaps.maxX, widen);
      gaps.push({ id, startX: cursorX, gap, base, zone: z });
      cursorX += gap;
    }
  });
  return { width: cursorX, height, hasContainer, items, gaps };
}
function layoutStagedGrid(args) {
  const { scope, runKey, grid, stageCols, visibleSet, unplaced, startPeripheralsRaw, endPeripheralsRaw, buildPeripheral, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen, sigmaCols, sigmaBands, freeCellItem, inheritedContributions, onStageColumnsResolved } = args;
  const bandIds = grid.transverse_bands.map((b) => b.id);
  const cells = [];
  let declOrder = 0;
  grid.transverse_bands.forEach((band, bandIdx) => {
    for (const item of band.items) {
      if (!visibleSet.has(item))
        continue;
      const cell = grid.cells?.[item];
      if (cell?.column === void 0)
        continue;
      const colStartDecl = stageCols.indexOf(cell.column);
      const colEndDecl = cell.to_column === void 0 ? colStartDecl : stageCols.indexOf(cell.to_column);
      const bandEndDecl = cell.to_band === void 0 ? bandIdx : bandIds.indexOf(cell.to_band);
      if (colStartDecl < 0 || colEndDecl < colStartDecl || bandEndDecl < bandIdx)
        continue;
      const sz = sizeOf(item);
      cells.push({
        entity: item,
        declOrder,
        colStartDecl,
        colEndDecl,
        bandStartDecl: bandIdx,
        bandEndDecl,
        cell,
        width: sz.width,
        height: sz.height,
        isContainer: isContainer(item),
        isExpanded: isExpandedContainer(item)
      });
      declOrder += 1;
    }
  });
  const coveredCols = /* @__PURE__ */ new Set();
  const coveredBands = /* @__PURE__ */ new Set();
  for (const c of cells) {
    for (let col = c.colStartDecl; col <= c.colEndDecl; col += 1)
      coveredCols.add(col);
    for (let b = c.bandStartDecl; b <= c.bandEndDecl; b += 1)
      coveredBands.add(b);
  }
  for (const contrib of inheritedContributions ?? []) {
    for (let col = contrib.colStartDecl; col <= contrib.colEndDecl; col += 1)
      coveredCols.add(col);
  }
  const activeStageDeclIndices = [...coveredCols].sort((a, b) => a - b);
  const activeBandDeclIndices = [...coveredBands].sort((a, b) => a - b);
  const declColToActive = new Map(activeStageDeclIndices.map((decl, active) => [decl, active]));
  const declBandToActive = new Map(activeBandDeclIndices.map((decl, active) => [decl, active]));
  const activeCells = cells.map((c) => ({
    ...c,
    colStart: declColToActive.get(c.colStartDecl),
    colEnd: declColToActive.get(c.colEndDecl),
    bandStart: declBandToActive.get(c.bandStartDecl),
    bandEnd: declBandToActive.get(c.bandEndDecl)
  }));
  const startPeripherals = startPeripheralsRaw.map((col) => buildPeripheral(col, declBandToActive, activeBandDeclIndices.length)).filter((p) => p !== void 0);
  const endPeripherals = endPeripheralsRaw.map((col) => buildPeripheral(col, declBandToActive, activeBandDeclIndices.length)).filter((p) => p !== void 0);
  const stageCount = activeStageDeclIndices.length;
  const bandCount = activeBandDeclIndices.length;
  const stageHasContainer = Array.from({ length: stageCount }, () => false);
  const bandHasContainer = Array.from({ length: bandCount }, () => false);
  for (const c of activeCells) {
    if (!c.isContainer)
      continue;
    for (let col = c.colStart; col <= c.colEnd; col += 1)
      stageHasContainer[col] = true;
    for (let b = c.bandStart; b <= c.bandEnd; b += 1)
      bandHasContainer[b] = true;
  }
  const allCols = [
    ...startPeripherals.map((p) => ({
      id: p.column.id,
      kind: "peripheral-start",
      hasContainer: p.hasContainer,
      peripheral: p
    })),
    ...activeStageDeclIndices.map((declIdx, activeIdx) => ({
      id: stageCols[declIdx],
      kind: "stage",
      hasContainer: stageHasContainer[activeIdx],
      stageIndex: activeIdx
    })),
    ...endPeripherals.map((p) => ({
      id: p.column.id,
      kind: "peripheral-end",
      hasContainer: p.hasContainer,
      peripheral: p
    }))
  ];
  const colBoundaryInfo = [];
  for (let i = 0; i < allCols.length - 1; i += 1) {
    const left = allCols[i];
    const right = allCols[i + 1];
    const z = left.hasContainer || right.hasContainer;
    const id = `${runKey}|along|${left.id}`;
    const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardX, zoneGutter, rowGaps.maxX, widen);
    colBoundaryInfo.push({ id, gap, base, zone: z });
  }
  const bandBoundaryInfo = [];
  for (let j = 0; j < bandCount - 1; j += 1) {
    const upperId = grid.transverse_bands[activeBandDeclIndices[j]].id;
    const z = bandHasContainer[j] || bandHasContainer[j + 1];
    const id = `${runKey}|across|${upperId}`;
    const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
    bandBoundaryInfo.push({ id, gap, base, zone: z });
  }
  const stageWidths = Array.from({ length: stageCount }, () => 0);
  for (const c of activeCells) {
    if (c.colStart === c.colEnd) {
      stageWidths[c.colStart] = Math.max(stageWidths[c.colStart], c.width);
    }
  }
  const freeCellBandActive = freeCellItem === void 0 ? -1 : activeBandDeclIndices.findIndex((declIdx) => grid.transverse_bands[declIdx].id === freeCellItem.bandId);
  const freeCellColFull = freeCellItem === void 0 || freeCellBandActive < 0 ? -1 : allCols.findIndex((c) => c.id === freeCellItem.colId);
  if (freeCellItem !== void 0 && freeCellColFull >= 0) {
    const colMeta = allCols[freeCellColFull];
    if (colMeta.kind === "stage" && colMeta.stageIndex !== void 0) {
      stageWidths[colMeta.stageIndex] = Math.max(stageWidths[colMeta.stageIndex], freeCellItem.width);
    }
  }
  const activeInherited = (inheritedContributions ?? []).map((contrib) => ({
    colStart: declColToActive.get(contrib.colStartDecl),
    colEnd: declColToActive.get(contrib.colEndDecl),
    neededWidth: contrib.neededWidth,
    declOrder: contrib.declOrder
  })).filter((entry) => entry.colStart !== void 0 && entry.colEnd !== void 0 && entry.colEnd >= entry.colStart);
  for (const entry of activeInherited) {
    if (entry.colStart === entry.colEnd) {
      stageWidths[entry.colStart] = Math.max(stageWidths[entry.colStart], entry.neededWidth);
    }
  }
  const colOffset = startPeripherals.length;
  const allColSpanners = [
    ...activeCells.filter((c) => c.colEnd > c.colStart).map((c) => ({
      colStart: c.colStart,
      colEnd: c.colEnd,
      width: c.width,
      declOrder: c.declOrder
    })),
    ...activeInherited.filter((entry) => entry.colEnd > entry.colStart).map((entry) => ({
      colStart: entry.colStart,
      colEnd: entry.colEnd,
      width: entry.neededWidth,
      declOrder: activeCells.length + entry.declOrder
    }))
  ].sort((a, b) => a.colEnd - a.colStart - (b.colEnd - b.colStart) || a.declOrder - b.declOrder);
  for (const c of allColSpanners) {
    let current = 0;
    for (let col = c.colStart; col <= c.colEnd; col += 1) {
      current += stageWidths[col];
      if (col < c.colEnd)
        current += colBoundaryInfo[colOffset + col].gap;
    }
    distributeWholeExcess(stageWidths, c.colStart, c.colEnd, c.width - current);
  }
  if (sigmaCols !== void 0) {
    activeStageDeclIndices.forEach((declIdx, activeIdx) => {
      const add = sigmaCols.get(stageCols[declIdx]) ?? 0;
      if (add > 0)
        stageWidths[activeIdx] = stageWidths[activeIdx] + add;
    });
  }
  const colWidths = allCols.map((col, fullIdx) => {
    const baseW = col.kind === "stage" ? stageWidths[col.stageIndex] : col.peripheral.width;
    return freeCellItem !== void 0 && fullIdx === freeCellColFull ? Math.max(baseW, freeCellItem.width) : baseW;
  });
  const colStarts = [];
  let cursorX = 0;
  for (let i = 0; i < allCols.length; i += 1) {
    colStarts.push(cursorX);
    cursorX += colWidths[i];
    if (i < colBoundaryInfo.length)
      cursorX += colBoundaryInfo[i].gap;
  }
  const stageAndPeripheralWidth = cursorX;
  const resolvedInheritedSizes = onStageColumnsResolved?.({
    colIds: activeStageDeclIndices.map((declIdx) => stageCols[declIdx]),
    colStarts: activeStageDeclIndices.map((_, activeIdx) => colStarts[colOffset + activeIdx]),
    colWidths: [...stageWidths],
    colGaps: Array.from({ length: Math.max(0, stageCount - 1) }, (_, idx) => colBoundaryInfo[colOffset + idx].gap),
    declColToActive
  });
  const finalCells = resolvedInheritedSizes === void 0 ? activeCells : activeCells.map((c) => {
    const updated = resolvedInheritedSizes.get(c.entity);
    return updated === void 0 ? c : { ...c, width: updated.width, height: updated.height };
  });
  const bandHeights = Array.from({ length: bandCount }, () => 0);
  for (const c of finalCells) {
    if (c.bandStart === c.bandEnd) {
      bandHeights[c.bandStart] = Math.max(bandHeights[c.bandStart], c.height);
    }
  }
  if (freeCellItem !== void 0 && freeCellBandActive >= 0 && freeCellColFull >= 0) {
    bandHeights[freeCellBandActive] = Math.max(bandHeights[freeCellBandActive], freeCellItem.height);
  }
  const bandSpanners = finalCells.filter((c) => c.bandEnd > c.bandStart).sort((a, b) => a.bandEnd - a.bandStart - (b.bandEnd - b.bandStart) || a.declOrder - b.declOrder);
  for (const c of bandSpanners) {
    let current = 0;
    for (let b = c.bandStart; b <= c.bandEnd; b += 1) {
      current += bandHeights[b];
      if (b < c.bandEnd)
        current += bandBoundaryInfo[b].gap;
    }
    distributeWholeExcess(bandHeights, c.bandStart, c.bandEnd, c.height - current);
  }
  if (sigmaBands !== void 0) {
    activeBandDeclIndices.forEach((declIdx, activeIdx) => {
      const add = sigmaBands.get(grid.transverse_bands[declIdx].id) ?? 0;
      if (add > 0)
        bandHeights[activeIdx] = bandHeights[activeIdx] + add;
    });
  }
  const bandStarts = [];
  let cursorY = 0;
  for (let j = 0; j < bandCount; j += 1) {
    bandStarts.push(cursorY);
    cursorY += bandHeights[j];
    if (j < bandBoundaryInfo.length)
      cursorY += bandBoundaryInfo[j].gap;
  }
  const declaredBandsBottom = cursorY;
  const placements = [];
  const gutterCollectors = [];
  for (const c of finalCells) {
    const fullColStart = colOffset + c.colStart;
    const fullColEnd = colOffset + c.colEnd;
    const slotX = colStarts[fullColStart];
    const slotW = colStarts[fullColEnd] + colWidths[fullColEnd] - slotX;
    const slotY = bandStarts[c.bandStart];
    const slotH = bandStarts[c.bandEnd] + bandHeights[c.bandEnd] - slotY;
    const justify = effectiveAlign(c.cell?.justify, c.isExpanded);
    const align = effectiveAlign(c.cell?.align, c.isExpanded);
    const alignedX = alignWithin(slotX, slotW, c.width, justify, c.isExpanded);
    const alignedY = alignWithin(slotY, slotH, c.height, align, c.isExpanded);
    placements.push({
      entity: c.entity,
      relX: clean2(alignedX.pos),
      relY: clean2(alignedY.pos),
      width: alignedX.size,
      height: alignedY.size,
      slotRelRect: { x: clean2(slotX), y: clean2(slotY), width: slotW, height: slotH },
      stretchX: alignedX.stretched,
      stretchY: alignedY.stretched,
      isPeripheral: false,
      colStart: fullColStart,
      colEnd: fullColEnd,
      bandStart: c.bandStart,
      bandEnd: c.bandEnd
    });
  }
  let maxBottom = declaredBandsBottom;
  allCols.forEach((col, fullColIdx) => {
    if (col.peripheral === void 0)
      return;
    const topY = bandCount > 0 ? bandStarts[col.peripheral.fromBandActive] : 0;
    const bottom = placePeripheralItems(col.peripheral, colStarts[fullColIdx], fullColIdx, topY, declaredBandsBottom, Math.max(0, bandCount - 1), placements, gutterCollectors, rowGaps);
    if (bottom > maxBottom)
      maxBottom = bottom;
  });
  const extraBands = [];
  let totalWidth = stageAndPeripheralWidth;
  if (unplaced.length > 0) {
    const trailing = layoutTrailingBand(runKey, unplaced, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen);
    let trailingTop = maxBottom;
    if (maxBottom > 0) {
      const prevHasZone = bandCount > 0 ? bandHasContainer[bandCount - 1] : false;
      const z = prevHasZone || trailing.hasContainer;
      const gapId = `${runKey}|across|__trailing__`;
      const { gap, base } = resolveBoundaryGap(gapId, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
      const gy = maxBottom;
      const stripW = Math.max(stageAndPeripheralWidth, trailing.width);
      gutterCollectors.push((originX, originY) => ({
        id: gapId,
        horizontal: true,
        strips: stripW > 0 ? [{ x: originX, y: originY + gy, width: stripW, height: gap }] : [],
        gap,
        base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: z
      }));
      trailingTop += gap;
    }
    const trailingBandIdx = bandCount;
    for (const item of trailing.items) {
      const align = effectiveAlign(void 0, item.isExpanded);
      const alignedY = alignWithin(trailingTop, trailing.height, item.height, align, item.isExpanded);
      placements.push({
        entity: item.entity,
        relX: clean2(item.relX),
        relY: clean2(alignedY.pos),
        width: item.width,
        height: alignedY.size,
        slotRelRect: { x: clean2(item.relX), y: clean2(trailingTop), width: item.width, height: trailing.height },
        stretchX: false,
        stretchY: alignedY.stretched,
        isPeripheral: false,
        colStart: -1,
        colEnd: -1,
        bandStart: trailingBandIdx,
        bandEnd: trailingBandIdx
      });
    }
    for (const g of trailing.gaps) {
      gutterCollectors.push((originX, originY) => ({
        id: g.id,
        horizontal: false,
        strips: [{ x: originX + g.startX, y: originY + trailingTop, width: g.gap, height: trailing.height }],
        gap: g.gap,
        base: g.base,
        authoredBase: false,
        max: rowGaps.maxX,
        zone: g.zone
      }));
    }
    extraBands.push({ id: "__trailing__", kind: "trailing", start: trailingTop, size: trailing.height });
    maxBottom = trailingTop + trailing.height;
    totalWidth = Math.max(totalWidth, trailing.width);
  }
  for (let i = 0; i < colBoundaryInfo.length; i += 1) {
    const info = colBoundaryInfo[i];
    const gx = colStarts[i] + colWidths[i];
    const leftCol = allCols[i];
    const rightCol = allCols[i + 1];
    const isStageBoundary = leftCol.kind === "stage" && rightCol.kind === "stage";
    const leftStageIdx = leftCol.stageIndex;
    gutterCollectors.push((originX, originY) => {
      const strips = [];
      let runTop;
      let runBottom;
      const flush = () => {
        if (runTop !== void 0 && runBottom !== void 0 && runBottom > runTop) {
          strips.push({ x: originX + gx, y: originY + runTop, width: info.gap, height: runBottom - runTop });
        }
        runTop = void 0;
        runBottom = void 0;
      };
      for (let b = 0; b < bandCount; b += 1) {
        const bh = bandHeights[b];
        const crossed = isStageBoundary && leftStageIdx !== void 0 && activeCells.some((c) => c.colStart <= leftStageIdx && c.colEnd >= leftStageIdx + 1 && c.bandStart <= b && c.bandEnd >= b);
        if (crossed) {
          flush();
          continue;
        }
        if (!(bh > 0))
          continue;
        if (runTop === void 0)
          runTop = bandStarts[b];
        runBottom = bandStarts[b] + bh;
      }
      if (!isStageBoundary && maxBottom > declaredBandsBottom) {
        const stripBottom = Math.max(leftCol.peripheral !== void 0 ? (bandCount > 0 ? bandStarts[leftCol.peripheral.fromBandActive] : 0) + leftCol.peripheral.naturalHeight : declaredBandsBottom, rightCol.peripheral !== void 0 ? (bandCount > 0 ? bandStarts[rightCol.peripheral.fromBandActive] : 0) + rightCol.peripheral.naturalHeight : declaredBandsBottom);
        if (stripBottom > declaredBandsBottom) {
          if (runTop === void 0)
            runTop = declaredBandsBottom;
          runBottom = Math.max(runBottom ?? declaredBandsBottom, stripBottom);
        }
      }
      flush();
      return {
        id: info.id,
        horizontal: false,
        strips,
        gap: info.gap,
        base: info.base,
        authoredBase: false,
        max: rowGaps.maxX,
        zone: info.zone
      };
    });
  }
  for (let j = 0; j < bandBoundaryInfo.length; j += 1) {
    const info = bandBoundaryInfo[j];
    const gy = bandStarts[j] + bandHeights[j];
    gutterCollectors.push((originX, originY) => {
      const strips = [];
      let runLeft;
      let runRight;
      const flush = () => {
        if (runLeft !== void 0 && runRight !== void 0 && runRight > runLeft) {
          strips.push({ x: originX + runLeft, y: originY + gy, width: runRight - runLeft, height: info.gap });
        }
        runLeft = void 0;
        runRight = void 0;
      };
      for (let s = 0; s < stageCount; s += 1) {
        const cw = stageWidths[s];
        const crossed = activeCells.some((c) => c.bandStart <= j && c.bandEnd >= j + 1 && c.colStart <= s && c.colEnd >= s);
        if (crossed) {
          flush();
          continue;
        }
        if (!(cw > 0))
          continue;
        const leftX = colStarts[colOffset + s];
        if (runLeft === void 0)
          runLeft = leftX;
        runRight = leftX + cw;
      }
      flush();
      return {
        id: info.id,
        horizontal: true,
        strips,
        gap: info.gap,
        base: info.base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: info.zone
      };
    });
  }
  const columns = allCols.map((col, idx) => ({
    id: col.id,
    kind: col.kind,
    start: colStarts[idx],
    size: colWidths[idx]
  }));
  const bands = [
    ...activeBandDeclIndices.map((declIdx, activeIdx) => ({
      id: grid.transverse_bands[declIdx].id,
      kind: "band",
      start: bandStarts[activeIdx],
      size: bandHeights[activeIdx]
    })),
    ...extraBands
  ];
  let freeCellRect;
  if (freeCellItem !== void 0 && freeCellBandActive >= 0 && freeCellColFull >= 0) {
    const fx = colStarts[freeCellColFull];
    const fw = colWidths[freeCellColFull];
    const fy = bandStarts[freeCellBandActive];
    const fh = bandHeights[freeCellBandActive];
    freeCellRect = {
      x: clean2(fx + Math.max(0, fw - freeCellItem.width) / 2),
      y: clean2(fy + Math.max(0, fh - freeCellItem.height) / 2),
      width: freeCellItem.width,
      height: freeCellItem.height
    };
  }
  return {
    scope,
    runKey,
    width: totalWidth,
    height: maxBottom,
    columns,
    bands,
    placements,
    unplaced,
    ...freeCellRect === void 0 ? {} : { freeCellRect },
    emitGutters: (originX, originY) => gutterCollectors.map((fn) => fn(originX, originY)),
    toReport: (originX, originY) => ({
      scope,
      runKey,
      columns: columns.map((c) => ({ ...c, start: clean2(originX + c.start) })),
      bands: bands.map((b) => ({ ...b, start: clean2(originY + b.start) })),
      cells: placements.map((p) => ({
        entity: p.entity,
        slotRect: {
          x: clean2(originX + p.slotRelRect.x),
          y: clean2(originY + p.slotRelRect.y),
          width: p.slotRelRect.width,
          height: p.slotRelRect.height
        },
        boxRect: {
          x: clean2(originX + p.relX),
          y: clean2(originY + p.relY),
          width: p.width,
          height: p.height
        },
        colStart: p.colStart,
        colEnd: p.colEnd,
        bandStart: p.bandStart,
        bandEnd: p.bandEnd
      }))
    })
  };
}
function layoutUnstagedGrid(args) {
  const { scope, runKey, grid, visibleSet, unplaced, startPeripheralsRaw, endPeripheralsRaw, buildPeripheral, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen, sigmaCols, sigmaBands, freeCellItem } = args;
  const activeBands = [];
  const declBandToActive = /* @__PURE__ */ new Map();
  grid.transverse_bands.forEach((band, declIdx) => {
    const visibleItems = band.items.filter((item) => visibleSet.has(item));
    if (visibleItems.length === 0)
      return;
    declBandToActive.set(declIdx, activeBands.length);
    const measured = visibleItems.map((entity) => {
      const sz = sizeOf(entity);
      const exp = isExpandedContainer(entity);
      const cell = grid.cells?.[entity];
      return {
        entity,
        width: sz.width,
        height: sz.height,
        isContainer: isContainer(entity),
        isExpanded: exp,
        align: effectiveAlign(cell?.align, exp)
      };
    });
    let cursorX2 = 0;
    let maxH = 0;
    const positioned = [];
    const intraGaps = [];
    measured.forEach((item, idx) => {
      maxH = Math.max(maxH, item.height);
      positioned.push({ ...item, relX: cursorX2 });
      cursorX2 += item.width;
      const next = measured[idx + 1];
      if (next !== void 0) {
        const z = item.isContainer || next.isContainer;
        const id = `${runKey}|along|${band.id}|${String(idx)}`;
        const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardX, zoneGutter, rowGaps.maxX, widen);
        intraGaps.push({ id, startX: cursorX2, gap, base, zone: z });
        cursorX2 += gap;
      }
    });
    const sigmaAdd = sigmaBands?.get(band.id) ?? 0;
    activeBands.push({
      declIdx,
      id: band.id,
      items: positioned,
      intraGaps,
      width: cursorX2,
      height: maxH + (sigmaAdd > 0 ? sigmaAdd : 0),
      hasContainer: measured.some((item) => item.isContainer)
    });
  });
  const startPeripherals = startPeripheralsRaw.map((col) => buildPeripheral(col, declBandToActive, activeBands.length)).filter((p) => p !== void 0);
  const endPeripherals = endPeripheralsRaw.map((col) => buildPeripheral(col, declBandToActive, activeBands.length)).filter((p) => p !== void 0);
  const mainSigmaX = sigmaCols?.get("__main__") ?? 0;
  const mainWidth = (activeBands.length > 0 ? Math.max(...activeBands.map((b) => b.width)) : 0) + (mainSigmaX > 0 ? mainSigmaX : 0);
  const mainHasContainer = activeBands.some((b) => b.hasContainer);
  const freeBandActive = freeCellItem === void 0 ? -1 : activeBands.findIndex((b) => b.id === freeCellItem.bandId);
  if (freeCellItem !== void 0 && freeBandActive >= 0) {
    const cur = activeBands[freeBandActive];
    if (freeCellItem.height > cur.height) {
      activeBands[freeBandActive] = { ...cur, height: freeCellItem.height };
    }
  }
  const allCols = [
    ...startPeripherals.map((p) => ({
      id: p.column.id,
      kind: "peripheral-start",
      width: freeCellItem !== void 0 && freeBandActive >= 0 && freeCellItem.colId === p.column.id ? Math.max(p.width, freeCellItem.width) : p.width,
      hasContainer: p.hasContainer,
      peripheral: p
    })),
    ...activeBands.length > 0 ? [{ id: "__main__", kind: "stage", width: mainWidth, hasContainer: mainHasContainer }] : [],
    ...endPeripherals.map((p) => ({
      id: p.column.id,
      kind: "peripheral-end",
      width: freeCellItem !== void 0 && freeBandActive >= 0 && freeCellItem.colId === p.column.id ? Math.max(p.width, freeCellItem.width) : p.width,
      hasContainer: p.hasContainer,
      peripheral: p
    }))
  ];
  const colBoundaryInfo = [];
  for (let i = 0; i < allCols.length - 1; i += 1) {
    const z = allCols[i].hasContainer || allCols[i + 1].hasContainer;
    const id = `${runKey}|along|${allCols[i].id}`;
    const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardX, zoneGutter, rowGaps.maxX, widen);
    colBoundaryInfo.push({ id, gap, base, zone: z });
  }
  const colStarts = [];
  let cursorX = 0;
  for (let i = 0; i < allCols.length; i += 1) {
    colStarts.push(cursorX);
    cursorX += allCols[i].width;
    if (i < colBoundaryInfo.length)
      cursorX += colBoundaryInfo[i].gap;
  }
  const mainColIdx = allCols.findIndex((c) => c.kind === "stage");
  const mainOriginX = mainColIdx >= 0 ? colStarts[mainColIdx] : 0;
  const bandBoundaryInfo = [];
  const bandStarts = [];
  let cursorY = 0;
  for (let j = 0; j < activeBands.length; j += 1) {
    bandStarts.push(cursorY);
    cursorY += activeBands[j].height;
    if (j < activeBands.length - 1) {
      const z = activeBands[j].hasContainer || activeBands[j + 1].hasContainer;
      const id = `${runKey}|across|${activeBands[j].id}`;
      const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
      bandBoundaryInfo.push({ id, gap, base, zone: z });
      cursorY += gap;
    }
  }
  const declaredBandsBottom = cursorY;
  const placements = [];
  const gutterCollectors = [];
  activeBands.forEach((band, bandIdx) => {
    const by = bandStarts[bandIdx];
    const bandSlackX = Math.max(0, mainWidth - band.width);
    const expandedIdx = band.items.map((item, idx) => item.isExpanded ? idx : -1).filter((idx) => idx >= 0);
    const itemWidths = band.items.map((item) => item.width);
    const itemStretchedX = band.items.map(() => false);
    if (mainSigmaX > 0 && bandSlackX > 0 && expandedIdx.length > 0) {
      const share = Math.floor(bandSlackX / expandedIdx.length);
      const rem = bandSlackX - share * expandedIdx.length;
      expandedIdx.forEach((idx, k) => {
        const add = share + (k === expandedIdx.length - 1 ? rem : 0);
        if (add > 0) {
          itemWidths[idx] = itemWidths[idx] + add;
          itemStretchedX[idx] = true;
        }
      });
    }
    let cursorItemX = 0;
    band.items.forEach((item, idx) => {
      const w = itemWidths[idx];
      const relX = cursorItemX;
      const alignedY = alignWithin(by, band.height, item.height, item.align, item.isExpanded);
      placements.push({
        entity: item.entity,
        relX: clean2(mainOriginX + relX),
        relY: clean2(alignedY.pos),
        width: w,
        height: alignedY.size,
        slotRelRect: { x: clean2(mainOriginX + relX), y: clean2(by), width: w, height: band.height },
        stretchX: itemStretchedX[idx],
        stretchY: alignedY.stretched,
        isPeripheral: false,
        colStart: mainColIdx,
        colEnd: mainColIdx,
        bandStart: bandIdx,
        bandEnd: bandIdx
      });
      cursorItemX += w;
      const g = band.intraGaps[idx];
      if (g !== void 0) {
        const gx = cursorItemX;
        gutterCollectors.push((originX, originY) => ({
          id: g.id,
          horizontal: false,
          strips: [{ x: originX + mainOriginX + gx, y: originY + by, width: g.gap, height: band.height }],
          gap: g.gap,
          base: g.base,
          authoredBase: false,
          max: rowGaps.maxX,
          zone: g.zone
        }));
        cursorItemX += g.gap;
      }
    });
  });
  for (let j = 0; j < bandBoundaryInfo.length; j += 1) {
    const info = bandBoundaryInfo[j];
    const gy = bandStarts[j] + activeBands[j].height;
    gutterCollectors.push((originX, originY) => ({
      id: info.id,
      horizontal: true,
      strips: mainWidth > 0 ? [{ x: originX + mainOriginX, y: originY + gy, width: mainWidth, height: info.gap }] : [],
      gap: info.gap,
      base: info.base,
      authoredBase: false,
      max: rowGaps.maxY,
      zone: info.zone
    }));
  }
  let maxBottom = declaredBandsBottom;
  allCols.forEach((col, fullColIdx) => {
    if (col.peripheral === void 0)
      return;
    const topY = activeBands.length > 0 ? bandStarts[col.peripheral.fromBandActive] : 0;
    const bottom = placePeripheralItems(col.peripheral, colStarts[fullColIdx], fullColIdx, topY, declaredBandsBottom, Math.max(0, activeBands.length - 1), placements, gutterCollectors, rowGaps);
    if (bottom > maxBottom)
      maxBottom = bottom;
  });
  for (let i = 0; i < colBoundaryInfo.length; i += 1) {
    const info = colBoundaryInfo[i];
    const gx = colStarts[i] + allCols[i].width;
    gutterCollectors.push((originX, originY) => ({
      id: info.id,
      horizontal: false,
      strips: maxBottom > 0 ? [{ x: originX + gx, y: originY, width: info.gap, height: maxBottom }] : [],
      gap: info.gap,
      base: info.base,
      authoredBase: false,
      max: rowGaps.maxX,
      zone: info.zone
    }));
  }
  const extraBands = [];
  let totalWidth = cursorX;
  if (unplaced.length > 0) {
    const trailing = layoutTrailingBand(runKey, unplaced, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen);
    let trailingTop = maxBottom;
    if (maxBottom > 0) {
      const prevHasZone = activeBands.length > 0 ? activeBands[activeBands.length - 1].hasContainer : false;
      const z = prevHasZone || trailing.hasContainer;
      const gapId = `${runKey}|across|__trailing__`;
      const { gap, base } = resolveBoundaryGap(gapId, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
      const gy = maxBottom;
      const stripW = Math.max(totalWidth, trailing.width);
      gutterCollectors.push((originX, originY) => ({
        id: gapId,
        horizontal: true,
        strips: stripW > 0 ? [{ x: originX, y: originY + gy, width: stripW, height: gap }] : [],
        gap,
        base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: z
      }));
      trailingTop += gap;
    }
    const trailingBandIdx = activeBands.length;
    for (const item of trailing.items) {
      const align = effectiveAlign(void 0, item.isExpanded);
      const alignedY = alignWithin(trailingTop, trailing.height, item.height, align, item.isExpanded);
      placements.push({
        entity: item.entity,
        relX: clean2(item.relX),
        relY: clean2(alignedY.pos),
        width: item.width,
        height: alignedY.size,
        slotRelRect: { x: clean2(item.relX), y: clean2(trailingTop), width: item.width, height: trailing.height },
        stretchX: false,
        stretchY: alignedY.stretched,
        isPeripheral: false,
        colStart: -1,
        colEnd: -1,
        bandStart: trailingBandIdx,
        bandEnd: trailingBandIdx
      });
    }
    for (const g of trailing.gaps) {
      gutterCollectors.push((originX, originY) => ({
        id: g.id,
        horizontal: false,
        strips: [{ x: originX + g.startX, y: originY + trailingTop, width: g.gap, height: trailing.height }],
        gap: g.gap,
        base: g.base,
        authoredBase: false,
        max: rowGaps.maxX,
        zone: g.zone
      }));
    }
    extraBands.push({ id: "__trailing__", kind: "trailing", start: trailingTop, size: trailing.height });
    maxBottom = trailingTop + trailing.height;
    totalWidth = Math.max(totalWidth, trailing.width);
  }
  const columns = allCols.map((c, i) => ({
    id: c.id,
    kind: c.kind,
    start: colStarts[i],
    size: c.width
  }));
  const bands = [
    ...activeBands.map((b, j) => ({ id: b.id, kind: "band", start: bandStarts[j], size: b.height })),
    ...extraBands
  ];
  let freeCellRect;
  if (freeCellItem !== void 0 && freeBandActive >= 0) {
    const colIdx = allCols.findIndex((c) => c.id === freeCellItem.colId);
    if (colIdx >= 0) {
      const fx = colStarts[colIdx];
      const fw = allCols[colIdx].width;
      const fy = bandStarts[freeBandActive];
      const fh = activeBands[freeBandActive].height;
      freeCellRect = {
        x: clean2(fx + Math.max(0, fw - freeCellItem.width) / 2),
        y: clean2(fy + Math.max(0, fh - freeCellItem.height) / 2),
        width: freeCellItem.width,
        height: freeCellItem.height
      };
    }
  }
  return {
    scope,
    runKey,
    width: totalWidth,
    height: maxBottom,
    columns,
    bands,
    placements,
    unplaced,
    ...freeCellRect === void 0 ? {} : { freeCellRect },
    emitGutters: (originX, originY) => gutterCollectors.map((fn) => fn(originX, originY)),
    toReport: (originX, originY) => ({
      scope,
      runKey,
      columns: columns.map((c) => ({ ...c, start: clean2(originX + c.start) })),
      bands: bands.map((b) => ({ ...b, start: clean2(originY + b.start) })),
      cells: placements.map((p) => ({
        entity: p.entity,
        slotRect: {
          x: clean2(originX + p.slotRelRect.x),
          y: clean2(originY + p.slotRelRect.y),
          width: p.slotRelRect.width,
          height: p.slotRelRect.height
        },
        boxRect: {
          x: clean2(originX + p.relX),
          y: clean2(originY + p.relY),
          width: p.width,
          height: p.height
        },
        colStart: p.colStart,
        colEnd: p.colEnd,
        bandStart: p.bandStart,
        bandEnd: p.bandEnd
      }))
    })
  };
}
function layoutInheritedGridScope(input) {
  const { scope, runKey, grid, visibleChildren, inherited, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen } = input;
  const visibleSet = new Set(visibleChildren);
  const declaredPlaced = /* @__PURE__ */ new Set();
  for (const band of grid.transverse_bands) {
    for (const item of band.items)
      declaredPlaced.add(item);
  }
  const unplaced = visibleChildren.filter((entity) => !declaredPlaced.has(entity));
  const { colIds, colStarts, colWidths, colGaps, firstColIdx, lastColIdx, containerSlotInset, contentInset } = inherited;
  const spanHostLeft = colStarts[firstColIdx];
  const spanHostRight = colStarts[lastColIdx] + colWidths[lastColIdx];
  const frameWidth = Math.max(0, spanHostRight - spanHostLeft - 2 * containerSlotInset);
  const contentWidth = Math.max(0, frameWidth - 2 * contentInset);
  const contentOriginHostX = spanHostLeft + containerSlotInset + contentInset;
  const bandIds = grid.transverse_bands.map((b) => b.id);
  const cells = [];
  let declOrder = 0;
  grid.transverse_bands.forEach((band, bandIdx) => {
    for (const item of band.items) {
      if (!visibleSet.has(item))
        continue;
      const cell = grid.cells?.[item];
      if (cell?.column === void 0)
        continue;
      const colStartHost = colIds.indexOf(cell.column);
      const colEndHost = cell.to_column === void 0 ? colStartHost : colIds.indexOf(cell.to_column);
      const bandEndDecl = cell.to_band === void 0 ? bandIdx : bandIds.indexOf(cell.to_band);
      if (colStartHost < firstColIdx || colEndHost > lastColIdx || colEndHost < colStartHost || bandEndDecl < bandIdx)
        continue;
      const sz = sizeOf(item);
      cells.push({
        entity: item,
        declOrder,
        colStartDecl: colStartHost,
        colEndDecl: colEndHost,
        bandStartDecl: bandIdx,
        bandEndDecl,
        cell,
        width: sz.width,
        height: sz.height,
        isContainer: isContainer(item),
        isExpanded: isExpandedContainer(item)
      });
      declOrder += 1;
    }
  });
  const coveredBands = /* @__PURE__ */ new Set();
  for (const c of cells) {
    for (let b = c.bandStartDecl; b <= c.bandEndDecl; b += 1)
      coveredBands.add(b);
  }
  const activeBandDeclIndices = [...coveredBands].sort((a, b) => a - b);
  const declBandToActive = new Map(activeBandDeclIndices.map((decl, active) => [decl, active]));
  const activeCells = cells.map((c) => ({
    ...c,
    colStart: c.colStartDecl - firstColIdx,
    colEnd: c.colEndDecl - firstColIdx,
    bandStart: declBandToActive.get(c.bandStartDecl),
    bandEnd: declBandToActive.get(c.bandEndDecl)
  }));
  const localColCount = lastColIdx - firstColIdx + 1;
  const bandCount = activeBandDeclIndices.length;
  const bandHasContainer = Array.from({ length: bandCount }, () => false);
  for (const c of activeCells) {
    if (!c.isContainer)
      continue;
    for (let b = c.bandStart; b <= c.bandEnd; b += 1)
      bandHasContainer[b] = true;
  }
  const bandBoundaryInfo = [];
  for (let j = 0; j < bandCount - 1; j += 1) {
    const upperId = grid.transverse_bands[activeBandDeclIndices[j]].id;
    const z = bandHasContainer[j] || bandHasContainer[j + 1];
    const id = `${runKey}|across|${upperId}`;
    const { gap, base } = resolveBoundaryGap(id, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
    bandBoundaryInfo.push({ id, gap, base, zone: z });
  }
  const bandHeights = Array.from({ length: bandCount }, () => 0);
  for (const c of activeCells) {
    if (c.bandStart === c.bandEnd) {
      bandHeights[c.bandStart] = Math.max(bandHeights[c.bandStart], c.height);
    }
  }
  const bandSpanners = activeCells.filter((c) => c.bandEnd > c.bandStart).sort((a, b) => a.bandEnd - a.bandStart - (b.bandEnd - b.bandStart) || a.declOrder - b.declOrder);
  for (const c of bandSpanners) {
    let current = 0;
    for (let b = c.bandStart; b <= c.bandEnd; b += 1) {
      current += bandHeights[b];
      if (b < c.bandEnd)
        current += bandBoundaryInfo[b].gap;
    }
    distributeWholeExcess(bandHeights, c.bandStart, c.bandEnd, c.height - current);
  }
  const bandStarts = [];
  let cursorY = 0;
  for (let j = 0; j < bandCount; j += 1) {
    bandStarts.push(cursorY);
    cursorY += bandHeights[j];
    if (j < bandBoundaryInfo.length)
      cursorY += bandBoundaryInfo[j].gap;
  }
  const declaredBandsBottom = cursorY;
  const placements = [];
  const gutterCollectors = [];
  for (const c of activeCells) {
    const touchesEdge = c.colStartDecl === firstColIdx || c.colEndDecl === lastColIdx;
    const slotInset = touchesEdge ? containerSlotInset + contentInset : 0;
    const rawLeft = colStarts[c.colStartDecl] - contentOriginHostX;
    const rawRight = colStarts[c.colEndDecl] + colWidths[c.colEndDecl] - contentOriginHostX;
    const slotX = rawLeft + slotInset;
    const slotW = Math.max(0, rawRight - rawLeft - 2 * slotInset);
    const slotY = bandStarts[c.bandStart];
    const slotH = bandStarts[c.bandEnd] + bandHeights[c.bandEnd] - slotY;
    const justify = effectiveAlign(c.cell?.justify, c.isExpanded);
    const align = effectiveAlign(c.cell?.align, c.isExpanded);
    const alignedX = alignWithin(slotX, slotW, c.width, justify, c.isExpanded);
    const alignedY = alignWithin(slotY, slotH, c.height, align, c.isExpanded);
    placements.push({
      entity: c.entity,
      relX: clean2(alignedX.pos),
      relY: clean2(alignedY.pos),
      width: alignedX.size,
      height: alignedY.size,
      slotRelRect: { x: clean2(slotX), y: clean2(slotY), width: slotW, height: slotH },
      stretchX: alignedX.stretched,
      stretchY: alignedY.stretched,
      isPeripheral: false,
      colStart: c.colStart,
      colEnd: c.colEnd,
      bandStart: c.bandStart,
      bandEnd: c.bandEnd
    });
  }
  let maxBottom = declaredBandsBottom;
  const extraBands = [];
  let totalWidth = contentWidth;
  if (unplaced.length > 0) {
    const trailing = layoutTrailingBand(runKey, unplaced, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen);
    let trailingTop = maxBottom;
    if (maxBottom > 0) {
      const prevHasZone = bandCount > 0 ? bandHasContainer[bandCount - 1] : false;
      const z = prevHasZone || trailing.hasContainer;
      const gapId = `${runKey}|across|__trailing__`;
      const { gap, base } = resolveBoundaryGap(gapId, z, rowGaps.cardY, zoneGutter, rowGaps.maxY, widen);
      const gy = maxBottom;
      const stripW = Math.max(contentWidth, trailing.width);
      gutterCollectors.push((originX, originY) => ({
        id: gapId,
        horizontal: true,
        strips: stripW > 0 ? [{ x: originX, y: originY + gy, width: stripW, height: gap }] : [],
        gap,
        base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: z
      }));
      trailingTop += gap;
    }
    const trailingBandIdx = bandCount;
    for (const item of trailing.items) {
      const align = effectiveAlign(void 0, item.isExpanded);
      const alignedY = alignWithin(trailingTop, trailing.height, item.height, align, item.isExpanded);
      placements.push({
        entity: item.entity,
        relX: clean2(item.relX),
        relY: clean2(alignedY.pos),
        width: item.width,
        height: alignedY.size,
        slotRelRect: { x: clean2(item.relX), y: clean2(trailingTop), width: item.width, height: trailing.height },
        stretchX: false,
        stretchY: alignedY.stretched,
        isPeripheral: false,
        colStart: -1,
        colEnd: -1,
        bandStart: trailingBandIdx,
        bandEnd: trailingBandIdx
      });
    }
    for (const g of trailing.gaps) {
      gutterCollectors.push((originX, originY) => ({
        id: g.id,
        horizontal: false,
        strips: [{ x: originX + g.startX, y: originY + trailingTop, width: g.gap, height: trailing.height }],
        gap: g.gap,
        base: g.base,
        authoredBase: false,
        max: rowGaps.maxX,
        zone: g.zone
      }));
    }
    extraBands.push({ id: "__trailing__", kind: "trailing", start: trailingTop, size: trailing.height });
    maxBottom = trailingTop + trailing.height;
    totalWidth = Math.max(totalWidth, trailing.width);
  }
  for (let localIdx = 0; localIdx < localColCount - 1; localIdx += 1) {
    const hostIdx = firstColIdx + localIdx;
    const gx = colStarts[hostIdx] + colWidths[hostIdx] - contentOriginHostX;
    const g = colGaps[hostIdx];
    const id = `${runKey}|along|${colIds[hostIdx]}`;
    gutterCollectors.push((originX, originY) => {
      const strips = [];
      let runTop;
      let runBottom;
      const flush = () => {
        if (runTop !== void 0 && runBottom !== void 0 && runBottom > runTop) {
          strips.push({ x: originX + gx, y: originY + runTop, width: g, height: runBottom - runTop });
        }
        runTop = void 0;
        runBottom = void 0;
      };
      for (let b = 0; b < bandCount; b += 1) {
        const bh = bandHeights[b];
        const crossed = activeCells.some((c) => c.colStart <= localIdx && c.colEnd >= localIdx + 1 && c.bandStart <= b && c.bandEnd >= b);
        if (crossed) {
          flush();
          continue;
        }
        if (!(bh > 0))
          continue;
        if (runTop === void 0)
          runTop = bandStarts[b];
        runBottom = bandStarts[b] + bh;
      }
      flush();
      return {
        id,
        horizontal: false,
        strips,
        gap: g,
        base: zoneGutter,
        authoredBase: false,
        max: rowGaps.maxX,
        zone: true
      };
    });
  }
  for (let j = 0; j < bandBoundaryInfo.length; j += 1) {
    const info = bandBoundaryInfo[j];
    const gy = bandStarts[j] + bandHeights[j];
    gutterCollectors.push((originX, originY) => {
      const strips = [];
      let runLeft;
      let runRight;
      const flush = () => {
        if (runLeft !== void 0 && runRight !== void 0 && runRight > runLeft) {
          strips.push({ x: originX + runLeft, y: originY + gy, width: runRight - runLeft, height: info.gap });
        }
        runLeft = void 0;
        runRight = void 0;
      };
      for (let localIdx = 0; localIdx < localColCount; localIdx += 1) {
        const hostIdx = firstColIdx + localIdx;
        const crossed = activeCells.some((c) => c.bandStart <= j && c.bandEnd >= j + 1 && c.colStart <= localIdx && c.colEnd >= localIdx);
        if (crossed) {
          flush();
          continue;
        }
        const cw = colWidths[hostIdx];
        if (!(cw > 0))
          continue;
        const leftX = Math.max(0, colStarts[hostIdx] - contentOriginHostX);
        const rightX = Math.min(contentWidth, colStarts[hostIdx] + cw - contentOriginHostX);
        if (!(rightX > leftX))
          continue;
        if (runLeft === void 0)
          runLeft = leftX;
        runRight = rightX;
      }
      flush();
      return {
        id: info.id,
        horizontal: true,
        strips,
        gap: info.gap,
        base: info.base,
        authoredBase: false,
        max: rowGaps.maxY,
        zone: info.zone
      };
    });
  }
  const columns = Array.from({ length: localColCount }, (_, localIdx) => {
    const hostIdx = firstColIdx + localIdx;
    return {
      id: colIds[hostIdx],
      kind: "stage",
      start: clean2(colStarts[hostIdx] - contentOriginHostX),
      size: colWidths[hostIdx]
    };
  });
  const bands = [
    ...activeBandDeclIndices.map((declIdx, activeIdx) => ({
      id: grid.transverse_bands[declIdx].id,
      kind: "band",
      start: bandStarts[activeIdx],
      size: bandHeights[activeIdx]
    })),
    ...extraBands
  ];
  return {
    scope,
    runKey,
    width: totalWidth,
    height: maxBottom,
    columns,
    bands,
    placements,
    unplaced,
    emitGutters: (originX, originY) => gutterCollectors.map((fn) => fn(originX, originY)),
    toReport: (originX, originY) => ({
      scope,
      runKey,
      columns: columns.map((c) => ({ ...c, start: clean2(originX + c.start) })),
      bands: bands.map((b) => ({ ...b, start: clean2(originY + b.start) })),
      cells: placements.map((p) => ({
        entity: p.entity,
        slotRect: {
          x: clean2(originX + p.slotRelRect.x),
          y: clean2(originY + p.slotRelRect.y),
          width: p.slotRelRect.width,
          height: p.slotRelRect.height
        },
        boxRect: {
          x: clean2(originX + p.relX),
          y: clean2(originY + p.relY),
          width: p.width,
          height: p.height
        },
        colStart: p.colStart,
        colEnd: p.colEnd,
        bandStart: p.bandStart,
        bandEnd: p.bandEnd
      }))
    })
  };
}
function layoutStackScope(input) {
  const { scope, runKey, stack, visibleChildren, sizeOf, isContainer, isExpandedContainer, rowGaps, zoneGutter, widen } = input;
  const horizontal = stack.axis === "row";
  const crossAlign = stack.align ?? "start";
  const measured = visibleChildren.map((entity) => {
    const sz = sizeOf(entity);
    return {
      entity,
      width: sz.width,
      height: sz.height,
      isContainer: isContainer(entity),
      isExpanded: isExpandedContainer(entity)
    };
  });
  if (measured.length === 0) {
    return { scope, runKey, axis: stack.axis, width: 0, height: 0, placements: [], emitGutters: () => [] };
  }
  const crossSize = Math.max(...measured.map((item) => horizontal ? item.height : item.width));
  const placements = [];
  const gutterSpecs = [];
  let cursor = 0;
  measured.forEach((item, idx) => {
    const effectiveCross = effectiveAlign(crossAlign, item.isExpanded);
    const alignedCross = alignWithin(0, crossSize, horizontal ? item.height : item.width, effectiveCross, item.isExpanded);
    placements.push({
      entity: item.entity,
      relX: clean2(horizontal ? cursor : alignedCross.pos),
      relY: clean2(horizontal ? alignedCross.pos : cursor),
      width: horizontal ? item.width : alignedCross.size,
      height: horizontal ? alignedCross.size : item.height,
      stretchX: !horizontal && alignedCross.stretched,
      stretchY: horizontal && alignedCross.stretched
    });
    cursor += horizontal ? item.width : item.height;
    const next = measured[idx + 1];
    if (next !== void 0) {
      const z = item.isContainer || next.isContainer;
      const id = `${runKey}|${horizontal ? "along" : "across"}|${String(idx)}`;
      const { gap, base } = resolveBoundaryGap(id, z, horizontal ? rowGaps.cardX : rowGaps.cardY, zoneGutter, horizontal ? rowGaps.maxX : rowGaps.maxY, widen);
      gutterSpecs.push({ id, start: cursor, gap, base, zone: z });
      cursor += gap;
    }
  });
  const width = horizontal ? cursor : crossSize;
  const height = horizontal ? crossSize : cursor;
  return {
    scope,
    runKey,
    axis: stack.axis,
    width,
    height,
    placements,
    emitGutters: (originX, originY) => gutterSpecs.map((g) => ({
      id: g.id,
      horizontal: !horizontal,
      strips: [
        horizontal ? { x: originX + g.start, y: originY, width: g.gap, height: crossSize } : { x: originX, y: originY + g.start, width: crossSize, height: g.gap }
      ],
      gap: g.gap,
      base: g.base,
      authoredBase: false,
      max: horizontal ? rowGaps.maxX : rowGaps.maxY,
      zone: g.zone
    }))
  };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/registry.js
var DIAGRAM_GLYPH_BASE = "M8 53L32 44L56 53L32 62Z";
function glyph(face, line, extra) {
  return {
    base: DIAGRAM_GLYPH_BASE,
    face,
    ...line === void 0 || line === "" ? {} : { line },
    ...extra
  };
}
var DIAGRAM_GLYPHS = {
  base: glyph("M10 12H54V48H10Z", "M18 22H46M18 32H40"),
  // --- radar-immobilier fa8133c2 (19): interiors preserved verbatim, base
  // replaced by the canonical diamond (§9.1, DIF-12) ---
  s3: glyph("M12 18Q32 6 52 18L47 47Q32 58 17 47Z", "M12 18Q32 30 52 18M18 29Q32 38 46 29", {
    text: "S3"
  }),
  postgres: glyph("M12 16Q32 4 52 16V47Q32 59 12 47Z", "M12 16Q32 28 52 16M12 28Q32 40 52 28M12 40Q32 52 52 40"),
  cluster: glyph("M32 7L54 20V44L32 57L10 44V20Z", "M32 19V32M21 26L32 32L43 26M32 32V46M32 32L20 40M32 32L44 40"),
  web: glyph("M8 12H56V49H8Z", "M8 23H56M15 18H17M22 18H24M16 31H30V42H16ZM37 32H48M37 40H48"),
  api: glyph("M8 12H56V50H8Z", "M22 24L15 31L22 38M42 24L49 31L42 38M35 22L29 40"),
  cronjob: glyph("M32 8A24 24 0 1 1 31.9 8Z", "M32 16V32L43 39M17 16L12 21M47 16L52 21"),
  identity: glyph("M32 6L52 14V31Q50 48 32 58Q14 48 12 31V14Z", "M26 29V24A6 6 0 0 1 38 24V29M23 29H41V42H23ZM32 34V37"),
  workstation: glyph("M8 10H56V42H8Z", "M13 15H51V37H13ZM24 43V51M40 43V51M17 53H47M18 23L24 27L18 31M30 31H39"),
  document: glyph("M15 6H37L50 19V57H15Z", "M37 6V19H50M23 28H42M23 36H42M23 44H35"),
  map: glyph("M7 16L24 9L41 16L57 9V49L41 56L24 49L7 56Z", "M24 9V49M41 16V56M13 29L24 25L41 35L51 31"),
  join: glyph("M8 12H24V27H8ZM40 12H56V27H40ZM24 42H40V57H24Z", "M16 27V34H48V27M32 34V42", {
    darkLine: true
  }),
  graph: glyph("M7 10H23V26H7ZM41 10H57V26H41ZM24 42H40V58H24Z", "M23 18H41M15 26L27 42M49 26L37 42", { darkLine: true }),
  check: glyph("M14 8H50V57H14Z", "M23 8V15H41V8M23 35L30 42L43 27"),
  release: glyph("M12 31L32 20L52 31V50L32 61L12 50Z", "M12 31L32 42L52 31M32 42V61M32 5V25M24 13L32 5L40 13"),
  user: glyph("M22 17A10 10 0 1 1 42 17A10 10 0 1 1 22 17ZM12 54V44Q12 31 25 31H39Q52 31 52 44V54Z", "M20 44V54M44 44V54"),
  url: glyph("M32 7A25 25 0 1 1 31.9 7Z", "M7 32H57M12 19H52M12 45H52M32 7C16 19 16 45 32 57C48 45 48 19 32 7Z"),
  llm: glyph("M17 17H47V47H17Z", "M25 25H39V39H25ZM25 8V17M39 8V17M25 47V56M39 47V56M8 25H17M8 39H17M47 25H56M47 39H56"),
  network: glyph("M24 7H40V23H24ZM5 42H21V58H5ZM43 42H59V58H43Z", "M32 23V33M13 42V33H51V42", { darkLine: true }),
  unknown: glyph("M32 6L59 55H5Z", "M32 24V38M32 45V46"),
  // --- sentropic #711 via the hrpolnav kit (9): verbatim geometry on the
  // canonical base, 64-unit viewBox ---
  people: glyph("M22 10a8 8 0 1 1 0 16a8 8 0 1 1 0-16Z M42 14a7 7 0 1 1 0 14a7 7 0 1 1 0-14Z M8 46c0-9 6-15 14-15s14 6 14 15Z M34 46c0-8 4-13 9-13s12 5 12 13Z"),
  "window": glyph("M9 11h46v36H9Z", "M9 19h46 M16 28h32 M16 35h22"),
  server: glyph("M14 8h36v14H14Z M14 25h36v14H14Z", "M20 15h10 M20 32h10 M42 15h.1 M42 32h.1"),
  brain: glyph("M32 12c-4-7-15-5-16 3c-8 1-11 11-6 17c-5 8 0 17 8 17c5 5 12 3 14-2c2 5 9 7 14 2c8 0 13-9 8-17c5-6 2-16-6-17c-1-8-12-10-16-3Z", "M32 12v35 M16 15c0 6 4 9 9 9 M10 32c4-4 9-3 12 1 M18 49c-2-5 0-10 5-12 M48 15c0-6-4-9-9-9 M54 32c-4-4-9-3-12 1 M46 49c2-5 0-10-5-12"),
  robot: glyph("M14 16h36v31H14Z M8 25h6v13H8Z M50 25h6v13h-6Z M29 6h6v5h-6Z", "M32 11v5 M23 27h.1 M41 27h.1 M23 38h18"),
  link: glyph("M10 12h16v14H10Z M38 30h16v14H38Z", "M26 19h12v11", { darkLine: true }),
  db: glyph("M14 13c0-4 8-7 18-7s18 3 18 7v29c0 4-8 7-18 7s-18-3-18-7Z", "M14 13c0 4 8 7 18 7s18-3 18-7 M14 27c0 4 8 7 18 7s18-3 18-7"),
  shield: glyph("M32 7l20 7v13c0 12-8 20-20 25C20 47 12 39 12 27V14Z", "M23 29l6 6 12-13"),
  cloud: glyph("M18 44a10 10 0 0 1 0-20a14 14 0 0 1 27-4a11 11 0 0 1 3 24Z")
};
var DIAGRAM_GLYPH_NAMES = Object.keys(DIAGRAM_GLYPHS);
function getDiagramGlyph(name) {
  return Object.hasOwn(DIAGRAM_GLYPHS, name) ? DIAGRAM_GLYPHS[name] : void 0;
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/diagramCardModel.js
var CARD_GEOMETRY = {
  width: 460,
  height: 200,
  borderWidth: 2,
  accentWidth: 8,
  padding: 8,
  /** Card left edge → header icon left edge (accent 8 + padding 8). */
  headerInset: 16,
  iconSize: 70,
  iconTextGap: 6,
  kicker: { size: 22, weight: 400, lineHeight: 1.3, letterSpacingEm: 0.04 },
  title: { size: 32, weight: 700, lineHeight: 1.3 },
  /** Header row → body block. */
  gap: 6,
  body: { size: 24, weight: 400, lineHeight: 1.3 },
  /**
   * Edge-label text (BF-6): 18px so one line plus margins fits the 32px
   * gutter cap (22 + 2 × 4 = 30 ≤ 32). Mirrors the
   * `diagramScene.edgeLabelFontSize` / `edgeLabelLineHeight` tokens;
   * additive, frozen card sizes unchanged.
   */
  edgeLabel: { size: 18, weight: 400, lineHeight: 22 / 18 },
  /** Accent-bar left edge → first body glyph. */
  bodyInsetFromBar: 14,
  ruleHeight: 1,
  ruleMargin: 4,
  ruleInsetStart: 16,
  ruleInsetEnd: 10,
  footer: { size: 24, weight: 700, lineHeight: 1.3 },
  /** Footer text-box bottom → inner edge of the bottom border. */
  footerBottomInset: 9.25,
  /**
   * Title/kicker width reservation when the toggle slot is present
   * (hrpn tints.css `header { padding-right: 66px }`: the 66 px the +/−
   * control needs in the header's inline-end).
   */
  toggleAllocation: 66,
  /** The toggle slot box itself: the 32 px DS IconButton (sm) square. */
  toggleBoxSize: 32,
  toggleInset: 8,
  /**
   * Header text width of a folded card (toggle present, icon present):
   * the owner-pinned 290 px — the hrpn folded-card title width
   * (356 − 66 = 290). Plain cards keep `contentRight − headerTextX`
   * (358 px with the icon).
   */
  foldedHeaderTextWidth: 290,
  /** Card allocations, frozen-box-derived (see module doc). */
  allocatedLines: { kicker: 1, title: 2, body: 2, footer: 1 }
};
var CARD_GEOMETRY_V2 = {
  ...CARD_GEOMETRY,
  width: 352,
  height: 154,
  padding: 6,
  accentWidth: 6,
  headerInset: 12,
  iconSize: 52,
  iconTextGap: 4,
  /** Preserves v1's −2 px body-vs-header offset (`10 − 12 = −2`, matching `14 − 16`). */
  bodyInsetFromBar: 10,
  foldedHeaderTextWidth: 210,
  /** Title on one line first (addendum 8); v1 keeps two lines. */
  allocatedLines: { kicker: 1, title: 1, body: 2, footer: 1 }
};
function anatomyCardGeometry(anatomy) {
  return anatomy === "v2" ? CARD_GEOMETRY_V2 : CARD_GEOMETRY;
}
function resolveDiagramAlign(anatomy, align) {
  if (anatomy === "v1")
    return "left";
  return align ?? "left";
}
var FLOW_BADGE_GEOMETRY = { size: 16, lineHeight: 20 };
var EDGE_LABEL_GEOMETRY = { size: 18, weight: 400, lineHeight: 22 };
function lineBoxHeight(size) {
  return Math.floor(size * 1.3 * 64) / 64;
}
function baselineOf(top, size) {
  return top + (size === 24 ? 22 : size);
}
function projectCardProps(presentation, opts) {
  if (presentation === void 0 || presentation.form !== "card")
    return { kind: "label" };
  const title = presentation.text.title ?? "";
  if (title === "")
    return { kind: "label" };
  const bodyLines = [];
  if (presentation.text.body !== void 0 && presentation.text.body !== "") {
    bodyLines.push(presentation.text.body);
  }
  let detailCount = 0;
  if (presentation.text.detail !== void 0 && presentation.text.detail !== "") {
    bodyLines.push(presentation.text.detail);
    detailCount = 1;
  }
  const icon = presentation.icon ?? "base";
  return {
    kind: "card",
    props: {
      entityId: opts.entityId,
      ...presentation.text.kicker === void 0 || presentation.text.kicker === "" ? {} : { kicker: presentation.text.kicker },
      title,
      body: bodyLines,
      ...detailCount === 0 ? {} : { detailCount },
      ...presentation.text.footer === void 0 || presentation.text.footer === "" ? {} : { footer: presentation.text.footer },
      ...icon === void 0 ? {} : { icon },
      ...icon === void 0 || opts.resolveGlyph === void 0 ? {} : (() => {
        const glyph2 = opts.resolveGlyph(icon);
        return glyph2 === void 0 ? {} : { iconGlyph: glyph2 };
      })(),
      ...presentation.categoryRef === void 0 ? {} : { tone: presentation.categoryRef },
      ...presentation.proposed === void 0 ? {} : { proposed: presentation.proposed },
      ...opts.toggle === void 0 ? {} : { toggle: opts.toggle },
      ...(() => {
        const anatomy = presentation.anatomy ?? opts.anatomy;
        return anatomy === void 0 ? {} : { anatomy };
      })(),
      ...(() => {
        const align = presentation.align ?? opts.align;
        return align === void 0 ? {} : { align };
      })()
    }
  };
}
function createCardMeasure(widthOf, version, breakWords = false, lineHeightOf) {
  return Object.assign((text3, role3, availableWidth) => {
    const lines = [];
    let tooWide = false;
    for (const paragraph of text3.split("\n")) {
      let line = "";
      let spaced = false;
      for (const token of paragraph.match(/\s+|[^\s·/_.-]+[·/_.-]?|[·/_.-]/gu) ?? []) {
        if (/^\s+$/.test(token)) {
          spaced = true;
          continue;
        }
        const join = spaced && line !== "" ? " " : "";
        spaced = false;
        const candidate = line + join + token;
        if (line !== "" && widthOf(candidate, role3) > availableWidth) {
          lines.push(line);
          line = "";
        }
        if (breakWords && widthOf(token, role3) > availableWidth) {
          for (const char of token) {
            if (line !== "" && widthOf(line + char, role3) > availableWidth) {
              lines.push(line);
              line = "";
            }
            line += char;
            if (widthOf(char, role3) > availableWidth)
              tooWide = true;
          }
        } else {
          line = line === "" ? token : candidate;
          if (widthOf(token, role3) > availableWidth)
            tooWide = true;
        }
      }
      if (line !== "")
        lines.push(line);
    }
    const lineHeight = lineHeightOf?.(role3);
    return { lines, tooWide, lineWidths: lines.map((line) => widthOf(line, role3)), ...lineHeight === void 0 ? {} : { lineHeight } };
  }, { version });
}
function sceneCardMeasure(measure2) {
  const version = measure2.version;
  if (version?.endsWith(":scene-wrap") || measure2("Mm09", "body", 1e3, 1).lineWidths === void 0)
    return measure2;
  return createCardMeasure((text3, role3) => {
    const measured = measure2(text3, role3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const width = Math.max(0, ...measured.lineWidths ?? [text3.length * CARD_GEOMETRY[role3].size]);
    return measure2 === defaultCardMeasure ? width === 0 ? 0 : (width - 2) * CARD_FALLBACK_WIDTH_FACTOR + 2 : width;
  }, `${version ?? "inter-fallback-1.12-v2"}:scene-wrap`, true, (role3) => measure2("Mg", role3, 1e3, 1).lineHeight);
}
var CARD_ADVANCES_TITLE = {
  "0": 0.67,
  "1": 0.43,
  "2": 0.63,
  "3": 0.65,
  "4": 0.68,
  "5": 0.62,
  "6": 0.65,
  "7": 0.58,
  "8": 0.65,
  "9": 0.65,
  "\n": 0.24,
  " ": 0.24,
  '"': 0.55,
  "#": 0.65,
  "%": 1.02,
  "&": 0.67,
  "'": 0.34,
  "(": 0.38,
  ")": 0.38,
  "*": 0.56,
  "+": 0.68,
  ",": 0.33,
  "-": 0.47,
  ".": 0.33,
  "/": 0.39,
  ":": 0.33,
  ";": 0.34,
  "<": 0.68,
  "=": 0.68,
  ">": 0.68,
  "@": 1.02,
  "A": 0.75,
  "B": 0.66,
  "C": 0.74,
  "D": 0.72,
  "E": 0.61,
  "F": 0.59,
  "G": 0.75,
  "H": 0.75,
  "I": 0.28,
  "J": 0.58,
  "K": 0.72,
  "L": 0.57,
  "M": 0.93,
  "N": 0.76,
  "O": 0.77,
  "P": 0.65,
  "Q": 0.78,
  "R": 0.66,
  "S": 0.65,
  "T": 0.67,
  "U": 0.73,
  "V": 0.75,
  "W": 1.04,
  "X": 0.74,
  "Y": 0.73,
  "Z": 0.66,
  "[": 0.38,
  "\\": 0.39,
  "]": 0.38,
  "_": 0.48,
  "a": 0.58,
  "b": 0.63,
  "c": 0.59,
  "d": 0.63,
  "e": 0.6,
  "f": 0.4,
  "g": 0.63,
  "h": 0.62,
  "i": 0.27,
  "j": 0.27,
  "k": 0.58,
  "l": 0.27,
  "m": 0.91,
  "n": 0.62,
  "o": 0.61,
  "p": 0.63,
  "q": 0.63,
  "r": 0.41,
  "s": 0.56,
  "t": 0.37,
  "u": 0.62,
  "v": 0.6,
  "w": 0.85,
  "x": 0.58,
  "y": 0.6,
  "z": 0.57,
  "{": 0.47,
  "}": 0.47,
  "\xA7": 0.57,
  "\xAB": 0.66,
  "\xB7": 0.33,
  "\xBB": 0.66,
  "\xC0": 0.75,
  "\xC7": 0.74,
  "\xC8": 0.61,
  "\xC9": 0.61,
  "\xD7": 0.68,
  "\xE0": 0.58,
  "\xE2": 0.58,
  "\xE7": 0.59,
  "\xE8": 0.6,
  "\xE9": 0.6,
  "\xEA": 0.6,
  "\xEE": 0.27,
  "\xF4": 0.61,
  "\xF9": 0.62,
  "\u2013": 0.5,
  "\u2019": 0.31,
  "\u2026": 1,
  "\u2192": 1,
  "\u2194": 1,
  "\u2260": 0.83203,
  "\u2265": 0.83203
};
var CARD_ADVANCES_BODY = {
  "0": 0.59961,
  "1": 0.59961,
  "2": 0.59961,
  "3": 0.59961,
  "4": 0.59961,
  "5": 0.59961,
  "6": 0.59961,
  "7": 0.59961,
  "8": 0.59961,
  "9": 0.59961,
  "\n": 0.2998,
  " ": 0.2998,
  '"': 0.45996,
  "#": 0.59961,
  "%": 0.69922,
  "&": 0.67969,
  "'": 0.2998,
  "(": 0.2998,
  ")": 0.2998,
  "*": 0.59961,
  "+": 0.59961,
  ",": 0.2998,
  "-": 0.2998,
  ".": 0.2998,
  "/": 0.51953,
  ":": 0.2998,
  ";": 0.2998,
  "<": 0.59961,
  "=": 0.59961,
  ">": 0.59961,
  "@": 0.7998,
  "A": 0.55957,
  "B": 0.61914,
  "C": 0.61914,
  "D": 0.65918,
  "E": 0.55957,
  "F": 0.47949,
  "G": 0.65918,
  "H": 0.65918,
  "I": 0.25977,
  "J": 0.39941,
  "K": 0.61914,
  "L": 0.5,
  "M": 0.81934,
  "N": 0.65918,
  "O": 0.65918,
  "P": 0.55957,
  "Q": 0.65918,
  "R": 0.61914,
  "S": 0.61914,
  "T": 0.5,
  "U": 0.63965,
  "V": 0.55957,
  "W": 0.81934,
  "X": 0.53906,
  "Y": 0.55957,
  "Z": 0.53906,
  "[": 0.2998,
  "\\": 0.51953,
  "]": 0.2998,
  "_": 0.5,
  "a": 0.53906,
  "b": 0.53906,
  "c": 0.47949,
  "d": 0.53906,
  "e": 0.53906,
  "f": 0.2998,
  "g": 0.5,
  "h": 0.53906,
  "i": 0.23926,
  "j": 0.21973,
  "k": 0.5,
  "l": 0.23926,
  "m": 0.81934,
  "n": 0.53906,
  "o": 0.53906,
  "p": 0.53906,
  "q": 0.53906,
  "r": 0.31934,
  "s": 0.51953,
  "t": 0.31934,
  "u": 0.53906,
  "v": 0.43945,
  "w": 0.65918,
  "x": 0.43945,
  "y": 0.41992,
  "z": 0.41992,
  "{": 0.2998,
  "}": 0.2998,
  "\xA7": 0.59961,
  "\xAB": 0.39941,
  "\xB7": 0.23926,
  "\xBB": 0.39941,
  "\xC0": 0.55957,
  "\xC7": 0.61914,
  "\xC8": 0.55957,
  "\xC9": 0.55957,
  "\xD7": 0.59961,
  "\xE0": 0.53906,
  "\xE2": 0.53906,
  "\xE7": 0.47949,
  "\xE8": 0.53906,
  "\xE9": 0.53906,
  "\xEA": 0.53906,
  "\xEE": 0.23926,
  "\xF4": 0.53906,
  "\xF9": 0.53906,
  "\u2013": 0.55566,
  "\u2019": 0.22168,
  "\u2026": 1,
  "\u2192": 1,
  "\u2194": 1,
  "\u2260": 0.83203,
  "\u2265": 0.83203
};
var CARD_FALLBACK_WIDTH_FACTOR = 1.12;
var DEFAULT_CARD_MEASURER_VERSION = "inter-fallback-1.12-v2";
function defaultCardMeasure(text3, role3, availableWidth) {
  const size = role3 === "kicker" ? CARD_GEOMETRY.kicker.size : role3 === "title" ? CARD_GEOMETRY.title.size : role3 === "footer" ? CARD_GEOMETRY.footer.size : CARD_GEOMETRY.body.size;
  const table = role3 === "title" || role3 === "footer" ? CARD_ADVANCES_TITLE : CARD_ADVANCES_BODY;
  const letterSpacing = role3 === "kicker" ? size * CARD_GEOMETRY.kicker.letterSpacingEm : 0;
  const measureString = (value) => {
    if (value.length === 0)
      return 0;
    const normalized = role3 === "kicker" ? value.toUpperCase() : value;
    let sum = 0;
    for (const char of normalized) {
      sum += (table[char] ?? 0.7) * size + letterSpacing;
    }
    return sum + 2;
  };
  return createCardMeasure(measureString, DEFAULT_CARD_MEASURER_VERSION, true)(text3, role3, availableWidth, Number.MAX_SAFE_INTEGER);
}
function cardLineMeasurer(measure2 = defaultCardMeasure) {
  return Object.assign((request) => {
    const role3 = request.role === "kicker" || request.role === "title" || request.role === "footer" ? request.role : "body";
    if (request.role === "edge-label" || request.role === "flow-badge") {
      const labelSize = request.role === "flow-badge" ? FLOW_BADGE_GEOMETRY.size : EDGE_LABEL_GEOMETRY.size;
      const labelHeight = request.role === "flow-badge" ? FLOW_BADGE_GEOMETRY.lineHeight : EDGE_LABEL_GEOMETRY.lineHeight;
      const scale = labelSize / CARD_GEOMETRY.body.size;
      const label = measure2(request.text, "body", request.availableWidth / scale, request.allocatedLines);
      return {
        lines: label.lines,
        width: label.lineWidths === void 0 ? request.availableWidth : Math.max(0, ...label.lineWidths) * scale,
        height: label.lines.length * Math.max(labelHeight, (label.lineHeight ?? 0) * scale),
        overflow: label.tooWide || label.lines.length > request.allocatedLines
      };
    }
    const measured = measure2(request.text, role3, request.availableWidth, request.allocatedLines);
    const size = role3 === "kicker" ? CARD_GEOMETRY.kicker.size : role3 === "title" ? CARD_GEOMETRY.title.size : CARD_GEOMETRY.body.size;
    const widest = measured.lineWidths === void 0 ? request.availableWidth : Math.max(0, ...measured.lineWidths);
    return {
      lines: measured.lines,
      width: widest,
      height: measured.lines.length * lineBoxHeight(size),
      overflow: measured.tooWide || measured.lines.length > request.allocatedLines
    };
  }, { version: measure2.version ?? DEFAULT_CARD_MEASURER_VERSION });
}
function headerSlotGeometry(opts) {
  const g = CARD_GEOMETRY;
  const kickerHeight = lineBoxHeight(g.kicker.size);
  const titleHeight = lineBoxHeight(g.title.size);
  const contentHeight = opts.kickerLines * kickerHeight + opts.titleLines * titleHeight;
  const iconSize = opts.iconSize ?? g.iconSize;
  const blockHeight = opts.hasIcon ? Math.max(iconSize, contentHeight) : contentHeight;
  return {
    kickerHeight,
    titleHeight,
    contentHeight,
    blockHeight,
    textTopOffset: (blockHeight - contentHeight) / 2,
    iconTopOffset: opts.hasIcon ? (blockHeight - iconSize) / 2 : 0
  };
}
function truncateSlot(text3, role3, width, budget, measure2, report) {
  const measured = measure2(text3, role3, width, budget);
  const fits = (line) => {
    const value = measure2(line, role3, width, 1);
    return !value.tooWide && value.lines.length <= 1 && (value.lineWidths?.[0] ?? width) <= width;
  };
  const lines = measured.lines.slice(0, budget).map((line, index) => {
    if (measured.lineWidths?.[index] !== void 0 && measured.lineWidths[index] <= width || fits(line))
      return line;
    return shorten(line);
  });
  function shorten(line) {
    const chars = [...line];
    while (chars.length > 0 && !fits(chars.join("").trimEnd() + "\u2026"))
      chars.pop();
    const prefix = chars.join("").trimEnd();
    const word = prefix.replace(/\s+\S*$/u, "");
    return (word && word !== prefix ? word : prefix) + "\u2026";
  }
  if (measured.lines.length > budget && lines.length > 0)
    lines[lines.length - 1] = shorten(lines.at(-1).replace(/…$/u, ""));
  if (measured.lines.length > budget || lines.some((line, index) => line !== measured.lines[index])) {
    report({
      neededPx: measured.lines.length * lineBoxHeight(CARD_GEOMETRY[role3].size),
      allocatedPx: budget * lineBoxHeight(CARD_GEOMETRY[role3].size),
      text: text3,
      severity: "info",
      reason: "truncated",
      hiddenLength: Math.max(1, text3.length - lines.join(" ").replaceAll("\u2026", "").length)
    });
  }
  return lines;
}
function cardFullText(props) {
  return [props.kicker, props.title, ...props.body, props.footer].filter(Boolean).join("\n");
}
function zoneFullText(props) {
  return [props.kicker, props.title, props.subtitle, props.footer].filter(Boolean).join("\n");
}
function layoutCardAt(props, measure2, anatomy, align) {
  const icon = props.icon ?? "base";
  const suppressed = icon === "none";
  const missing = !suppressed && props.iconGlyph === void 0 && getDiagramGlyph(icon) === void 0;
  props = {
    ...props,
    autoSize: props.autoSize ?? true,
    icon: missing ? "unknown" : icon,
    iconGlyph: suppressed ? { face: "" } : props.iconGlyph ?? getDiagramGlyph(icon) ?? getDiagramGlyph("unknown")
  };
  const g = anatomyCardGeometry(anatomy);
  const diagnostics = missing ? [{ code: "card-icon-missing", slot: "icon", entityId: props.entityId, neededPx: 1, allocatedPx: 0 }] : [];
  const bodyMode = props.bodyMode ?? "leaf";
  const contentTop = g.borderWidth + g.padding;
  const contentRight = g.width - g.borderWidth - g.padding;
  const hasIcon = !suppressed && props.icon !== void 0 && props.iconGlyph !== void 0;
  const headerTextX = hasIcon ? g.headerInset + g.iconSize + g.iconTextGap : g.headerInset;
  const toggle = props.toggle !== void 0;
  const headerTextWidth = toggle ? hasIcon ? g.foldedHeaderTextWidth : contentRight - g.toggleAllocation - headerTextX : contentRight - headerTextX;
  const headerAnchor = align === "center" ? "middle" : "start";
  const headerLineX = align === "center" ? headerTextX + headerTextWidth / 2 : headerTextX;
  const fitSlot = (text3, role3, width, budget, slot = role3) => truncateSlot(text3, role3, width, budget, measure2, (diagnostic2) => diagnostics.push({ ...diagnostic2, code: "card-overflow", slot, entityId: props.entityId }));
  if (missing) {
    diagnostics.push({
      code: "card-icon-unknown",
      slot: "icon",
      entityId: props.entityId,
      neededPx: 1,
      allocatedPx: 0
    });
  }
  const kickerTexts = props.kicker === void 0 ? [] : fitSlot(props.kicker, "kicker", headerTextWidth, g.allocatedLines.kicker);
  const footerReserve = props.footer === void 0 ? g.borderWidth + g.padding : lineBoxHeight(g.footer.size) + g.ruleHeight + 2 * g.ruleMargin + g.borderWidth + g.footerBottomInset;
  const titleBudget = Math.max(1, Math.min(g.allocatedLines.title, Math.floor((g.height - contentTop - g.gap - footerReserve - (props.body.length > 0 ? lineBoxHeight(g.body.size) : 0) - kickerTexts.length * lineBoxHeight(g.kicker.size)) / lineBoxHeight(g.title.size))));
  const titleTexts = fitSlot(props.title, "title", headerTextWidth, titleBudget);
  const headerGeo = headerSlotGeometry({
    hasIcon,
    kickerLines: kickerTexts.length,
    titleLines: titleTexts.length,
    iconSize: g.iconSize
  });
  const kickerHeight = headerGeo.kickerHeight;
  const titleHeight = headerGeo.titleHeight;
  const headerBlockHeight = headerGeo.blockHeight;
  const textTop = contentTop + headerGeo.textTopOffset;
  const iconBox = hasIcon ? { x: g.headerInset, y: contentTop + headerGeo.iconTopOffset, size: g.iconSize } : void 0;
  const bodyHeight = lineBoxHeight(g.body.size);
  const bodyY = contentTop + headerBlockHeight + g.gap;
  const subtitleMode = bodyMode === "subtitle";
  const subtitleMeasure = g.width - 2 * (anatomyZoneGeometry(anatomy).collapsedInset + anatomyZoneGeometry(anatomy).collapsedSubtitleMarginInline);
  const bodyTextX = subtitleMode ? (g.width - subtitleMeasure) / 2 : g.bodyInsetFromBar;
  const bodyWidth = subtitleMode ? subtitleMeasure : contentRight - bodyTextX;
  const bodyAnchor = "middle";
  const bodyLineX = bodyTextX + bodyWidth / 2;
  const wrappedBody = [];
  let detailLines = 0;
  for (const [bodyIndex, line] of props.body.entries()) {
    const measured = measure2(line, "body", bodyWidth, g.allocatedLines.body);
    wrappedBody.push(...measured.lines);
    if (bodyIndex >= props.body.length - (props.detailCount ?? 0))
      detailLines += measured.lines.length;
  }
  const bodySlot = subtitleMode ? "collapsed-subtitle" : "body";
  const bodySourceText = props.body.join("\n");
  const footerHeight = lineBoxHeight(g.footer.size);
  const footerBottom = g.height - g.borderWidth - g.footerBottomInset;
  let footerLines = [];
  let ruleY;
  if (props.footer !== void 0) {
    const footerWidth = contentRight - g.headerInset;
    const footerTexts = fitSlot(props.footer, "footer", footerWidth, g.allocatedLines.footer);
    const footerAnchor = align === "center" ? "middle" : "start";
    const footerLineX = footerAnchor === "middle" ? g.headerInset + footerWidth / 2 : g.headerInset;
    const footerBlockHeight = footerTexts.length * footerHeight;
    footerLines = footerTexts.map((text3, index) => ({
      text: text3,
      x: footerLineX,
      baseline: baselineOf(footerBottom - footerBlockHeight + index * footerHeight, g.footer.size),
      size: g.footer.size,
      weight: g.footer.weight,
      secondary: false,
      anchor: footerAnchor
    }));
    ruleY = footerBottom - footerBlockHeight - g.ruleHeight - g.ruleMargin;
  }
  const bodyAreaBottom = ruleY === void 0 ? g.height - g.borderWidth - g.padding : ruleY - g.ruleMargin;
  const bodyBudget = Math.max(0, Math.floor((bodyAreaBottom - bodyY) / bodyHeight));
  const bodyTexts = fitSlot(bodySourceText, "body", bodyWidth, bodyBudget, bodySlot);
  const bodyBlockTop = bodyY + Math.max(0, (bodyAreaBottom - bodyY - bodyTexts.length * bodyHeight) / 2);
  const detailStart = wrappedBody.length - detailLines;
  const body = bodyTexts.map((text3, index) => ({
    text: text3,
    x: bodyLineX,
    baseline: baselineOf(bodyBlockTop + index * bodyHeight, g.body.size),
    size: g.body.size,
    weight: g.body.weight,
    secondary: !subtitleMode && index >= detailStart && (props.detailCount ?? 0) > 0,
    anchor: bodyAnchor
  }));
  const bodyBottom = bodyBlockTop + bodyTexts.length * bodyHeight;
  const kicker = kickerTexts.map((text3, index) => ({
    text: text3,
    x: headerLineX,
    baseline: baselineOf(textTop + index * kickerHeight, g.kicker.size),
    size: g.kicker.size,
    weight: g.kicker.weight,
    secondary: true,
    anchor: headerAnchor
  }));
  const titleTop = textTop + kickerTexts.length * kickerHeight;
  const title = titleTexts.map((text3, index) => ({
    text: text3,
    x: headerLineX,
    baseline: baselineOf(titleTop + index * titleHeight, g.title.size),
    size: g.title.size,
    weight: g.title.weight,
    secondary: false,
    anchor: headerAnchor
  }));
  const toggleBox = props.toggle === void 0 ? void 0 : {
    x: g.width - g.toggleInset - g.toggleBoxSize,
    y: g.toggleInset,
    size: g.toggleBoxSize
  };
  return {
    icon: { name: props.icon, glyph: props.iconGlyph },
    box: { width: g.width, height: g.height },
    contentTop,
    contentRight,
    ...iconBox === void 0 ? {} : { iconBox },
    headerTextX,
    headerTextWidth,
    kicker,
    title,
    headerBlockHeight,
    bodyX: bodyTextX,
    bodyWidth,
    bodyArea: { top: bodyY, bottom: bodyAreaBottom },
    body,
    bodyBottom,
    ...ruleY === void 0 ? {} : { ruleY },
    ruleX1: g.ruleInsetStart,
    ruleX2: g.width - g.ruleInsetEnd,
    footerLines,
    footerBottom,
    ...toggleBox === void 0 ? {} : { toggleBox },
    diagnostics
  };
}
function layoutCard(props, measure2) {
  const align = resolveDiagramAlign(props.anatomy, props.align);
  const primary = layoutCardAt(props, measure2, props.anatomy, align);
  if (props.anatomy !== "v2")
    return primary;
  const v2Overflows = primary.diagnostics.filter((diagnostic2) => diagnostic2.code === "card-overflow");
  if (v2Overflows.length === 0)
    return primary;
  const fallback = layoutCardAt(props, measure2, "v1", "left");
  const stillOverflows = fallback.diagnostics.some((diagnostic2) => diagnostic2.code === "card-overflow");
  const diagnostics = stillOverflows ? [...fallback.diagnostics] : [
    ...fallback.diagnostics,
    ...v2Overflows.map((diagnostic2) => ({
      code: "card-overflow",
      slot: diagnostic2.slot,
      entityId: diagnostic2.entityId,
      neededPx: diagnostic2.neededPx,
      allocatedPx: diagnostic2.allocatedPx,
      ...diagnostic2.text === void 0 ? {} : { text: diagnostic2.text },
      severity: "info",
      reason: "fallback-v1"
    }))
  ];
  return {
    ...fallback,
    anatomyFallback: "v1",
    diagnostics
  };
}
var ZONE_GEOMETRY = {
  radius: 0,
  borderWidth: 1.5,
  // Shared with the atomic card by construction (one geometry source §5.6):
  // every field below aliases CARD_GEOMETRY unless the zone frame differs.
  headerInset: CARD_GEOMETRY.headerInset,
  iconSize: CARD_GEOMETRY.iconSize,
  iconTextGap: CARD_GEOMETRY.iconTextGap,
  kicker: CARD_GEOMETRY.kicker,
  title: CARD_GEOMETRY.title,
  subtitle: CARD_GEOMETRY.body,
  /** Rendered title → subtitle gap: alias of the card `gap` (§6.4). */
  subtitleGap: CARD_GEOMETRY.gap,
  headerRuleGap: 4,
  contentInsetTop: DIAGRAM_SCENE_SPACING.containerPadding,
  contentInsetBottom: DIAGRAM_SCENE_SPACING.containerPadding,
  contentInsetInline: DIAGRAM_SCENE_SPACING.containerPadding,
  ruleHeight: CARD_GEOMETRY.ruleHeight,
  ruleMargin: CARD_GEOMETRY.ruleMargin,
  ruleInsetStart: CARD_GEOMETRY.ruleInsetStart,
  ruleInsetEnd: CARD_GEOMETRY.ruleInsetEnd,
  footer: CARD_GEOMETRY.footer,
  footerBottomInset: CARD_GEOMETRY.footerBottomInset,
  toggleAllocation: CARD_GEOMETRY.toggleAllocation,
  toggleBoxSize: CARD_GEOMETRY.toggleBoxSize,
  /**
   * Expanded toggle top inset: the frozen SVG places every zone toggle at
   * `y + 10` (flush under the frame's top edge), while the header band
   * starts at `y + 16`.
   */
  toggleTopInset: CARD_GEOMETRY.toggleInset,
  toggleInset: CARD_GEOMETRY.toggleInset,
  /**
   * Expanded header text inset from the frame's left edge: the kit wraps
   * kicker/title at `width − 178` (icon 16 + 70 + gap 6, toggle room, right
   * inset) — 314 px at the PEOPLE width 492.
   */
  headerTextInset: 178,
  collapsedWidth: CARD_GEOMETRY.width,
  collapsedHeight: CARD_GEOMETRY.height,
  collapsedInset: 16,
  collapsedSubtitleMarginInline: 16,
  allocatedLines: { kicker: 1, title: 2, subtitle: 2, footer: 1 }
};
var ZONE_GEOMETRY_V2 = {
  ...ZONE_GEOMETRY,
  headerInset: CARD_GEOMETRY_V2.headerInset,
  iconSize: CARD_GEOMETRY_V2.iconSize,
  iconTextGap: CARD_GEOMETRY_V2.iconTextGap,
  /**
   * Expanded header text inset for v2: `12 + 52 + 4 + 86 = 154` so the
   * inline-end toggle reserve stays `86 px` (matching v1) instead of
   * growing to `110 px`.
   */
  headerTextInset: 154,
  collapsedWidth: CARD_GEOMETRY_V2.width,
  collapsedHeight: CARD_GEOMETRY_V2.height,
  collapsedInset: 12,
  collapsedSubtitleMarginInline: 12,
  allocatedLines: { kicker: 1, title: 1, subtitle: 2, footer: 1 }
};
function anatomyZoneGeometry(anatomy) {
  return anatomy === "v2" ? ZONE_GEOMETRY_V2 : ZONE_GEOMETRY;
}
function normalizeZoneDepth(depth) {
  if (depth === void 0 || !Number.isFinite(depth))
    return 0;
  return Math.max(0, Math.floor(depth));
}
function zoneDepthSurface(depth, startParity = 0) {
  return (normalizeZoneDepth(depth) + startParity) % 2 === 0 ? "surface1" : "surface2";
}
var COLLAPSED_SUBTITLE_MEASURE = ZONE_GEOMETRY.collapsedWidth - 2 * (ZONE_GEOMETRY.collapsedInset + ZONE_GEOMETRY.collapsedSubtitleMarginInline);
function zoneCollapsedCardProps(props) {
  props = { ...props, icon: props.icon ?? "cluster" };
  return {
    ...props.autoSize === void 0 ? {} : { autoSize: props.autoSize },
    ...props.height === void 0 ? {} : { height: props.height },
    ...props.anatomy === void 0 ? {} : { anatomy: props.anatomy },
    entityId: props.entityId,
    ...props.kicker === void 0 ? {} : { kicker: props.kicker },
    title: props.title,
    body: props.subtitle === void 0 || props.subtitle === "" ? [] : [props.subtitle],
    ...props.footer === void 0 ? {} : { footer: props.footer },
    ...props.icon === void 0 ? {} : { icon: props.icon },
    ...props.iconGlyph === void 0 ? {} : { iconGlyph: props.iconGlyph },
    ...props.tone === void 0 ? {} : { tone: props.tone },
    ...props.proposed === void 0 ? {} : { proposed: props.proposed },
    ...props.toggleLabel === void 0 ? {} : { toggle: { collapsed: true, label: props.toggleLabel } },
    ...props.align === void 0 ? {} : { align: props.align },
    // A folded zone keeps its depth background (owner addendum 1); no pin
    // means no surface key, so unthreaded cards render byte-identical.
    ...props.depth === void 0 && props.depthParityStart === void 0 ? {} : { surface: zoneDepthSurface(props.depth, props.depthParityStart) },
    bodyMode: "subtitle"
  };
}
function childLayoutHeight(child, measure2) {
  if (child.kind === "card")
    return child.card === void 0 ? CARD_GEOMETRY.height : layoutCard(child.card, measure2).box.height;
  if (child.zone === void 0)
    return ZONE_GEOMETRY.collapsedHeight;
  return layoutZone(child.zone, measure2, child.children ?? []).box.height;
}
function layoutZone(props, measure2, children = []) {
  const icon = props.icon ?? "cluster";
  const suppressed = icon === "none";
  const missing = !suppressed && props.iconGlyph === void 0 && getDiagramGlyph(icon) === void 0;
  props = {
    ...props,
    autoSize: props.autoSize ?? true,
    icon: missing ? "unknown" : icon,
    iconGlyph: suppressed ? { face: "" } : props.iconGlyph ?? getDiagramGlyph(icon) ?? getDiagramGlyph("unknown")
  };
  const g = { ...anatomyZoneGeometry(props.anatomy), ...props.containerPadding === void 0 ? {} : { contentInsetTop: props.containerPadding, contentInsetBottom: props.containerPadding, contentInsetInline: props.containerPadding } };
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const diagnostics = missing ? [{ code: "card-icon-missing", slot: "icon", entityId: props.entityId, neededPx: 1, allocatedPx: 0 }] : [];
  const hasDepthPins = props.depth !== void 0 || props.depthParityStart !== void 0;
  const depth = normalizeZoneDepth(props.depth);
  const surface = zoneDepthSurface(props.depth, props.depthParityStart);
  if (props.reportSurfaceSame === true && surface === "surface1" && children.some((child) => child.kind === "card" && child.zone === void 0 && child.card?.tone === void 0)) {
    diagnostics.push({ code: "zone-surface-same", slot: "surface", entityId: props.entityId, neededPx: 1, allocatedPx: 0 });
  }
  if (missing) {
    diagnostics.push({
      code: "zone-icon-unknown",
      slot: "icon",
      entityId: props.entityId,
      neededPx: 1,
      allocatedPx: 0
    });
  }
  if (props.collapsed) {
    const card = layoutCard(zoneCollapsedCardProps(props), measure2);
    for (const diagnostic2 of card.diagnostics) {
      diagnostics.push({
        code: diagnostic2.code === "card-icon-missing" ? "card-icon-missing" : diagnostic2.code === "card-icon-unknown" ? "zone-icon-unknown" : diagnostic2.code === "card-grown" ? "zone-grown" : "zone-overflow",
        slot: diagnostic2.slot,
        entityId: diagnostic2.entityId,
        neededPx: diagnostic2.neededPx,
        allocatedPx: diagnostic2.allocatedPx,
        ...diagnostic2.text === void 0 ? {} : { text: diagnostic2.text },
        ...diagnostic2.severity === void 0 ? {} : { severity: diagnostic2.severity },
        ...diagnostic2.reason === void 0 ? {} : { reason: diagnostic2.reason },
        ...diagnostic2.hiddenLength === void 0 ? {} : { hiddenLength: diagnostic2.hiddenLength }
      });
    }
    return {
      icon: { name: props.icon, glyph: props.iconGlyph },
      box: { x, y, width: card.box.width, height: card.box.height },
      collapsed: true,
      ...hasDepthPins ? { surface, depth } : {},
      card,
      diagnostics
    };
  }
  const width = props.width ?? g.collapsedWidth;
  const contentRight = x + width - g.contentInsetInline;
  const hasIcon = !suppressed && props.icon !== void 0 && props.iconGlyph !== void 0;
  const headerTextX = hasIcon ? x + g.headerInset + g.iconSize + g.iconTextGap : x + g.headerInset;
  const rightHeaderReserve = props.toggleLabel === void 0 ? g.headerInset : g.headerTextInset - (g.headerInset + g.iconSize + g.iconTextGap);
  const headerTextWidth = Math.max(0, x + width - headerTextX - rightHeaderReserve);
  const align = resolveDiagramAlign(props.anatomy, props.align);
  const headerAnchor = align === "center" ? "middle" : "start";
  const headerLineX = align === "center" ? headerTextX + headerTextWidth / 2 : headerTextX;
  const fitSlot = (text3, role3, width2, budget, slot = role3) => truncateSlot(text3, role3, width2, budget, measure2, (diagnostic2) => diagnostics.push({ ...diagnostic2, code: "zone-overflow", slot, entityId: props.entityId }));
  const subtitleLineHeight = lineBoxHeight(g.subtitle.size);
  const kickerTexts = props.kicker === void 0 ? [] : fitSlot(props.kicker, "kicker", headerTextWidth, g.allocatedLines.kicker);
  const titleTexts = fitSlot(props.title, "title", headerTextWidth, g.allocatedLines.title);
  const headerGeo = headerSlotGeometry({
    hasIcon,
    kickerLines: kickerTexts.length,
    titleLines: titleTexts.length,
    iconSize: g.iconSize
  });
  const kickerHeight = headerGeo.kickerHeight;
  const titleHeight = headerGeo.titleHeight;
  const headerBlockHeight = headerGeo.blockHeight;
  const headerTop = y + g.headerInset;
  const textTop = headerTop + headerGeo.textTopOffset;
  const iconBox = hasIcon ? { x: x + g.headerInset, y: headerTop + headerGeo.iconTopOffset, size: g.iconSize } : void 0;
  const kicker = kickerTexts.map((text3, index) => ({
    text: text3,
    x: headerLineX,
    baseline: baselineOf(textTop + index * kickerHeight, g.kicker.size),
    size: g.kicker.size,
    weight: g.kicker.weight,
    secondary: true,
    anchor: headerAnchor
  }));
  const titleTop = textTop + kickerTexts.length * kickerHeight;
  const title = titleTexts.map((text3, index) => ({
    text: text3,
    x: headerLineX,
    baseline: baselineOf(titleTop + index * titleHeight, g.title.size),
    size: g.title.size,
    weight: g.title.weight,
    secondary: false,
    anchor: headerAnchor
  }));
  const subtitleX = x + g.headerInset;
  const subtitleWidth = Math.min(width, g.collapsedWidth) - g.ruleInsetStart - g.ruleInsetEnd;
  const subtitleAnchor = align === "center" ? "middle" : "start";
  const subtitleLineX = align === "center" ? subtitleX + subtitleWidth / 2 : subtitleX;
  const subtitleTexts = fitSlot(props.subtitle ?? "", "body", subtitleWidth, g.allocatedLines.subtitle, "subtitle");
  const subtitleTop = headerTop + headerBlockHeight + g.subtitleGap;
  const subtitle = subtitleTexts.map((text3, index) => ({
    text: text3,
    x: subtitleLineX,
    baseline: baselineOf(subtitleTop + index * subtitleLineHeight, g.subtitle.size),
    size: g.subtitle.size,
    weight: g.subtitle.weight,
    secondary: false,
    anchor: subtitleAnchor
  }));
  const subtitleBottom = subtitleTexts.length === 0 ? subtitleTop : subtitleTop + subtitleTexts.length * subtitleLineHeight;
  const ruleY = subtitleTexts.length > 0 ? subtitleBottom + g.headerRuleGap : headerTop + headerBlockHeight + g.headerRuleGap;
  const contentTop = ruleY + g.contentInsetTop;
  const footerHeight = lineBoxHeight(g.footer.size);
  const footerX = x + g.contentInsetInline;
  const footerWidth = x + width - g.contentInsetInline - footerX;
  const footerMeasured = props.footer === void 0 ? void 0 : measure2(props.footer, "footer", footerWidth, g.allocatedLines.footer);
  const footerTexts = fitSlot(props.footer ?? "", "footer", footerWidth, g.allocatedLines.footer);
  const footerBlockHeight = footerTexts.length * footerHeight;
  const childrenBottom = children.reduce((bottom, child) => Math.max(bottom, child.y + childLayoutHeight(child, measure2)), y);
  const footerReserve = footerTexts.length === 0 ? 0 : footerBlockHeight + g.ruleHeight + 2 * g.ruleMargin + g.footerBottomInset;
  const requiredHeight = Math.max(childrenBottom, contentTop) + g.contentInsetBottom - y + footerReserve;
  const height = props.autoSize ? Math.max(props.height ?? g.collapsedHeight, requiredHeight) : props.height ?? Math.max(g.collapsedHeight, requiredHeight);
  if (!props.autoSize && props.height !== void 0 && requiredHeight > props.height) {
    diagnostics.push({
      code: "zone-overflow",
      slot: "frame",
      entityId: props.entityId,
      neededPx: requiredHeight,
      allocatedPx: props.height,
      text: props.title
    });
  }
  const toggleBox = props.toggleLabel === void 0 ? void 0 : { x: x + width - g.toggleInset - g.toggleBoxSize, y: y + g.toggleInset, size: g.toggleBoxSize };
  const footerBottom = y + height - g.borderWidth - g.footerBottomInset;
  let footer = [];
  let footerRuleY;
  if (footerMeasured !== void 0) {
    const footerAnchor = align === "center" ? "middle" : "start";
    const footerLineX = footerAnchor === "middle" ? footerX + footerWidth / 2 : footerX;
    footer = footerTexts.map((text3, index) => ({
      text: text3,
      x: footerLineX,
      baseline: baselineOf(footerBottom - footerBlockHeight + index * footerHeight, g.footer.size),
      size: g.footer.size,
      weight: g.footer.weight,
      secondary: false,
      anchor: footerAnchor
    }));
    footerRuleY = footerBottom - footerBlockHeight - g.ruleHeight - g.ruleMargin;
  }
  return {
    icon: { name: props.icon, glyph: props.iconGlyph },
    box: { x, y, width, height },
    collapsed: false,
    ...hasDepthPins ? { surface, depth } : {},
    header: {
      ...iconBox === void 0 ? {} : { iconBox },
      headerTextX,
      headerTextWidth,
      kicker,
      title,
      headerBlockHeight,
      subtitle,
      subtitleWidth,
      subtitleBottom,
      ruleY,
      contentTop,
      ...toggleBox === void 0 ? {} : { toggleBox },
      footer,
      ...footerRuleY === void 0 ? {} : { footerRuleY },
      footerBottom
    },
    diagnostics
  };
}
function projectZoneProps(presentation, opts) {
  if (presentation === void 0 || presentation.form !== "container" && presentation.form !== "legend") {
    return { kind: "label" };
  }
  const title = presentation.text.title ?? "";
  if (title === "")
    return { kind: "label" };
  const icon = presentation.icon ?? "cluster";
  return {
    kind: "zone",
    props: {
      entityId: opts.entityId,
      ...opts.containerPadding === void 0 ? {} : { containerPadding: opts.containerPadding },
      ...presentation.text.kicker === void 0 || presentation.text.kicker === "" ? {} : { kicker: presentation.text.kicker },
      title,
      ...presentation.text.subtitle === void 0 || presentation.text.subtitle === "" ? {} : { subtitle: presentation.text.subtitle },
      ...presentation.text.footer === void 0 || presentation.text.footer === "" ? {} : { footer: presentation.text.footer },
      ...icon === void 0 ? {} : { icon },
      ...icon === void 0 || opts.resolveGlyph === void 0 ? {} : (() => {
        const glyph2 = opts.resolveGlyph(icon);
        return glyph2 === void 0 ? {} : { iconGlyph: glyph2 };
      })(),
      ...presentation.categoryRef === void 0 ? {} : { tone: presentation.categoryRef },
      ...presentation.proposed === void 0 ? {} : { proposed: presentation.proposed },
      ...(() => {
        const anatomy = presentation.anatomy ?? opts.anatomy;
        return anatomy === void 0 ? {} : { anatomy };
      })(),
      collapsed: opts.collapsed,
      ...opts.toggleLabel === void 0 ? {} : { toggleLabel: opts.toggleLabel },
      ...(() => {
        const align = presentation.align ?? opts.align;
        return align === void 0 ? {} : { align };
      })(),
      ...(() => {
        const depth = presentation.depth ?? opts.depth;
        return depth === void 0 ? {} : { depth };
      })(),
      ...(() => {
        const start = presentation.depthParityStart ?? opts.depthParityStart;
        return start === void 0 ? {} : { depthParityStart: start };
      })(),
      ...opts.x === void 0 ? {} : { x: opts.x },
      ...opts.y === void 0 ? {} : { y: opts.y },
      ...opts.width === void 0 ? {} : { width: opts.width },
      ...opts.height === void 0 ? {} : { height: opts.height }
    }
  };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/linkLegend.js
var LINK_LEGEND_STROKE_ORDER = Object.freeze([
  "solid",
  "dashed",
  "dotted"
]);
var LINK_LEGEND_EMPHASIS_ORDER = Object.freeze([
  "default",
  "emphasis"
]);
var LINK_LEGEND_ARROWHEAD_ORDER = Object.freeze([
  "arrow",
  "none"
]);
var ALL_LINK_LEGEND_STYLES = Object.freeze(LINK_LEGEND_STROKE_ORDER.flatMap((strokeStyle) => LINK_LEGEND_EMPHASIS_ORDER.flatMap((emphasis) => LINK_LEGEND_ARROWHEAD_ORDER.map((arrowhead) => Object.freeze({
  strokeStyle,
  arrowhead,
  emphasis,
  key: `${strokeStyle}:${arrowhead}:${emphasis}`
})))));
var LINK_LEGEND_GAP = 48;
var LINK_LEGEND_PADDING = 16;
var LINK_LEGEND_HEADER_HEIGHT = 30;
var LINK_LEGEND_HEADER_GAP = 8;
var LINK_LEGEND_SWATCH_WIDTH = 56;
var LINK_LEGEND_SWATCH_HEIGHT = 16;
var LINK_LEGEND_SWATCH_GAP = 14;
var LINK_LEGEND_ROW_HEIGHT = 28;
var LINK_LEGEND_ROW_GAP = 8;
var LINK_LEGEND_MIN_WIDTH = 240;
var LINK_LEGEND_FONT_SIZE = DEFAULT_EDGE_LABEL_SIZE;
var EDGE_STROKE = "var(--st-component-diagramScene-edgeStroke, #64748b)";
var EMPHASIS_STROKE = LINK_EMPHASIS_STROKE;
var measureLegendFallback = cardLineMeasurer();
function linkStyleKey(style) {
  return `${style.strokeStyle}:${style.arrowhead}:${style.emphasis}`;
}
function defaultLinkStyleLabel(style) {
  const parts = [];
  if (style.emphasis === "emphasis")
    parts.push("Emphasis");
  if (style.strokeStyle === "dashed") {
    parts.push("Proposed (dashed)");
  } else if (style.strokeStyle === "dotted") {
    parts.push("Dotted");
  } else if (parts.length === 0) {
    parts.push("Link");
  }
  if (style.arrowhead === "none") {
    parts.push("Undirected");
  }
  return parts.join(" \xB7 ");
}
function styleRank(style) {
  const stroke = LINK_LEGEND_STROKE_ORDER.indexOf(style.strokeStyle);
  const emphasis = LINK_LEGEND_EMPHASIS_ORDER.indexOf(style.emphasis);
  const arrowhead = LINK_LEGEND_ARROWHEAD_ORDER.indexOf(style.arrowhead);
  return stroke * 4 + emphasis * 2 + arrowhead;
}
function collectLinkLegendStyles(edges) {
  const counts = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    if (edge.markers !== void 0 || edge.directed === true)
      continue;
    const strokeStyle = edge.strokeStyle ?? "solid";
    const arrowhead = connectorMarkerKind(edge.arrowhead);
    const emphasis = edge.emphasis === "emphasis" ? "emphasis" : "default";
    const triple = { strokeStyle, arrowhead, emphasis };
    const key = linkStyleKey(triple);
    const existing = counts.get(key);
    if (existing !== void 0) {
      existing.count += 1;
    } else {
      counts.set(key, { ...triple, count: 1 });
    }
  }
  if (counts.size < 2)
    return [];
  return [...counts.entries()].map(([key, value]) => ({
    key,
    strokeStyle: value.strokeStyle,
    arrowhead: value.arrowhead,
    emphasis: value.emphasis,
    count: value.count
  })).sort((left, right) => styleRank(left) - styleRank(right));
}
function measureLegendLineWidth(measureLines2, text3) {
  const request = { text: text3, role: "edge-label", availableWidth: Number.MAX_SAFE_INTEGER, allocatedLines: 1, folded: false };
  const layout = measureLines2(request);
  return layout.width >= request.availableWidth || !Number.isFinite(layout.width) ? measureLegendFallback(request).width : layout.width;
}
function measureSceneLinkLegend(input) {
  const collected = collectLinkLegendStyles(input.edges);
  if (collected.length < 2)
    return void 0;
  const title = input.title ?? "Legend";
  const fontSize = input.fontSize ?? LINK_LEGEND_FONT_SIZE;
  const scale = fontSize > 0 && Number.isFinite(fontSize) ? fontSize / LINK_LEGEND_FONT_SIZE : 1;
  const headerHeight = scale === 1 ? LINK_LEGEND_HEADER_HEIGHT : Math.ceil(LINK_LEGEND_HEADER_HEIGHT * scale);
  const headerGap = scale === 1 ? LINK_LEGEND_HEADER_GAP : Math.ceil(LINK_LEGEND_HEADER_GAP * scale);
  const rowHeight = Math.max(LINK_LEGEND_SWATCH_HEIGHT, scale === 1 ? LINK_LEGEND_ROW_HEIGHT : Math.ceil(LINK_LEGEND_ROW_HEIGHT * scale));
  const rowGap = scale === 1 ? LINK_LEGEND_ROW_GAP : Math.ceil(LINK_LEGEND_ROW_GAP * scale);
  const measureWidth = (text3) => measureLegendLineWidth(input.measureLines, text3) * scale;
  const scaledTitleWidth = measureWidth(title);
  let maxLabelWidth = 0;
  const entries = collected.map((item, index) => {
    const label = input.labels?.[item.key] ?? defaultLinkStyleLabel(item);
    const scaledWidth = measureWidth(label);
    if (scaledWidth > maxLabelWidth)
      maxLabelWidth = scaledWidth;
    const rowY = LINK_LEGEND_PADDING + headerHeight + headerGap + index * (rowHeight + rowGap);
    return {
      ...item,
      label,
      rowY,
      rowHeight
    };
  });
  const contentWidth = Math.max(scaledTitleWidth, LINK_LEGEND_SWATCH_WIDTH + LINK_LEGEND_SWATCH_GAP + maxLabelWidth);
  const width = Math.ceil(Math.max(LINK_LEGEND_MIN_WIDTH, 2 * LINK_LEGEND_PADDING + contentWidth));
  const height = 2 * LINK_LEGEND_PADDING + headerHeight + headerGap + entries.length * rowHeight + Math.max(0, entries.length - 1) * rowGap;
  return {
    title,
    width,
    height,
    entries,
    padding: LINK_LEGEND_PADDING,
    headerHeight,
    headerGap,
    rowHeight,
    rowGap,
    swatchWidth: LINK_LEGEND_SWATCH_WIDTH,
    swatchHeight: LINK_LEGEND_SWATCH_HEIGHT,
    swatchGap: LINK_LEGEND_SWATCH_GAP,
    fontSize
  };
}
function placeSceneLinkLegend(measured, anchor, contentBounds, explicitRect) {
  const rect = anchor === "free-cell" && explicitRect !== void 0 ? { x: explicitRect.x, y: explicitRect.y, width: measured.width, height: measured.height } : anchor === "bottom" ? {
    x: contentBounds.x,
    y: contentBounds.y + contentBounds.height + LINK_LEGEND_GAP,
    width: measured.width,
    height: measured.height
  } : {
    x: contentBounds.x + contentBounds.width + LINK_LEGEND_GAP,
    y: contentBounds.y,
    width: measured.width,
    height: measured.height
  };
  return {
    anchor: anchor === "free-cell" && explicitRect === void 0 ? "right" : anchor,
    title: measured.title,
    rect,
    entries: measured.entries,
    padding: measured.padding,
    headerHeight: measured.headerHeight,
    headerGap: measured.headerGap,
    rowHeight: measured.rowHeight,
    rowGap: measured.rowGap,
    swatchWidth: measured.swatchWidth,
    swatchHeight: measured.swatchHeight,
    swatchGap: measured.swatchGap,
    fontSize: measured.fontSize
  };
}
function buildSceneLinkLegend(input) {
  const anchor = input.anchor ?? "right";
  if (anchor === "none" || input.contentBounds === void 0)
    return void 0;
  const measured = measureSceneLinkLegend(input);
  if (measured === void 0)
    return void 0;
  return placeSceneLinkLegend(measured, anchor, input.contentBounds);
}
function linkLegendSwatchGeometry(style, widths) {
  const emphasized = style.emphasis === "emphasis";
  const stroke = emphasized ? EMPHASIS_STROKE : EDGE_STROKE;
  const strokeWidth2 = connectorStrokeWidth(style, widths);
  const dashArray = connectorDashArray(style.strokeStyle);
  const lineEnd = style.arrowhead === "none" ? 54 : 46;
  const linePath = `M2 8H${lineEnd}`;
  if (style.arrowhead === "none") {
    return {
      viewBox: `0 0 ${LINK_LEGEND_SWATCH_WIDTH} ${LINK_LEGEND_SWATCH_HEIGHT}`,
      width: LINK_LEGEND_SWATCH_WIDTH,
      height: LINK_LEGEND_SWATCH_HEIGHT,
      linePath,
      stroke,
      strokeWidth: strokeWidth2,
      ...dashArray === void 0 ? {} : { dashArray }
    };
  }
  return {
    viewBox: `0 0 ${LINK_LEGEND_SWATCH_WIDTH} ${LINK_LEGEND_SWATCH_HEIGHT}`,
    width: LINK_LEGEND_SWATCH_WIDTH,
    height: LINK_LEGEND_SWATCH_HEIGHT,
    linePath,
    arrowPath: "M44 3L54 8L44 13Z",
    stroke,
    strokeWidth: strokeWidth2,
    ...dashArray === void 0 ? {} : { dashArray },
    arrowFill: stroke
  };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/hints.js
function isLayoutGroup(item) {
  return typeof item !== "string";
}
function groupLeaves(group) {
  const out = [];
  const visit = (item) => {
    if (!isLayoutGroup(item)) {
      out.push(item);
      return;
    }
    for (const child of item.items)
      visit(child);
  };
  for (const item of group.items)
    visit(item);
  return out;
}
function validateHints(hints, scope) {
  const refusals = [];
  const refuse = (path, message, refs) => {
    refusals.push({ code: "layout-hint-invalid", path, message, refs });
  };
  for (const [parent, order] of Object.entries(hints.ordering ?? {})) {
    const parentRef = parent;
    const seen = /* @__PURE__ */ new Set();
    for (const member of order) {
      if (seen.has(member)) {
        refuse(`hints.ordering.${parent}`, `duplicate member ${member} in the ordering of ${parent}`, [member]);
        continue;
      }
      seen.add(member);
      if (!scope.roots.has(member) && !scope.parentOf.has(member)) {
        refuse(`hints.ordering.${parent}`, `unknown member ${member} in the ordering of ${parent}`, [member]);
      } else if (scope.parentOf.get(member) !== parentRef) {
        refuse(`hints.ordering.${parent}`, `member ${member} is outside the sibling context of ${parent}`, [member]);
      }
    }
  }
  const seenRoots = /* @__PURE__ */ new Set();
  for (const member of hints.rootOrder ?? []) {
    if (!scope.roots.has(member) || seenRoots.has(member)) {
      refuse("hints.rootOrder", `${member} is not a root entity listed once in hints.rootOrder`, [member]);
    }
    seenRoots.add(member);
  }
  const visitGroup = (group, path) => {
    const leaves = groupLeaves(group);
    const seen = /* @__PURE__ */ new Set();
    for (const leaf of leaves) {
      if (seen.has(leaf)) {
        refuse(`${path}.items`, `duplicate leaf ${leaf} in group ${group.id}`, [leaf]);
        continue;
      }
      seen.add(leaf);
      if (!scope.roots.has(leaf) && !scope.parentOf.has(leaf)) {
        refuse(`${path}.items`, `unknown leaf ${leaf} in group ${group.id}`, [leaf]);
      }
    }
    const scopes = /* @__PURE__ */ new Set();
    for (const leaf of new Set(leaves)) {
      if (scope.roots.has(leaf))
        scopes.add(void 0);
      else
        scopes.add(scope.parentOf.get(leaf));
    }
    if (scopes.size > 1) {
      refuse(`${path}.items`, `group ${group.id} mixes sibling contexts (${leaves.join(", ")})`, [...new Set(leaves)]);
    }
    for (const item of group.items) {
      if (isLayoutGroup(item))
        visitGroup(item, `${path}.items.${item.id}`);
    }
  };
  for (const group of hints.grouping ?? [])
    visitGroup(group, `hints.grouping.${group.id}`);
  const ownership = /* @__PURE__ */ new Map();
  for (const group of hints.grouping ?? []) {
    const leaves = [...new Set(groupLeaves(group))];
    const contexts = /* @__PURE__ */ new Set();
    for (const leaf of leaves) {
      const context2 = scope.roots.has(leaf) ? "__roots__" : `parent:${String(scope.parentOf.get(leaf) ?? "__unknown__")}`;
      contexts.add(context2);
    }
    if (contexts.size !== 1)
      continue;
    const context = [...contexts][0];
    let claimed = ownership.get(context);
    if (claimed === void 0) {
      claimed = /* @__PURE__ */ new Map();
      ownership.set(context, claimed);
    }
    for (const leaf of leaves) {
      const first = claimed.get(leaf);
      if (first !== void 0) {
        refuse(`hints.grouping.${group.id}.items`, `duplicate leaf ${leaf} across groups ${first} and ${group.id}`, [leaf]);
        continue;
      }
      claimed.set(leaf, group.id);
    }
  }
  if (hints.composition !== void 0) {
    validateCompositionHints(hints.composition, scope, refuse);
  }
  return refusals;
}
function validateCompositionHints(composition, scope, refuse) {
  const byString5 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const hasEntity = (ref) => scope.roots.has(ref) || scope.parentOf.has(ref);
  const isContainer = (ref) => scope.containers?.has(ref) ?? false;
  const grids = composition.grids;
  if (grids === void 0 || grids.root === void 0) {
    refuse("hints.composition.grids.root", "stage-columns composition requires a root grid", []);
    return;
  }
  const bandOwner = /* @__PURE__ */ new Map();
  const placed = /* @__PURE__ */ new Set();
  for (const scopeKey of Object.keys(grids).sort(byString5)) {
    const grid = grids[scopeKey];
    if (grid === void 0)
      continue;
    const gridPath = `hints.composition.grids.${scopeKey}`;
    if (scopeKey !== "root") {
      const entity = scopeKey;
      if (!hasEntity(entity)) {
        refuse(gridPath, `unknown grid scope ${scopeKey}`, [entity]);
      } else if (scope.containers !== void 0 && !isContainer(entity)) {
        refuse(gridPath, `grid scope ${scopeKey} is not a container`, [entity]);
      }
    }
    const checkChild = (item, path) => {
      if (placed.has(item)) {
        refuse(path, `duplicate placement of ${item} in composition`, [item]);
      } else {
        placed.add(item);
      }
      if (!hasEntity(item)) {
        refuse(path, `unknown entity ${item} in grid ${scopeKey}`, [item]);
        return;
      }
      const inScope = scopeKey === "root" ? scope.roots.has(item) : scope.parentOf.get(item) === scopeKey;
      if (!inScope) {
        refuse(path, `entity ${item} does not have ${scopeKey} as placement parent`, [item]);
      }
    };
    const bandItems = /* @__PURE__ */ new Set();
    for (const band of grid.transverse_bands) {
      const bandPath = `${gridPath}.transverse_bands.${band.id}.items`;
      for (const item of band.items) {
        checkChild(item, bandPath);
        bandItems.add(item);
        if (!bandOwner.has(item))
          bandOwner.set(item, scopeKey);
      }
    }
    for (const column of grid.peripheral_columns ?? []) {
      const columnPath = `${gridPath}.peripheral_columns.${column.id}.items`;
      for (const item of column.items) {
        checkChild(item, columnPath);
      }
    }
    for (const itemKey of Object.keys(grid.cells ?? {}).sort(byString5)) {
      const itemRef = itemKey;
      const cell = grid.cells?.[itemRef];
      if (cell === void 0)
        continue;
      const cellPath = `${gridPath}.cells.${itemKey}`;
      if (!hasEntity(itemRef)) {
        refuse(cellPath, `unknown cell entity ${itemKey} in grid ${scopeKey}`, [itemRef]);
        continue;
      }
      if (!bandItems.has(itemRef)) {
        refuse(cellPath, `cell entity ${itemKey} is not a band item of grid ${scopeKey}`, [itemRef]);
      }
      if (scope.containers !== void 0 && !isContainer(itemRef) && (cell.justify === "stretch" || cell.align === "stretch")) {
        refuse(cellPath, `stretch alignment is admitted on containers only, not leaf ${itemKey}`, [itemRef]);
      }
    }
  }
  const resolving = /* @__PURE__ */ new Set();
  const checkInherit = (scopeKey) => {
    const grid = grids[scopeKey];
    if (grid === void 0)
      return false;
    if (grid.stage_columns !== "inherit")
      return grid.stage_columns !== void 0;
    const path = `hints.composition.grids.${scopeKey}.stage_columns`;
    if (scopeKey === "root" || resolving.has(scopeKey)) {
      refuse(path, `inherit on ${scopeKey} requires a cell in an enclosing staged grid`, scopeKey === "root" ? [] : [scopeKey]);
      return false;
    }
    const entity = scopeKey;
    const parent = bandOwner.get(entity);
    const parentGrid = parent === void 0 ? void 0 : grids[parent];
    const parentCell = parentGrid?.cells?.[entity];
    if (parent === void 0 || parentGrid === void 0 || parentGrid.stage_columns === void 0 || parentCell?.column === void 0) {
      refuse(path, `inherit on ${scopeKey} requires a band cell in an enclosing staged grid`, [entity]);
      return false;
    }
    resolving.add(scopeKey);
    const ok = checkInherit(parent);
    resolving.delete(scopeKey);
    return ok;
  };
  for (const scopeKey of Object.keys(grids).sort(byString5)) {
    if (grids[scopeKey]?.stage_columns === "inherit")
      checkInherit(scopeKey);
  }
  for (const stackKey of Object.keys(composition.stacks ?? {}).sort(byString5)) {
    const entity = stackKey;
    const stack = composition.stacks[entity];
    const stackPath = `hints.composition.stacks.${stackKey}`;
    if (!hasEntity(entity)) {
      refuse(stackPath, `unknown stack container ${stackKey}`, [entity]);
      continue;
    }
    if (scope.containers !== void 0 && !isContainer(entity)) {
      refuse(stackPath, `stack key ${stackKey} is not a container`, [entity]);
      continue;
    }
    if (grids[entity] !== void 0) {
      refuse(stackPath, `container ${stackKey} cannot declare both a grid and a stack`, [entity]);
    }
    if (stack?.align === "stretch" && scope.containers !== void 0) {
      const leafChildren = [];
      for (const [child, parent] of scope.parentOf) {
        if (parent === entity && !isContainer(child))
          leafChildren.push(child);
      }
      if (leafChildren.length > 0) {
        refuse(`${stackPath}.align`, `stretch alignment is admitted on containers only, not leaves in stack ${stackKey}`, leafChildren.sort(byString5));
      }
    }
  }
}
function resolveOrder(siblings, ordered) {
  const members = new Set(siblings);
  const listed = (ordered ?? []).filter((member) => members.has(member));
  const rest = siblings.filter((member) => !(ordered ?? []).includes(member)).sort();
  return [...listed, ...rest];
}
function resolveGaps(hints, metrics) {
  return {
    cardGapX: hints?.cardGapX ?? metrics.nodeGap,
    cardGapY: hints?.cardGapY ?? metrics.nodeGap,
    zoneGapX: hints?.zoneGapX ?? metrics.nodeGap,
    zoneGapY: hints?.zoneGapY ?? metrics.nodeGap,
    rankGap: hints?.rankGap ?? metrics.rankGap
  };
}
function resolveRowGaps(hints, metrics, useZoneGutter = false) {
  const zoneGutter = useZoneGutter ? Math.max(DIAGRAM_SCENE_SPACING.zoneGutter, metrics.zoneGutter ?? DIAGRAM_SCENE_SPACING.zoneGutter) : void 0;
  return {
    cardX: hints?.cardGapX ?? metrics.rowGapInline ?? metrics.gapMin ?? DEFAULT_ROW_GAP,
    cardY: hints?.cardGapY ?? metrics.rowGapBlock ?? metrics.gapMinBlock ?? DIAGRAM_SCENE_SPACING.gapMinBlock,
    zoneX: zoneGutter ?? hints?.zoneGapX ?? metrics.rowGapInline ?? metrics.gapMin ?? DEFAULT_ROW_GAP,
    zoneY: zoneGutter ?? hints?.zoneGapY ?? metrics.rowGapBlock ?? metrics.gapMinBlock ?? DIAGRAM_SCENE_SPACING.gapMinBlock,
    maxX: metrics.gapInlineMax ?? metrics.gapMax ?? DEFAULT_ROW_GAP_MAX,
    maxY: metrics.gapBlockMax ?? metrics.gapMax ?? DEFAULT_ROW_GAP_MAX
  };
}
function effectiveStretch(groupStretch, globalStretch) {
  return groupStretch ?? globalStretch ?? false;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/fingerprint.js
function digestOf(text3) {
  let high = 2166136261;
  let low = 16777619;
  for (let index = 0; index < text3.length; index += 1) {
    const unit = text3.charCodeAt(index);
    high = Math.imul(high ^ unit, 16777619) >>> 0;
    low = Math.imul(low ^ unit + index, 2166136261) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

// node_modules/@sentropic/diagram-canvas/dist/layout/measure.js
var FIXED_CARD_WIDTH = 460;
var FIXED_CARD_HEIGHT = 200;
var LEGEND_KEY_HEIGHT = 64;
var CONTENT_INSET = DIAGRAM_SCENE_SPACING.containerPadding;
var RULE_GAP = 4;
var SUBTITLE_TO_RULE_GAP = 4;
var RULE_TO_FIRST_CHILD_GAP = DIAGRAM_SCENE_SPACING.containerPadding;
var LAST_CHILD_TO_BOTTOM_GAP = DIAGRAM_SCENE_SPACING.containerPadding;
var TOGGLE_ALLOCATION = 66;
var SWATCH_ALLOCATION = 32;
var UNWRAPPED_PROBE_WIDTH = 1e5;
function scaleEdgeLabelMeasurer(measureLines2, edgeLabelSize, baseSize = 18) {
  if (edgeLabelSize === void 0 || !Number.isFinite(edgeLabelSize) || edgeLabelSize <= 0 || Math.abs(edgeLabelSize - baseSize) < 1e-9) {
    return measureLines2;
  }
  const scale = edgeLabelSize / baseSize;
  const scaled = (request) => {
    if (request.role !== "edge-label")
      return measureLines2(request);
    const availableWidth = Number.isFinite(request.availableWidth) ? request.availableWidth / scale : request.availableWidth;
    const measured = measureLines2({ ...request, availableWidth });
    return {
      ...measured,
      width: measured.width * scale,
      height: measured.height * scale
    };
  };
  return scaled;
}
var DEFAULT_ALLOCATED_LINES = {
  kicker: 1,
  title: 2,
  body: 4,
  detail: 3,
  footer: 1,
  subtitle: 2,
  "legend-label": 2,
  "edge-label": 1,
  "flow-badge": 1
};
function innerWidthOf(outerWidth) {
  return outerWidth - 2 * CONTENT_INSET;
}
function headerAvailableWidth(innerWidth, toggle) {
  return toggle ? innerWidth - TOGGLE_ALLOCATION : innerWidth;
}
function headerBandHeight(kicker, title, subtitle) {
  let height = title.height;
  if (kicker !== void 0)
    height += RULE_GAP + kicker.height;
  if (subtitle !== void 0)
    height += SUBTITLE_TO_RULE_GAP + subtitle.height;
  return height;
}
function measureHeader(input, measure2) {
  const allocated = (role3) => input.allocatedLines[role3] ?? DEFAULT_ALLOCATED_LINES[role3];
  const at = (role3, text3, availableWidth) => measure2({ text: text3, role: role3, availableWidth, allocatedLines: allocated(role3), folded: input.folded });
  const titleWidth = headerAvailableWidth(input.availableWidth, input.toggle);
  const kicker = input.slots.kicker === void 0 ? void 0 : at("kicker", input.slots.kicker, titleWidth);
  const title = at("title", input.slots.title ?? "", titleWidth);
  const subtitle = input.slots.subtitle === void 0 ? void 0 : at("subtitle", input.slots.subtitle, input.availableWidth);
  const height = headerBandHeight(kicker, title, subtitle);
  return {
    occurrence: input.occurrence,
    ...kicker === void 0 ? {} : { kicker },
    title,
    ...subtitle === void 0 ? {} : { subtitle },
    height,
    overflow: (kicker?.overflow ?? false) || title.overflow || (subtitle?.overflow ?? false)
  };
}
function headerOverflows(input, header, lineHeightOf) {
  const out = [];
  const entries = [
    ["kicker", header.kicker],
    ["title", header.title],
    ["subtitle", header.subtitle]
  ];
  for (const [role3, layout] of entries) {
    if (layout === void 0 || !layout.overflow)
      continue;
    const allocatedLines = input.allocatedLines[role3] ?? DEFAULT_ALLOCATED_LINES[role3];
    out.push({
      occurrence: header.occurrence,
      slot: role3,
      neededHeight: layout.height,
      allocatedHeight: allocatedLines * lineHeightOf(role3),
      lines: layout.lines.length,
      allocatedLines
    });
  }
  return out;
}

// node_modules/@sentropic/diagram-canvas/dist/layout/plan.js
var byString3 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var clean3 = (value) => value === 0 ? 0 : value;
var ASPECT_16_9_TARGET = 16 / 9;
var ASPECT_16_9_TOLERANCE = 0.02;
var ASPECT_TAU_LADDER = [0.56, 0.75, 1, 1.33, 1.78, 2.37, 3.16, 4.21];
function chooseAspectTau(candidates, target = ASPECT_16_9_TARGET) {
  const EPS_DIST = 1e-9;
  const EPS_AREA = 1e-6;
  const EPS_TAU = 1e-9;
  let best;
  for (const cand of candidates) {
    const ratio = cand.height > 0 && cand.width > 0 ? cand.width / cand.height : target;
    const distance = Math.abs(Math.log(ratio / target));
    const entry = { ...cand, ratio, distance };
    if (best === void 0) {
      best = entry;
      continue;
    }
    if (entry.distance < best.distance - EPS_DIST) {
      best = entry;
      continue;
    }
    if (Math.abs(entry.distance - best.distance) <= EPS_DIST) {
      const area = entry.width * entry.height;
      const bestArea = best.width * best.height;
      if (area < bestArea - EPS_AREA) {
        best = entry;
        continue;
      }
      if (Math.abs(area - bestArea) <= EPS_AREA) {
        const dDefault = Math.abs(entry.tau - 1.78);
        const bestDefault = Math.abs(best.tau - 1.78);
        if (dDefault < bestDefault - EPS_TAU) {
          best = entry;
          continue;
        }
        if (Math.abs(dDefault - bestDefault) <= EPS_TAU && entry.tau < best.tau) {
          best = entry;
        }
      }
    }
  }
  return best ?? { tau: 1.78, width: 0, height: 0, ratio: target, distance: 0 };
}
function combineRootWithLegendBounds(gridWidth, gridHeight, legendSize, anchor, legendInsideCell = false) {
  if (legendSize === void 0 || anchor === "none" || legendInsideCell) {
    return { width: gridWidth, height: gridHeight };
  }
  if (anchor === "bottom") {
    return {
      width: Math.max(gridWidth, legendSize.width),
      height: gridHeight + LINK_LEGEND_GAP + legendSize.height
    };
  }
  return {
    width: gridWidth + LINK_LEGEND_GAP + legendSize.width,
    height: Math.max(gridHeight, legendSize.height)
  };
}
function computeAspectSlack(args) {
  const target = args.target ?? ASPECT_16_9_TARGET;
  const tolerance = args.tolerance ?? ASPECT_16_9_TOLERANCE;
  if (!(args.width > 0) || !(args.height > 0)) {
    return { sigmaCols: {}, sigmaBands: {}, capReached: false, ratio: target };
  }
  const ratio = args.width / args.height;
  if (Math.abs(ratio / target - 1) <= tolerance) {
    return { sigmaCols: {}, sigmaBands: {}, capReached: false, ratio };
  }
  const distribute = (totalDelta, trackIds, cap) => {
    const n = trackIds.length;
    if (n === 0 || totalDelta <= 0)
      return { map: {}, capReached: totalDelta > 0 };
    const base = Math.floor(totalDelta / n);
    const rem = totalDelta - base * n;
    const out = {};
    let capReached2 = false;
    trackIds.forEach((id, idx) => {
      const raw = base + (idx === n - 1 ? rem : 0);
      if (raw > cap)
        capReached2 = true;
      const clamped = Math.min(cap, raw);
      if (clamped > 0)
        out[id] = clamped;
    });
    return {
      map: Object.fromEntries(Object.entries(out).sort(([left], [right]) => byString3(left, right))),
      capReached: capReached2
    };
  };
  if (ratio < target) {
    const deltaW = Math.round(target * args.height - args.width);
    const { map: map2, capReached: capReached2 } = distribute(deltaW, args.xTrackIds, args.capX);
    return { sigmaCols: map2, sigmaBands: {}, capReached: capReached2, ratio };
  }
  const deltaH = Math.round(args.width / target - args.height);
  const { map, capReached } = distribute(deltaH, args.yTrackIds, args.capY);
  return { sigmaCols: {}, sigmaBands: map, capReached, ratio };
}
function foldNeutralView(sourceView) {
  const referencedGroups = /* @__PURE__ */ new Set();
  for (const occ of Object.values(sourceView.entityOccurrences)) {
    if (occ.group !== void 0)
      referencedGroups.add(occ.group);
  }
  const groups = {};
  for (const key of Object.keys(sourceView.groups).sort(byString3)) {
    const group = sourceView.groups[key];
    const isStampedOnly = group.occurrence !== void 0 && key === foldGroupId(group.occurrence) && group.label === void 0 && !referencedGroups.has(key);
    if (isStampedOnly)
      continue;
    const { collapsed: _collapsed, ...rest } = group;
    void _collapsed;
    groups[key] = rest;
  }
  const relationOccurrences = {};
  for (const key of Object.keys(sourceView.relationOccurrences).sort(byString3)) {
    const occurrence = sourceView.relationOccurrences[key];
    relationOccurrences[key] = {
      ...occurrence,
      endpoints: occurrence.endpoints.map((endpoint) => endpoint.chainProvenance !== void 0 ? endpoint : endpoint.sourceOccurrence === void 0 ? { role: endpoint.role, occurrence: endpoint.occurrence } : { role: endpoint.role, occurrence: endpoint.sourceOccurrence })
    };
  }
  return {
    ...sourceView,
    groups,
    relationOccurrences,
    presentation: {
      ...sourceView.presentation,
      camera: void 0
    }
  };
}
function computePlanDigest(fields) {
  return digestOf(canonicalise(fields));
}
function auditSiblingZonePaintedGaps(args) {
  const { gridReports, packedLevels, isContainer, zoneGutter } = args;
  const seen = /* @__PURE__ */ new Set();
  const all = [];
  const pushPair = (entry) => {
    const key = `${entry.scope}|${entry.axis}|${entry.left}|${entry.right}`;
    if (seen.has(key))
      return;
    seen.add(key);
    all.push(entry);
  };
  for (const scope of Object.keys(gridReports).sort(byString3)) {
    const report = gridReports[scope];
    const containerCells = report.cells.filter((cell) => isContainer(cell.entity));
    for (let i = 0; i < containerCells.length; i += 1) {
      const a = containerCells[i];
      for (let j = 0; j < containerCells.length; j += 1) {
        if (i === j)
          continue;
        const b = containerCells[j];
        if (a.colEnd >= 0 && b.colStart >= 0 && a.colEnd + 1 === b.colStart && a.bandStart >= 0 && b.bandStart >= 0 && Math.max(a.bandStart, b.bandStart) <= Math.min(a.bandEnd, b.bandEnd)) {
          const colA = report.columns[a.colEnd];
          const colB = report.columns[b.colStart];
          if (colA !== void 0 && colB !== void 0) {
            const gutter = clean3(colB.start - (colA.start + colA.size));
            const fromSlack = clean3(colA.start + colA.size - (a.boxRect.x + a.boxRect.width));
            const toSlack = clean3(b.boxRect.x - colB.start);
            const paintedGap = clean3(b.boxRect.x - (a.boxRect.x + a.boxRect.width));
            pushPair({
              scope,
              axis: "horizontal",
              left: a.entity,
              right: b.entity,
              paintedGap,
              token: gutter,
              slack: clean3(fromSlack + toSlack),
              fromSlack,
              toSlack
            });
          }
        }
        if (a.bandEnd >= 0 && b.bandStart >= 0 && a.bandEnd + 1 === b.bandStart) {
          const sameColRange = a.colStart >= 0 && b.colStart >= 0 ? Math.max(a.colStart, b.colStart) <= Math.min(a.colEnd, b.colEnd) : Math.min(a.boxRect.x + a.boxRect.width, b.boxRect.x + b.boxRect.width) > Math.max(a.boxRect.x, b.boxRect.x);
          if (sameColRange) {
            const bandA = report.bands[a.bandEnd];
            const bandB = report.bands[b.bandStart];
            if (bandA !== void 0 && bandB !== void 0) {
              const gutter = clean3(bandB.start - (bandA.start + bandA.size));
              const fromSlack = clean3(bandA.start + bandA.size - (a.boxRect.y + a.boxRect.height));
              const toSlack = clean3(b.boxRect.y - bandB.start);
              const paintedGap = clean3(b.boxRect.y - (a.boxRect.y + a.boxRect.height));
              pushPair({
                scope,
                axis: "vertical",
                left: a.entity,
                right: b.entity,
                paintedGap,
                token: gutter,
                slack: clean3(fromSlack + toSlack),
                fromSlack,
                toSlack
              });
            }
          }
        }
      }
    }
  }
  for (const level of packedLevels) {
    const { scope, rows, shelves } = level;
    for (let s = 0; s < shelves.length; s += 1) {
      const shelf = shelves[s];
      const shelfEnd = rows ? Math.max(...shelf.map((item) => item.rect.y + item.rect.height)) : Math.max(...shelf.map((item) => item.rect.x + item.rect.width));
      const nextShelf = shelves[s + 1];
      const nextStart = nextShelf === void 0 ? void 0 : rows ? Math.min(...nextShelf.map((item) => item.rect.y)) : Math.min(...nextShelf.map((item) => item.rect.x));
      for (let k = 0; k < shelf.length - 1; k += 1) {
        const a = shelf[k];
        const b = shelf[k + 1];
        if (!isContainer(a.entity) || !isContainer(b.entity))
          continue;
        const paintedGap = clean3(rows ? b.rect.x - (a.rect.x + a.rect.width) : b.rect.y - (a.rect.y + a.rect.height));
        pushPair({
          scope,
          axis: rows ? "horizontal" : "vertical",
          left: a.entity,
          right: b.entity,
          paintedGap,
          token: zoneGutter,
          slack: clean3(paintedGap - zoneGutter),
          fromSlack: 0,
          toSlack: clean3(paintedGap - zoneGutter)
        });
      }
      if (nextShelf !== void 0 && nextStart !== void 0) {
        const gutter = clean3(nextStart - shelfEnd);
        for (const a of shelf) {
          if (!isContainer(a.entity))
            continue;
          for (const b of nextShelf) {
            if (!isContainer(b.entity))
              continue;
            const overlaps = rows ? Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) > Math.max(a.rect.x, b.rect.x) : Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) > Math.max(a.rect.y, b.rect.y);
            if (!overlaps)
              continue;
            const fromSlack = clean3(rows ? shelfEnd - (a.rect.y + a.rect.height) : shelfEnd - (a.rect.x + a.rect.width));
            const toSlack = clean3(rows ? b.rect.y - nextStart : b.rect.x - nextStart);
            const paintedGap = clean3(rows ? b.rect.y - (a.rect.y + a.rect.height) : b.rect.x - (a.rect.x + a.rect.width));
            pushPair({
              scope,
              axis: rows ? "vertical" : "horizontal",
              left: a.entity,
              right: b.entity,
              paintedGap,
              token: gutter,
              slack: clean3(fromSlack + toSlack),
              fromSlack,
              toSlack
            });
          }
        }
      }
    }
  }
  all.sort((left, right) => byString3(left.scope, right.scope) || byString3(left.axis, right.axis) || byString3(left.left, right.left) || byString3(left.right, right.right));
  const aboveToken = all.filter((entry) => entry.paintedGap > zoneGutter + 1e-6);
  return { all, aboveToken };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/sceneMeasure.js
function measureSceneBox(presentation, occurrence, width, collapsed, measure2, containerPadding) {
  const zone = presentation?.form === "container" || presentation?.form === "legend";
  const measured = /* @__PURE__ */ new Map();
  const at = (text3, role3, availableWidth) => {
    const key = JSON.stringify([text3, role3, availableWidth]);
    let layout2 = measured.get(key);
    if (layout2 === void 0) {
      layout2 = measure2({ text: text3, role: role3, availableWidth, allocatedLines: DEFAULT_ALLOCATED_LINES[role3], folded: collapsed });
      measured.set(key, layout2);
    }
    return layout2;
  };
  const adapter = (text3, role3, availableWidth, allocatedLines) => {
    const layout2 = at(text3, zone && !collapsed && role3 === "body" ? "subtitle" : role3, availableWidth);
    return {
      lines: layout2.lines,
      tooWide: layout2.width > availableWidth,
      lineWidths: layout2.lines.map(() => layout2.width)
    };
  };
  const resolveGlyph = () => ({ face: "" });
  const projected = zone ? projectZoneProps(presentation, { entityId: occurrence, collapsed, width, ...containerPadding === void 0 ? {} : { containerPadding }, toggleLabel: "toggle", resolveGlyph }) : projectCardProps(presentation, { entityId: occurrence, resolveGlyph });
  const props = projected.kind === "label" ? { entityId: occurrence, title: presentation?.text.title ?? "", body: [] } : projected.props;
  const layout = projected.kind === "zone" ? layoutZone({ ...projected.props, autoSize: true }, adapter) : layoutCard({ ...props, autoSize: true }, adapter);
  const card = "collapsed" in layout ? layout.card : layout;
  const effectiveCardGeometry = anatomyCardGeometry(card?.anatomyFallback ?? presentation?.anatomy);
  const zoneGeo = anatomyZoneGeometry(presentation?.anatomy);
  const header = "collapsed" in layout ? layout.header : void 0;
  const textWidth = card?.headerTextWidth ?? header.headerTextWidth;
  const rawKicker = presentation?.text.kicker === void 0 ? void 0 : at(presentation.text.kicker, "kicker", textWidth);
  const rawTitle = at(presentation?.text.title ?? "", "title", textWidth);
  const rawSubtitle = header === void 0 || presentation?.text.subtitle === void 0 ? void 0 : at(presentation.text.subtitle, "subtitle", header.subtitleWidth);
  const bounded = (raw, lines, size) => raw === void 0 ? void 0 : { ...raw, lines: lines?.map((line) => line.text) ?? [], height: (lines?.length ?? 0) * lineBoxHeight(size), overflow: false };
  const kicker = bounded(rawKicker, card?.kicker ?? header?.kicker, CARD_GEOMETRY.kicker.size);
  const title = bounded(rawTitle, card?.title ?? header?.title, CARD_GEOMETRY.title.size);
  const subtitle = bounded(rawSubtitle, header?.subtitle, CARD_GEOMETRY.body.size);
  const blockHeight = Math.max(projected.kind === "label" || presentation?.icon === "none" ? 0 : effectiveCardGeometry.iconSize, (kicker?.height ?? 0) + title.height);
  const height = header === void 0 ? blockHeight : blockHeight + zoneGeo.headerRuleGap + (subtitle === void 0 || subtitle.lines.length === 0 ? 0 : zoneGeo.subtitleGap + subtitle.height);
  const measuredHeader = {
    occurrence,
    ...kicker === void 0 ? {} : { kicker },
    title,
    ...subtitle === void 0 ? {} : { subtitle },
    height,
    overflow: (kicker?.overflow ?? false) || title.overflow || (subtitle?.overflow ?? false)
  };
  const footerReserve = header === void 0 || header.footer.length === 0 ? 0 : header.footer.length * lineBoxHeight(zoneGeo.footer.size) + zoneGeo.ruleHeight + 2 * zoneGeo.ruleMargin + zoneGeo.footerBottomInset;
  return {
    width: layout.box.width,
    height: layout.box.height,
    header: measuredHeader,
    bodyWidth: card?.bodyWidth ?? width - 2 * (containerPadding ?? zoneGeo.contentInsetInline),
    footerWidth: card === void 0 ? width - 2 * (containerPadding ?? zoneGeo.contentInsetInline) : card.box.width - effectiveCardGeometry.borderWidth - effectiveCardGeometry.padding - effectiveCardGeometry.headerInset,
    footerReserve,
    diagnostics: layout.diagnostics
  };
}

// node_modules/@sentropic/diagram-canvas/dist/layout/measured.js
var EDGE_LABEL_WIDTH = 400;
var byString4 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function semanticName(document, entity) {
  const attributes = document.entities[entity]?.attributes;
  const name = attributes?.["name"];
  return name !== void 0 && name.kind === "text" && typeof name.value === "string" ? name.value : "";
}
function formOf(presentation, occurrence) {
  return presentation.entities[occurrence]?.form;
}
function persistableDiagramPresentation(presentation) {
  const allowsAlign = presentation.contractPin !== void 0 && isPresentationContractV2Pin(presentation.contractPin);
  const entities = {};
  for (const [key, entry] of Object.entries(presentation.entities)) {
    const record = entry;
    const cleanEntry = {};
    for (const [field, value] of Object.entries(record)) {
      if (field === "anatomy" || field === "depth" || field === "depthParityStart")
        continue;
      if (field === "align" && !allowsAlign)
        continue;
      cleanEntry[field] = value;
    }
    entities[key] = cleanEntry;
  }
  const { relations: _transientRelations, ...base } = presentation;
  void _transientRelations;
  return { ...base, entities };
}
function relationPresentationFor(relations, occurrence, relation) {
  if (relations === void 0)
    return void 0;
  return relations[occurrence] ?? relations[relation];
}
var ALLOWED_RELATION_OCCURRENCE_FIELDS = /* @__PURE__ */ new Set([
  "id",
  "relation",
  "endpoints",
  "waypoints",
  "strokeStyle",
  "arrowhead",
  "emphasis"
]);
function validateRelationPresentations(relations, contractPin, sourceView) {
  const refusals = [];
  const isV2 = contractPin !== void 0 && isPresentationContractV2Pin(contractPin);
  const isFrozenV1 = contractPin !== void 0 && !isV2;
  if (relations !== void 0 && (relations === null || typeof relations !== "object" || Array.isArray(relations))) {
    refusals.push({ code: "document-invalid", path: "presentation.relations", message: "connector styles must be keyed by relation" });
  } else if (relations !== void 0) {
    const keys = Object.keys(relations).sort(byString4);
    if (isFrozenV1 && keys.length > 0) {
      for (const key of keys) {
        refusals.push({
          code: "document-invalid",
          path: `presentation.relations.${key}`,
          message: "presentation.relations requires diagram-presentation@2; frozen diagram-presentation@1 cannot persist DE-2 connector styles"
        });
      }
    }
    for (const key of keys) {
      const entry = relations[key];
      if (entry === void 0)
        continue;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        refusals.push({ code: "document-invalid", path: `presentation.relations.${key}`, message: "connector style must be a record" });
        continue;
      }
      for (const field of Object.keys(entry).sort(byString4)) {
        if (field !== "strokeStyle" && field !== "arrowhead" && field !== "emphasis") {
          refusals.push({
            code: "document-invalid",
            path: `presentation.relations.${key}.${field}`,
            message: `unknown connector presentation field ${field}; select connectors by closed registry words only`
          });
        }
      }
      if (entry["strokeStyle"] !== void 0 && !isStrokeStyle(entry["strokeStyle"])) {
        refusals.push({
          code: "document-invalid",
          path: `presentation.relations.${key}.strokeStyle`,
          message: `strokeStyle ${String(entry["strokeStyle"])} is not a closed dash-pattern registry word`
        });
      }
      if (entry["arrowhead"] !== void 0 && !isArrowheadKind(entry["arrowhead"])) {
        refusals.push({
          code: "document-invalid",
          path: `presentation.relations.${key}.arrowhead`,
          message: `arrowhead ${String(entry["arrowhead"])} is not a closed arrowhead registry word`
        });
      }
      if (entry["emphasis"] !== void 0 && !isLinkEmphasis(entry["emphasis"])) {
        refusals.push({
          code: "document-invalid",
          path: `presentation.relations.${key}.emphasis`,
          message: `emphasis ${String(entry["emphasis"])} is not a closed link-emphasis registry word`
        });
      }
    }
  }
  if (sourceView !== void 0) {
    for (const key of Object.keys(sourceView.relationOccurrences).sort(byString4)) {
      const occurrence = sourceView.relationOccurrences[key];
      if (occurrence === void 0)
        continue;
      if (occurrence === null || typeof occurrence !== "object" || Array.isArray(occurrence)) {
        refusals.push({ code: "document-invalid", path: `sourceView.relationOccurrences.${key}`, message: "relation occurrence must be a record" });
        continue;
      }
      for (const field of Object.keys(occurrence).sort(byString4)) {
        if (!ALLOWED_RELATION_OCCURRENCE_FIELDS.has(field)) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.${field}`,
            message: `unknown connector occurrence field ${field}; select connectors by closed registry words only`
          });
        }
      }
      const strokeStyle = occurrence["strokeStyle"];
      if (strokeStyle !== void 0) {
        if (!isStrokeStyle(strokeStyle)) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.strokeStyle`,
            message: `strokeStyle ${String(strokeStyle)} is not a closed dash-pattern registry word`
          });
        } else if (isFrozenV1 && strokeStyle === "dotted") {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.strokeStyle`,
            message: "strokeStyle dotted requires diagram-presentation@2 under view validation"
          });
        }
      }
      const arrowhead = occurrence["arrowhead"];
      if (arrowhead !== void 0) {
        if (!isArrowheadKind(arrowhead)) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.arrowhead`,
            message: `arrowhead ${String(arrowhead)} is not a closed arrowhead registry word`
          });
        } else if (isFrozenV1) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.arrowhead`,
            message: "arrowhead requires diagram-presentation@2 under view validation"
          });
        }
      }
      const emphasis = occurrence["emphasis"];
      if (emphasis !== void 0) {
        if (!isLinkEmphasis(emphasis)) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.emphasis`,
            message: `emphasis ${String(emphasis)} is not a closed link-emphasis registry word`
          });
        } else if (isFrozenV1) {
          refusals.push({
            code: "document-invalid",
            path: `sourceView.relationOccurrences.${key}.emphasis`,
            message: "emphasis requires diagram-presentation@2 under view validation"
          });
        }
      }
    }
  }
  return refusals;
}
function slotTexts(document, presentation, occurrence, entity) {
  const text3 = presentation.entities[occurrence]?.text;
  const slots = {};
  if (text3?.kicker !== void 0)
    slots.kicker = text3.kicker;
  const title = text3?.title ?? semanticName(document, entity);
  if (title !== "")
    slots.title = title;
  if (text3?.body !== void 0)
    slots.body = text3.body;
  if (text3?.detail !== void 0)
    slots.detail = text3.detail;
  if (text3?.subtitle !== void 0)
    slots.subtitle = text3.subtitle;
  if (text3?.footer !== void 0)
    slots.footer = text3.footer;
  return slots;
}
function edgeLabelOf(document, id) {
  const attributes = document.relations[id]?.attributes;
  const label = attributes?.["label"];
  if (label !== void 0 && label.kind === "text" && typeof label.value === "string" && label.value !== "") {
    return label.value;
  }
  return void 0;
}
function stripProjections(sourceView) {
  const relationOccurrences = {};
  for (const [key, occurrence] of Object.entries(sourceView.relationOccurrences)) {
    relationOccurrences[key] = {
      ...occurrence,
      endpoints: occurrence.endpoints.map((endpoint) => endpoint.sourceOccurrence === void 0 ? { role: endpoint.role, occurrence: endpoint.occurrence } : { role: endpoint.role, occurrence: endpoint.sourceOccurrence })
    };
  }
  return { ...sourceView, relationOccurrences };
}
function stampFoldGroups(sourceView, collapsed) {
  const groups = {};
  if (sourceView !== void 0) {
    for (const [key, group] of Object.entries(sourceView.groups)) {
      const typed = group;
      if (typed.occurrence === void 0) {
        groups[key] = { id: typed.id, occurrence: void 0 };
        continue;
      }
      if (collapsed.has(typed.occurrence)) {
        groups[key] = { id: typed.id, occurrence: typed.occurrence, collapsed: true };
        continue;
      }
      if (typed.collapsed === void 0) {
        const { collapsed: _absent, ...rest } = typed;
        void _absent;
        groups[key] = rest;
        continue;
      }
      groups[key] = { id: typed.id, occurrence: typed.occurrence, collapsed: false };
    }
  }
  for (const id of collapsed) {
    const bound = Object.keys(groups).find((key) => groups[key]?.occurrence === id);
    if (bound !== void 0)
      continue;
    const raw = id;
    const local = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
    const generated = `grp.${local.length}.${local}`;
    if (groups[generated] !== void 0)
      continue;
    groups[generated] = { id: generated, occurrence: id, collapsed: true };
  }
  return groups;
}
var clean4 = (value) => value === 0 ? 0 : value;
var HEADER_ROUNDS = 6;
var LANE_TOLERANCE = 0.5;
var OUTER_LANES = 6;
var sameRecord = (left, right) => {
  const lk = Object.keys(left);
  const rk = Object.keys(right);
  if (lk.length !== rk.length)
    return false;
  return lk.every((k) => left[k] === right[k]);
};
function computeNominalCompositionPlan(document, options, sourceView) {
  const neutralView = sourceView === void 0 ? void 0 : foldNeutralView(sourceView);
  const { previousOrientation: _ignoredPrev, ...restOptions } = options;
  void _ignoredPrev;
  const nominalOptions = {
    ...restOptions,
    collapsed: []
  };
  const shared = { sceneBoxCache: /* @__PURE__ */ new Map() };
  const want16x9 = options.hints?.composition?.aspect === "16:9";
  if (!want16x9) {
    const tau = 1.78;
    const capture = { autoPackLevels: {}, innerWiden: {} };
    const pass = layoutMeasuredPass(document, nominalOptions, neutralView, /* @__PURE__ */ new Set(), {
      mode: "nominal-plan",
      tauOverride: tau,
      capture,
      shared
    });
    if (pass.status === "refused") {
      return { status: "refused", result: pass };
    }
    const autoPackLevels2 = Object.fromEntries(Object.entries(capture.autoPackLevels).sort(([left], [right]) => byString4(left, right)));
    const innerWiden2 = Object.fromEntries(Object.entries(capture.innerWiden).sort(([left], [right]) => byString4(left, right)));
    const sigmaCols = {};
    const sigmaBands = {};
    const legendCell = capture.legendCell;
    const planDigest2 = computePlanDigest({
      tau,
      autoPackLevels: autoPackLevels2,
      innerWiden: innerWiden2,
      sigmaCols,
      sigmaBands,
      ...legendCell === void 0 ? {} : { legendCell }
    });
    return {
      status: "ok",
      plan: {
        planDigest: planDigest2,
        tau,
        autoPackLevels: autoPackLevels2,
        innerWiden: innerWiden2,
        sigmaCols,
        sigmaBands,
        ...legendCell === void 0 ? {} : { legendCell }
      },
      ...shared.graph === void 0 ? {} : { graph: shared.graph }
    };
  }
  const ladderCandidates = [];
  let chosenSizingReport;
  let capturedLegendCell;
  const sizingByTau = /* @__PURE__ */ new Map();
  for (const tau of ASPECT_TAU_LADDER) {
    const cap = { autoPackLevels: {}, innerWiden: {} };
    const sizingPass = layoutMeasuredPass(document, nominalOptions, neutralView, /* @__PURE__ */ new Set(), {
      mode: "nominal-plan",
      tauOverride: tau,
      sizingOnly: true,
      capture: cap,
      shared
    });
    if (sizingPass.status === "refused") {
      return { status: "refused", result: sizingPass };
    }
    const report = cap.sizingReport;
    if (report === void 0) {
      return { status: "refused", result: sizingPass };
    }
    if (capturedLegendCell === void 0 && cap.legendCell !== void 0) {
      capturedLegendCell = cap.legendCell;
    }
    sizingByTau.set(tau, report);
    const combined = combineRootWithLegendBounds(report.rootWidth, report.rootHeight, report.legendSize, report.effectiveLegendAnchor, report.legendInsideCell);
    ladderCandidates.push({ tau, width: combined.width, height: combined.height });
  }
  const chosenTau = chooseAspectTau(ladderCandidates, ASPECT_16_9_TARGET);
  chosenSizingReport = sizingByTau.get(chosenTau.tau);
  const slack1 = computeAspectSlack({
    width: chosenTau.width,
    height: chosenTau.height,
    xTrackIds: chosenSizingReport.xTrackIds,
    yTrackIds: chosenSizingReport.yTrackIds,
    capX: chosenSizingReport.capX,
    capY: chosenSizingReport.capY
  });
  const capture1 = { autoPackLevels: {}, innerWiden: {} };
  const pass1 = layoutMeasuredPass(document, nominalOptions, neutralView, /* @__PURE__ */ new Set(), {
    mode: "nominal-plan",
    tauOverride: chosenTau.tau,
    sigmaColsOverride: slack1.sigmaCols,
    sigmaBandsOverride: slack1.sigmaBands,
    ...capturedLegendCell === void 0 ? {} : { legendCellOverride: capturedLegendCell },
    capture: capture1,
    shared
  });
  if (pass1.status === "refused") {
    return { status: "refused", result: pass1 };
  }
  const painted1 = capture1.paintedBounds ?? { width: chosenTau.width, height: chosenTau.height };
  const ratio1 = painted1.height > 0 && painted1.width > 0 ? painted1.width / painted1.height : ASPECT_16_9_TARGET;
  const dist1 = Math.abs(Math.log(ratio1 / ASPECT_16_9_TARGET));
  let bestCapture = capture1;
  let bestSigmaCols = slack1.sigmaCols;
  let bestSigmaBands = slack1.sigmaBands;
  let bestRatio = ratio1;
  let postRouteCorrectionRounds = 0;
  if (Math.abs(ratio1 / ASPECT_16_9_TARGET - 1) > ASPECT_16_9_TOLERANCE) {
    const sumX1 = Object.values(slack1.sigmaCols).reduce((sum, v) => sum + v, 0);
    const sumY1 = Object.values(slack1.sigmaBands).reduce((sum, v) => sum + v, 0);
    const baseW = Math.max(1, painted1.width - sumX1);
    const baseH = Math.max(1, painted1.height - sumY1);
    const slack2 = computeAspectSlack({
      width: baseW,
      height: baseH,
      xTrackIds: chosenSizingReport.xTrackIds,
      yTrackIds: chosenSizingReport.yTrackIds,
      capX: chosenSizingReport.capX,
      capY: chosenSizingReport.capY
    });
    if (!sameRecord(slack2.sigmaCols, slack1.sigmaCols) || !sameRecord(slack2.sigmaBands, slack1.sigmaBands)) {
      postRouteCorrectionRounds = 1;
      const capture2 = { autoPackLevels: {}, innerWiden: {} };
      const pass2 = layoutMeasuredPass(document, nominalOptions, neutralView, /* @__PURE__ */ new Set(), {
        mode: "nominal-plan",
        tauOverride: chosenTau.tau,
        sigmaColsOverride: slack2.sigmaCols,
        sigmaBandsOverride: slack2.sigmaBands,
        ...capturedLegendCell === void 0 ? {} : { legendCellOverride: capturedLegendCell },
        capture: capture2,
        shared
      });
      if (pass2.status === "laid-out") {
        const painted2 = capture2.paintedBounds ?? painted1;
        const ratio2 = painted2.height > 0 && painted2.width > 0 ? painted2.width / painted2.height : ASPECT_16_9_TARGET;
        const dist2 = Math.abs(Math.log(ratio2 / ASPECT_16_9_TARGET));
        if (dist2 < dist1 - 1e-9) {
          bestCapture = capture2;
          bestSigmaCols = slack2.sigmaCols;
          bestSigmaBands = slack2.sigmaBands;
          bestRatio = ratio2;
        }
      }
    }
  }
  const autoPackLevels = Object.fromEntries(Object.entries(bestCapture.autoPackLevels).sort(([left], [right]) => byString4(left, right)));
  const innerWiden = Object.fromEntries(Object.entries(bestCapture.innerWiden).sort(([left], [right]) => byString4(left, right)));
  const nominalAspect = clean4(Math.round(bestRatio * 1e6) / 1e6);
  const unreached = Math.abs(bestRatio / ASPECT_16_9_TARGET - 1) > ASPECT_16_9_TOLERANCE;
  const finalLegendCell = capturedLegendCell ?? bestCapture.legendCell;
  const planDigest = computePlanDigest({
    tau: chosenTau.tau,
    autoPackLevels,
    innerWiden,
    sigmaCols: bestSigmaCols,
    sigmaBands: bestSigmaBands,
    ...finalLegendCell === void 0 ? {} : { legendCell: finalLegendCell }
  });
  return {
    status: "ok",
    plan: {
      planDigest,
      tau: chosenTau.tau,
      autoPackLevels,
      innerWiden,
      sigmaCols: bestSigmaCols,
      sigmaBands: bestSigmaBands,
      ...finalLegendCell === void 0 ? {} : { legendCell: finalLegendCell },
      nominalAspect,
      postRouteCorrectionRounds,
      ...unreached ? { aspectUnreached: { achieved: nominalAspect, target: ASPECT_16_9_TARGET } } : {}
    },
    ...shared.graph === void 0 ? {} : { graph: shared.graph }
  };
}
function layoutMeasured(document, options, sourceView, execution) {
  const relationStyleRefusals = validateRelationPresentations(options.presentation?.relations, options.presentation?.contractPin ?? sourceView?.presentation.diagram?.contractPin, sourceView);
  if (relationStyleRefusals.length > 0) {
    return { status: "refused", refusals: relationStyleRefusals, diagnostics: [] };
  }
  if (document.profileRefs.length === 1 && document.profileRefs[0] === "erd@1")
    return layoutErd(document, options, sourceView);
  if (document.profileRefs.length === 1 && document.profileRefs[0] === "process@1")
    return layoutProcess(document, options, sourceView);
  let stateCtx;
  if (options.hints?.composition !== void 0) {
    let nominalPlan = execution?.plan;
    let prevalidatedGraph = execution?.graph;
    if (nominalPlan === void 0) {
      const built = computeNominalCompositionPlan(document, options, sourceView);
      if (built.status === "refused")
        return built.result;
      nominalPlan = built.plan;
      prevalidatedGraph = built.graph;
    }
    stateCtx = {
      mode: "state",
      plan: nominalPlan,
      ...execution?.memo === void 0 ? {} : { memo: execution.memo },
      ...prevalidatedGraph === void 0 ? {} : { shared: { graph: prevalidatedGraph } }
    };
  }
  const first = layoutMeasuredPass(document, options, sourceView, /* @__PURE__ */ new Set(), stateCtx);
  if (first.status !== "laid-out" || first.flowTargets === void 0)
    return first;
  const forced = /* @__PURE__ */ new Set();
  const failed = new Set(first.warnings.filter((w) => w.code === "route-obstructed" || w.code === "badge-unplaced").flatMap((w) => w.refs));
  const plan = planFlows(document, first.view, options.registry, options, /* @__PURE__ */ new Set());
  for (const [key, members] of plan.groups) {
    if (members.length >= 2 && !first.flowBundles?.some((b) => b.id === key) && members.some((m) => failed.has(m.occurrence)))
      forced.add(key);
  }
  if (forced.size === 0)
    return first;
  const repaired = layoutMeasuredPass(document, options, sourceView, forced, stateCtx);
  return repaired.status === "laid-out" ? { ...repaired, flowRepairPasses: 1 } : repaired;
}
function layoutMeasuredPass(document, options, sourceView, forced, planCtx) {
  if (!Number.isFinite(options.targetWidth) || options.targetWidth <= 0) {
    return {
      status: "refused",
      refusals: [
        {
          code: "target-width-invalid",
          path: "targetWidth",
          message: `the target width is a positive number of CSS px, got ${String(options.targetWidth)}`
        }
      ],
      diagnostics: []
    };
  }
  if (sourceView !== void 0 && Object.values(sourceView.entityOccurrences).some((occurrence) => document.entities[occurrence.entity]?.type === "flow-scenario"))
    return { status: "refused", refusals: [{ code: "document-invalid", path: "sourceView.entityOccurrences", message: "flow scenarios have no view occurrence" }], diagnostics: [] };
  const presentation = options.presentation;
  if (presentation === void 0) {
    return {
      status: "refused",
      refusals: [{ code: "document-invalid", path: "presentation", message: "measured layout needs presentation.diagram" }],
      diagnostics: []
    };
  }
  const occurrenceAnatomy = (occurrence) => diagramAnatomyOf(presentation, sourceView, occurrence);
  const cardWidthOf = (occurrence) => anatomyCardGeometry(occurrenceAnatomy(occurrence)).width;
  if (options.measureLines === void 0) {
    return {
      status: "refused",
      refusals: [
        {
          code: "measure-lines-missing",
          path: "measureLines",
          message: "measured layout needs an injected LineMeasurer through options.measureLines"
        }
      ],
      diagnostics: []
    };
  }
  const measure2 = options.measureLines;
  const sceneBoxCache = planCtx?.shared?.sceneBoxCache ?? /* @__PURE__ */ new Map();
  const sceneBoxAt = (id, width, collapsed) => {
    const key = `${id}|${width}|${collapsed}`;
    let box = sceneBoxCache.get(key);
    if (box === void 0) {
      const rawEntry = presentation.entities[id];
      const entry = rawEntry === void 0 ? void 0 : { ...rawEntry, anatomy: occurrenceAnatomy(id) };
      const kind = kinds.get(projected.entityOccurrences[id]?.entity);
      const expanded = kind === "container-expanded" || kind === "legend-expanded";
      box = measureSceneBox(expanded && entry?.form === "card" ? { ...entry, form: "container" } : entry, id, width, collapsed, measure2, metrics.containerPadding);
      sceneBoxCache.set(key, box);
    }
    return box;
  };
  let graph = planCtx?.shared?.graph;
  if (graph === void 0) {
    const validationOptions = options.bindings === void 0 ? { registry: options.registry } : { registry: options.registry, bindings: options.bindings };
    const diagnostics = [...validateDocument(document, validationOptions), ...validateFlows(document)];
    if (hasErrors(diagnostics)) {
      return {
        status: "refused",
        refusals: [{ code: "document-invalid", path: "document", message: "diagram-core refuses this document" }],
        diagnostics
      };
    }
    const read = readMeasuredGraph(document, options.registry);
    if ("refusals" in read)
      return { status: "refused", refusals: read.refusals, diagnostics: [] };
    graph = read.graph;
    if (planCtx?.shared !== void 0)
      planCtx.shared.graph = graph;
  }
  const r7Routing = isR7ConnectorPresentation(presentation, sourceView, document);
  const routeSpacing = r7Routing ? options.metrics?.routeSpacing ?? DEFAULT_ROUTE_SPACING : 0;
  const borderClearance = r7Routing ? options.metrics?.routeBorderClearance ?? DEFAULT_ROUTE_BORDER_CLEARANCE : options.metrics?.clearance ?? DEFAULT_LAYOUT_METRICS.clearance;
  const dockCornerInset = routeSpacing > 0 ? Math.ceil(routeSpacing / Math.SQRT2) : 0;
  const baseSlotSpacing = options.metrics?.trackSpacing ?? channelMetrics({}, true).trackSpacing;
  const metrics = {
    ...DEFAULT_LAYOUT_METRICS,
    ...options.metrics,
    routeSpacing,
    routeBorderClearance: borderClearance,
    slotSpacing: options.metrics?.slotSpacing ?? (r7Routing ? Math.max(routeSpacing, baseSlotSpacing) : baseSlotSpacing)
  };
  const hints = options.hints ?? {};
  const composition = hints.composition;
  const zoneRule = r7Routing || composition !== void 0;
  const gaps = resolveGaps(options.hints, metrics);
  const globalStretch = hints.stretch ?? false;
  const rowPack = resolveRowPack(options.rowPack);
  const contentInset = metrics.containerPadding;
  const rowGaps = resolveRowGaps(hints, metrics);
  const zoneGutter = resolveRowGaps(hints, metrics, zoneRule).zoneX;
  {
    const refusals = [...validateRowPack(rowPack)];
    const refuseGap = (path, name, value, cap) => {
      if (Number.isFinite(value) && value >= 0 && value <= cap)
        return;
      refusals.push({
        code: "layout-hint-invalid",
        path,
        message: `the sibling gap ${name} is within [0, ${String(cap)}] (axis cap), got ${String(value)}`
      });
    };
    refuseGap("hints.cardGapX", "cardGapX", rowGaps.cardX, rowGaps.maxX);
    refuseGap("hints.zoneGapX", "zoneGapX", hints.zoneGapX ?? rowGaps.zoneX, rowGaps.maxX);
    refuseGap("hints.cardGapY", "cardGapY", rowGaps.cardY, rowGaps.maxY);
    refuseGap("hints.zoneGapY", "zoneGapY", hints.zoneGapY ?? rowGaps.zoneY, rowGaps.maxY);
    const visitGap = (group, path) => {
      if (group.gapAfter !== void 0) {
        refuseGap(`${path}.gapAfter`, `gapAfter of group ${group.id}`, group.gapAfter, Math.min(rowGaps.maxX, rowGaps.maxY));
      }
      for (const item of group.items)
        if (isLayoutGroup(item))
          visitGap(item, `${path}.items.${item.id}`);
    };
    for (const group of hints.grouping ?? [])
      visitGap(group, `hints.grouping.${group.id}`);
    if (refusals.length > 0)
      return { status: "refused", refusals, diagnostics: [] };
  }
  const occurrenceOf = (entity) => occurrenceRef(`e.${localIdOf(entity)}`);
  const collapsedOccurrences = options.collapsed !== void 0 ? new Set(options.collapsed) : sourceView !== void 0 ? /* @__PURE__ */ new Set([...collapsedOf(sourceView)]) : /* @__PURE__ */ new Set();
  const synthesizeRetained = () => {
    const foldResolver = createTypeResolver(document);
    const bindsFoldGroup = (parent) => {
      const entity = document.entities[parent];
      const profile = entity === void 0 ? void 0 : options.registry.get(entity.profile);
      if (entity === void 0 || profile === void 0)
        return false;
      const resolution = foldResolver.resolve(profile, entity.type);
      return resolution.ok && resolution.resolved.container;
    };
    const entityOccurrences = {};
    const synthesizedGroups = {};
    for (const id of graph.nodes.keys()) {
      const occurrence = occurrenceOf(id);
      const parent = graph.nodes.get(id)?.parent;
      const group = parent === void 0 || !bindsFoldGroup(parent) ? void 0 : foldGroupId(occurrenceOf(parent));
      entityOccurrences[occurrence] = {
        id: occurrence,
        entity: id,
        ...group === void 0 ? {} : { group },
        geometry: { x: 0, y: 0, width: FIXED_CARD_WIDTH, height: 200 }
      };
      if (group !== void 0) {
        const parentOccurrence = occurrenceOf(parent);
        synthesizedGroups[group] ??= { id: group, occurrence: parentOccurrence };
      }
    }
    const portOccurrences = {};
    const coded = (value) => `${value.length}.${value}`;
    for (const portId of Object.keys(document.ports ?? {}).sort(byString4)) {
      const port = document.ports[portId];
      const owner = port?.owner;
      if (owner === void 0 || !graph.nodes.has(owner))
        continue;
      const occurrence = occurrenceRef(`p.s.${coded(localIdOf(portId))}`);
      portOccurrences[occurrence] = {
        id: occurrence,
        port: portId,
        ownerOccurrence: occurrenceOf(owner),
        side: "south",
        order: 0,
        anchor: 0
      };
    }
    const relationOccurrences = {};
    for (const edge of graph.edges) {
      const occurrence = occurrenceRef(`r.${localIdOf(edge.id)}`);
      const sourceOccurrence = edge.source.port === void 0 ? occurrenceOf(edge.source.entity) : occurrenceRef(`p.s.${coded(localIdOf(edge.source.port))}`);
      const targetOccurrence = edge.target.port === void 0 ? occurrenceOf(edge.target.entity) : occurrenceRef(`p.s.${coded(localIdOf(edge.target.port))}`);
      const style = relationPresentationFor(presentation.relations, occurrence, edge.id);
      relationOccurrences[occurrence] = {
        id: occurrence,
        relation: edge.id,
        endpoints: [
          { role: "source", occurrence: sourceOccurrence },
          { role: "target", occurrence: targetOccurrence }
        ],
        ...style?.strokeStyle === void 0 ? {} : { strokeStyle: style.strokeStyle },
        ...style?.arrowhead === void 0 ? {} : { arrowhead: style.arrowhead },
        ...style?.emphasis === void 0 ? {} : { emphasis: style.emphasis }
      };
    }
    return {
      viewId: options.viewId ?? viewRef("layout"),
      semanticDocumentId: document.documentId,
      revision: document.revision,
      entityOccurrences,
      relationOccurrences,
      portOccurrences,
      groups: synthesizedGroups,
      filters: [],
      presentation: { camera: { x: 0, y: 0, zoom: 1 }, diagram: persistableDiagramPresentation(presentation) }
    };
  };
  let projected;
  if (sourceView !== void 0) {
    try {
      const stripped = stripProjections(sourceView);
      projected = projectView(document, stripped, [...collapsedOccurrences]);
    } catch {
      const stampedGroups = stampFoldGroups(sourceView, collapsedOccurrences);
      projected = { ...sourceView, groups: stampedGroups };
    }
  } else {
    const retained = synthesizeRetained();
    try {
      projected = projectView(document, retained, [...collapsedOccurrences]);
    } catch {
      projected = retained;
    }
  }
  const flowOccurrences = /* @__PURE__ */ new Set();
  for (const occurrence of Object.values(projected.relationOccurrences)) {
    if (document.relations[occurrence.relation]?.type !== "flow-step")
      continue;
    if (flowOccurrences.has(occurrence.relation))
      return { status: "refused", refusals: [{ code: "document-invalid", path: "sourceView.relationOccurrences", message: "one flow step must have at most one occurrence per view" }], diagnostics: [] };
    flowOccurrences.add(occurrence.relation);
  }
  const flowPlan = planFlows(document, projected, options.registry, options, forced);
  const hasFlows = flowOccurrences.size > 0;
  const flowTokens = { ...DEFAULT_FLOW_TOKENS, ...options.flowTokens };
  const entityToOccurrences = /* @__PURE__ */ new Map();
  for (const occurrence of Object.values(projected.entityOccurrences)) {
    const list = entityToOccurrences.get(occurrence.entity) ?? [];
    list.push(occurrence.id);
    entityToOccurrences.set(occurrence.entity, list);
  }
  for (const list of entityToOccurrences.values())
    list.sort(byString4);
  const visibleOccurrences = evaluateVisibility({ document, view: projected }).visible;
  const visibleEntities = /* @__PURE__ */ new Set();
  for (const id of [...visibleOccurrences].sort(byString4)) {
    const entity = projected.entityOccurrences[id]?.entity;
    if (entity !== void 0 && graph.nodes.has(entity))
      visibleEntities.add(entity);
  }
  const visible = (id) => visibleEntities.has(id);
  const representativeOf2 = (entity) => {
    const list = entityToOccurrences.get(entity) ?? [];
    return list.find((occurrence) => visibleOccurrences.has(occurrence)) ?? list[0] ?? occurrenceOf(entity);
  };
  const anatomyOverrides = Object.fromEntries(Object.keys(projected.entityOccurrences).flatMap((id) => {
    const anatomy = presentation.entities[id]?.anatomy ?? sourceView?.presentation.entityAnatomy?.[id];
    return anatomy === void 0 || anatomy === (projected.presentation.anatomy ?? "v1") ? [] : [[id, anatomy]];
  }));
  const { entityAnatomy: _previousAnatomy, ...projectedPresentation } = projected.presentation;
  const foldMetadata = {
    groups: projected.groups,
    filters: [...projected.filters],
    presentationState: {
      ...projectedPresentation,
      ...Object.keys(anatomyOverrides).length === 0 ? {} : { entityAnatomy: anatomyOverrides },
      diagram: persistableDiagramPresentation(presentation)
    },
    summaryLabels: projected.summaryLabels,
    projected,
    representativeOf: representativeOf2
  };
  const isCollapsed = (id) => collapsedOccurrences.has(representativeOf2(id));
  const classify = (id) => {
    const node = graph.nodes.get(id);
    const form = formOf(presentation, representativeOf2(id));
    if (form === "legend-key")
      return "legend-key";
    if (form === "legend")
      return isCollapsed(id) ? "legend-collapsed" : "legend-expanded";
    if (form === "container" || node.kind === "container") {
      return isCollapsed(id) ? "container-collapsed" : "container-expanded";
    }
    return "leaf";
  };
  const kinds = /* @__PURE__ */ new Map();
  for (const id of graph.nodes.keys())
    kinds.set(id, classify(id));
  const containerEntities = /* @__PURE__ */ new Set();
  for (const node of graph.nodes.values()) {
    const kind = kinds.get(node.id);
    if (node.kind === "container" || kind === "container-expanded" || kind === "container-collapsed" || kind === "legend-expanded" || kind === "legend-collapsed") {
      containerEntities.add(node.id);
    }
  }
  const hintRefusals = validateHints(hints, {
    roots: new Set(graph.roots),
    parentOf: new Map([...graph.nodes.values()].map((node) => [node.id, node.parent])),
    containers: containerEntities
  });
  if (hintRefusals.length > 0)
    return { status: "refused", refusals: hintRefusals, diagnostics: [] };
  const childOrder = (parent, children) => {
    const live = children.filter(visible);
    if (kinds.get(parent) === "legend-expanded") {
      const order = presentation.legends[representativeOf2(parent)]?.order;
      return resolveOrder(live, order);
    }
    return resolveOrder(live, hints.ordering?.[parent]);
  };
  const placementParentOf = (id) => {
    let current = graph.nodes.get(id)?.parent;
    while (current !== void 0) {
      if (visible(current)) {
        const kind = kinds.get(current);
        if (kind === "container-expanded" || kind === "legend-expanded")
          return current;
      }
      current = graph.nodes.get(current)?.parent;
    }
    return void 0;
  };
  const placedChildrenOf = (id) => {
    const kind = kinds.get(id);
    if (kind !== "container-expanded" && kind !== "legend-expanded")
      return [];
    return [...graph.nodes.keys()].filter((child) => visible(child) && placementParentOf(child) === id);
  };
  const groupEffectiveOf = (group, parentEffective) => effectiveStretch(group.stretch, parentEffective);
  const contextStretchOf = (member) => {
    let bestEffective = globalStretch;
    let bestDepth = -1;
    const visit = (group, depth, parentEffective) => {
      const effective = groupEffectiveOf(group, parentEffective);
      if (groupLeaves(group).includes(member) && depth > bestDepth) {
        bestEffective = effective;
        bestDepth = depth;
      }
      for (const item of group.items)
        if (isLayoutGroup(item))
          visit(item, depth + 1, effective);
    };
    for (const group of hints.grouping ?? [])
      visit(group, 0, globalStretch);
    return bestDepth >= 0 ? bestEffective : globalStretch;
  };
  const unwrappedHeaderWidth = (id) => {
    const slots = slotTexts(document, presentation, representativeOf2(id), id);
    const width = headerAvailableWidth(UNWRAPPED_PROBE_WIDTH, true);
    let widest = 0;
    for (const role3 of ["kicker", "title"]) {
      const text3 = slots[role3];
      if (text3 === void 0)
        continue;
      widest = Math.max(widest, measure2({ text: text3, role: role3, availableWidth: width, allocatedLines: 1, folded: false }).width);
    }
    return widest;
  };
  const isStretchedBox = (id) => {
    const kind = kinds.get(id);
    return kind === "container-expanded" || kind === "legend-expanded";
  };
  const rootOrder = resolveOrder([...graph.nodes.keys()].filter((id) => visible(id) && placementParentOf(id) === void 0).sort(byString4), hints.rootOrder);
  const orderedChildren = /* @__PURE__ */ new Map();
  const orderedChildrenOf = (id) => {
    let ordered = orderedChildren.get(id);
    if (ordered === void 0) {
      ordered = childOrder(id, placedChildrenOf(id));
      orderedChildren.set(id, ordered);
    }
    return ordered;
  };
  const levelKeyOf = (parent) => parent === void 0 ? ROOT_LEVEL_KEY : representativeOf2(parent);
  const buildGroupRun = (group, key, parentEffective) => {
    const stretch = effectiveStretch(group.stretch, parentEffective);
    const items = [];
    for (const item of group.items) {
      if (isLayoutGroup(item)) {
        const run = buildGroupRun(item, `${key}/${item.id}`, stretch);
        if (run.items.length > 0)
          items.push({ run, gapAfter: item.gapAfter });
      } else if (visible(item)) {
        items.push({ entity: item });
      }
    }
    return { key, mode: group.direction, items, stretch };
  };
  const buildLevelRun = (parent, ordered) => {
    const key = levelKeyOf(parent);
    const inherited = parent === void 0 ? globalStretch : contextStretchOf(parent);
    const parts = groupsForLevel(ordered, hints);
    if (parts === void 0)
      return { key, mode: "auto", items: ordered.map((entity) => ({ entity })), stretch: inherited };
    const items = parts.map((part) => part.group === void 0 ? {
      run: { key: `${key}#rest`, mode: "auto", items: part.members.map((entity) => ({ entity })), stretch: inherited },
      gapAfter: void 0
    } : { run: buildGroupRun(part.group, `${key}#${part.group.id}`, globalStretch), gapAfter: part.group.gapAfter });
    return { key, mode: "auto", items, stretch: false };
  };
  const itemHasZone = (item) => "entity" in item ? kinds.get(item.entity) !== "leaf" : runHasZone(item.run);
  const runHasZone = (run) => run.items.some(itemHasZone);
  const shelfHasZone = (run, shelf) => shelf.some((slot) => itemHasZone(run.items[slot]));
  const resolveDrawnEnd = (occurrence) => {
    const entityOccurrence = projected.entityOccurrences[occurrence];
    if (entityOccurrence !== void 0 && visibleOccurrences.has(occurrence)) {
      return { entity: entityOccurrence.entity };
    }
    const portOccurrence = projected.portOccurrences[occurrence];
    if (portOccurrence !== void 0 && visibleOccurrences.has(occurrence)) {
      const owner = projected.entityOccurrences[portOccurrence.ownerOccurrence];
      if (owner === void 0 || !visibleOccurrences.has(portOccurrence.ownerOccurrence))
        return void 0;
      return { entity: owner.entity, port: portOccurrence.port };
    }
    return void 0;
  };
  const drawnEdges = [];
  for (const occurrence of Object.values(projected.relationOccurrences).sort((left, right) => byString4(left.id, right.id))) {
    const semantic = document.relations[occurrence.relation];
    const owner = semantic === void 0 ? void 0 : options.registry.get(semantic.profile);
    if (semantic === void 0 || owner === void 0 || relationBaseType(document, owner, semantic) !== "link" || !relationVerdict(projected, semantic, document).visible)
      continue;
    const sourceEnd = occurrence.endpoints.find((endpoint) => endpoint.role === "source");
    const targetEnd = occurrence.endpoints.find((endpoint) => endpoint.role === "target");
    if (sourceEnd === void 0 || targetEnd === void 0)
      continue;
    const source = resolveDrawnEnd(sourceEnd.occurrence);
    const target = resolveDrawnEnd(targetEnd.occurrence);
    if (source === void 0 || target === void 0)
      continue;
    if (flowPlan.suppressed.has(occurrence.id))
      continue;
    drawnEdges.push({ occurrence: occurrence.id, relation: occurrence.relation, source, target });
  }
  const edgeBundles = {};
  const liftedPairs = /* @__PURE__ */ new Map();
  for (const edge of drawnEdges) {
    if (flowOccurrences.has(edge.relation))
      continue;
    const projectedEdge = projected.relationOccurrences[edge.occurrence];
    if (!projectedEdge.endpoints.some((end) => end.sourceOccurrence !== void 0))
      continue;
    let key;
    if (r7Routing) {
      const relStyle = relationPresentationFor(presentation.relations, projectedEdge.id, projectedEdge.relation);
      const strokeStyle = resolveDashPattern(projectedEdge.strokeStyle ?? relStyle?.strokeStyle)?.style ?? "solid";
      const arrowhead = resolveArrowhead(projectedEdge.arrowhead ?? relStyle?.arrowhead)?.canonicalKind ?? "arrow";
      const emphasis = resolveLinkEmphasis(projectedEdge.emphasis ?? relStyle?.emphasis)?.emphasis ?? "default";
      key = JSON.stringify([edge.source.entity, edge.target.entity, strokeStyle, arrowhead, emphasis]);
    } else {
      key = JSON.stringify([edge.source.entity, edge.target.entity]);
    }
    const pair3 = liftedPairs.get(key) ?? [];
    pair3.push(edge);
    liftedPairs.set(key, pair3);
  }
  const bundled = /* @__PURE__ */ new Set();
  for (const pair3 of liftedPairs.values()) {
    if (pair3.length < 2)
      continue;
    const first2 = pair3[0];
    edgeBundles[first2.occurrence] = {
      members: pair3.map((edge) => edge.occurrence),
      label: `${pair3.length} liaisons`,
      relations: pair3.map((edge) => edgeLabelOf(document, edge.relation)).filter((label) => label !== void 0),
      title: pair3.map((edge) => edgeLabelOf(document, edge.relation)).filter((label) => label !== void 0).join("\n")
    };
    pair3.slice(1).forEach((edge) => bundled.add(edge.occurrence));
  }
  for (let index = drawnEdges.length - 1; index >= 0; index -= 1) {
    if (bundled.has(drawnEdges[index].occurrence))
      drawnEdges.splice(index, 1);
  }
  const portClaims = /* @__PURE__ */ new Map();
  if (hasFlows)
    for (const edge of drawnEdges)
      for (const end of projected.relationOccurrences[edge.occurrence].endpoints) {
        if (projected.portOccurrences[end.occurrence] !== void 0)
          portClaims.set(end.occurrence, (portClaims.get(end.occurrence) ?? 0) + 1);
      }
  const slotOf = (edge, role3) => {
    const occurrence = projected.relationOccurrences[edge.occurrence].endpoints.find((end) => end.role === role3)?.occurrence;
    return occurrence !== void 0 && (portClaims.get(occurrence) ?? 0) > 1 ? occurrence : void 0;
  };
  const flowRunRanks = new Map([...flowPlan.ranks].filter(([id]) => {
    const edge = drawnEdges.find((candidate) => candidate.occurrence === id);
    return edge !== void 0 && slotOf(edge, "source") === void 0 && slotOf(edge, "target") === void 0;
  }));
  const filteredGraph = {
    nodes: new Map([...graph.nodes].filter(([id]) => visible(id))),
    roots: graph.roots.filter(visible),
    edges: drawnEdges.map((edge) => ({
      ...flowRunRanks.has(edge.occurrence) ? { flowRank: flowRunRanks.get(edge.occurrence) } : {},
      id: edge.occurrence,
      source: edge.source.port === void 0 ? { entity: edge.source.entity } : { entity: edge.source.entity, port: edge.source.port, ...slotOf(edge, "source") === void 0 ? {} : { slot: slotOf(edge, "source") } },
      target: edge.target.port === void 0 ? { entity: edge.target.entity } : { entity: edge.target.entity, port: edge.target.port, ...slotOf(edge, "target") === void 0 ? {} : { slot: slotOf(edge, "target") } }
    }))
  };
  const edgeLabelMeasure = scaleEdgeLabelMeasurer(measure2, r7Routing ? metrics.edgeLabelSize : void 0, DEFAULT_EDGE_LABEL_SIZE);
  const labelSizes = /* @__PURE__ */ new Map();
  const edgeLayouts = /* @__PURE__ */ new Map();
  for (const edge of drawnEdges) {
    if (flowPlan.bundles.some((bundle2) => bundle2.carrier === edge.occurrence))
      continue;
    const label = edgeBundles[edge.occurrence]?.label ?? edgeLabelOf(document, edge.relation);
    if (label === void 0)
      continue;
    const bundle = edgeBundles[edge.occurrence];
    const chip = bundle?.relations === void 0 ? void 0 : measureBundleLabel(bundle.relations, edgeLabelMeasure, metrics.bundleLabelMaxWidth, bundle.members.length);
    const layout = chip === void 0 ? edgeLabelMeasure({
      text: label,
      role: "edge-label",
      availableWidth: EDGE_LABEL_WIDTH,
      allocatedLines: DEFAULT_ALLOCATED_LINES["edge-label"],
      folded: false
    }) : chip.layout;
    if (bundle !== void 0 && chip !== void 0)
      bundle.chip = chip;
    const occurrenceId = edge.occurrence;
    edgeLayouts.set(occurrenceId, layout);
    labelSizes.set(occurrenceId, { width: layout.width, height: layout.height });
  }
  const routeSizes = new Map(labelSizes);
  for (const member of flowPlan.members) {
    if (flowPlan.suppressed.has(member.occurrence))
      continue;
    const bundle = flowPlan.bundles.find((b) => b.carrier === member.occurrence);
    const text3 = bundle === void 0 ? member.step.badge : (options.flows?.countTemplate ?? "{n}").replaceAll("{n}", String(bundle.members.length));
    const badge = measure2({ text: text3, role: "flow-badge", availableWidth: Number.MAX_SAFE_INTEGER, allocatedLines: 1, folded: false });
    const old = routeSizes.get(member.occurrence);
    routeSizes.set(member.occurrence, { width: Math.max(old?.width ?? 0, flowTokens.flowBadgeSize, badge.width + 2 * flowTokens.flowBadgePaddingX), height: Math.max(old?.height ?? 0, flowTokens.flowBadgeSize) });
  }
  const projectedAncestorsOf = (occurrence) => {
    const start = projected.portOccurrences[occurrence]?.ownerOccurrence ?? occurrence;
    const found = [];
    const seen2 = /* @__PURE__ */ new Set();
    let current = parentOccurrenceOf(projected, start);
    while (current !== void 0 && !seen2.has(current)) {
      seen2.add(current);
      const entity = projected.entityOccurrences[current]?.entity;
      if (entity !== void 0 && visible(entity))
        found.push(entity);
      current = parentOccurrenceOf(projected, current);
    }
    return found;
  };
  const sharedContainerOf = (left, right) => {
    const chain = /* @__PURE__ */ new Set();
    for (let current = placementParentOf(right); current !== void 0; current = placementParentOf(current))
      chain.add(current);
    for (let current = placementParentOf(left); current !== void 0; current = placementParentOf(current)) {
      if (chain.has(current))
        return current;
    }
    return void 0;
  };
  const lineHeightOf = (role3) => measure2({ text: "Mg", role: role3, availableWidth: 1e3, allocatedLines: 1, folded: false }).height;
  const effectiveLegendAnchor = composition === void 0 ? "none" : composition.legend === "host" ? options.legend ?? "right" : composition.legend;
  const stateMeasuredLegend = (() => {
    if (composition === void 0 || effectiveLegendAnchor === "none")
      return void 0;
    const legendEdges = [];
    for (const edge of drawnEdges) {
      const occurrence = projected.relationOccurrences[edge.occurrence];
      if (occurrence === void 0)
        continue;
      const semantic = document.relations[occurrence.relation];
      if (semantic?.profile === "erd@1" || semantic?.type === "flow-step")
        continue;
      const relStyle = presentation.relations?.[occurrence.id] ?? presentation.relations?.[occurrence.relation];
      const rawStroke = occurrence.strokeStyle ?? relStyle?.strokeStyle;
      const resolvedStroke = rawStroke === void 0 ? void 0 : resolveDashPattern(rawStroke)?.style;
      const rawArrow = occurrence.arrowhead ?? relStyle?.arrowhead;
      const resolvedArrow = rawArrow === void 0 ? void 0 : resolveArrowhead(rawArrow)?.canonicalKind;
      const rawEmphasis = occurrence.emphasis ?? relStyle?.emphasis;
      const resolvedEmphasis = rawEmphasis === void 0 ? void 0 : resolveLinkEmphasis(rawEmphasis)?.emphasis;
      legendEdges.push({
        ...r7Routing && resolvedStroke !== void 0 && resolvedStroke !== "solid" ? { strokeStyle: resolvedStroke } : {},
        ...r7Routing && resolvedArrow !== void 0 && resolvedArrow !== "arrow" ? { arrowhead: resolvedArrow } : {},
        ...r7Routing && resolvedEmphasis === "emphasis" ? { emphasis: resolvedEmphasis } : {}
      });
    }
    return measureSceneLinkLegend({
      edges: legendEdges,
      measureLines: measure2,
      ...options.legendTitle === void 0 ? {} : { title: options.legendTitle },
      ...options.legendLabels === void 0 ? {} : { labels: options.legendLabels },
      ...metrics.edgeLabelSize === void 0 ? {} : { fontSize: metrics.edgeLabelSize }
    });
  })();
  const resolvedLegendCell = composition !== void 0 && effectiveLegendAnchor === "free-cell" ? planCtx?.mode === "state" ? planCtx.plan?.legendCell : planCtx?.legendCellOverride ?? findFirstEmptyRootCell(composition.grids.root, rootOrder) : void 0;
  if (planCtx?.mode === "nominal-plan" && planCtx.capture !== void 0 && resolvedLegendCell !== void 0) {
    planCtx.capture.legendCell = resolvedLegendCell;
  }
  const rootFreeCellItem = effectiveLegendAnchor === "free-cell" && resolvedLegendCell !== void 0 && stateMeasuredLegend !== void 0 ? {
    bandId: resolvedLegendCell.bandId,
    colId: resolvedLegendCell.colId,
    width: stateMeasuredLegend.width,
    height: stateMeasuredLegend.height
  } : void 0;
  const nominalPlan = planCtx?.mode === "state" ? planCtx.plan : void 0;
  const subtreeMemo = planCtx?.mode === "state" ? planCtx.memo : void 0;
  const innerWidenMap = nominalPlan === void 0 ? void 0 : new Map(Object.entries(nominalPlan.innerWiden));
  const sigmaColsMap = planCtx?.sigmaColsOverride !== void 0 ? new Map(Object.entries(planCtx.sigmaColsOverride)) : nominalPlan !== void 0 && Object.keys(nominalPlan.sigmaCols).length > 0 ? new Map(Object.entries(nominalPlan.sigmaCols)) : void 0;
  const sigmaBandsMap = planCtx?.sigmaBandsOverride !== void 0 ? new Map(Object.entries(planCtx.sigmaBandsOverride)) : nominalPlan !== void 0 && Object.keys(nominalPlan.sigmaBands).length > 0 ? new Map(Object.entries(nominalPlan.sigmaBands)) : void 0;
  const runPass = (plan, orientationOverrides) => {
    const warnings = [];
    const overflows = [];
    const warnOverflow = (overflow, zone) => {
      overflows.push(overflow);
      warnings.push({
        code: zone ? "zone-overflow" : "card-overflow",
        refs: [overflow.occurrence, overflow.slot],
        message: `overflow in ${overflow.slot}: needs ${overflow.neededHeight} over ${overflow.allocatedHeight}; every character is kept`,
        details: {
          occurrence: overflow.occurrence,
          slot: overflow.slot,
          neededHeight: overflow.neededHeight,
          allocatedHeight: overflow.allocatedHeight,
          lines: overflow.lines,
          allocatedLines: overflow.allocatedLines
        }
      });
    };
    const outerWidths = /* @__PURE__ */ new Map();
    const packedSizes = /* @__PURE__ */ new Map();
    const packedRuns = /* @__PURE__ */ new Map();
    const levelRuns = /* @__PURE__ */ new Map();
    const composedGrids = /* @__PURE__ */ new Map();
    const composedStacks = /* @__PURE__ */ new Map();
    const composedUnplaced = /* @__PURE__ */ new Map();
    const orientationRecord = /* @__PURE__ */ new Map();
    const chosen = /* @__PURE__ */ new Map();
    const capturedAutoPack = /* @__PURE__ */ new Map();
    const memoStoreQueue = /* @__PURE__ */ new Map();
    const headers = /* @__PURE__ */ new Map();
    const headerInputs = /* @__PURE__ */ new Map();
    const headerWidths = /* @__PURE__ */ new Map();
    const widenForScope = (scopeKey) => {
      if (nominalPlan !== void 0) {
        return scopeKey === ROOT_LEVEL_KEY ? plan?.widen : innerWidenMap;
      }
      return plan?.widen;
    };
    const visibleDescendantsOf = (rootEntity) => {
      const result2 = [];
      const visit = (parent) => {
        for (const child of orderedChildrenOf(parent)) {
          result2.push(child);
          if (kinds.get(child) === "container-expanded" || kinds.get(child) === "legend-expanded") {
            visit(child);
          }
        }
      };
      visit(rootEntity);
      return result2;
    };
    const descendantFoldKey = (rootEntity) => {
      const folded = [];
      for (const desc of visibleDescendantsOf(rootEntity)) {
        if (isCollapsed(desc))
          folded.push(desc);
      }
      folded.sort(byString4);
      return folded.join(",");
    };
    const memoKeyFor = (entity, inheritedKey) => `${nominalPlan.planDigest}|${entity}|${descendantFoldKey(entity)}|${inheritedKey ?? ""}`;
    const restoreMemoEntry = (entry) => {
      for (const snap of entry.descendants) {
        outerWidths.set(snap.entity, snap.outerWidth);
        packedSizes.set(snap.entity, { width: snap.packedSize.width, height: snap.packedSize.height });
        if (snap.header !== void 0)
          headers.set(snap.entity, snap.header);
        if (snap.headerInput !== void 0)
          headerInputs.set(snap.entity, snap.headerInput);
        if (snap.headerWidth !== void 0)
          headerWidths.set(snap.entity, snap.headerWidth);
        if (snap.composedGrid !== void 0)
          composedGrids.set(snap.runKey, snap.composedGrid);
        if (snap.composedStack !== void 0)
          composedStacks.set(snap.runKey, snap.composedStack);
        if (snap.composedUnplaced !== void 0)
          composedUnplaced.set(snap.runKey, snap.composedUnplaced);
        if (snap.packedRun !== void 0)
          packedRuns.set(snap.runKey, snap.packedRun);
        if (snap.levelRun !== void 0)
          levelRuns.set(snap.entity, snap.levelRun);
        if (snap.chosen !== void 0)
          chosen.set(snap.runKey, snap.chosen);
        if (snap.orientation !== void 0)
          orientationRecord.set(snap.runKey, snap.orientation);
      }
    };
    const snapshotSubtree = (rootEntity) => {
      const nodes = [rootEntity, ...visibleDescendantsOf(rootEntity)];
      const descendants = nodes.map((entity) => {
        const runKey = levelKeyOf(entity);
        const header = headers.get(entity);
        const headerInput = headerInputs.get(entity);
        const headerWidth = headerWidths.get(entity);
        const composedGrid = composedGrids.get(runKey);
        const composedStack = composedStacks.get(runKey);
        const unplacedList = composedUnplaced.get(runKey);
        const packedRun = packedRuns.get(runKey);
        const levelRun = levelRuns.get(entity);
        const chosenRun = chosen.get(runKey);
        const orient = orientationRecord.get(runKey);
        const packedSize = packedSizes.get(entity) ?? { width: 0, height: 0 };
        return {
          entity,
          runKey,
          outerWidth: outerWidths.get(entity) ?? packedSize.width,
          packedSize: { width: packedSize.width, height: packedSize.height },
          ...header === void 0 ? {} : { header },
          ...headerInput === void 0 ? {} : { headerInput },
          ...headerWidth === void 0 ? {} : { headerWidth },
          ...composedGrid === void 0 ? {} : { composedGrid },
          ...composedStack === void 0 ? {} : { composedStack },
          ...unplacedList === void 0 ? {} : { composedUnplaced: unplacedList },
          ...packedRun === void 0 ? {} : { packedRun },
          ...levelRun === void 0 ? {} : { levelRun },
          ...chosenRun === void 0 ? {} : { chosen: chosenRun },
          ...orient === void 0 ? {} : { orientation: orient }
        };
      });
      const rootSize = packedSizes.get(rootEntity);
      return {
        naturalSize: { width: rootSize.width, height: rootSize.height },
        descendants
      };
    };
    const headerAt = (id, inner) => {
      const known = headers.get(id);
      if (known !== void 0 && headerWidths.get(id) === inner)
        return known;
      const kind = kinds.get(id);
      const input = {
        entity: id,
        occurrence: representativeOf2(id),
        effectiveType: `${document.entities[id]?.profile ?? ""}:${document.entities[id]?.type ?? ""}/${formOf(presentation, representativeOf2(id)) ?? graph.nodes.get(id).kind}`,
        folded: kind === "container-collapsed" || kind === "legend-collapsed",
        toggle: kind !== "leaf",
        slots: slotTexts(document, presentation, representativeOf2(id), id),
        availableWidth: inner,
        allocatedLines: { ...DEFAULT_ALLOCATED_LINES }
      };
      const entry = presentation.entities[representativeOf2(id)];
      const header = entry === void 0 ? measureHeader(input, measure2) : sceneBoxAt(representativeOf2(id), inner + 2 * CONTENT_INSET, input.folded).header;
      headers.set(id, header);
      headerInputs.set(id, input);
      headerWidths.set(id, inner);
      return header;
    };
    const headerHeightOf = (id, outer) => (headers.get(id) ?? headerAt(id, innerWidthOf(outer))).height;
    const sizeRun = (run, chromeWidth, chromeHeight) => {
      const boxes = run.items.map((item) => "entity" in item ? sizeBox(item.entity) : sizeRun(item.run, 0, 0));
      if (run.stretch) {
        let widest = 0;
        run.items.forEach((item, slot) => {
          if ("entity" in item && isStretchedBox(item.entity))
            widest = Math.max(widest, boxes[slot].width);
        });
        run.items.forEach((item, slot) => {
          if (!("entity" in item) || !isStretchedBox(item.entity))
            return;
          boxes[slot] = { width: widest, height: boxes[slot].height };
          outerWidths.set(item.entity, widest);
          packedSizes.set(item.entity, boxes[slot]);
        });
      }
      const zone = runHasZone(run);
      const hasSiblingZones = zoneRule && run.items.filter(itemHasZone).length > 1;
      const baseX = hasSiblingZones ? zoneGutter : zone ? rowGaps.zoneX : rowGaps.cardX;
      const baseY = hasSiblingZones ? zoneGutter : zone ? rowGaps.zoneY : rowGaps.cardY;
      const packOptions = {
        targetAspect: planCtx?.mode === "nominal-plan" && planCtx.tauOverride !== void 0 ? planCtx.tauOverride : rowPack.targetAspect,
        gapX: baseX,
        gapY: baseY,
        chromeWidth,
        chromeHeight,
        tallBias: rowPack.tallBias,
        emptyPenaltyWeight: rowPack.emptyPenaltyWeight
      };
      const plannedLevel = nominalPlan?.autoPackLevels[run.key];
      const frozen2 = plan?.frozen.get(run.key);
      let orientation;
      let shelves;
      const forcedOrientation = run.mode === "auto" ? orientationOverrides?.get(run.key) : void 0;
      if (plannedLevel !== void 0) {
        const indexByEntity = /* @__PURE__ */ new Map();
        run.items.forEach((item, idx) => {
          if ("entity" in item)
            indexByEntity.set(item.entity, idx);
        });
        const placedSlots = /* @__PURE__ */ new Set();
        const mapped = [];
        for (const plannedShelf of plannedLevel.shelves) {
          const indices = [];
          for (const entity of plannedShelf) {
            const idx = indexByEntity.get(entity);
            if (idx !== void 0) {
              indices.push(idx);
              placedSlots.add(idx);
            }
          }
          if (indices.length > 0)
            mapped.push(indices);
        }
        const remaining = [];
        run.items.forEach((_, idx) => {
          if (!placedSlots.has(idx))
            remaining.push(idx);
        });
        if (remaining.length > 0)
          mapped.push(remaining);
        orientation = plannedLevel.orientation;
        shelves = mapped;
      } else if (forcedOrientation !== void 0) {
        orientation = forcedOrientation;
        shelves = (forcedOrientation === "rows" ? packRows : packColumns)(boxes, packOptions).rows;
      } else if (frozen2 !== void 0 && frozen2.shelves.reduce((count, shelf) => count + shelf.length, 0) === boxes.length) {
        orientation = frozen2.orientation;
        shelves = frozen2.shelves;
      } else if (run.mode === "auto") {
        const previousForChoice = planCtx?.mode === "nominal-plan" ? void 0 : options.previousOrientation?.[run.key];
        const choice = chooseOrientation(boxes, packOptions, rowPack.orientationHysteresis, previousForChoice);
        orientation = choice.orientation;
        shelves = choice.result.rows;
      } else {
        orientation = run.mode;
        shelves = (run.mode === "rows" ? packRows : packColumns)(boxes, packOptions).rows;
      }
      if (plannedLevel === void 0 && run.mode === "auto" && orientation === "columns" && shelves.every((shelf) => shelf.length === 1)) {
        orientation = "rows";
        shelves = [shelves.flat()];
      }
      chosen.set(run.key, { orientation, shelves });
      if (planCtx?.mode === "nominal-plan" && plan === void 0 && run.key !== ROOT_LEVEL_KEY) {
        const entityShelves = shelves.map((shelf) => shelf.map((slot) => {
          const item = run.items[slot];
          return item !== void 0 && "entity" in item ? item.entity : void 0;
        }).filter((e) => e !== void 0)).filter((shelf) => shelf.length > 0);
        capturedAutoPack.set(run.key, { orientation, shelves: entityShelves });
      }
      if (run.mode === "auto" && boxes.length > 0)
        orientationRecord.set(run.key, orientation);
      const rows = orientation === "rows";
      const alongBase = rows ? baseX : baseY;
      const acrossBase = rows ? baseY : baseX;
      const cardAlongBase = rows ? rowGaps.cardX : rowGaps.cardY;
      const cardAcrossBase = rows ? rowGaps.cardY : rowGaps.cardX;
      const zoneAlongBase = rows ? rowGaps.zoneX : rowGaps.zoneY;
      const zoneAcrossBase = rows ? rowGaps.zoneY : rowGaps.zoneX;
      const activeWiden = widenForScope(run.key);
      const gapAfterOf = (slot) => {
        const item = run.items[slot];
        return "run" in item ? item.gapAfter : void 0;
      };
      const seated = seatShelves(boxes, shelves, orientation, (shelf, slot) => {
        const leftSlot = shelves[shelf][slot];
        const rightSlot = shelves[shelf][slot + 1];
        if (zoneRule) {
          const leftZone = itemHasZone(run.items[leftSlot]);
          const rightZone = itemHasZone(run.items[rightSlot]);
          if (leftZone && rightZone)
            return zoneGutter;
          return Math.max(gapAfterOf(leftSlot) ?? (leftZone || rightZone ? zoneAlongBase : cardAlongBase), activeWiden?.get(`${run.key}|along|${String(slot)}`) ?? 0, activeWiden?.get(`${run.key}|along|${String(slot)}|${String(shelf)}`) ?? 0);
        }
        return Math.max(gapAfterOf(leftSlot) ?? alongBase, activeWiden?.get(`${run.key}|along|${String(slot)}`) ?? 0, activeWiden?.get(`${run.key}|along|${String(slot)}|${String(shelf)}`) ?? 0);
      }, (shelf) => {
        const last = shelves[shelf][shelves[shelf].length - 1];
        if (zoneRule) {
          const nextShelf = shelves[shelf + 1];
          const currentZone = shelfHasZone(run, shelves[shelf]);
          const nextZone = shelfHasZone(run, nextShelf);
          if (currentZone && nextZone)
            return zoneGutter;
          const base = currentZone || nextZone ? zoneAcrossBase : cardAcrossBase;
          return Math.max(gapAfterOf(last) ?? base, activeWiden?.get(`${run.key}|across|${String(shelf)}`) ?? 0);
        }
        return Math.max(gapAfterOf(last) ?? acrossBase, activeWiden?.get(`${run.key}|across|${String(shelf)}`) ?? 0);
      });
      packedRuns.set(run.key, { run, rows, shelves, boxes, positions: seated.positions, alongBase, acrossBase });
      return { width: seated.width, height: seated.height };
    };
    const legendKeyCardWidth = (id) => {
      const parent = graph.nodes.get(id)?.parent;
      return parent !== void 0 ? cardWidthOf(representativeOf2(parent)) : cardWidthOf(representativeOf2(id));
    };
    const entityIsContainer = (entity) => kinds.get(entity) !== "leaf";
    const headerFloorOf = (entity) => {
      const zg = anatomyZoneGeometry(occurrenceAnatomy(representativeOf2(entity)));
      const icon = presentation.entities[representativeOf2(entity)]?.icon !== "none";
      const reserve = zg.headerTextInset - (icon ? 0 : zg.iconSize + zg.iconTextGap);
      return Math.max(zg.collapsedWidth, unwrappedHeaderWidth(entity) + reserve);
    };
    const isExpandedInheritingGrid = (entity) => isStretchedBox(entity) && composition?.grids[entity]?.stage_columns === "inherit";
    const solveStagedGridWithInherit = (gridScope, gridRunKey, hostGrid, visibleList, freeCellItem) => {
      const hostWiden = widenForScope(gridRunKey);
      const isRootGrid = gridScope === "root";
      if (!Array.isArray(hostGrid.stage_columns)) {
        return layoutGridScope({
          scope: gridScope,
          runKey: gridRunKey,
          grid: hostGrid,
          visibleChildren: visibleList,
          sizeOf: sizeBox,
          isContainer: entityIsContainer,
          isExpandedContainer: isStretchedBox,
          rowGaps,
          zoneGutter,
          widen: hostWiden,
          ...isRootGrid && sigmaColsMap !== void 0 ? { sigmaCols: sigmaColsMap } : {},
          ...isRootGrid && sigmaBandsMap !== void 0 ? { sigmaBands: sigmaBandsMap } : {},
          ...freeCellItem === void 0 ? {} : { freeCellItem }
        });
      }
      const hostStageCols = hostGrid.stage_columns;
      const inheritedNodeMeta = /* @__PURE__ */ new Map();
      const inheritedContributions = [];
      let contribOrder = 0;
      const collectInheritor = (containerId, firstDecl, lastDecl, containerSlotInset) => {
        const childGrid = composition.grids[containerId];
        const children = orderedChildrenOf(containerId);
        const childVisible = new Set(children);
        const childInheritors = [];
        const meta = { grid: childGrid, firstDecl, lastDecl, containerSlotInset, childInheritors };
        inheritedNodeMeta.set(containerId, meta);
        inheritedContributions.push({
          colStartDecl: firstDecl,
          colEndDecl: lastDecl,
          neededWidth: headerFloorOf(containerId) + 2 * containerSlotInset,
          declOrder: contribOrder++
        });
        const declared = /* @__PURE__ */ new Set();
        for (const band of childGrid.transverse_bands) {
          for (const item of band.items) {
            declared.add(item);
            if (!childVisible.has(item))
              continue;
            const cell = childGrid.cells?.[item];
            if (cell?.column === void 0)
              continue;
            const cFirst = hostStageCols.indexOf(cell.column);
            const cLast = cell.to_column === void 0 ? cFirst : hostStageCols.indexOf(cell.to_column);
            if (cFirst < firstDecl || cLast > lastDecl || cLast < cFirst)
              continue;
            const touchesEdge = cFirst === firstDecl || cLast === lastDecl;
            const slotInset = touchesEdge ? containerSlotInset + contentInset : 0;
            if (isExpandedInheritingGrid(item)) {
              childInheritors.push(item);
              collectInheritor(item, cFirst, cLast, slotInset);
            } else {
              const sz = sizeBox(item);
              inheritedContributions.push({
                colStartDecl: cFirst,
                colEndDecl: cLast,
                neededWidth: sz.width + 2 * slotInset,
                declOrder: contribOrder++
              });
            }
          }
        }
        const unplacedInner = children.filter((child) => !declared.has(child));
        if (unplacedInner.length > 0) {
          let trailingW = 0;
          unplacedInner.forEach((child, idx) => {
            const sz = sizeBox(child);
            trailingW += sz.width;
            if (idx + 1 < unplacedInner.length) {
              const z = entityIsContainer(child) || entityIsContainer(unplacedInner[idx + 1]);
              trailingW += z ? zoneGutter : rowGaps.cardX;
            }
          });
          inheritedContributions.push({
            colStartDecl: firstDecl,
            colEndDecl: lastDecl,
            neededWidth: trailingW + 2 * contentInset + 2 * containerSlotInset,
            declOrder: contribOrder++
          });
        }
      };
      const hostVisible = new Set(visibleList);
      const topInheritors = [];
      for (const band of hostGrid.transverse_bands) {
        for (const item of band.items) {
          if (!hostVisible.has(item) || !isExpandedInheritingGrid(item))
            continue;
          const cell = hostGrid.cells?.[item];
          if (cell?.column === void 0)
            continue;
          const cFirst = hostStageCols.indexOf(cell.column);
          const cLast = cell.to_column === void 0 ? cFirst : hostStageCols.indexOf(cell.to_column);
          if (cFirst < 0 || cLast < cFirst)
            continue;
          topInheritors.push(item);
          collectInheritor(item, cFirst, cLast, 0);
        }
      }
      const sizeForHost = (entity) => {
        if (inheritedNodeMeta.has(entity)) {
          return { width: headerFloorOf(entity), height: 0 };
        }
        return sizeBox(entity);
      };
      return layoutGridScope({
        scope: gridScope,
        runKey: gridRunKey,
        grid: hostGrid,
        visibleChildren: visibleList,
        sizeOf: sizeForHost,
        isContainer: entityIsContainer,
        isExpandedContainer: isStretchedBox,
        rowGaps,
        zoneGutter,
        widen: hostWiden,
        ...isRootGrid && sigmaColsMap !== void 0 ? { sigmaCols: sigmaColsMap } : {},
        ...isRootGrid && sigmaBandsMap !== void 0 ? { sigmaBands: sigmaBandsMap } : {},
        ...freeCellItem === void 0 ? {} : { freeCellItem },
        inheritedContributions,
        onStageColumnsResolved: topInheritors.length === 0 ? void 0 : (resolvedCols) => {
          const updatedSizes = /* @__PURE__ */ new Map();
          const realizeInheritor = (containerId) => {
            const meta = inheritedNodeMeta.get(containerId);
            const firstActive = resolvedCols.declColToActive.get(meta.firstDecl);
            const lastActive = resolvedCols.declColToActive.get(meta.lastDecl);
            const inheritedSpanKey = `${resolvedCols.colIds.slice(firstActive, lastActive + 1).join(",")};${resolvedCols.colWidths.slice(firstActive, lastActive + 1).join(",")};${resolvedCols.colGaps.slice(firstActive, lastActive).join(",")};${String(meta.containerSlotInset)}`;
            if (subtreeMemo !== void 0 && nominalPlan !== void 0) {
              const key = memoKeyFor(containerId, inheritedSpanKey);
              const hit = subtreeMemo.get(key);
              if (hit !== void 0) {
                restoreMemoEntry(hit);
                updatedSizes.set(containerId, hit.naturalSize);
                return hit.naturalSize;
              }
              memoStoreQueue.set(containerId, key);
            }
            for (const child of meta.childInheritors)
              realizeInheritor(child);
            const containerRunKey = levelKeyOf(containerId);
            const gridLayout = layoutInheritedGridScope({
              scope: containerId,
              runKey: containerRunKey,
              grid: meta.grid,
              visibleChildren: orderedChildrenOf(containerId),
              inherited: {
                colIds: resolvedCols.colIds,
                colStarts: resolvedCols.colStarts,
                colWidths: resolvedCols.colWidths,
                colGaps: resolvedCols.colGaps,
                firstColIdx: firstActive,
                lastColIdx: lastActive,
                containerSlotInset: meta.containerSlotInset,
                contentInset
              },
              sizeOf: (child) => packedSizes.get(child) ?? sizeBox(child),
              isContainer: entityIsContainer,
              isExpandedContainer: isStretchedBox,
              rowGaps,
              zoneGutter,
              widen: widenForScope(containerRunKey)
            });
            composedGrids.set(containerRunKey, gridLayout);
            if (gridLayout.unplaced.length > 0)
              composedUnplaced.set(containerRunKey, gridLayout.unplaced);
            const spanWidth = resolvedCols.colStarts[lastActive] + resolvedCols.colWidths[lastActive] - resolvedCols.colStarts[firstActive] - 2 * meta.containerSlotInset;
            const zg = anatomyZoneGeometry(occurrenceAnatomy(representativeOf2(containerId)));
            const outer = Math.max(headerFloorOf(containerId), spanWidth);
            const hdrH = headerHeightOf(containerId, outer);
            outerWidths.set(containerId, outer);
            const size = {
              width: outer,
              height: zg.headerInset + hdrH + contentInset + gridLayout.height + contentInset + sceneBoxAt(representativeOf2(containerId), outer, false).footerReserve
            };
            packedSizes.set(containerId, size);
            updatedSizes.set(containerId, size);
            return size;
          };
          for (const top of topInheritors)
            realizeInheritor(top);
          return updatedSizes;
        }
      });
    };
    const sizeBox = (id) => {
      const kind = kinds.get(id);
      if (kind === "leaf" || kind === "container-collapsed" || kind === "legend-collapsed") {
        const entry = presentation.entities[representativeOf2(id)];
        const measured = entry === void 0 ? { width: FIXED_CARD_WIDTH, height: FIXED_CARD_HEIGHT } : sceneBoxAt(representativeOf2(id), cardWidthOf(representativeOf2(id)), kind !== "leaf");
        outerWidths.set(id, measured.width);
        const size2 = { width: measured.width, height: measured.height };
        packedSizes.set(id, size2);
        return size2;
      }
      if (kind === "legend-key")
        return { width: innerWidthOf(legendKeyCardWidth(id)), height: LEGEND_KEY_HEIGHT };
      if (subtreeMemo !== void 0 && nominalPlan !== void 0 && kind === "container-expanded" && composition?.grids[id]?.stage_columns !== "inherit") {
        const key = memoKeyFor(id);
        const hit = subtreeMemo.get(key);
        if (hit !== void 0) {
          restoreMemoEntry(hit);
          return hit.naturalSize;
        }
        memoStoreQueue.set(id, key);
      }
      const zoneGeo = anatomyZoneGeometry(occurrenceAnatomy(representativeOf2(id)));
      const hasIcon = presentation.entities[representativeOf2(id)]?.icon !== "none";
      const headerReserve = zoneGeo.headerTextInset - (hasIcon ? 0 : zoneGeo.iconSize + zoneGeo.iconTextGap);
      const headerDriven = unwrappedHeaderWidth(id) + headerReserve;
      const floor = Math.max(zoneGeo.collapsedWidth, headerDriven);
      const ordered = orderedChildrenOf(id);
      const headerHeight = headerHeightOf(id, floor);
      if (kind === "legend-expanded") {
        outerWidths.set(id, floor);
        const keys = ordered.length * LEGEND_KEY_HEIGHT + Math.max(0, ordered.length - 1) * gaps.cardGapY;
        const size2 = { width: floor, height: zoneGeo.headerInset + headerHeight + contentInset + keys + contentInset };
        packedSizes.set(id, size2);
        return size2;
      }
      const composedGrid = composition?.grids[id];
      const composedStack = composition?.stacks[id];
      const runKey = levelKeyOf(id);
      if (composedStack !== void 0) {
        const stackLayout = layoutStackScope({
          scope: id,
          runKey,
          stack: composedStack,
          visibleChildren: ordered,
          sizeOf: sizeBox,
          isContainer: entityIsContainer,
          isExpandedContainer: isStretchedBox,
          rowGaps,
          zoneGutter,
          widen: widenForScope(runKey)
        });
        composedStacks.set(runKey, stackLayout);
        const outer2 = Math.max(floor, stackLayout.width + (ordered.length > 0 ? 2 * contentInset : 0));
        outerWidths.set(id, outer2);
        const size2 = {
          width: outer2,
          height: zoneGeo.headerInset + headerHeight + contentInset + stackLayout.height + contentInset + sceneBoxAt(representativeOf2(id), outer2, false).footerReserve
        };
        packedSizes.set(id, size2);
        return size2;
      }
      if (composedGrid !== void 0 && composedGrid.stage_columns !== "inherit") {
        const gridLayout = solveStagedGridWithInherit(id, runKey, composedGrid, ordered);
        composedGrids.set(runKey, gridLayout);
        if (gridLayout.unplaced.length > 0)
          composedUnplaced.set(runKey, gridLayout.unplaced);
        const outer2 = Math.max(floor, gridLayout.width + (ordered.length > 0 ? 2 * contentInset : 0));
        outerWidths.set(id, outer2);
        const size2 = {
          width: outer2,
          height: zoneGeo.headerInset + headerHeight + contentInset + gridLayout.height + contentInset + sceneBoxAt(representativeOf2(id), outer2, false).footerReserve
        };
        packedSizes.set(id, size2);
        return size2;
      }
      const run = buildLevelRun(id, ordered);
      levelRuns.set(id, run);
      const level = sizeRun(run, 2 * contentInset, zoneGeo.headerInset + headerHeight + contentInset + contentInset);
      const packed = packedRuns.get(run.key);
      let uExtra = 0;
      if (packed !== void 0) {
        const zone = runHasZone(run);
        const baseGap = packed.rows ? zone ? rowGaps.zoneX : rowGaps.cardX : zone ? rowGaps.zoneY : rowGaps.cardY;
        for (const edge of drawnEdges) {
          if (placementParentOf(edge.source.entity) !== id || placementParentOf(edge.target.entity) !== id)
            continue;
          const labelSize = labelSizes.get(edge.occurrence);
          if (labelSize === void 0)
            continue;
          const si = ordered.indexOf(edge.source.entity);
          const ti = ordered.indexOf(edge.target.entity);
          if (si < 0 || ti < 0)
            continue;
          const sameShelf = packed.shelves.some((shelf) => shelf.includes(si) && shelf.includes(ti));
          if (!sameShelf)
            continue;
          const need = (packed.rows ? labelSize.width : labelSize.height) + 2 * metrics.labelMargin;
          if (need > baseGap)
            uExtra += labelSize.height + 2 * metrics.labelMargin;
        }
      }
      const levelHeight = level.height + uExtra;
      const outer = Math.max(floor, level.width + (ordered.length > 0 ? 2 * contentInset : 0));
      outerWidths.set(id, outer);
      const size = {
        width: outer,
        height: zoneGeo.headerInset + headerHeight + contentInset + levelHeight + contentInset + sceneBoxAt(representativeOf2(id), outer, false).footerReserve
      };
      packedSizes.set(id, size);
      return size;
    };
    let rootRun = { key: ROOT_LEVEL_KEY, mode: "auto", items: [], stretch: false };
    const sizeAll = () => {
      outerWidths.clear();
      packedSizes.clear();
      packedRuns.clear();
      levelRuns.clear();
      composedGrids.clear();
      composedStacks.clear();
      composedUnplaced.clear();
      orientationRecord.clear();
      chosen.clear();
      capturedAutoPack.clear();
      memoStoreQueue.clear();
      if (composition?.grids.root !== void 0) {
        const rootGrid = solveStagedGridWithInherit("root", ROOT_LEVEL_KEY, composition.grids.root, rootOrder, rootFreeCellItem);
        composedGrids.set(ROOT_LEVEL_KEY, rootGrid);
        if (rootGrid.unplaced.length > 0)
          composedUnplaced.set(ROOT_LEVEL_KEY, rootGrid.unplaced);
        rootRun = { key: ROOT_LEVEL_KEY, mode: "auto", items: [], stretch: false };
        return;
      }
      rootRun = buildLevelRun(void 0, rootOrder);
      sizeRun(rootRun, 0, 0);
    };
    const headerIds = [...graph.nodes.keys()].filter((id) => visible(id) && kinds.get(id) !== "legend-key").sort(byString4);
    const measureHeaders = () => {
      for (const id of headerIds) {
        const kind = kinds.get(id);
        const folded = kind === "container-collapsed" || kind === "legend-collapsed";
        headerAt(id, folded ? innerWidthOf(packedSizes.get(id)?.width ?? cardWidthOf(representativeOf2(id))) : innerWidthOf(outerWidths.get(id) ?? cardWidthOf(representativeOf2(id))));
      }
    };
    sizeAll();
    for (let round = 0; round < HEADER_ROUNDS; round += 1) {
      measureHeaders();
      const before = new Map(outerWidths);
      sizeAll();
      if (before.size === outerWidths.size && [...outerWidths].every(([id, width2]) => before.get(id) === width2))
        break;
    }
    if (planCtx?.sizingOnly === true && planCtx.capture !== void 0) {
      const rootGridLayout2 = composedGrids.get(ROOT_LEVEL_KEY);
      const legendSize = stateMeasuredLegend === void 0 ? void 0 : { width: stateMeasuredLegend.width, height: stateMeasuredLegend.height };
      planCtx.capture.sizingReport = {
        rootWidth: rootGridLayout2?.width ?? 0,
        rootHeight: rootGridLayout2?.height ?? 0,
        xTrackIds: (rootGridLayout2?.columns ?? []).filter((c) => c.kind === "stage").map((c) => c.id),
        yTrackIds: (rootGridLayout2?.bands ?? []).filter((b) => b.kind === "band").map((b) => b.id),
        capX: rowGaps.maxX,
        capY: rowGaps.maxY,
        ...legendSize === void 0 ? {} : { legendSize },
        effectiveLegendAnchor,
        legendInsideCell: rootGridLayout2?.freeCellRect !== void 0
      };
      return {
        result: {
          status: "laid-out",
          view: projected,
          fit: { direction: "top-to-bottom", width: 0, height: 0, zoom: 1, pans: false, phone: false },
          warnings: []
        },
        chosen,
        requested: /* @__PURE__ */ new Map(),
        unused: [],
        unplaced: 0
      };
    }
    if (planCtx?.mode === "nominal-plan" && plan === void 0 && planCtx.capture !== void 0) {
      for (const [runKey, level] of capturedAutoPack) {
        planCtx.capture.autoPackLevels[runKey] = level;
      }
    }
    if (subtreeMemo !== void 0 && nominalPlan !== void 0 && memoStoreQueue.size > 0) {
      for (const [entityId, memoKey] of memoStoreQueue) {
        if (packedSizes.has(entityId)) {
          subtreeMemo.set(memoKey, snapshotSubtree(entityId));
        }
      }
    }
    for (const id of headerIds) {
      const size = packedSizes.get(id);
      const occurrence = representativeOf2(id);
      if (presentation.entities[occurrence] !== void 0 && size !== void 0) {
        for (const diagnostic2 of sceneBoxAt(occurrence, size.width, isCollapsed(id)).diagnostics) {
          if (diagnostic2.reason !== "truncated" && diagnostic2.reason !== "fallback-v1")
            continue;
          const isFallback = diagnostic2.reason === "fallback-v1";
          warnings.push({
            code: kinds.get(id) === "leaf" ? "card-overflow" : "zone-overflow",
            severity: "info",
            refs: [occurrence, diagnostic2.slot],
            message: isFallback ? "compact anatomy overflow on " + diagnostic2.slot + ": fell back to v1 frozen box" : "truncated " + diagnostic2.slot + ": " + diagnostic2.hiddenLength + " hidden characters; full text in title/aria",
            details: {
              slot: diagnostic2.slot,
              reason: diagnostic2.reason,
              ...diagnostic2.hiddenLength === void 0 ? {} : { hiddenLength: diagnostic2.hiddenLength },
              neededHeight: diagnostic2.neededPx,
              allocatedHeight: diagnostic2.allocatedPx
            }
          });
        }
      } else
        for (const overflow of headerOverflows(headerInputs.get(id), headers.get(id), lineHeightOf)) {
          warnOverflow(overflow, kinds.get(id) !== "leaf");
        }
    }
    if (options.reportSurfaceSame === true) {
      for (const id of headerIds) {
        const kind = kinds.get(id);
        if (kind !== "container-expanded" && kind !== "legend-expanded")
          continue;
        const zoneOcc = representativeOf2(id);
        const zoneEntry = presentation.entities[zoneOcc];
        const zoneDepth = zoneEntry?.depth ?? graph.nodes.get(id)?.depth ?? 0;
        const surface = zoneDepthSurface(zoneDepth, zoneEntry?.depthParityStart);
        if (surface !== "surface1")
          continue;
        for (const childId of orderedChildrenOf(id)) {
          if (kinds.get(childId) !== "leaf")
            continue;
          const childOcc = representativeOf2(childId);
          const childEntry = presentation.entities[childOcc];
          if (childEntry?.categoryRef !== void 0)
            continue;
          warnings.push({
            code: "zone-surface-same",
            severity: "info",
            refs: [zoneOcc, childOcc],
            message: `white leaf card ${childOcc} sits on same-colour surface1 zone ${zoneOcc}`,
            details: { zone: zoneOcc, card: childOcc, surface }
          });
        }
      }
    }
    for (const [scopeKey, missing] of [...composedUnplaced].sort(([left], [right]) => byString4(left, right))) {
      warnings.push({
        severity: "info",
        code: "composition-unplaced",
        refs: missing.map((entity) => representativeOf2(entity)),
        message: `${String(missing.length)} visible item(s) omitted from grid ${scopeKey} were placed in a trailing band`,
        details: { scope: scopeKey, count: missing.length }
      });
    }
    const rects = /* @__PURE__ */ new Map();
    const titleBands = /* @__PURE__ */ new Map();
    const footerBands = /* @__PURE__ */ new Map();
    const legendInner = /* @__PURE__ */ new Map();
    const seatedBoxes = /* @__PURE__ */ new Map();
    const composedEmittedGutters = [];
    const composedGridReports = {};
    const seatComposedGrid = (gridLayout, originX, originY) => {
      for (const placement of gridLayout.placements) {
        const forced2 = placement.stretchX || placement.stretchY ? { width: placement.width, height: placement.height } : void 0;
        seatBox(placement.entity, originX + placement.relX, originY + placement.relY, forced2);
      }
      composedEmittedGutters.push(...gridLayout.emitGutters(originX, originY));
      composedGridReports[gridLayout.scope] = gridLayout.toReport(originX, originY);
    };
    const seatComposedStack = (stackLayout, originX, originY) => {
      for (const placement of stackLayout.placements) {
        const forced2 = placement.stretchX || placement.stretchY ? { width: placement.width, height: placement.height } : void 0;
        seatBox(placement.entity, originX + placement.relX, originY + placement.relY, forced2);
      }
      composedEmittedGutters.push(...stackLayout.emitGutters(originX, originY));
    };
    const seatRun = (run, originX, originY) => {
      const packed = packedRuns.get(run.key);
      const absolute = [];
      run.items.forEach((item, slot) => {
        const position = packed.positions[slot];
        const box = packed.boxes[slot];
        const x = originX + position.x;
        const y = originY + position.y;
        absolute.push({ x, y, width: box.width, height: box.height });
        if ("entity" in item)
          seatBox(item.entity, x, y);
        else
          seatRun(item.run, x, y);
      });
      seatedBoxes.set(run.key, absolute);
    };
    const seatBox = (id, x, y, forcedSize) => {
      const kind = kinds.get(id);
      if (kind === "leaf" || kind === "container-collapsed" || kind === "legend-collapsed") {
        rects.set(id, { x, y, ...packedSizes.get(id) });
        return;
      }
      if (kind === "legend-key") {
        rects.set(id, { x, y, width: innerWidthOf(legendKeyCardWidth(id)), height: LEGEND_KEY_HEIGHT });
        return;
      }
      const natural = packedSizes.get(id);
      const size = forcedSize === void 0 ? natural : { width: Math.max(natural.width, forcedSize.width), height: Math.max(natural.height, forcedSize.height) };
      const header = headers.get(id);
      const zoneGeo = anatomyZoneGeometry(occurrenceAnatomy(representativeOf2(id)));
      const inner = innerWidthOf(size.width);
      rects.set(id, { x, y, width: size.width, height: size.height });
      const ruleClearance2 = (zoneGeo.ruleHeight / 2 + 1) / LABEL_CLEARANCE_REFERENCE_SCALE;
      titleBands.set(id, { x, y, width: size.width, height: zoneGeo.headerInset + header.height });
      const footerReserve = sceneBoxAt(representativeOf2(id), size.width, false).footerReserve;
      if (footerReserve > 0)
        footerBands.set(id, {
          x,
          y: y + size.height - footerReserve - zoneGeo.borderWidth - ruleClearance2,
          width: size.width,
          height: footerReserve + zoneGeo.borderWidth + ruleClearance2
        });
      const contentX = x + contentInset;
      const contentY = y + zoneGeo.headerInset + header.height + contentInset;
      if (kind === "legend-expanded") {
        legendInner.set(id, inner);
        orderedChildrenOf(id).forEach((key, index) => {
          rects.set(key, {
            x: contentX,
            y: contentY + index * (LEGEND_KEY_HEIGHT + gaps.cardGapY),
            width: inner,
            height: LEGEND_KEY_HEIGHT
          });
        });
        return;
      }
      const runKey = levelKeyOf(id);
      const gridLayout = composedGrids.get(runKey);
      if (gridLayout !== void 0) {
        seatComposedGrid(gridLayout, contentX, contentY);
        return;
      }
      const stackLayout = composedStacks.get(runKey);
      if (stackLayout !== void 0) {
        seatComposedStack(stackLayout, contentX, contentY);
        return;
      }
      const run = levelRuns.get(id);
      if (run !== void 0)
        seatRun(run, contentX, contentY);
    };
    const rootGridLayout = composedGrids.get(ROOT_LEVEL_KEY);
    if (rootGridLayout !== void 0)
      seatComposedGrid(rootGridLayout, 0, 0);
    else
      seatRun(rootRun, 0, 0);
    const slots = [];
    const recordSlot = (occurrence, role3, layout, zone) => {
      slots.push({ occurrence, role: role3, layout });
      if (role3 === "legend-label" && layout.height > LEGEND_KEY_HEIGHT) {
        const allocatedLines = DEFAULT_ALLOCATED_LINES[role3];
        warnOverflow({
          occurrence,
          slot: role3,
          neededHeight: layout.height,
          allocatedHeight: LEGEND_KEY_HEIGHT,
          lines: layout.lines.length,
          allocatedLines
        }, zone);
        return;
      }
      if (layout.overflow && (role3 === "edge-label" || presentation.entities[occurrence] === void 0)) {
        const allocatedLines = DEFAULT_ALLOCATED_LINES[role3];
        warnOverflow({
          occurrence,
          slot: role3,
          neededHeight: layout.height,
          allocatedHeight: allocatedLines * lineHeightOf(role3),
          lines: layout.lines.length,
          allocatedLines
        }, zone);
      }
    };
    for (const id of [...graph.nodes.keys()].sort(byString4)) {
      if (!visible(id))
        continue;
      const kind = kinds.get(id);
      const occurrence = representativeOf2(id);
      const text3 = slotTexts(document, presentation, occurrence, id);
      if (kind === "legend-key") {
        const parent = graph.nodes.get(id)?.parent;
        const inner2 = parent !== void 0 && legendInner.has(parent) ? legendInner.get(parent) : innerWidthOf(legendKeyCardWidth(id));
        recordSlot(occurrence, "legend-label", measure2({
          text: text3.title ?? "",
          role: "legend-label",
          availableWidth: inner2 - SWATCH_ALLOCATION,
          allocatedLines: DEFAULT_ALLOCATED_LINES["legend-label"],
          folded: false
        }), false);
        continue;
      }
      const expanded = kind === "container-expanded" || kind === "legend-expanded";
      const inner = expanded ? innerWidthOf(outerWidths.get(id) ?? cardWidthOf(occurrence)) : innerWidthOf(cardWidthOf(occurrence));
      const rendered = sceneBoxAt(occurrence, rects.get(id).width, !expanded && kind !== "leaf");
      for (const role3 of ["body", "detail", "footer"]) {
        if (text3[role3] === void 0)
          continue;
        recordSlot(occurrence, role3, measure2({
          text: text3[role3],
          role: role3,
          availableWidth: role3 === "footer" ? rendered.footerWidth : rendered.bodyWidth,
          allocatedLines: DEFAULT_ALLOCATED_LINES[role3],
          folded: !expanded && kind !== "leaf"
        }), expanded);
      }
    }
    for (const edge of [...drawnEdges].sort((left, right) => byString4(left.occurrence, right.occurrence))) {
      const layout = edgeLayouts.get(edge.occurrence);
      if (layout !== void 0)
        recordSlot(edge.occurrence, "edge-label", layout, false);
    }
    const routeShapes = [
      ...[...rects].filter(([id]) => !isStretchedBox(id)).map(([, rect]) => rect),
      ...titleBands.values()
    ];
    const ruleClearance = (ZONE_GEOMETRY.ruleHeight / 2 + 1) / LABEL_CLEARANCE_REFERENCE_SCALE;
    const fixedShapes = [...routeShapes, ...[...titleBands.values()].map((band) => ({
      x: band.x,
      y: band.y + band.height,
      width: band.width,
      height: ZONE_GEOMETRY.ruleHeight / 2 + ruleClearance
    })), ...footerBands.values()];
    const zoneShapes = [...rects].filter(([id]) => isStretchedBox(id));
    const shapesByEdge = /* @__PURE__ */ new Map();
    const passableZonesByEdge = /* @__PURE__ */ new Map();
    for (const edge of drawnEdges) {
      const own = /* @__PURE__ */ new Set();
      for (const end of [edge.source.entity, edge.target.entity]) {
        for (let current = placementParentOf(end); current !== void 0; current = placementParentOf(current))
          own.add(current);
      }
      const edgeId = edge.occurrence;
      shapesByEdge.set(edgeId, [
        ...routeShapes,
        ...zoneShapes.filter(([id]) => !own.has(id)).map(([, rect]) => rect)
      ]);
      passableZonesByEdge.set(edgeId, zoneShapes.filter(([id]) => own.has(id)).map(([, rect]) => rect));
    }
    const shapesOf = (id) => shapesByEdge.get(id) ?? routeShapes;
    const passableZonesOf = (id) => passableZonesByEdge.get(id) ?? [];
    const innerOf = (container) => {
      const rect = rects.get(container);
      const band = titleBands.get(container);
      if (rect === void 0 || band === void 0)
        return void 0;
      const inset = routeSpacing > 0 ? Math.max(4, borderClearance) : 4;
      const top = band.y + band.height + inset;
      return {
        x: rect.x + inset,
        y: top,
        width: Math.max(0, rect.width - 2 * inset),
        height: Math.max(0, rect.y + rect.height - top - inset)
      };
    };
    const withinOf = /* @__PURE__ */ new Map();
    for (const edge of drawnEdges) {
      const shared = sharedContainerOf(edge.source.entity, edge.target.entity);
      const inner = shared === void 0 ? void 0 : innerOf(shared);
      if (inner !== void 0)
        withinOf.set(edge.occurrence, inner);
    }
    const probeMarginOf = (height) => Math.min(metrics.labelMargin, (Math.min(rowGaps.cardY, rowGaps.zoneY) - height) / 2);
    const drawingTop = Math.min(0, ...[...rects.values()].map((rect) => rect.y));
    const drawingBottom = Math.max(0, ...[...rects.values()].map((rect) => rect.y + rect.height));
    const sideOverrides = /* @__PURE__ */ new Map();
    const labelledPairs = /* @__PURE__ */ new Map();
    const usedUTracks = /* @__PURE__ */ new Map();
    for (const edge of [...drawnEdges].sort((left, right) => byString4(left.occurrence, right.occurrence))) {
      const id = edge.occurrence;
      const size = routeSizes.get(id);
      const source = edge.source.entity;
      const target = edge.target.entity;
      if (size === void 0 || source === target)
        continue;
      if (isAncestor(filteredGraph, source, target) || isAncestor(filteredGraph, target, source))
        continue;
      const a = rects.get(source);
      const b = rects.get(target);
      const bridge = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
      const sideBySide = a.y < b.y + b.height && b.y < a.y + a.height && bridge >= 0;
      const vBridge = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
      const stacked = !sideBySide && a.x < b.x + b.width && b.x < a.x + a.width && vBridge >= 0;
      if (!sideBySide && !stacked)
        continue;
      if (sideBySide) {
        const band = {
          x: Math.min(a.x + a.width, b.x + b.width),
          y: Math.max(a.y, b.y),
          width: bridge,
          height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        };
        if (bridge >= size.width + 2 * metrics.labelMargin && !shapesOf(id).some((shape) => rectsIntersect(shape, band)))
          continue;
      } else {
        const band = {
          x: Math.max(a.x, b.x),
          y: Math.min(a.y + a.height, b.y + b.height),
          width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
          height: vBridge
        };
        if (vBridge >= size.height + 2 * metrics.labelMargin && !shapesOf(id).some((shape) => rectsIntersect(shape, band)))
          continue;
      }
      const probe = metrics.labelMargin;
      const pairKey = [source, target].sort().join("|");
      const nth = labelledPairs.get(pairKey) ?? 0;
      labelledPairs.set(pairKey, nth + 1);
      const within = withinOf.get(id);
      const containerKey = placementParentOf(source) !== void 0 && placementParentOf(source) === placementParentOf(target) ? placementParentOf(source) : "root";
      const trackKey = `${containerKey}|${sideBySide ? Math.max(a.y + a.height, b.y + b.height) : Math.max(a.x + a.width, b.x + b.width)}`;
      const used = usedUTracks.get(trackKey) ?? 0;
      const depth = (sideBySide ? size.height : size.width) + 2 * probe;
      const pitch = Math.max(depth + 2 * metrics.labelMargin, routeSpacing > 0 ? routeSpacing : 0);
      const uEdgeClearance = routeSpacing > 0 ? borderClearance : 0;
      const laneFreeRow = (side, attempt) => {
        const base = side === "south" ? Math.max(a.y + a.height, b.y + b.height) + uEdgeClearance : Math.min(a.y, b.y) - depth - uEdgeClearance;
        const top = side === "south" ? base + attempt * pitch : base - attempt * pitch;
        const centres = [a.x + a.width / 2, b.x + b.width / 2];
        const lane = { x: Math.min(...centres), y: top, width: Math.abs(centres[0] - centres[1]), height: depth };
        if (within !== void 0 && (lane.x < within.x || lane.y < within.y || lane.x + lane.width > within.x + within.width || lane.y + lane.height > within.y + within.height)) {
          return false;
        }
        const laneCheck = uEdgeClearance > 0 ? { x: lane.x, y: lane.y - uEdgeClearance, width: lane.width, height: lane.height + 2 * uEdgeClearance } : lane;
        const legs = [a, b].map((rect) => side === "south" ? { x: rect.x + rect.width / 2 - 1, y: rect.y + rect.height, width: 2, height: top - (rect.y + rect.height) } : { x: rect.x + rect.width / 2 - 1, y: top + depth, width: 2, height: rect.y - (top + depth) });
        return ![laneCheck, ...legs.filter((leg) => leg.height > 0)].some((zone) => shapesOf(id).some((shape) => rectsIntersect(shape, zone)));
      };
      const laneFreeCol = (side, attempt) => {
        const base = side === "east" ? Math.max(a.x + a.width, b.x + b.width) + uEdgeClearance : Math.min(a.x, b.x) - depth - uEdgeClearance;
        const left = side === "east" ? base + attempt * pitch : base - attempt * pitch;
        const centres = [a.y + a.height / 2, b.y + b.height / 2];
        const lane = { x: left, y: Math.min(...centres), width: depth, height: Math.abs(centres[0] - centres[1]) };
        if (within !== void 0 && (lane.x < within.x || lane.y < within.y || lane.x + lane.width > within.x + within.width || lane.y + lane.height > within.y + within.height)) {
          return false;
        }
        const laneCheck = uEdgeClearance > 0 ? { x: lane.x - uEdgeClearance, y: lane.y, width: lane.width + 2 * uEdgeClearance, height: lane.height } : lane;
        const legs = [a, b].map((rect) => side === "east" ? { x: rect.x + rect.width, y: rect.y + rect.height / 2 - 1, width: left - (rect.x + rect.width), height: 2 } : { x: left + depth, y: rect.y + rect.height / 2 - 1, width: rect.x - (left + depth), height: 2 });
        return ![laneCheck, ...legs.filter((leg) => leg.width > 0)].some((zone) => shapesOf(id).some((shape) => rectsIntersect(shape, zone)));
      };
      const outside = within !== void 0 || !sideBySide ? void 0 : Math.min(a.y, b.y) <= drawingTop ? "north" : Math.max(a.y + a.height, b.y + b.height) >= drawingBottom ? "south" : void 0;
      let placed = false;
      if (sideBySide) {
        const preference = outside === void 0 ? nth % 2 === 0 ? ["south", "north"] : ["north", "south"] : nth % 2 === 0 ? [outside, outside === "south" ? "north" : "south"] : [outside === "south" ? "north" : "south", outside];
        for (const side of preference) {
          for (let attempt = used; attempt < used + 3 && !placed; attempt += 1) {
            if (laneFreeRow(side, attempt)) {
              sideOverrides.set(id, { source: side, target: side, turn: true });
              usedUTracks.set(trackKey, attempt + 1);
              placed = true;
            }
          }
          if (placed)
            break;
        }
      } else {
        for (const side of ["east", "west"]) {
          for (let attempt = used; attempt < used + 3 && !placed; attempt += 1) {
            if (laneFreeCol(side, attempt)) {
              sideOverrides.set(id, { source: side, target: side, turn: true });
              usedUTracks.set(trackKey, attempt + 1);
              placed = true;
            }
          }
          if (placed)
            break;
        }
      }
    }
    const isNorthBlockedByTitle = (entity) => {
      const parent = placementParentOf(entity);
      if (parent === void 0)
        return false;
      const band = titleBands.get(parent);
      const rect = rects.get(entity);
      if (band === void 0 || rect === void 0)
        return false;
      return rect.y - (band.y + band.height) < 2 * borderClearance - 1e-4;
    };
    const sideStaysInWithin = (entity, side, within) => {
      if (within === void 0)
        return true;
      const r = rects.get(entity);
      const need = borderClearance;
      if (side === "west")
        return r.x - need >= within.x - 1e-4;
      if (side === "east")
        return r.x + r.width + need <= within.x + within.width + 1e-4;
      if (side === "north")
        return r.y - need >= within.y - 1e-4;
      return r.y + r.height + need <= within.y + within.height + 1e-4;
    };
    if (routeSpacing > 0) {
      const isDescendantOrSame = (node, ancestor) => {
        for (let cur = node; cur !== void 0; cur = placementParentOf(cur)) {
          if (cur === ancestor)
            return true;
        }
        return false;
      };
      const outerWallsOf = (entity, parent, within) => {
        const r = rects.get(entity);
        const p = rects.get(parent);
        const footerH = footerBands.get(parent)?.height ?? 0;
        const walls = [];
        const inWithin = (side) => {
          if (within === void 0)
            return true;
          if (side === "west")
            return p.x - borderClearance >= within.x - 1e-4;
          if (side === "east")
            return p.x + p.width + borderClearance <= within.x + within.width + 1e-4;
          return p.y + p.height + borderClearance <= within.y + within.height + 1e-4;
        };
        if (r.x - p.x <= contentInset + 1 && inWithin("west"))
          walls.push("west");
        if (p.x + p.width - (r.x + r.width) <= contentInset + 1 && inWithin("east"))
          walls.push("east");
        if (p.y + p.height - footerH - (r.y + r.height) <= contentInset + 1 && inWithin("south"))
          walls.push("south");
        return walls;
      };
      const redirectSide = (selfId, otherId, chosen2, within) => {
        const self = rects.get(selfId);
        const other = rects.get(otherId);
        const selfCx = self.x + self.width / 2;
        const selfCy = self.y + self.height / 2;
        const otherCx = other.x + other.width / 2;
        const otherCy = other.y + other.height / 2;
        const parent = placementParentOf(selfId);
        if (parent !== void 0 && !isDescendantOrSame(otherId, parent)) {
          const outer = outerWallsOf(selfId, parent, within);
          if (outer.includes(chosen2))
            return chosen2;
          const facingOuter = outer.filter((side) => {
            if (side === "west")
              return otherCx < selfCx;
            if (side === "east")
              return otherCx > selfCx;
            return otherCy > selfCy;
          });
          if (facingOuter.length > 0) {
            const score = (side) => {
              if (side === "west")
                return -(selfCx - otherCx);
              if (side === "east")
                return -(otherCx - selfCx);
              return -(otherCy - selfCy);
            };
            return [...facingOuter].sort((a, b) => score(a) - score(b))[0];
          }
        }
        if (chosen2 !== "north" || !isNorthBlockedByTitle(selfId))
          return chosen2;
        const candidates = ["east", "west", "south"].filter((s) => sideStaysInWithin(selfId, s, within));
        if (candidates.length === 0)
          return chosen2;
        if (other.x >= self.x + self.width && candidates.includes("east"))
          return "east";
        if (self.x >= other.x + other.width && candidates.includes("west"))
          return "west";
        if (Math.abs(otherCx - selfCx) > 1e-4) {
          const pref = otherCx > selfCx ? "east" : "west";
          if (candidates.includes(pref))
            return pref;
        }
        if (parent !== void 0) {
          const parentRect = rects.get(parent);
          const distLeft = self.x - parentRect.x;
          const distRight = parentRect.x + parentRect.width - (self.x + self.width);
          const pref = distLeft <= distRight ? "west" : "east";
          if (candidates.includes(pref))
            return pref;
        }
        return candidates[0];
      };
      for (const edge of drawnEdges) {
        const id = edge.occurrence;
        if (sideOverrides.has(id))
          continue;
        const source = edge.source.entity;
        const target = edge.target.entity;
        if (source === target)
          continue;
        if (isAncestor(filteredGraph, source, target) || isAncestor(filteredGraph, target, source))
          continue;
        const within = withinOf.get(id);
        const sDefault = sideToward(rects.get(source), rects.get(target), "top-to-bottom");
        const tDefault = sideToward(rects.get(target), rects.get(source), "top-to-bottom");
        const sSide = redirectSide(source, target, sDefault, within);
        const tSide = redirectSide(target, source, tDefault, within);
        if (sSide !== sDefault || tSide !== tDefault) {
          sideOverrides.set(id, { source: sSide, target: tSide, turn: false });
        }
      }
    }
    const collectShelfGutters = () => {
      const out = [];
      for (const [key, packed] of [...packedRuns].sort(([left], [right]) => byString4(left, right))) {
        const boxes = seatedBoxes.get(key);
        if (boxes === void 0 || boxes.length < 2)
          continue;
        const rows = packed.rows;
        const zone = runHasZone(packed.run);
        const cardAlongBase = rows ? rowGaps.cardX : rowGaps.cardY;
        const cardAcrossBase = rows ? rowGaps.cardY : rowGaps.cardX;
        const zoneAlongBase = rows ? rowGaps.zoneX : rowGaps.zoneY;
        const zoneAcrossBase = rows ? rowGaps.zoneY : rowGaps.zoneX;
        const gapAfter = (slot) => {
          const item = packed.run.items[slot];
          return "run" in item ? item.gapAfter : void 0;
        };
        const alongOf = (rect) => rows ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
        const acrossOf = (rect) => rows ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
        const stripOf = (along, across) => rows ? { x: along[0], y: across[0], width: along[1] - along[0], height: across[1] - across[0] } : { x: across[0], y: along[0], width: across[1] - across[0], height: along[1] - along[0] };
        const extent = [
          Math.min(...boxes.map((rect) => alongOf(rect)[0])),
          Math.max(...boxes.map((rect) => alongOf(rect)[1]))
        ];
        const alongStrips = /* @__PURE__ */ new Map();
        packed.shelves.forEach((shelf, shelfIndex) => {
          const start = acrossOf(boxes[shelf[0]])[0];
          const end = Math.max(...shelf.map((slot) => acrossOf(boxes[slot])[1]));
          const next = packed.shelves[shelfIndex + 1];
          if (next !== void 0) {
            const nextStart = acrossOf(boxes[next[0]])[0];
            const currentZone = shelfHasZone(packed.run, shelf);
            const nextZone = shelfHasZone(packed.run, next);
            const acrossZone = zoneRule ? currentZone && nextZone : zone;
            const bordersZone = currentZone || nextZone;
            const base = zoneRule ? acrossZone ? zoneGutter : gapAfter(shelf.at(-1)) ?? (bordersZone ? zoneAcrossBase : cardAcrossBase) : gapAfter(shelf.at(-1)) ?? packed.acrossBase;
            out.push({
              id: `${key}|across|${String(shelfIndex)}`,
              horizontal: rows,
              strips: [stripOf(extent, [end, nextStart])],
              gap: nextStart - end,
              base,
              authoredBase: false,
              max: rows ? rowGaps.maxY : rowGaps.maxX,
              zone: acrossZone
            });
          }
          shelf.forEach((slot, index) => {
            const following = shelf[index + 1];
            if (following === void 0)
              return;
            const strip = stripOf([alongOf(boxes[slot])[1], alongOf(boxes[following])[0]], [start, end]);
            const leftZone = itemHasZone(packed.run.items[slot]);
            const rightZone = itemHasZone(packed.run.items[following]);
            const pairZone = zoneRule ? leftZone && rightZone : zone;
            (alongStrips.get(index) ?? alongStrips.set(index, []).get(index)).push({
              shelf: shelfIndex,
              slot,
              strip,
              zone: pairZone,
              bordersZone: zoneRule ? leftZone || rightZone : zone
            });
          });
        });
        for (const [index, strips] of [...alongStrips].sort(([left], [right]) => left - right)) {
          const thickness = (strip) => rows ? strip.width : strip.height;
          const startOf = (strip) => rows ? strip.x : strip.y;
          const lane = strips.every(({ strip, zone: stripZone, bordersZone }) => Math.abs(startOf(strip) - startOf(strips[0].strip)) <= LANE_TOLERANCE && stripZone === strips[0].zone && bordersZone === strips[0].bordersZone);
          const max = rows ? rowGaps.maxX : rowGaps.maxY;
          const baseFor = (slot, stripZone, bordersZone) => zoneRule ? stripZone ? zoneGutter : gapAfter(slot) ?? (bordersZone ? zoneAlongBase : cardAlongBase) : gapAfter(slot) ?? packed.alongBase;
          if (lane) {
            out.push({
              id: `${key}|along|${String(index)}`,
              horizontal: !rows,
              strips: strips.map(({ strip }) => strip),
              gap: Math.max(...strips.map(({ strip }) => thickness(strip))),
              base: Math.max(...strips.map(({ slot, zone: stripZone, bordersZone }) => baseFor(slot, stripZone, bordersZone))),
              authoredBase: false,
              max,
              zone: strips[0].zone
            });
          } else {
            for (const { shelf, slot, strip, zone: stripZone, bordersZone } of strips) {
              out.push({
                id: `${key}|along|${String(index)}|${String(shelf)}`,
                horizontal: !rows,
                strips: [strip],
                gap: thickness(strip),
                base: baseFor(slot, stripZone, bordersZone),
                authoredBase: false,
                max,
                zone: stripZone
              });
            }
          }
        }
      }
      return out;
    };
    const freeCellLegendRect = rootGridLayout?.freeCellRect;
    const sortedBarrierEntriesEarly = [...titleBands].sort(([left], [right]) => byString4(left, right));
    const earlyAuditBarriers = [
      ...sortedBarrierEntriesEarly.map(([entity, rect]) => ({ entity: String(entity), rect })),
      ...freeCellLegendRect === void 0 ? [] : [{ rect: freeCellLegendRect }]
    ];
    let combPlan;
    if (composition !== void 0 && (composition.fanIn === "comb" || composition.fanOut === "comb")) {
      const combCandidates = [];
      for (const edge of drawnEdges) {
        if (edge.source.entity === edge.target.entity)
          continue;
        if (isAncestor(filteredGraph, edge.source.entity, edge.target.entity) || isAncestor(filteredGraph, edge.target.entity, edge.source.entity))
          continue;
        const occurrence = projected.relationOccurrences[edge.occurrence];
        if (occurrence === void 0)
          continue;
        const semantic = document.relations[occurrence.relation];
        if (semantic?.profile === "erd@1" || semantic?.type === "flow-step")
          continue;
        const relStyle = relationPresentationFor(presentation.relations, occurrence.id, occurrence.relation);
        const resolvedStroke = resolveDashPattern(occurrence.strokeStyle ?? relStyle?.strokeStyle)?.style ?? "solid";
        const resolvedArrow = resolveArrowhead(occurrence.arrowhead ?? relStyle?.arrowhead)?.canonicalKind ?? "arrow";
        const resolvedEmphasis = resolveLinkEmphasis(occurrence.emphasis ?? relStyle?.emphasis)?.emphasis ?? "default";
        const styleKey = linkStyleKey({ strokeStyle: resolvedStroke, arrowhead: resolvedArrow, emphasis: resolvedEmphasis });
        const sourceRole = occurrence.endpoints.find((ep) => ep.role === "source");
        const targetRole = occurrence.endpoints.find((ep) => ep.role === "target");
        const passable = /* @__PURE__ */ new Set([
          ...sourceRole === void 0 ? [] : projectedAncestorsOf(sourceRole.occurrence),
          ...targetRole === void 0 ? [] : projectedAncestorsOf(targetRole.occurrence)
        ]);
        const occRelRef = edge.occurrence;
        const within = withinOf.get(occRelRef);
        const effLabel = edgeBundles[edge.occurrence]?.label ?? edgeLabelOf(document, edge.relation);
        combCandidates.push({
          occurrence: edge.occurrence,
          relation: edge.relation,
          source: edge.source,
          target: edge.target,
          styleKey,
          arrowhead: resolvedArrow,
          ...effLabel === void 0 ? {} : { label: effLabel },
          passable,
          ...within === void 0 ? {} : { within }
        });
      }
      combPlan = solveCombs({
        candidates: combCandidates,
        fanIn: composition.fanIn,
        fanOut: composition.fanOut,
        r7Routing,
        rects,
        placementParentOf,
        gridReports: composedGridReports,
        gutters: [...composedEmittedGutters, ...collectShelfGutters()],
        barriers: earlyAuditBarriers,
        isNorthBlockedByTitle,
        routeSpacing,
        borderClearance,
        cornerInset: dockCornerInset
      });
      for (const fb of combPlan.fallbacks) {
        warnings.push({
          severity: "info",
          code: "comb-fallback",
          refs: fb.members,
          message: `comb group at ${fb.hub} routed separately (${fb.reason})`,
          details: { hub: fb.hub, members: fb.members, reason: fb.reason }
        });
      }
    }
    const combMemberSet = combPlan === void 0 ? void 0 : combPlan.memberCombId;
    const plainEdges = combMemberSet === void 0 || combMemberSet.size === 0 ? drawnEdges : drawnEdges.filter((edge) => !combMemberSet.has(String(edge.occurrence)));
    const routingGraph = combMemberSet === void 0 || combMemberSet.size === 0 ? filteredGraph : {
      ...filteredGraph,
      edges: filteredGraph.edges.filter((edge) => !combMemberSet.has(String(edge.id)))
    };
    const docked = dockEdges({
      ...hasFlows ? { flowBadgeSize: flowTokens.flowBadgeSize } : {},
      graph: routingGraph,
      rects,
      direction: "top-to-bottom",
      metrics,
      labelSizes: /* @__PURE__ */ new Map(),
      fixed: true,
      cornerInset: dockCornerInset,
      sideOverrides,
      ...combPlan !== void 0 && combPlan.reservedSlots.size > 0 ? { reservedSlots: combPlan.reservedSlots } : {}
    });
    const finalDocks = new Map(docked.docks);
    if (combPlan !== void 0) {
      for (const [id, docks] of combPlan.memberDocks)
        finalDocks.set(id, docks);
    }
    {
      const byEntity = /* @__PURE__ */ new Map();
      for (const overflow of docked.fixedOverflows) {
        const entry = byEntity.get(overflow.entity) ?? { sides: [], required: 0, fitted: 0 };
        entry.sides.push(overflow.side);
        entry.required += overflow.required;
        entry.fitted += overflow.fitted;
        byEntity.set(overflow.entity, entry);
      }
      for (const entity of [...byEntity.keys()].sort(byString4)) {
        const entry = byEntity.get(entity);
        const sides = [...entry.sides].sort(byString4);
        const occurrence = representativeOf2(entity);
        warnings.push({
          code: "docking-overflow",
          refs: [occurrence],
          message: `sides ${sides.join(",")} of ${occurrence} need ${entry.required} docks, fit ${entry.fitted}`,
          details: {
            occurrence,
            sides: sides.join(","),
            required: entry.required,
            fitted: entry.fitted
          }
        });
      }
    }
    const buildRequests = (docksMap) => plainEdges.map((edge) => {
      const occurrence = projected.relationOccurrences[edge.occurrence];
      const sourceRole = occurrence.endpoints.find((endpoint) => endpoint.role === "source");
      const targetRole = occurrence.endpoints.find((endpoint) => endpoint.role === "target");
      const occurrenceId = edge.occurrence;
      const pair3 = docksMap.get(occurrenceId);
      const passable = /* @__PURE__ */ new Set([
        ...projectedAncestorsOf(sourceRole.occurrence),
        ...projectedAncestorsOf(targetRole.occurrence)
      ]);
      const within = withinOf.get(occurrenceId);
      return {
        ...flowRunRanks.has(edge.occurrence) ? { flowRank: flowRunRanks.get(edge.occurrence), flowRun: [edge.source.entity, edge.target.entity].sort().join("|") + "|" + String(sideOverrides.get(occurrenceId)?.turn === true) } : {},
        id: occurrenceId,
        pairKey: [edge.source.entity, edge.target.entity].sort().join("|"),
        start: pair3.source.point,
        startExit: pair3.source.exit,
        end: pair3.target.point,
        endExit: pair3.target.exit,
        passable,
        // BF-3: an edge whose two ends share an expanded container stays in its content box.
        ...within === void 0 ? {} : { within }
      };
    });
    let requests = buildRequests(finalDocks);
    const outerLanes = [];
    const outerLanesX = [];
    let labelLimit;
    const markSizes = [...routeSizes.values()];
    const edgeClearance = Math.max(metrics.clearance, borderClearance);
    if (markSizes.length > 0 && rects.size > 0) {
      const pitch = Math.max(routeSpacing, ...markSizes.map((size) => size.height + 2 * metrics.labelMargin));
      const pitchX = Math.max(routeSpacing, ...markSizes.map((size) => size.width + 2 * metrics.labelMargin));
      const left = Math.min(...[...rects.values()].map((rect) => rect.x));
      const right = Math.max(...[...rects.values()].map((rect) => rect.x + rect.width));
      const width2 = right - left;
      const height = drawingBottom - drawingTop;
      const spareX = Math.max(0, height * rowPack.targetAspect - width2) / 2;
      const spareY = Math.max(0, width2 / rowPack.targetAspect - height) / 2;
      const allowance = edgeClearance + pitch;
      labelLimit = {
        x: left - spareX - edgeClearance - pitchX,
        y: drawingTop - spareY - allowance,
        width: width2 + 2 * (spareX + edgeClearance + pitchX),
        height: height + 2 * (spareY + allowance)
      };
      const lanes = Math.min(markSizes.length, OUTER_LANES, 1 + Math.floor(spareY / pitch));
      for (let lane = 1; lane <= lanes; lane += 1) {
        outerLanes.push(drawingTop - edgeClearance - lane * pitch, drawingBottom + edgeClearance + lane * pitch);
      }
      const lanesX = Math.min(markSizes.length, OUTER_LANES, 1 + Math.floor(spareX / pitchX));
      for (let lane = 1; lane <= lanesX; lane += 1) {
        outerLanesX.push(left - edgeClearance - lane * pitchX, right + edgeClearance + lane * pitchX);
      }
    }
    const sortedBarrierEntries = [...titleBands].sort(([left], [right]) => byString4(left, right));
    const sortedBarriers = [
      ...sortedBarrierEntries.map(([, band]) => band),
      ...freeCellLegendRect === void 0 ? [] : [freeCellLegendRect]
    ];
    const auditBarriers = [
      ...sortedBarrierEntries.map(([entity, rect]) => ({ entity: String(entity), rect })),
      ...freeCellLegendRect === void 0 ? [] : [{ rect: freeCellLegendRect }]
    ];
    const runRouter = (reqs, priority) => routeEdges({
      rects,
      requests: reqs,
      avoidFallbackInteriors: true,
      clearance: borderClearance,
      routeSpacing,
      barriers: sortedBarriers,
      lanes: { xs: outerLanesX, ys: outerLanes },
      ...priority === void 0 ? {} : { priority },
      ...combPlan !== void 0 && combPlan.reservedPolylines.length > 0 ? { reservedRoutes: combPlan.reservedPolylines } : {}
    });
    let routed = runRouter(requests);
    if (routeSpacing > 0 && drawnEdges.length > 1) {
      const quickAudit = (outcome2) => {
        const checked = [];
        for (const edge of drawnEdges) {
          const id = edge.occurrence;
          const pts = combPlan?.memberRoutes.get(id) ?? outcome2.routes.get(id);
          if (pts === void 0)
            continue;
          const occ = projected.relationOccurrences[edge.occurrence];
          const sRole = occ.endpoints.find((ep) => ep.role === "source");
          const tRole = occ.endpoints.find((ep) => ep.role === "target");
          const style = relationPresentationFor(presentation.relations, occ.id, occ.relation);
          const rawArrow = resolveArrowhead(occ.arrowhead ?? style?.arrowhead).canonicalKind;
          const arrowhead = combPlan?.suppressedArrowheads.has(String(edge.occurrence)) ? "none" : rawArrow;
          const combGroupId = combPlan?.memberCombId.get(String(edge.occurrence));
          const passable = /* @__PURE__ */ new Set([
            ...projectedAncestorsOf(sRole.occurrence),
            ...projectedAncestorsOf(tRole.occurrence)
          ]);
          checked.push({
            id: String(edge.occurrence),
            source: String(edge.source.entity),
            target: String(edge.target.entity),
            points: pts,
            ...edge.source.port === void 0 ? {} : { sourcePort: String(edge.source.port) },
            ...edge.target.port === void 0 ? {} : { targetPort: String(edge.target.port) },
            arrowhead,
            passable,
            ...combGroupId === void 0 ? {} : { combGroupId }
          });
        }
        return checkRouteSpacing({
          rects,
          routes: checked,
          routeSpacing,
          borderClearance,
          barriers: auditBarriers
        });
      };
      const scoreOf = (outcome2, report) => outcome2.obstructed.length * 1e4 + outcome2.escaped.length * 1e3 + report.conflictCount;
      let bestReport = quickAudit(routed);
      let bestScore = scoreOf(routed, bestReport);
      let bestPriority;
      if (bestScore > 0) {
        const maxStage1Rounds = rects.size > 25 && bestReport.conflictCount > 5 && routed.obstructed.length === 0 ? 1 : 3;
        const promoted = /* @__PURE__ */ new Set();
        for (let round = 0; round < maxStage1Rounds && bestScore > 0; round += 1) {
          const beforeSize = promoted.size;
          for (const r of routed.obstructed)
            promoted.add(r);
          for (const r of routed.escaped)
            promoted.add(r);
          for (const conflict of bestReport.conflicts) {
            for (const r of conflict.routes)
              promoted.add(r);
          }
          if (promoted.size === beforeSize)
            break;
          const candidate = runRouter(requests, promoted);
          const candReport = quickAudit(candidate);
          const candScore = scoreOf(candidate, candReport);
          if (candScore < bestScore) {
            routed = candidate;
            bestReport = candReport;
            bestScore = candScore;
            bestPriority = new Set(promoted);
          } else {
            break;
          }
        }
      }
      if (bestScore > 0 && (bestReport.conflictCount <= 5 || rects.size <= 25)) {
        const workingOverrides = new Map(sideOverrides);
        const allSides = ["west", "east", "south", "north"];
        const sideScoreToward = (fromId, toId, side) => {
          const a = rects.get(fromId);
          const b = rects.get(toId);
          const dx = b.x + b.width / 2 - (a.x + a.width / 2);
          const dy = b.y + b.height / 2 - (a.y + a.height / 2);
          if (side === "east")
            return -dx;
          if (side === "west")
            return dx;
          if (side === "south")
            return -dy;
          return dy;
        };
        const maxStage2Calls = rects.size > 25 ? 6 : 18;
        let stage2Calls = 0;
        for (let round = 0; round < 4 && bestScore > 0 && stage2Calls < maxStage2Calls; round += 1) {
          const counts = /* @__PURE__ */ new Map();
          for (const r of routed.obstructed)
            counts.set(String(r), (counts.get(String(r)) ?? 0) + 10);
          for (const r of routed.escaped)
            counts.set(String(r), (counts.get(String(r)) ?? 0) + 5);
          for (const conflict of bestReport.conflicts) {
            for (const r of conflict.routes)
              counts.set(r, (counts.get(r) ?? 0) + 1);
          }
          const rankedEdges = [...counts.entries()].sort((a, b) => b[1] - a[1] || byString4(a[0], b[0])).map(([id]) => plainEdges.find((e) => String(e.occurrence) === id)).filter((e) => {
            if (e === void 0)
              return false;
            if (e.source.entity === e.target.entity)
              return false;
            if (e.source.port !== void 0 || e.target.port !== void 0)
              return false;
            if (isAncestor(filteredGraph, e.source.entity, e.target.entity) || isAncestor(filteredGraph, e.target.entity, e.source.entity))
              return false;
            return true;
          });
          let improved = false;
          for (const edge of rankedEdges.slice(0, 2)) {
            if (stage2Calls >= maxStage2Calls)
              break;
            const id = edge.occurrence;
            const within = withinOf.get(id);
            const currentDock = finalDocks.get(id);
            const validSourceSides = allSides.filter((s) => (s !== "north" || !isNorthBlockedByTitle(edge.source.entity)) && sideStaysInWithin(edge.source.entity, s, within)).sort((a, b) => sideScoreToward(edge.source.entity, edge.target.entity, a) - sideScoreToward(edge.source.entity, edge.target.entity, b));
            const validTargetSides = allSides.filter((s) => (s !== "north" || !isNorthBlockedByTitle(edge.target.entity)) && sideStaysInWithin(edge.target.entity, s, within)).sort((a, b) => sideScoreToward(edge.target.entity, edge.source.entity, a) - sideScoreToward(edge.target.entity, edge.source.entity, b));
            const faceCandidates = [];
            for (const s of validSourceSides) {
              if (s !== currentDock.source.side)
                faceCandidates.push([s, currentDock.target.side]);
            }
            for (const t of validTargetSides) {
              if (t !== currentDock.target.side)
                faceCandidates.push([currentDock.source.side, t]);
            }
            let bestCandOverrides;
            let bestCandDocks;
            let bestCandRequests;
            let bestCandOutcome;
            let bestCandReport;
            let bestCandScore = bestScore;
            for (const [s, t] of faceCandidates) {
              if (stage2Calls >= maxStage2Calls)
                break;
              stage2Calls += 1;
              const candOverrides = new Map(workingOverrides);
              candOverrides.set(id, { source: s, target: t, turn: false });
              const candDocked = dockEdges({
                ...hasFlows ? { flowBadgeSize: flowTokens.flowBadgeSize } : {},
                graph: routingGraph,
                rects,
                direction: "top-to-bottom",
                metrics,
                labelSizes: /* @__PURE__ */ new Map(),
                fixed: true,
                cornerInset: dockCornerInset,
                sideOverrides: candOverrides,
                ...combPlan !== void 0 && combPlan.reservedSlots.size > 0 ? { reservedSlots: combPlan.reservedSlots } : {}
              });
              if (candDocked.fixedOverflows.length > docked.fixedOverflows.length)
                continue;
              const candRequests = buildRequests(candDocked.docks);
              const candOutcome = runRouter(candRequests, bestPriority);
              const candReport = quickAudit(candOutcome);
              const candScore = scoreOf(candOutcome, candReport);
              if (candScore < bestCandScore) {
                bestCandScore = candScore;
                bestCandOverrides = candOverrides;
                bestCandDocks = candDocked.docks;
                bestCandRequests = candRequests;
                bestCandOutcome = candOutcome;
                bestCandReport = candReport;
                break;
              }
            }
            if (bestCandOutcome !== void 0 && bestCandDocks !== void 0 && bestCandRequests !== void 0 && bestCandReport !== void 0 && bestCandOverrides !== void 0) {
              workingOverrides.clear();
              for (const [k, v] of bestCandOverrides)
                workingOverrides.set(k, v);
              sideOverrides.clear();
              for (const [k, v] of bestCandOverrides)
                sideOverrides.set(k, v);
              finalDocks.clear();
              for (const [k, v] of bestCandDocks)
                finalDocks.set(k, v);
              if (combPlan !== void 0) {
                for (const [k, v] of combPlan.memberDocks)
                  finalDocks.set(k, v);
              }
              requests = bestCandRequests;
              routed = bestCandOutcome;
              bestReport = bestCandReport;
              bestScore = bestCandScore;
              improved = true;
              break;
            }
          }
          if (!improved)
            break;
        }
      }
      if (bestScore > 0 && rects.size <= 25) {
        const orderRank = /* @__PURE__ */ new Map();
        [...requests].sort((a, b) => {
          const aIn = a.within !== void 0 ? 0 : 1;
          const bIn = b.within !== void 0 ? 0 : 1;
          if (aIn !== bIn)
            return aIn - bIn;
          const aDist = Math.abs(a.start.x - a.end.x) + Math.abs(a.start.y - a.end.y);
          const bDist = Math.abs(b.start.x - b.end.x) + Math.abs(b.start.y - b.end.y);
          if (Math.abs(aDist - bDist) > 1e-4)
            return aDist - bDist;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        }).forEach((req, idx) => orderRank.set(String(req.id), idx));
        const victims = /* @__PURE__ */ new Set();
        for (const r of routed.obstructed)
          victims.add(r);
        for (const r of routed.escaped)
          victims.add(r);
        for (const conflict of bestReport.conflicts) {
          const sorted = [...conflict.routes].sort((a, b) => (orderRank.get(b) ?? 0) - (orderRank.get(a) ?? 0));
          if (sorted.length > 0)
            victims.add(sorted[0]);
        }
        if (victims.size > 0) {
          const candidate = runRouter(requests, victims);
          const candReport = quickAudit(candidate);
          const candScore = scoreOf(candidate, candReport);
          if (candScore < bestScore) {
            routed = candidate;
            bestReport = candReport;
            bestScore = candScore;
          }
        }
      }
    }
    const retryRoutes = new Map(routed.routes);
    if (combPlan !== void 0) {
      for (const [id, pts] of combPlan.memberRoutes)
        retryRoutes.set(id, pts);
    }
    const retryObstructed = new Set(routed.obstructed);
    const otherRoutesOf = (id) => [
      ...requests.filter((candidate) => candidate.id !== id && !retryObstructed.has(candidate.id)).map((candidate) => retryRoutes.get(candidate.id)).filter((route) => route !== void 0),
      ...combPlan?.reservedPolylines ?? []
    ];
    const parallel = /* @__PURE__ */ new Map();
    for (const request of requests) {
      if (edgeLayouts.has(request.id))
        continue;
      const pair3 = parallel.get(request.pairKey) ?? [];
      pair3.push(request);
      parallel.set(request.pairKey, pair3);
    }
    for (const pair3 of parallel.values()) {
      if (pair3.length < 2)
        continue;
      pair3.sort((a, b) => byString4(a.id, b.id));
      const first2 = pair3[0];
      const horizontal = Math.abs(first2.start.x - first2.end.x) >= Math.abs(first2.start.y - first2.end.y);
      const center = horizontal ? (first2.start.x + first2.end.x) / 2 : (first2.start.y + first2.end.y) / 2;
      const combPitch = Math.max(routeSpacing, (horizontal ? metrics.trackSpacing : metrics.trackSpacingBlock) ?? (horizontal ? 14 : 7));
      pair3.forEach((request, index) => {
        const lane = center + (index - (pair3.length - 1) / 2) * combPitch;
        const points = horizontal ? [request.start, { x: lane, y: request.start.y }, { x: lane, y: request.end.y }, request.end] : [request.start, { x: request.start.x, y: lane }, { x: request.end.x, y: lane }, request.end];
        const firstLeg = points.find((point) => point.x !== request.start.x || point.y !== request.start.y);
        const lastLeg = [...points].reverse().find((point) => point.x !== request.end.x || point.y !== request.end.y);
        if (firstLeg === void 0 || lastLeg === void 0 || (firstLeg.x - request.start.x) * request.startExit.x + (firstLeg.y - request.start.y) * request.startExit.y <= 0 || (lastLeg.x - request.end.x) * request.endExit.x + (lastLeg.y - request.end.y) * request.endExit.y <= 0)
          return;
        const firstLen = Math.hypot(firstLeg.x - request.start.x, firstLeg.y - request.start.y);
        const lastLen = Math.hypot(lastLeg.x - request.end.x, lastLeg.y - request.end.y);
        if (routeSpacing > 0 && (firstLen < borderClearance - 1e-4 || lastLen < borderClearance - 1e-4))
          return;
        const within = request.within;
        if (within !== void 0 && points.some((point) => point.x < within.x || point.y < within.y || point.x > within.x + within.width || point.y > within.y + within.height))
          return;
        if (requests.some((other) => other.id !== request.id && other.pairKey === request.pairKey && routesConflict(points, retryRoutes.get(other.id))))
          return;
        if (points.slice(1).some((point, i) => {
          const prev = points[i];
          if (shapesOf(request.id).some((shape) => {
            if (rectsIntersect(shape, {
              x: Math.min(point.x, prev.x),
              y: Math.min(point.y, prev.y),
              width: Math.abs(point.x - prev.x),
              height: Math.abs(point.y - prev.y)
            }))
              return true;
            if (!(routeSpacing > 0))
              return false;
            if (i === 0 && (Math.abs(prev.x - shape.x) < 1e-4 || Math.abs(prev.x - (shape.x + shape.width)) < 1e-4 || Math.abs(prev.y - shape.y) < 1e-4 || Math.abs(prev.y - (shape.y + shape.height)) < 1e-4))
              return false;
            if (i === points.length - 2 && (Math.abs(point.x - shape.x) < 1e-4 || Math.abs(point.x - (shape.x + shape.width)) < 1e-4 || Math.abs(point.y - shape.y) < 1e-4 || Math.abs(point.y - (shape.y + shape.height)) < 1e-4))
              return false;
            return segmentToRectDistance(prev, point, shape) < borderClearance - 1e-4;
          }))
            return true;
          if (routeSpacing > 0 && passableZonesOf(request.id).some((zone) => segmentToPassableBorderDistance(prev, point, zone) < borderClearance - 1e-4)) {
            return true;
          }
          return false;
        }))
          return;
        if (routeSpacing > 0) {
          const candidateElbows = points.slice(1, -1);
          const violatesSpacing = otherRoutesOf(request.id).some((other) => {
            for (let i = 1; i < points.length; i += 1) {
              const a1 = points[i - 1];
              const a2 = points[i];
              for (let j = 1; j < other.length; j += 1) {
                const b1 = other[j - 1];
                const b2 = other[j];
                if (Math.abs(a1.y - a2.y) < 1e-4 && Math.abs(b1.y - b2.y) < 1e-4 && Math.abs(a1.y - b1.y) < routeSpacing - 1e-4) {
                  if (Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x)) > 1e-4)
                    return true;
                }
                if (Math.abs(a1.x - a2.x) < 1e-4 && Math.abs(b1.x - b2.x) < 1e-4 && Math.abs(a1.x - b1.x) < routeSpacing - 1e-4) {
                  if (Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y)) > 1e-4)
                    return true;
                }
              }
            }
            for (const e1 of candidateElbows) {
              for (let k = 1; k < other.length - 1; k += 1) {
                if (Math.hypot(e1.x - other[k].x, e1.y - other[k].y) < routeSpacing - 1e-4)
                  return true;
              }
            }
            return false;
          });
          if (violatesSpacing)
            return;
        }
        retryRoutes.set(request.id, points);
        retryObstructed.delete(request.id);
      });
    }
    if (retryObstructed.size > 0 && !(routeSpacing > 0)) {
      const failed = new Set(retryObstructed);
      const retryRequests = requests.filter((request) => failed.has(request.id));
      const retried = routeEdges({
        rects,
        requests: retryRequests,
        avoidFallbackInteriors: true,
        clearance: 2,
        barriers: [...titleBands].sort(([left], [right]) => byString4(left, right)).map(([, band]) => band),
        lanes: { xs: outerLanesX, ys: outerLanes }
      });
      for (const [id, points] of retried.routes) {
        if (!failed.has(id) || retried.obstructed.includes(id) || retried.escaped.includes(id))
          continue;
        const request = requests.find((candidate) => candidate.id === id);
        if (requests.some((other) => other.id !== id && other.pairKey === request.pairKey && routesConflict(points, retryRoutes.get(other.id))))
          continue;
        retryRoutes.set(id, points);
        retryObstructed.delete(id);
      }
    }
    for (const id of [...routed.escaped].sort(byString4)) {
      warnings.push({
        code: "route-obstructed",
        refs: [id],
        message: `route of ${id} leaves the content box of its shared container; no route inside it was found`
      });
    }
    const combCarrierPlaced = /* @__PURE__ */ new Set();
    const labelBoxes = /* @__PURE__ */ new Map();
    const marks = placeFlowMarks({ plan: flowPlan, routes: retryRoutes, shapes: [...fixedShapes, ...zoneShapes.flatMap(([, rect]) => [
      { x: rect.x, y: rect.y, width: rect.width, height: metrics.labelMargin },
      { x: rect.x, y: rect.y + rect.height - metrics.labelMargin, width: rect.width, height: metrics.labelMargin },
      { x: rect.x, y: rect.y, width: metrics.labelMargin, height: rect.height },
      { x: rect.x + rect.width - metrics.labelMargin, y: rect.y, width: metrics.labelMargin, height: rect.height }
    ])], within: withinOf, ...labelLimit === void 0 ? {} : { limit: labelLimit }, measure: measure2, options, margin: metrics.labelMargin });
    warnings.push(...marks.warnings);
    const taken = [...marks.taken, ...freeCellLegendRect === void 0 ? [] : [freeCellLegendRect]];
    const entries = [...edgeLayouts.entries()].filter(([id]) => !(combPlan?.suppressedLabels.has(String(id)) === true)).sort(([left], [right]) => byString4(left, right)).map(([id, layout]) => {
      const within = withinOf.get(id);
      return {
        id,
        route: retryRoutes.get(id),
        size: { width: layout.width, height: layout.height },
        ...within === void 0 ? {} : { within },
        ...labelLimit === void 0 ? {} : { limit: labelLimit }
      };
    });
    const unplaced = [];
    if (combPlan !== void 0) {
      for (const comb of combPlan.groups) {
        if (comb.label === void 0)
          continue;
        const carrierId = comb.carrier;
        combCarrierPlaced.add(String(comb.carrier));
        const existingLayout = edgeLayouts.get(carrierId);
        const measuredCombLabel = existingLayout ?? edgeLabelMeasure({
          text: comb.label,
          role: "edge-label",
          availableWidth: EDGE_LABEL_WIDTH,
          allocatedLines: DEFAULT_ALLOCATED_LINES["edge-label"],
          folded: false
        });
        if (existingLayout === void 0) {
          recordSlot(comb.carrier, "edge-label", measuredCombLabel, false);
        }
        const size = { width: measuredCombLabel.width, height: measuredCombLabel.height };
        const within = withinOf.get(carrierId);
        let placedComb;
        for (const seg of comb.trunkSegments) {
          placedComb = placePackedLabel({
            id: carrierId,
            route: seg,
            size,
            ...within === void 0 ? {} : { within },
            ...labelLimit === void 0 ? {} : { limit: labelLimit }
          }, fixedShapes, taken, metrics.labelMargin);
          if (placedComb !== void 0)
            break;
        }
        if (placedComb === void 0) {
          const fullRoute = retryRoutes.get(carrierId);
          if (fullRoute !== void 0) {
            placedComb = placePackedLabel({
              id: carrierId,
              route: fullRoute,
              size,
              ...within === void 0 ? {} : { within },
              ...labelLimit === void 0 ? {} : { limit: labelLimit }
            }, fixedShapes, taken, metrics.labelMargin);
          }
        }
        if (placedComb !== void 0) {
          labelBoxes.set(carrierId, placedComb.box);
          taken.push(placedComb.box);
        } else {
          unplaced.push({
            id: carrierId,
            route: retryRoutes.get(carrierId),
            size,
            ...within === void 0 ? {} : { within },
            ...labelLimit === void 0 ? {} : { limit: labelLimit }
          });
        }
      }
    }
    const detourStep = routeSpacing > 0 ? borderClearance : 2;
    const detourClearance = routeSpacing > 0 ? borderClearance : 0;
    for (const entry of entries) {
      if (combCarrierPlaced.has(String(entry.id)))
        continue;
      const edge = drawnEdges.find((candidate) => candidate.occurrence === entry.id);
      let choice = placePackedLabel(entry, fixedShapes, taken, metrics.labelMargin);
      if (flowPlan.ranks.has(entry.id)) {
        if (choice === void 0)
          unplaced.push(entry);
        else {
          labelBoxes.set(entry.id, choice.box);
          taken.push(choice.box);
        }
        continue;
      }
      if (plan?.external.has(entry.id) && sharedContainerOf(edge.source.entity, edge.target.entity) === void 0) {
        const request = requests.find((candidate) => candidate.id === entry.id);
        const { limit: _limit, ...unbounded } = entry;
        const route = labelDetour({
          request,
          shapes: shapesOf(entry.id),
          earlier: requests.filter((other) => other.id !== request.id && other.pairKey === request.pairKey && !retryObstructed.has(other.id)).map((other) => retryRoutes.get(other.id)),
          allFixed: otherRoutesOf(entry.id),
          passableZones: passableZonesOf(entry.id),
          step: detourStep,
          routeSpacing,
          borderClearance: detourClearance,
          xs: [.../* @__PURE__ */ new Set([request.start.x, request.end.x, ...outerLanesX])].sort((a, b) => a - b),
          ys: [.../* @__PURE__ */ new Set([request.start.y, request.end.y, ...outerLanes])].sort((a, b) => a - b),
          accepts: (points) => {
            const label = placePackedLabel({ ...unbounded, route: points }, fixedShapes, taken, metrics.labelMargin);
            return label !== void 0 && (label.box.y >= drawingBottom || label.box.y + label.box.height <= drawingTop);
          }
        });
        if (route !== void 0) {
          retryRoutes.set(entry.id, route);
          retryObstructed.delete(entry.id);
          choice = placePackedLabel({ ...unbounded, route }, fixedShapes, taken, metrics.labelMargin);
        }
      }
      const probeMargin = probeMarginOf(entry.size.height);
      if (plan === void 0 && choice === void 0 && !retryObstructed.has(entry.id) && probeMargin >= 0 && placementParentOf(edge.source.entity) === placementParentOf(edge.target.entity) && placePackedLabel(entry, fixedShapes, taken, metrics.labelMargin, probeMargin) !== void 0) {
        unplaced.push(entry);
        continue;
      }
      if (choice === void 0 || retryObstructed.has(entry.id)) {
        choice = void 0;
        const request = requests.find((candidate) => candidate.id === entry.id);
        const samePair = requests.filter((candidate) => candidate.id !== entry.id && candidate.pairKey === request.pairKey && !retryObstructed.has(candidate.id)).map((candidate) => retryRoutes.get(candidate.id));
        const allFixed = otherRoutesOf(entry.id);
        const shapes = shapesOf(entry.id);
        const margin = probeMargin;
        const xs = /* @__PURE__ */ new Set([request.start.x, request.end.x]);
        const ys = new Set(outerLanes);
        for (const rect of shapes) {
          xs.add(rect.x - edgeClearance);
          xs.add(rect.x + rect.width + edgeClearance);
          for (const pad2 of [metrics.labelMargin, Math.max(0, margin)]) {
            const dy = Math.max(edgeClearance, entry.size.height / 2 + pad2);
            ys.add(rect.y - dy);
            ys.add(rect.y + rect.height + dy);
          }
        }
        for (const end of [request.start, request.end]) {
          xs.add(end.x - entry.size.width - 2 * metrics.labelMargin);
          xs.add(end.x + entry.size.width + 2 * metrics.labelMargin);
        }
        const sortedXs = [...xs].sort((a, b) => a - b);
        const sortedYs = [...ys].sort((a, b) => a - b);
        const edgePassableZones = passableZonesOf(entry.id);
        let detour = labelDetour({
          request,
          shapes,
          earlier: samePair,
          allFixed,
          passableZones: edgePassableZones,
          step: detourStep,
          routeSpacing,
          borderClearance: detourClearance,
          xs: sortedXs,
          ys: sortedYs,
          accepts: (points) => {
            return placePackedLabel({ ...entry, route: points }, fixedShapes, taken, metrics.labelMargin) !== void 0;
          }
        });
        let sortedWideXs;
        let sortedWideYs;
        const ensureWideGrid = () => {
          if (sortedWideXs !== void 0 && sortedWideYs !== void 0) {
            return { xs: sortedWideXs, ys: sortedWideYs };
          }
          const wideXs = /* @__PURE__ */ new Set([...xs, ...outerLanesX]);
          const wideYs = new Set(ys);
          const xSeeds = composition !== void 0 ? [request.start.x, request.end.x, ...outerLanesX, ...sortedXs] : [request.start.x, request.end.x, ...outerLanesX];
          for (const x of xSeeds) {
            wideXs.add(x - routeSpacing);
            wideXs.add(x + routeSpacing);
          }
          if (composition !== void 0) {
            for (let idx = 0; idx + 1 < sortedXs.length; idx += 1) {
              wideXs.add((sortedXs[idx] + sortedXs[idx + 1]) / 2);
            }
          }
          for (const y of [request.start.y, request.end.y, ...outerLanes]) {
            wideYs.add(y - routeSpacing);
            wideYs.add(y + routeSpacing);
          }
          if (composition !== void 0) {
            const takenDy = Math.max(edgeClearance, entry.size.height / 2 + metrics.labelMargin);
            for (const box of taken) {
              wideYs.add(box.y - takenDy);
              wideYs.add(box.y + box.height + takenDy);
            }
          }
          sortedWideXs = [...wideXs].sort((a, b) => a - b);
          sortedWideYs = [...wideYs].sort((a, b) => a - b);
          return { xs: sortedWideXs, ys: sortedWideYs };
        };
        if (detour === void 0 && routeSpacing > 0) {
          const wide = ensureWideGrid();
          detour = labelDetour({
            request,
            shapes,
            earlier: samePair,
            allFixed,
            passableZones: edgePassableZones,
            step: detourStep,
            routeSpacing,
            borderClearance: detourClearance,
            xs: wide.xs,
            ys: wide.ys,
            accepts: (points) => {
              return placePackedLabel({ ...entry, route: points }, fixedShapes, taken, metrics.labelMargin) !== void 0;
            }
          });
        }
        if (detour !== void 0) {
          retryRoutes.set(entry.id, detour);
          retryObstructed.delete(entry.id);
          choice = placePackedLabel({ ...entry, route: detour }, fixedShapes, taken, metrics.labelMargin);
        } else if (margin >= 0) {
          const probeRoute = labelDetour({
            request,
            shapes,
            earlier: samePair,
            allFixed,
            passableZones: edgePassableZones,
            step: detourStep,
            routeSpacing,
            borderClearance: detourClearance,
            xs: sortedXs,
            ys: sortedYs,
            accepts: (points) => placePackedLabel({ ...entry, route: points }, fixedShapes, taken, metrics.labelMargin, margin) !== void 0
          });
          if (probeRoute !== void 0)
            retryRoutes.set(entry.id, probeRoute);
        }
        const sharesPort = drawnEdges.some((other) => other !== edge && [other.source.port, other.target.port].some((port) => port !== void 0 && (port === edge.source.port || port === edge.target.port)));
        if (choice === void 0 && edge.source.entity !== edge.target.entity && !sharesPort && !isAncestor(filteredGraph, edge.source.entity, edge.target.entity) && !isAncestor(filteredGraph, edge.target.entity, edge.source.entity)) {
          const sides = ["north", "south", "east", "west"];
          const facePairs = [
            ...sides.map((side) => [side, side]),
            ...sides.flatMap((source) => sides.filter((target) => target !== source).map((target) => [source, target]))
          ];
          const docksClear = (candidate) => {
            if (!(routeSpacing > 0))
              return true;
            for (const [otherId, otherDocks] of finalDocks) {
              if (otherId === entry.id)
                continue;
              for (const cDock of [candidate.source, candidate.target]) {
                for (const oDock of [otherDocks.source, otherDocks.target]) {
                  if (cDock.entity === oDock.entity && cDock.port !== void 0 && cDock.port === oDock.port)
                    continue;
                  if (cDock.entity === oDock.entity && Math.hypot(cDock.point.x - oDock.point.x, cDock.point.y - oDock.point.y) < routeSpacing - 1e-4) {
                    return false;
                  }
                }
              }
              if (Math.hypot(candidate.target.point.x - otherDocks.target.point.x, candidate.target.point.y - otherDocks.target.point.y) < routeSpacing - 1e-4) {
                return false;
              }
            }
            return true;
          };
          const adjustDockAway = (dock, role3) => {
            const rect = rects.get(dock.entity);
            if (rect === void 0 || dock.port !== void 0 || !(routeSpacing > 0))
              return dock;
            const vertical = dock.side === "east" || dock.side === "west";
            const startCoord = (vertical ? rect.y : rect.x) + dockCornerInset;
            const endCoord = (vertical ? rect.y + rect.height : rect.x + rect.width) - dockCornerInset;
            const spacing = Math.max(routeSpacing, metrics.slotSpacing);
            const occupied = [];
            for (const [otherId, otherDocks] of finalDocks) {
              if (otherId === entry.id)
                continue;
              for (const oDock of [otherDocks.source, otherDocks.target]) {
                if (oDock.entity === dock.entity && oDock.side === dock.side) {
                  occupied.push(vertical ? oDock.point.y : oDock.point.x);
                }
              }
              if (role3 === "target" && otherDocks.target.entity === dock.entity && otherDocks.target.side === dock.side) {
                occupied.push(vertical ? otherDocks.target.point.y : otherDocks.target.point.x);
              }
            }
            const base = vertical ? dock.point.y : dock.point.x;
            const isClearCoord = (c) => c >= startCoord - 1e-4 && c <= endCoord + 1e-4 && occupied.every((u) => Math.abs(u - c) >= routeSpacing - 1e-4);
            if (isClearCoord(base))
              return dock;
            for (let step = 1; step <= 16; step += 1) {
              for (const delta of [-step * spacing, step * spacing]) {
                const c = base + delta;
                if (!isClearCoord(c))
                  continue;
                const point = vertical ? { x: dock.point.x, y: c } : { x: c, y: dock.point.y };
                const anchor = vertical ? (c - rect.y) / rect.height : (c - rect.x) / rect.width;
                return { ...dock, point, anchor };
              }
            }
            return dock;
          };
          for (const [source, target] of facePairs) {
            const overrides = new Map(sideOverrides);
            overrides.set(entry.id, { source, target, turn: source === target });
            let pair3 = dockEdges({
              graph: filteredGraph,
              rects,
              direction: "top-to-bottom",
              metrics,
              labelSizes: /* @__PURE__ */ new Map(),
              fixed: true,
              cornerInset: dockCornerInset,
              sideOverrides: overrides
            }).docks.get(entry.id);
            if (composition !== void 0 && !docksClear(pair3) && routeSpacing > 0) {
              pair3 = {
                source: adjustDockAway(pair3.source, "source"),
                target: adjustDockAway(pair3.target, "target")
              };
            }
            if (!docksClear(pair3))
              continue;
            const alternative = {
              ...request,
              start: pair3.source.point,
              startExit: pair3.source.exit,
              end: pair3.target.point,
              endExit: pair3.target.exit
            };
            let route = labelDetour({
              request: alternative,
              shapes,
              earlier: samePair,
              allFixed,
              passableZones: edgePassableZones,
              step: detourStep,
              routeSpacing,
              borderClearance: detourClearance,
              xs: sortedXs,
              ys: sortedYs,
              accepts: (points) => placePackedLabel({ ...entry, route: points }, fixedShapes, taken, metrics.labelMargin) !== void 0
            });
            if (route === void 0 && composition !== void 0 && routeSpacing > 0) {
              const wide = ensureWideGrid();
              route = labelDetour({
                request: alternative,
                shapes,
                earlier: samePair,
                allFixed,
                passableZones: edgePassableZones,
                step: detourStep,
                routeSpacing,
                borderClearance: detourClearance,
                xs: wide.xs,
                ys: wide.ys,
                accepts: (points) => placePackedLabel({ ...entry, route: points }, fixedShapes, taken, metrics.labelMargin) !== void 0
              });
            }
            if (route === void 0)
              continue;
            retryRoutes.set(entry.id, route);
            retryObstructed.delete(entry.id);
            finalDocks.set(entry.id, pair3);
            choice = placePackedLabel({ ...entry, route }, fixedShapes, taken, metrics.labelMargin);
            break;
          }
        }
      }
      if (choice === void 0) {
        const request = requests.find((candidate) => candidate.id === entry.id);
        if (entry.within === void 0) {
          const right = Math.max(...[...rects.values()].map((rect) => rect.x + rect.width));
          const pitch = Math.max(routeSpacing, ...[...labelSizes.values()].map((size) => size.height + 2 * metrics.labelMargin));
          const column = right + Math.max(...[...labelSizes.values()].map((size) => size.width)) / 2 + edgeClearance;
          const row = drawingBottom + edgeClearance + (entries.indexOf(entry) + 1) * pitch;
          const upperRow = drawingTop - edgeClearance - (entries.indexOf(entry) + 1) * pitch;
          const { limit: _limit, ...unbounded } = entry;
          const samePair = requests.filter((candidate) => candidate.id !== entry.id && candidate.pairKey === request.pairKey && !retryObstructed.has(candidate.id)).map((candidate) => retryRoutes.get(candidate.id));
          const allFixed = otherRoutesOf(entry.id);
          const comb = (earlier) => labelDetour({
            request,
            shapes: shapesOf(entry.id),
            earlier,
            allFixed,
            passableZones: passableZonesOf(entry.id),
            step: detourStep,
            routeSpacing,
            borderClearance: detourClearance,
            xs: [.../* @__PURE__ */ new Set([request.start.x, request.end.x, column, ...outerLanesX])].sort((a, b) => a - b),
            ys: [.../* @__PURE__ */ new Set([request.start.y, request.end.y, upperRow, row, ...outerLanes])].sort((a, b) => a - b),
            accepts: (points) => placePackedLabel({ ...unbounded, route: points }, fixedShapes, taken, metrics.labelMargin) !== void 0
          });
          const route = comb(samePair);
          if (route !== void 0) {
            retryRoutes.set(entry.id, route);
            retryObstructed.delete(entry.id);
            choice = placePackedLabel({ ...unbounded, route }, fixedShapes, taken, metrics.labelMargin);
          }
        }
      }
      if (choice === void 0) {
        unplaced.push({ ...entry, route: retryRoutes.get(entry.id) });
        continue;
      }
      labelBoxes.set(entry.id, choice.box);
      taken.push(choice.box);
    }
    for (const entry of unplaced) {
      warnings.push({ code: "label-unplaced", refs: [entry.id], message: `no segment holds the label of ${entry.id}` });
    }
    for (const id of [...retryObstructed].sort(byString4)) {
      warnings.push({ code: "route-obstructed", refs: [id], message: `no orthogonal route around the obstacles was found for ${id}; an elbow is drawn instead` });
    }
    const gutters = [...composedEmittedGutters];
    for (const [key, packed] of [...packedRuns].sort(([left], [right]) => byString4(left, right))) {
      const boxes = seatedBoxes.get(key);
      if (boxes === void 0 || boxes.length < 2)
        continue;
      const rows = packed.rows;
      const zone = runHasZone(packed.run);
      const axisAuthored = (horizontal, isZone) => (horizontal ? isZone ? hints?.zoneGapX : hints?.cardGapX : isZone ? hints?.zoneGapY : hints?.cardGapY) !== void 0;
      const cardAlongBase = rows ? rowGaps.cardX : rowGaps.cardY;
      const cardAcrossBase = rows ? rowGaps.cardY : rowGaps.cardX;
      const zoneAlongBase = rows ? rowGaps.zoneX : rowGaps.zoneY;
      const zoneAcrossBase = rows ? rowGaps.zoneY : rowGaps.zoneX;
      const gapAfter = (slot) => {
        const item = packed.run.items[slot];
        return "run" in item ? item.gapAfter : void 0;
      };
      const alongOf = (rect) => rows ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
      const acrossOf = (rect) => rows ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
      const stripOf = (along, across) => rows ? { x: along[0], y: across[0], width: along[1] - along[0], height: across[1] - across[0] } : { x: across[0], y: along[0], width: across[1] - across[0], height: along[1] - along[0] };
      const extent = [
        Math.min(...boxes.map((rect) => alongOf(rect)[0])),
        Math.max(...boxes.map((rect) => alongOf(rect)[1]))
      ];
      const alongStrips = /* @__PURE__ */ new Map();
      packed.shelves.forEach((shelf, shelfIndex) => {
        const start = acrossOf(boxes[shelf[0]])[0];
        const end = Math.max(...shelf.map((slot) => acrossOf(boxes[slot])[1]));
        const next = packed.shelves[shelfIndex + 1];
        if (next !== void 0) {
          const nextStart = acrossOf(boxes[next[0]])[0];
          const currentZone = shelfHasZone(packed.run, shelf);
          const nextZone = shelfHasZone(packed.run, next);
          const acrossZone = zoneRule ? currentZone && nextZone : zone;
          const bordersZone = currentZone || nextZone;
          const base = zoneRule ? acrossZone ? zoneGutter : gapAfter(shelf.at(-1)) ?? (bordersZone ? zoneAcrossBase : cardAcrossBase) : gapAfter(shelf.at(-1)) ?? packed.acrossBase;
          gutters.push({
            id: `${key}|across|${String(shelfIndex)}`,
            horizontal: rows,
            strips: [stripOf(extent, [end, nextStart])],
            gap: nextStart - end,
            base,
            authoredBase: zoneRule && acrossZone ? false : gapAfter(shelf.at(-1)) !== void 0 || axisAuthored(!rows, zoneRule ? bordersZone : zone),
            max: rows ? rowGaps.maxY : rowGaps.maxX,
            zone: acrossZone
          });
        }
        shelf.forEach((slot, index) => {
          const following = shelf[index + 1];
          if (following === void 0)
            return;
          const strip = stripOf([alongOf(boxes[slot])[1], alongOf(boxes[following])[0]], [start, end]);
          const leftZone = itemHasZone(packed.run.items[slot]);
          const rightZone = itemHasZone(packed.run.items[following]);
          const pairZone = zoneRule ? leftZone && rightZone : zone;
          (alongStrips.get(index) ?? alongStrips.set(index, []).get(index)).push({
            shelf: shelfIndex,
            slot,
            strip,
            zone: pairZone,
            bordersZone: zoneRule ? leftZone || rightZone : zone
          });
        });
      });
      for (const [index, strips] of [...alongStrips].sort(([left], [right]) => left - right)) {
        const thickness = (strip) => rows ? strip.width : strip.height;
        const startOf = (strip) => rows ? strip.x : strip.y;
        const lane = strips.every(({ strip, zone: stripZone, bordersZone }) => Math.abs(startOf(strip) - startOf(strips[0].strip)) <= LANE_TOLERANCE && stripZone === strips[0].zone && bordersZone === strips[0].bordersZone);
        const max = rows ? rowGaps.maxX : rowGaps.maxY;
        const baseFor = (slot, stripZone, bordersZone) => zoneRule ? stripZone ? zoneGutter : gapAfter(slot) ?? (bordersZone ? zoneAlongBase : cardAlongBase) : gapAfter(slot) ?? packed.alongBase;
        if (lane) {
          const laneZone = strips[0].zone;
          gutters.push({
            id: `${key}|along|${String(index)}`,
            horizontal: !rows,
            strips: strips.map(({ strip }) => strip),
            gap: Math.max(...strips.map(({ strip }) => thickness(strip))),
            base: Math.max(...strips.map(({ slot, zone: stripZone, bordersZone }) => baseFor(slot, stripZone, bordersZone))),
            authoredBase: zoneRule && laneZone ? false : strips.some(({ slot }) => gapAfter(slot) !== void 0) || axisAuthored(rows, strips[0].bordersZone),
            max,
            zone: laneZone
          });
        } else {
          for (const { shelf, slot, strip, zone: stripZone, bordersZone } of strips) {
            gutters.push({
              id: `${key}|along|${String(index)}|${String(shelf)}`,
              horizontal: !rows,
              strips: [strip],
              gap: thickness(strip),
              base: baseFor(slot, stripZone, bordersZone),
              authoredBase: zoneRule && stripZone ? false : gapAfter(slot) !== void 0 || axisAuthored(rows, bordersZone),
              max,
              zone: stripZone
            });
          }
        }
      }
    }
    const channels = gutters.map((gutter) => {
      const edges = [...retryRoutes].filter(([, route]) => gutter.strips.some((strip) => route.some((point, i) => {
        const next = route[i + 1];
        if (next === void 0)
          return false;
        return rectsIntersect(strip, {
          x: Math.min(point.x, next.x),
          y: Math.min(point.y, next.y),
          width: Math.abs(point.x - next.x),
          height: Math.abs(point.y - next.y)
        });
      }))).map(([id]) => String(id)).sort(byString4);
      const seenCombs = /* @__PURE__ */ new Set();
      const n = edges.reduce((sum, id) => {
        const combId = combPlan?.memberCombId.get(id);
        if (combId !== void 0) {
          if (seenCombs.has(combId))
            return sum;
          seenCombs.add(combId);
          return sum + 1;
        }
        return sum + (edgeBundles[id]?.members.length ?? 1);
      }, 0);
      const intersecting = [...labelBoxes.values()].filter((box) => gutter.strips.some((strip) => rectsIntersect(strip, box)));
      const labelled = intersecting.length > 0;
      const axis = gutter.horizontal ? "vertical" : "horizontal";
      const parameters = channelMetrics(metrics, axis === "horizontal");
      const expected = zoneRule && gutter.zone ? gutter.base : (() => {
        const placedFloor = Math.max(0, ...intersecting.map((box) => (gutter.horizontal ? box.height : box.width) + 2 * metrics.labelMargin).filter((needed) => needed <= gutter.max));
        return Math.min(gutter.max, Math.max(placedFloor, channelGap(n, labelled, { ...parameters, gapMin: gutter.authoredBase ? gutter.base : Math.max(parameters.gapMin, gutter.base) })));
      })();
      return {
        id: gutter.id,
        axis,
        edges,
        strips: gutter.strips,
        n,
        labelled,
        gap: gutter.gap,
        expected,
        ...r7Routing ? { capacity: channelCapacity(gutter.gap, routeSpacing, borderClearance) } : {},
        ...zoneRule ? { zone: gutter.zone } : {}
      };
    });
    const isFrozenInnerGutter = (gutterId) => nominalPlan !== void 0 && !gutterId.startsWith(`${ROOT_LEVEL_KEY}|`);
    const unused = [];
    const gutterIds = new Set(gutters.map((gutter) => gutter.id));
    for (const id of [...plan?.widen.keys() ?? []].sort(byString4)) {
      if (isFrozenInnerGutter(id))
        continue;
      if (!gutterIds.has(id))
        unused.push(id);
    }
    const requested = /* @__PURE__ */ new Map();
    const probed = [...taken];
    for (const entry of unplaced) {
      const probe = probeMarginOf(entry.size.height);
      if (probe < 0)
        continue;
      const choice = placePackedLabel(entry, fixedShapes, probed, metrics.labelMargin, probe);
      if (choice === void 0)
        continue;
      probed.push(choice.box);
      const edge = drawnEdges.find((candidate) => candidate.occurrence === entry.id);
      const shared = sharedContainerOf(edge.source.entity, edge.target.entity);
      const level = shared === void 0 ? ROOT_LEVEL_KEY : representativeOf2(shared);
      for (const gutter of gutters) {
        if (zoneRule && gutter.zone)
          continue;
        if (isFrozenInnerGutter(gutter.id))
          continue;
        if (!gutter.id.startsWith(`${level}|`))
          continue;
        if (!gutter.strips.some((strip) => rectsIntersect(strip, choice.box)))
          continue;
        const needed = (gutter.horizontal ? entry.size.height : entry.size.width) + 2 * metrics.labelMargin;
        if (needed > gutter.max || needed <= gutter.gap)
          continue;
        requested.set(gutter.id, Math.max(requested.get(gutter.id) ?? 0, needed));
      }
    }
    for (const channel of channels) {
      if (zoneRule && channel.zone || isFrozenInnerGutter(channel.id)) {
        requested.delete(channel.id);
        continue;
      }
      const target = Math.max(requested.get(channel.id) ?? 0, channel.expected);
      if (Math.abs(target - channel.gap) > 0.5)
        requested.set(channel.id, target);
      else
        requested.delete(channel.id);
    }
    const checkedRoutes = [];
    const conventionEdges = [];
    for (const edge of drawnEdges) {
      const id = edge.occurrence;
      const points = retryRoutes.get(id);
      if (points === void 0)
        continue;
      const occurrence = projected.relationOccurrences[edge.occurrence];
      const sourceRole = occurrence.endpoints.find((endpoint) => endpoint.role === "source");
      const targetRole = occurrence.endpoints.find((endpoint) => endpoint.role === "target");
      const style = relationPresentationFor(presentation.relations, occurrence.id, occurrence.relation);
      const arrowhead = resolveArrowhead(occurrence.arrowhead ?? style?.arrowhead)?.canonicalKind ?? "arrow";
      const passable = /* @__PURE__ */ new Set([
        ...projectedAncestorsOf(sourceRole.occurrence),
        ...projectedAncestorsOf(targetRole.occurrence)
      ]);
      const flowArrows = marks.arrows[edge.occurrence];
      const startPt = points[0];
      const startArrowhead = flowArrows !== void 0 && startPt !== void 0 && flowArrows.some((a) => Math.hypot(a.tip.x - startPt.x, a.tip.y - startPt.y) <= 1e-4);
      const combGroupId = combPlan?.memberCombId.get(String(edge.occurrence));
      const effectiveAuditArrow = combPlan?.suppressedArrowheads.has(String(edge.occurrence)) ? "none" : arrowhead;
      checkedRoutes.push({
        id: String(edge.occurrence),
        source: String(edge.source.entity),
        target: String(edge.target.entity),
        points,
        ...edge.source.port === void 0 ? {} : { sourcePort: String(edge.source.port) },
        ...edge.target.port === void 0 ? {} : { targetPort: String(edge.target.port) },
        arrowhead: effectiveAuditArrow,
        ...startArrowhead ? { startArrowhead: true } : {},
        passable,
        ...combGroupId === void 0 ? {} : { combGroupId }
      });
      if (options.conventions?.arrowDirection === true) {
        const semanticRelation = document.relations[occurrence.relation];
        const semSource = semanticRelation?.endpoints.find((ep) => ep.role === "source")?.target;
        const semTarget = semanticRelation?.endpoints.find((ep) => ep.role === "target")?.target;
        conventionEdges.push({
          id: String(edge.occurrence),
          relationId: String(occurrence.relation),
          sourceEntity: String(edge.source.entity),
          targetEntity: String(edge.target.entity),
          sourceOccurrence: String(sourceRole.occurrence),
          targetOccurrence: String(targetRole.occurrence),
          ...semSource === void 0 ? {} : { semanticSourceEntity: String(semSource) },
          ...semTarget === void 0 ? {} : { semanticTargetEntity: String(semTarget) },
          arrowhead
        });
      }
    }
    if (options.conventions !== void 0) {
      const conventionZones = [];
      if (options.conventions.zoneTagAcronyms === true) {
        for (const id of [...rects.keys()].sort(byString4)) {
          const kind = kinds.get(id);
          if (kind !== "container-expanded" && kind !== "container-collapsed")
            continue;
          const occ = representativeOf2(id);
          const entry = presentation.entities[occ];
          conventionZones.push({ id: String(occ), tag: entry?.text?.kicker });
        }
      }
      warnings.push(...lintDiagramConventions({
        options: options.conventions,
        document,
        edges: conventionEdges,
        zones: conventionZones
      }));
    }
    const routeSpacingReport = routeSpacing > 0 ? checkRouteSpacing({
      rects,
      routes: checkedRoutes,
      routeSpacing,
      borderClearance,
      channels,
      barriers: auditBarriers
    }) : void 0;
    if (routeSpacingReport !== void 0) {
      for (const conflict of routeSpacingReport.conflicts) {
        warnings.push({
          severity: "info",
          code: conflict.kind === "channel-capacity-exceeded" ? "channel-capacity-exceeded" : "route-spacing-conflict",
          refs: conflict.routes,
          message: conflict.message,
          details: {
            kind: conflict.kind,
            actual: conflict.actual,
            required: conflict.required,
            ...conflict.entity === void 0 ? {} : { entity: conflict.entity },
            ...conflict.channelId === void 0 ? {} : { channelId: conflict.channelId }
          }
        });
      }
    }
    const placedView = buildMeasuredView(document, filteredGraph, rects, finalDocks, retryRoutes, options, foldMetadata, drawnEdges, r7Routing && sourceView !== void 0 && sourceView.presentation.diagram?.contractPin === void 0 && isPresentationContractV2Pin(presentation.contractPin));
    const bounds = unionOf(rects, retryRoutes, new Map([
      ...labelBoxes,
      ...Object.entries(marks.badges).map(([id, box]) => [id, box]),
      ...Object.entries(marks.arrows).flatMap(([id, arrows]) => arrows.map((arrow, i) => [id + String(i), arrow.box])),
      ...freeCellLegendRect === void 0 ? [] : [["__free_cell_legend__", freeCellLegendRect]]
    ]));
    const width = bounds.width;
    const zoom = bounds.empty ? 1 : Math.min(1, Math.max(MIN_ZOOM, options.targetWidth / width));
    const camera = bounds.empty ? { x: 0, y: 0 } : { x: bounds.xmin, y: bounds.ymin };
    const view = {
      ...placedView,
      presentation: {
        ...placedView.presentation,
        camera: { x: clean4(camera.x), y: clean4(camera.y), zoom }
      }
    };
    const measurements = {
      headers: [...headers.values()].sort((left, right) => byString4(left.occurrence, right.occurrence)),
      slots: [...slots].sort((left, right) => byString4(left.occurrence, right.occurrence) || byString4(left.role, right.role)),
      overflows: [...overflows].sort((left, right) => byString4(left.occurrence, right.occurrence) || byString4(left.slot, right.slot))
    };
    let linkLegend;
    if (hints.composition !== void 0 && effectiveLegendAnchor !== "none" && stateMeasuredLegend !== void 0) {
      if (effectiveLegendAnchor === "free-cell" && freeCellLegendRect !== void 0) {
        linkLegend = placeSceneLinkLegend(stateMeasuredLegend, "free-cell", freeCellLegendRect, freeCellLegendRect);
      } else {
        const paddedBoxes = /* @__PURE__ */ new Map();
        for (const [id, box] of labelBoxes) {
          paddedBoxes.set(id, {
            x: box.x - metrics.labelMargin,
            y: box.y - metrics.labelMargin,
            width: box.width + 2 * metrics.labelMargin,
            height: box.height + 2 * metrics.labelMargin
          });
        }
        for (const [id, box] of Object.entries(marks.badges))
          paddedBoxes.set(id, box);
        for (const [id, arrows] of Object.entries(marks.arrows)) {
          arrows.forEach((arrow, i) => paddedBoxes.set(id + String(i), arrow.box));
        }
        const legendUnion = unionOf(rects, retryRoutes, paddedBoxes);
        if (!legendUnion.empty) {
          const contentBounds = {
            x: legendUnion.xmin,
            y: legendUnion.ymin,
            width: legendUnion.width,
            height: legendUnion.height
          };
          linkLegend = placeSceneLinkLegend(stateMeasuredLegend, effectiveLegendAnchor === "free-cell" ? "right" : effectiveLegendAnchor, contentBounds);
        }
      }
    }
    let compositionReport;
    if (composition !== void 0) {
      const sortedGridReports = Object.fromEntries(Object.entries(composedGridReports).sort(([left], [right]) => byString4(left, right)));
      const packedLevelsForAudit = [];
      for (const [key, packed] of [...packedRuns].sort(([left], [right]) => byString4(left, right))) {
        const boxes = seatedBoxes.get(key);
        if (boxes === void 0 || boxes.length < 2)
          continue;
        const shelves = packed.shelves.map((shelf) => shelf.map((slot) => {
          const item = packed.run.items[slot];
          const rect = boxes[slot];
          if (item === void 0 || !("entity" in item) || rect === void 0)
            return void 0;
          return { entity: item.entity, rect };
        }).filter((entry) => entry !== void 0)).filter((shelf) => shelf.length > 0);
        if (shelves.length > 0) {
          packedLevelsForAudit.push({ scope: key, rows: packed.rows, shelves });
        }
      }
      const paintedGaps = auditSiblingZonePaintedGaps({
        gridReports: sortedGridReports,
        packedLevels: packedLevelsForAudit,
        isContainer: entityIsContainer,
        zoneGutter
      });
      if (nominalPlan?.aspectUnreached !== void 0 && collapsedOccurrences.size === 0) {
        warnings.push({
          severity: "info",
          code: "aspect-unreached",
          refs: [],
          message: `target 16:9 aspect ratio was not reached within the slack cap (achieved ${nominalPlan.aspectUnreached.achieved.toFixed(3)})`,
          details: {
            achieved: nominalPlan.aspectUnreached.achieved,
            target: nominalPlan.aspectUnreached.target
          }
        });
      }
      if (planCtx?.mode === "nominal-plan" && planCtx.capture !== void 0) {
        const paintedExtras = new Map([
          ...labelBoxes,
          ...Object.entries(marks.badges).map(([id, box]) => [id, box]),
          ...Object.entries(marks.arrows).flatMap(([id, arrows]) => arrows.map((arrow, i) => [id + String(i), arrow.box])),
          ...linkLegend === void 0 ? [] : [["__link_legend__", linkLegend.rect]]
        ]);
        const painted = unionOf(rects, retryRoutes, paintedExtras);
        planCtx.capture.paintedBounds = { width: painted.width, height: painted.height };
      }
      compositionReport = {
        grids: sortedGridReports,
        ...nominalPlan === void 0 ? {} : { planDigest: nominalPlan.planDigest },
        ...nominalPlan?.nominalAspect === void 0 ? {} : {
          nominalAspect: nominalPlan.nominalAspect,
          tau: nominalPlan.tau,
          sigmaCols: nominalPlan.sigmaCols,
          sigmaBands: nominalPlan.sigmaBands,
          ...nominalPlan.postRouteCorrectionRounds === void 0 ? {} : { postRouteCorrectionRounds: nominalPlan.postRouteCorrectionRounds }
        },
        paintedGapsAboveToken: paintedGaps.aboveToken,
        ...combPlan !== void 0 && combPlan.fallbacks.length > 0 ? { combFallbacks: combPlan.fallbacks } : {}
      };
    }
    const result = {
      status: "laid-out",
      ...hasFlows ? { badgeBoxes: marks.badges, arrowBoxes: marks.arrows, flowBundles: flowPlan.bundles, flowTargets: marks.targets, flowRepairPasses: 0 } : {},
      view,
      fit: {
        direction: "top-to-bottom",
        width,
        height: bounds.height,
        zoom,
        pans: width * zoom > options.targetWidth,
        phone: options.targetWidth <= PHONE_MAX_WIDTH
      },
      warnings,
      measurements,
      orientations: Object.fromEntries([...orientationRecord].sort(([left], [right]) => byString4(left, right))),
      channels,
      ...routeSpacingReport === void 0 ? {} : { routeSpacing: routeSpacingReport },
      labelBoxes: Object.fromEntries([...labelBoxes].sort(([left], [right]) => byString4(left, right)).map(([id, box]) => [id, { x: clean4(box.x), y: clean4(box.y), width: box.width, height: box.height }])),
      ...Object.keys(edgeBundles).length === 0 ? {} : { edgeBundles },
      ...composition === void 0 ? {} : {
        legendResolved: true,
        ...linkLegend === void 0 ? {} : { linkLegend },
        ...compositionReport === void 0 ? {} : { composition: compositionReport },
        ...combPlan !== void 0 && combPlan.groups.length > 0 ? { combGroups: combPlan.groups } : {}
      }
    };
    return { result, chosen, requested, unused, unplaced: unplaced.length };
  };
  const first = runPass(void 0);
  const frozen = first.chosen;
  const widen = /* @__PURE__ */ new Map();
  const external = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Map();
  let outcome = first;
  let previous;
  for (let round = 0; round < 24 && (outcome.requested.size > 0 || outcome.unused.length > 0); round += 1) {
    const signature = JSON.stringify(outcome.result.status === "laid-out" ? outcome.result.channels?.map((channel) => [channel.id, channel.gap, channel.n, channel.labelled]) : []);
    const repeated = seen.get(signature);
    if (repeated !== void 0 && outcome.result.status === "laid-out") {
      const current = outcome.result.channels ?? [];
      for (const edge of drawnEdges) {
        if (sharedContainerOf(edge.source.entity, edge.target.entity) !== void 0)
          continue;
        const id = edge.occurrence;
        if (!edgeLayouts.has(id))
          continue;
        const memberships = previous?.result.status === "laid-out" ? (previous.result.channels ?? []).filter((channel) => channel.edges.includes(id)).map((channel) => channel.id) : [];
        const now = current.filter((channel) => channel.edges.includes(id)).map((channel) => channel.id);
        const oldBox = previous?.result.status === "laid-out" ? previous.result.labelBoxes?.[id] : void 0;
        const newBox = outcome.result.labelBoxes?.[id];
        const oldLabels = previous?.result.status === "laid-out" && oldBox !== void 0 ? (previous.result.channels ?? []).filter((channel) => channel.strips.some((strip) => rectsIntersect(strip, oldBox))).map((channel) => channel.id) : [];
        const newLabels = newBox === void 0 ? [] : current.filter((channel) => channel.strips.some((strip) => rectsIntersect(strip, newBox))).map((channel) => channel.id);
        if (JSON.stringify(memberships) !== JSON.stringify(now) || JSON.stringify(oldLabels) !== JSON.stringify(newLabels))
          external.add(id);
      }
      seen.clear();
    }
    seen.set(signature, outcome);
    for (const id of outcome.unused)
      widen.delete(id);
    for (const [id, gap] of outcome.requested)
      widen.set(id, gap);
    previous = outcome;
    outcome = runPass({ frozen, widen, external });
  }
  if (planCtx?.mode === "nominal-plan" && planCtx.capture !== void 0) {
    for (const [id, gap] of [...widen].sort(([left], [right]) => byString4(left, right))) {
      if (!id.startsWith(`${ROOT_LEVEL_KEY}|`)) {
        planCtx.capture.innerWiden[id] = gap;
      }
    }
  }
  if (composition === void 0 && routeSpacing > 0 && filteredGraph.nodes.size <= 25 && outcome.result.status === "laid-out" && (outcome.result.routeSpacing?.conflictCount ?? 0) > 0) {
    const candidateKeys = /* @__PURE__ */ new Set();
    for (const conflict of outcome.result.routeSpacing.conflicts) {
      if (conflict.kind !== "channel-capacity-exceeded" || conflict.channelId === void 0)
        continue;
      const key = conflict.channelId.split("|")[0];
      if (key !== void 0 && outcome.result.orientations?.[key] !== void 0) {
        candidateKeys.add(key);
      }
    }
    const metricOf = (pass) => {
      if (pass.result.status !== "laid-out")
        return [Infinity, Infinity, Infinity];
      const obs = pass.result.warnings.filter((w) => w.code === "route-obstructed").length;
      const cc = pass.result.routeSpacing?.conflictCount ?? 0;
      return [obs, cc, pass.unplaced];
    };
    let bestMetric = metricOf(outcome);
    const maxFlipCandidates = 2;
    for (const key of [...candidateKeys].sort(byString4).slice(0, maxFlipCandidates)) {
      if (bestMetric[0] === 0 && bestMetric[1] === 0)
        break;
      const currentOrient = outcome.result.status === "laid-out" ? outcome.result.orientations?.[key] : void 0;
      if (currentOrient === void 0)
        continue;
      const flipped = currentOrient === "rows" ? "columns" : "rows";
      const overrides = /* @__PURE__ */ new Map([[key, flipped]]);
      const candidate = runPass(void 0, overrides);
      const candMetric = metricOf(candidate);
      if (candMetric[0] === 0 && candMetric[1] === 0) {
        outcome = candidate;
        bestMetric = candMetric;
      }
    }
  }
  if (outcome.result.status === "laid-out" && outcome.requested.size > 0)
    return {
      ...outcome.result,
      warnings: [...outcome.result.warnings, {
        code: "channel-unresolved",
        refs: [...outcome.requested.keys()],
        message: "Channel demands did not settle within the bounded routing pass"
      }]
    };
  return outcome.result;
}
function unionOf(rects, routes, labels) {
  let empty = true;
  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;
  const extend = (x, y) => {
    empty = false;
    if (x < xmin)
      xmin = x;
    if (x > xmax)
      xmax = x;
    if (y < ymin)
      ymin = y;
    if (y > ymax)
      ymax = y;
  };
  for (const rect of rects.values()) {
    extend(rect.x, rect.y);
    extend(rect.x + rect.width, rect.y + rect.height);
  }
  for (const route of routes.values())
    for (const point of route)
      extend(point.x, point.y);
  for (const box of labels.values()) {
    extend(box.x, box.y);
    extend(box.x + box.width, box.y + box.height);
  }
  if (empty)
    return { empty: true, xmin: 0, ymin: 0, width: 0, height: 0 };
  return { empty: false, xmin, ymin, width: xmax - xmin, height: ymax - ymin };
}
function buildMeasuredView(document, graph, rects, docks, routes, options, foldMetadata, drawnEdges, persistUnpinnedDashes) {
  const projected = foldMetadata.projected;
  const maxContainerDepth = Math.max(-1, ...[...graph.nodes.values()].filter((node) => node.kind === "container").map((node) => node.depth));
  const entityOccurrences = {};
  for (const occurrence of Object.values(projected.entityOccurrences).sort((left, right) => byString4(left.id, right.id))) {
    const rect = rects.get(occurrence.entity);
    const node = graph.nodes.get(occurrence.entity);
    if (rect !== void 0 && node !== void 0) {
      entityOccurrences[occurrence.id] = {
        ...occurrence,
        geometry: { x: clean4(rect.x), y: clean4(rect.y), width: clean4(rect.width), height: clean4(rect.height) },
        z: node.kind === "container" ? node.depth - (maxContainerDepth + 1) : 0
      };
    } else {
      entityOccurrences[occurrence.id] = { ...occurrence };
    }
  }
  const portOccurrences = {};
  for (const occurrence of Object.values(projected.portOccurrences)) {
    portOccurrences[occurrence.id] = { ...occurrence };
  }
  const relationOccurrences = {};
  for (const occurrence of Object.values(projected.relationOccurrences).sort((left, right) => byString4(left.id, right.id))) {
    const style = relationPresentationFor(options.presentation?.relations, occurrence.id, occurrence.relation);
    const authoredStroke = style?.strokeStyle !== void 0 || persistUnpinnedDashes && occurrence.strokeStyle === "dashed";
    const arrowhead = style?.arrowhead ?? (authoredStroke ? "arrow" : void 0);
    const styledOccurrence = {
      ...occurrence,
      ...occurrence.strokeStyle === void 0 && style?.strokeStyle !== void 0 ? { strokeStyle: style.strokeStyle } : {},
      ...occurrence.arrowhead === void 0 && arrowhead !== void 0 ? { arrowhead } : {},
      ...occurrence.emphasis === void 0 && style?.emphasis !== void 0 ? { emphasis: style.emphasis } : {}
    };
    const occurrenceId = occurrence.id;
    const pair3 = docks.get(occurrenceId);
    const route = routes.get(occurrenceId);
    if (pair3 !== void 0 && route !== void 0) {
      const waypoints = route.slice(pair3.source.port === void 0 ? 0 : 1, pair3.target.port === void 0 ? route.length : route.length - 1).map((point) => ({ x: clean4(point.x), y: clean4(point.y) }));
      relationOccurrences[occurrence.id] = { ...styledOccurrence, waypoints };
    } else {
      const { waypoints: _oldRoute, ...retained } = styledOccurrence;
      relationOccurrences[occurrence.id] = document.relations[occurrence.relation]?.type === "flow-step" ? retained : { ...styledOccurrence };
    }
  }
  const portClaims = /* @__PURE__ */ new Map();
  for (const edge of [...drawnEdges].sort((left, right) => byString4(left.occurrence, right.occurrence))) {
    const pair3 = docks.get(edge.occurrence);
    if (pair3 === void 0)
      continue;
    const occurrence = projected.relationOccurrences[edge.occurrence];
    if (occurrence === void 0)
      continue;
    for (const [dock, role3] of [
      [pair3.source, "source"],
      [pair3.target, "target"]
    ]) {
      if (dock.port === void 0)
        continue;
      const endpoint = occurrence.endpoints.find((candidate) => candidate.role === role3);
      if (endpoint === void 0 || projected.portOccurrences[endpoint.occurrence] === void 0)
        continue;
      const claims = portClaims.get(endpoint.occurrence) ?? [];
      claims.push({ edge: edge.occurrence, role: role3, dock });
      portClaims.set(endpoint.occurrence, claims);
    }
  }
  for (const [id, claims] of [...portClaims].sort(([left], [right]) => byString4(left, right))) {
    const winner = [...claims].sort((left, right) => byString4(left.edge, right.edge) || byString4(left.role, right.role))[0];
    const existing = portOccurrences[id];
    portOccurrences[id] = {
      ...existing,
      side: winner.dock.side,
      order: winner.dock.order,
      anchor: clean4(winner.dock.anchor)
    };
  }
  const summaryLabels = foldMetadata.summaryLabels === void 0 ? void 0 : Object.fromEntries(Object.entries(foldMetadata.summaryLabels).filter(([, definition]) => entityOccurrences[definition.sourceOccurrence] !== void 0 && entityOccurrences[definition.targetOccurrence] !== void 0));
  return {
    viewId: options.viewId ?? viewRef("layout"),
    semanticDocumentId: document.documentId,
    revision: document.revision,
    entityOccurrences,
    relationOccurrences,
    portOccurrences,
    groups: foldMetadata.groups,
    filters: [...foldMetadata.filters],
    presentation: foldMetadata.presentationState,
    ...summaryLabels === void 0 || Object.keys(summaryLabels).length === 0 ? {} : { summaryLabels }
  };
}
function layoutFolded(document, sourceView, options) {
  if (sourceView.semanticDocumentId !== document.documentId) {
    return {
      status: "refused",
      refusals: [{ code: "document-invalid", path: "sourceView", message: "the source view draws another document" }],
      diagnostics: []
    };
  }
  return layoutMeasured(document, options, sourceView);
}
function readMeasuredGraph(document, registry) {
  const refusals = [];
  const resolver = createTypeResolver(document);
  const kinds = /* @__PURE__ */ new Map();
  for (const key of Object.keys(document.entities).sort(byString4)) {
    const entity = document.entities[key];
    if (entity.type === "flow-scenario")
      continue;
    const profile = registry.get(entity.profile);
    if (profile === void 0) {
      refusals.push({
        code: "entity-profile-unsupported",
        path: `entities.${key}.profile`,
        message: `the layout engine lays out generic@1 and generic@2 entities; ${entity.id} is ${entity.profile}`,
        refs: [entity.id]
      });
      continue;
    }
    if (entity.profile !== "generic@1" && entity.profile !== "generic@2") {
      refusals.push({
        code: "entity-profile-unsupported",
        path: `entities.${key}.profile`,
        message: `the layout engine lays out generic@1 and generic@2 entities; ${entity.id} is ${entity.profile}`,
        refs: [entity.id]
      });
      continue;
    }
    const resolution = resolver.resolve(profile, entity.type);
    if (!resolution.ok) {
      refusals.push({
        code: "entity-type-unsupported",
        path: `entities.${key}.type`,
        message: `the layout engine lays out node, container, legend and legend-key entities; ${entity.id} is ${entity.type}`,
        refs: [entity.id]
      });
      continue;
    }
    const family = resolution.resolved.familyType;
    const allowed = entity.profile === "generic@1" ? ["node", "container"] : ["node", "container", "legend", "legend-key"];
    if (!allowed.includes(family)) {
      refusals.push({
        code: "entity-type-unsupported",
        path: `entities.${key}.type`,
        message: `the layout engine lays out node, container, legend and legend-key entities; ${entity.id} is ${entity.type}`,
        refs: [entity.id]
      });
      continue;
    }
    const isContainer = entity.profile === "generic@1" ? family === "container" : resolution.resolved.container === true;
    kinds.set(entity.id, isContainer ? "container" : "node");
  }
  const parentOf = /* @__PURE__ */ new Map();
  const edges = [];
  for (const key of Object.keys(document.relations).sort(byString4)) {
    const relation = document.relations[key];
    const owner = registry.get(relation.profile);
    const baseType = owner === void 0 ? relation.type : relationBaseType(document, owner, relation);
    if (relation.profile !== "generic@1" && relation.profile !== "generic@2" || baseType !== "contains" && baseType !== "link") {
      if (baseType === "contains" || baseType === "link") {
        refusals.push({
          code: "entity-profile-unsupported",
          path: `relations.${key}.profile`,
          message: `the layout engine lays out generic@1 and generic@2 relations; ${relation.id} is ${relation.profile} ${relation.type}`,
          refs: [relation.id]
        });
      } else {
        refusals.push({
          code: "relation-type-unsupported",
          path: `relations.${key}.type`,
          message: `the layout engine lays out link and contains relations; ${relation.id} is ${relation.profile} ${relation.type}`,
          refs: [relation.id]
        });
      }
      continue;
    }
    const role3 = (name) => relation.endpoints.find((endpoint) => endpoint.role === name)?.target;
    if (baseType === "contains") {
      const parent = role3("parent");
      const child = role3("child");
      if (parent !== void 0 && child !== void 0)
        parentOf.set(child, parent);
      continue;
    }
    const end = (name) => {
      const target2 = role3(name);
      if (target2 === void 0)
        return void 0;
      if (target2.startsWith("port:")) {
        const port = document.ports[target2];
        return port === void 0 ? void 0 : { entity: port.owner, port: port.id };
      }
      return { entity: target2 };
    };
    const source = end("source");
    const target = end("target");
    if (source === void 0 || target === void 0)
      continue;
    const labelAttr = relation.attributes?.["label"];
    const label = labelAttr !== void 0 && labelAttr.kind === "text" && typeof labelAttr.value === "string" && labelAttr.value !== "" ? labelAttr.value : void 0;
    edges.push({ id: relation.id, source, target, ...label === void 0 ? {} : { label } });
  }
  if (refusals.length > 0)
    return { refusals };
  const children = /* @__PURE__ */ new Map();
  for (const id of kinds.keys())
    children.set(id, []);
  for (const [child, parent] of parentOf)
    children.get(parent)?.push(child);
  const depthOf = (id) => {
    let depth = 0;
    for (let cursor = parentOf.get(id); cursor !== void 0; cursor = parentOf.get(cursor))
      depth += 1;
    return depth;
  };
  const nodes = /* @__PURE__ */ new Map();
  for (const id of [...kinds.keys()].sort(byString4)) {
    const labelAttr = document.entities[id]?.attributes?.["name"];
    const label = labelAttr !== void 0 && labelAttr.kind === "text" && typeof labelAttr.value === "string" ? labelAttr.value : "";
    nodes.set(id, {
      id,
      kind: kinds.get(id),
      label,
      parent: parentOf.get(id),
      children: [...children.get(id) ?? []].sort(byString4),
      depth: depthOf(id)
    });
  }
  const roots = [...nodes.values()].filter((node) => node.parent === void 0).map((node) => node.id);
  return { graph: { nodes, roots, edges } };
}
function groupsForLevel(members, hints) {
  const set = new Set(members);
  if (set.size === 0)
    return void 0;
  const groups = (hints.grouping ?? []).filter((group) => {
    const leaves = groupLeaves(group);
    return leaves.length > 0 && leaves.every((leaf) => set.has(leaf));
  });
  if (groups.length === 0)
    return void 0;
  const grouped = /* @__PURE__ */ new Set();
  for (const group of groups)
    for (const leaf of groupLeaves(group))
      grouped.add(leaf);
  const rest = members.filter((member) => !grouped.has(member));
  return [...groups.map((group) => ({ group, members: groupLeaves(group) })), ...rest.length > 0 ? [{ members: rest }] : []];
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/connectorPath.js
var DEFAULT_EDGE_CORNER_RADIUS = 12;
var EPSILON = 1e-6;
function formatCoord(value) {
  const cleaned = Number(value.toPrecision(12));
  return String(cleaned === 0 ? 0 : cleaned);
}
function simplifyElbowPoints(points) {
  if (points.length <= 1)
    return points.map((p) => ({ x: p.x, y: p.y }));
  const dedup = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const prev = dedup[dedup.length - 1];
    if (Math.hypot(point.x - prev.x, point.y - prev.y) > EPSILON) {
      dedup.push({ x: point.x, y: point.y });
    }
  }
  if (dedup.length === 1) {
    const last = points[points.length - 1];
    dedup.push({ x: last.x, y: last.y });
    return dedup;
  }
  const end = points[points.length - 1];
  dedup[dedup.length - 1] = { x: end.x, y: end.y };
  if (dedup.length <= 2)
    return dedup;
  const simplified = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const curr = dedup[i];
    const next = dedup[i + 1];
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 <= EPSILON || len2 <= EPSILON)
      continue;
    const cross = (dx1 * dy2 - dy1 * dx2) / (len1 * len2);
    const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    if (Math.abs(cross) <= EPSILON && dot > 0)
      continue;
    simplified.push(curr);
  }
  simplified.push(dedup[dedup.length - 1]);
  return simplified;
}
function connectorPath(points, cornerRadius = DEFAULT_EDGE_CORNER_RADIUS) {
  if (points.length < 2)
    return "";
  const simplified = simplifyElbowPoints(points);
  const safeRadius = Number.isFinite(cornerRadius) && cornerRadius > 0 ? cornerRadius : 0;
  const start = simplified[0];
  const parts = [`M${formatCoord(start.x)} ${formatCoord(start.y)}`];
  let cursorX = start.x;
  let cursorY = start.y;
  for (let i = 1; i < simplified.length - 1; i += 1) {
    const prev = simplified[i - 1];
    const corner = simplified[i];
    const next = simplified[i + 1];
    const inX = corner.x - prev.x;
    const inY = corner.y - prev.y;
    const outX = next.x - corner.x;
    const outY = next.y - corner.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    const r = Math.min(safeRadius, inLen / 2, outLen / 2);
    const cross = inLen > EPSILON && outLen > EPSILON ? (inX * outY - inY * outX) / (inLen * outLen) : 0;
    if (r <= EPSILON || Math.abs(cross) <= EPSILON) {
      parts.push(`L${formatCoord(corner.x)} ${formatCoord(corner.y)}`);
      cursorX = corner.x;
      cursorY = corner.y;
      continue;
    }
    const enterX = corner.x - inX / inLen * r;
    const enterY = corner.y - inY / inLen * r;
    const exitX = corner.x + outX / outLen * r;
    const exitY = corner.y + outY / outLen * r;
    if (Math.hypot(enterX - cursorX, enterY - cursorY) > EPSILON) {
      parts.push(`L${formatCoord(enterX)} ${formatCoord(enterY)}`);
    }
    parts.push(`Q${formatCoord(corner.x)} ${formatCoord(corner.y)} ${formatCoord(exitX)} ${formatCoord(exitY)}`);
    cursorX = exitX;
    cursorY = exitY;
  }
  const end = simplified[simplified.length - 1];
  parts.push(`L${formatCoord(end.x)} ${formatCoord(end.y)}`);
  return parts.join(" ");
}
function connectorCornerBounds(points, cornerRadius = DEFAULT_EDGE_CORNER_RADIUS) {
  if (points.length < 3 || !Number.isFinite(cornerRadius) || cornerRadius <= 0)
    return [];
  const simplified = simplifyElbowPoints(points);
  const boxes = [];
  for (let i = 1; i < simplified.length - 1; i += 1) {
    const prev = simplified[i - 1];
    const corner = simplified[i];
    const next = simplified[i + 1];
    const inX = corner.x - prev.x;
    const inY = corner.y - prev.y;
    const outX = next.x - corner.x;
    const outY = next.y - corner.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    const r = Math.min(cornerRadius, inLen / 2, outLen / 2);
    const cross = inLen > EPSILON && outLen > EPSILON ? (inX * outY - inY * outX) / (inLen * outLen) : 0;
    if (r <= EPSILON || Math.abs(cross) <= EPSILON)
      continue;
    const enterX = corner.x - inX / inLen * r;
    const enterY = corner.y - inY / inLen * r;
    const exitX = corner.x + outX / outLen * r;
    const exitY = corner.y + outY / outLen * r;
    const midX = 0.25 * enterX + 0.5 * corner.x + 0.25 * exitX;
    const midY = 0.25 * enterY + 0.5 * corner.y + 0.25 * exitY;
    boxes.push({
      x: Math.min(enterX, midX),
      y: Math.min(enterY, midY),
      width: Math.abs(enterX - midX),
      height: Math.abs(enterY - midY)
    }, {
      x: Math.min(midX, exitX),
      y: Math.min(midY, exitY),
      width: Math.abs(midX - exitX),
      height: Math.abs(midY - exitY)
    });
  }
  return boxes;
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/sceneLabelClearance.js
function clearSceneLabels(labels, routes, shapes, clearance, cornerRadius = 0, routeExtraMargins) {
  const bounds = shapes.map(normaliseRect);
  for (let r = 0; r < routes.length; r++) {
    const route = routes[r];
    const extra = Math.max(0, routeExtraMargins?.[r] ?? 0);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      bounds.push({
        x: Math.min(a.x, b.x) - extra,
        y: Math.min(a.y, b.y) - extra,
        width: Math.abs(a.x - b.x) + 2 * extra,
        height: Math.abs(a.y - b.y) + 2 * extra
      });
    }
    if (cornerRadius > 0) {
      for (const bend of connectorCornerBounds(route, cornerRadius)) {
        bounds.push(extra > 0 ? { x: bend.x - extra, y: bend.y - extra, width: bend.width + 2 * extra, height: bend.height + 2 * extra } : bend);
      }
    }
  }
  return labels.map((label) => {
    const { box } = label;
    const padded = (x, y) => ({ x: x - clearance, y: y - clearance, width: box.width + 2 * clearance, height: box.height + 2 * clearance });
    const candidates = [{ x: box.x, y: box.y, cost: 0 }];
    const compare = (a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x;
    const visited = /* @__PURE__ */ new Set([`${box.x},${box.y}`]);
    const add = (x, y) => {
      const key = `${x},${y}`;
      if (visited.has(key))
        return;
      visited.add(key);
      const candidate = { x, y, cost: Math.abs(x - box.x) + Math.abs(y - box.y) };
      let index = candidates.length;
      candidates.push(candidate);
      while (index > 0) {
        const parent = index - 1 >> 1;
        if (compare(candidates[parent], candidate) <= 0)
          break;
        candidates[index] = candidates[parent];
        index = parent;
      }
      candidates[index] = candidate;
    };
    while (candidates.length > 0) {
      const choice = candidates[0];
      const last = candidates.pop();
      if (candidates.length > 0) {
        let index = 0;
        while (2 * index + 1 < candidates.length) {
          let child = 2 * index + 1;
          if (child + 1 < candidates.length && compare(candidates[child + 1], candidates[child]) < 0)
            child++;
          if (compare(last, candidates[child]) <= 0)
            break;
          candidates[index] = candidates[child];
          index = child;
        }
        candidates[index] = last;
      }
      const area = normaliseRect(padded(choice.x, choice.y));
      const right = area.x + area.width, bottom = area.y + area.height;
      const hitIndex = bounds.findIndex((obstacle) => area.x < obstacle.x + obstacle.width && obstacle.x < right && area.y < obstacle.y + obstacle.height && obstacle.y < bottom);
      const hit = bounds[hitIndex];
      if (hit === void 0) {
        const placed = { ...box, x: choice.x, y: choice.y };
        bounds.push(normaliseRect(placed));
        if (choice.cost === 0)
          return label;
        const anchor = label.leader?.at(-2);
        const leader = anchor === void 0 ? void 0 : [
          ...label.leader.slice(0, -1),
          {
            x: Math.max(placed.x, Math.min(anchor.x, placed.x + placed.width)),
            y: Math.max(placed.y, Math.min(anchor.y, placed.y + placed.height))
          }
        ];
        return { ...label, box: placed, ...leader === void 0 ? {} : { leader } };
      }
      add(hit.x - clearance - box.width, choice.y);
      add(hit.x + hit.width + clearance, choice.y);
      add(choice.x, hit.y - clearance - box.height);
      add(choice.x, hit.y + hit.height + clearance);
    }
    return label;
  });
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/diagramSceneModel.js
var DEFAULT_SCENE_TARGET_WIDTH = 1440;
var EDGE_LABEL_ALLOCATION = 400;
function sceneContentSize(result) {
  return result?.status === "laid-out" ? { width: result.fit.width, height: result.fit.height } : { width: 0, height: 0 };
}
var ROLE_ICONS = { card: "base", zone: "cluster", store: "db", actor: "user", api: "api", runtime: "server" };
function resolveScenePresentation(document, presentation, bindings = {}, strict = true, view, resolveGlyph = getDiagramGlyph, options = {}) {
  const missing = [];
  const withViewAnatomy = (id, entry) => {
    const anatomy = diagramAnatomyOf(presentation, view, id);
    const resolved = entry.anatomy === void 0 && anatomy === "v2" ? { ...entry, anatomy } : entry;
    if (resolved.anatomy !== "v2" && resolved.align === "center") {
      const { align: _ignored, ...rest } = resolved;
      return rest;
    }
    return resolved;
  };
  const entities = Object.fromEntries(Object.entries(presentation.entities).map(([id, entry]) => {
    if (entry.form !== "card" && entry.form !== "container" && entry.form !== "legend")
      return [id, withViewAnatomy(id, entry)];
    const entityId = view?.entityOccurrences[id]?.entity ?? id.replace(/^occurrence:e\./, "entity:");
    const entity = document.entities[entityId];
    if (entity?.profile === "erd@1" || entity?.profile === "process@1")
      return [id, withViewAnatomy(id, entry)];
    const binding = bindings[entity === void 0 ? "" : entity.profile + ":" + entity.type] ?? bindings[entity?.type ?? ""];
    if (binding?.shape !== void 0 && binding.shape !== "component")
      return [id, withViewAnatomy(id, { ...entry, icon: entry.icon ?? "none" })];
    const role3 = binding?.role ?? (entry.form === "card" ? "card" : "zone");
    const icon = entry.icon ?? binding?.icon ?? ROLE_ICONS[role3];
    if (icon === "none")
      return [id, withViewAnatomy(id, { ...entry, icon: "none" })];
    if (icon === void 0 || resolveGlyph(icon) === void 0) {
      missing.push(id);
      return [id, withViewAnatomy(id, { ...entry, icon: strict ? "unknown" : "none" })];
    }
    return [id, withViewAnatomy(id, { ...entry, icon })];
  }));
  const startParity = options.depthParityStart ?? 0;
  const hasViewGroups = view !== void 0 && Object.keys(view.groups).length > 0;
  const semanticParentOf = /* @__PURE__ */ new Map();
  if (!hasViewGroups && document.relations !== void 0) {
    for (const relation of Object.values(document.relations)) {
      const baseType = document.typeDefinitions?.[relation.type]?.baseType ?? relation.type;
      if (baseType !== "contains")
        continue;
      const parent = relation.endpoints.find((endpoint) => endpoint.role === "parent")?.target;
      const child = relation.endpoints.find((endpoint) => endpoint.role === "child")?.target;
      if (parent !== void 0 && child !== void 0)
        semanticParentOf.set(child, parent);
    }
  }
  const depthOf = (id) => {
    let depth = 0;
    const seen = /* @__PURE__ */ new Set();
    if (hasViewGroups) {
      for (let parent = parentOccurrenceOf(view, id); parent !== void 0 && !seen.has(parent); parent = parentOccurrenceOf(view, parent)) {
        seen.add(parent);
        depth += 1;
      }
      return depth;
    }
    const entityId = view?.entityOccurrences[id]?.entity ?? id.replace(/^occurrence:e\./, "entity:");
    for (let parent = semanticParentOf.get(entityId); parent !== void 0 && !seen.has(parent); parent = semanticParentOf.get(parent)) {
      seen.add(parent);
      depth += 1;
    }
    return depth;
  };
  const stamped = Object.fromEntries(Object.entries(entities).map(([id, entry]) => {
    const zone = entry;
    if (zone.form !== "container" && zone.form !== "legend")
      return [id, entry];
    const depth = zone.depth === void 0 ? depthOf(id) : void 0;
    const needsParity = zone.depthParityStart === void 0 && startParity !== 0;
    if ((depth === void 0 || depth === 0) && !needsParity)
      return [id, entry];
    return [id, {
      ...entry,
      ...depth === void 0 || depth === 0 ? {} : { depth },
      ...needsParity ? { depthParityStart: startParity } : {}
    }];
  }));
  return { presentation: { ...presentation, entities: stamped }, missing };
}
function layoutScene2(input) {
  const resolved = resolveScenePresentation(input.document, input.presentation, input.iconBindings, input.strictIcons, input.view, input.resolveGlyph, input.depthParityStart === void 0 ? {} : { depthParityStart: input.depthParityStart });
  const options = {
    registry: input.registry,
    ...input.flows === void 0 ? {} : { flows: input.flows },
    ...input.flowTokens === void 0 ? {} : { flowTokens: input.flowTokens },
    ...input.bindings === void 0 ? {} : { bindings: input.bindings },
    measureText: (text3) => {
      const layout = input.measureLines({
        text: text3,
        role: "body",
        availableWidth: Number.MAX_SAFE_INTEGER,
        allocatedLines: 1,
        folded: false
      });
      return { width: layout.width, height: layout.height };
    },
    presentation: resolved.presentation,
    measureLines: input.measureLines,
    collapsed: input.collapsed,
    ...input.hints === void 0 ? {} : { hints: input.hints },
    ...input.metrics === void 0 ? {} : { metrics: input.metrics },
    rowPack: input.rowPack ?? {},
    targetWidth: input.targetWidth ?? DEFAULT_SCENE_TARGET_WIDTH,
    ...input.previousOrientation === void 0 ? {} : { previousOrientation: input.previousOrientation },
    ...input.reportSurfaceSame === void 0 ? {} : { reportSurfaceSame: input.reportSurfaceSame },
    ...input.conventions === void 0 ? {} : { conventions: input.conventions },
    ...input.hints?.composition !== void 0 && input.legend !== void 0 ? { legend: input.legend } : {},
    ...input.hints?.composition !== void 0 && input.legendTitle !== void 0 ? { legendTitle: input.legendTitle } : {},
    ...input.hints?.composition !== void 0 && input.legendLabels !== void 0 ? { legendLabels: input.legendLabels } : {}
  };
  const result = input.cache !== void 0 ? input.view === void 0 ? input.cache.layout(input.document, options) : input.cache.layoutFolded(input.document, input.view, options) : input.view === void 0 ? layoutMeasured(input.document, options) : layoutFolded(input.document, input.view, options);
  return result.status !== "laid-out" || resolved.missing.length === 0 ? result : { ...result, warnings: [...result.warnings, ...resolved.missing.map((id) => ({ code: "card-icon-missing", refs: [id], message: "No icon resolves for this component; strict mode displays unknown" }))] };
}
function collapsedOccurrencesOf(view) {
  if (view === void 0)
    return [];
  const found = [];
  for (const key of Object.keys(view.groups).sort()) {
    const group = view.groups[key];
    if (group.collapsed === true && group.occurrence !== void 0)
      found.push(group.occurrence);
  }
  return found;
}
function scenePaintPlane(node) {
  if (node.kind === "process" && node.processBox?.kind === "lane")
    return "frame";
  return node.kind === "zone" && !node.collapsed ? "frame" : "box";
}
function sceneNodesOnPlane(nodes, plane) {
  return nodes.filter((node) => scenePaintPlane(node) === plane);
}
var CONNECTOR_MASK_MARGIN = 64;
var CONNECTOR_CUTOUT_SLACK = 3;
function sceneConnectorMask(scene) {
  if (scene.bounds === void 0 || scene.connectorCutouts.length === 0)
    return void 0;
  const { x, y, width, height } = scene.bounds;
  return {
    region: { x: x - CONNECTOR_MASK_MARGIN, y: y - CONNECTOR_MASK_MARGIN, width: width + 2 * CONNECTOR_MASK_MARGIN, height: height + 2 * CONNECTOR_MASK_MARGIN },
    cutouts: scene.connectorCutouts
  };
}
var byCodeUnit3 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function edgeLabelOf2(document, relation) {
  const attributes = document.relations[relation]?.attributes;
  const label = attributes?.["label"];
  return label !== void 0 && label.kind === "text" && typeof label.value === "string" && label.value !== "" ? label.value : void 0;
}
function resolveScene(result, input, viewport) {
  let scene = resolveSceneAtZoom(result, input);
  if (!viewport?.fitToWindow || !scene.r7Connectors)
    return scene;
  const labelSize = input.metrics?.edgeLabelSize ?? DEFAULT_EDGE_LABEL_SIZE;
  let paintZoom = Math.max(LABEL_CLEARANCE_REFERENCE_SCALE, MIN_EDGE_LABEL_CSS_PX / labelSize);
  for (let pass = 0; pass < 4 && scene.bounds !== void 0; pass += 1) {
    const { zoom } = sceneFit({ ...viewport, bounds: scene.bounds });
    if (!(zoom > 0 && zoom < paintZoom))
      break;
    paintZoom = zoom;
    scene = resolveSceneAtZoom(result, input, paintZoom);
  }
  return scene;
}
function resolveSceneAtZoom(result, input, paintZoom) {
  const view = result.view;
  const resolved = resolveScenePresentation(input.document, input.presentation, input.iconBindings, input.strictIcons, view, input.resolveGlyph, input.depthParityStart === void 0 ? {} : { depthParityStart: input.depthParityStart });
  const frame = buildScene({ document: input.document, views: { [view.viewId]: view } }, view.viewId);
  const bundledMembers = new Set(Object.values(result.edgeBundles ?? {}).flatMap((bundle) => bundle.members.slice(1)));
  const items = frame.items.filter((item) => item.kind !== "edge" || !bundledMembers.has(item.occurrence));
  const visibleEdges = new Set(items.filter((item) => item.kind === "edge").map((item) => item.occurrence));
  const collapsed = new Set(collapsedOccurrencesOf(view));
  const rawNodes = sceneNodes(frame);
  const isProcessDoc = input.document.profileRefs.length === 1 && input.document.profileRefs[0] === "process@1";
  const processDirection = result.fit.direction === "top-to-bottom" ? "top-to-bottom" : "left-to-right";
  const processNumbered = isProcessDoc ? parseProcessFlowExtension(input.document)?.numbered ?? true : false;
  const processStepNumbers = isProcessDoc && processNumbered ? computeProcessStepNumbers(input.document, Object.values(input.document.entities).filter((e) => e.type === "step")) : void 0;
  const laneBandIndexByEntity = /* @__PURE__ */ new Map();
  if (isProcessDoc) {
    rawNodes.filter((n) => input.document.entities[n.entity]?.type === "lane").sort((a, b) => (processDirection === "left-to-right" ? a.rect.y - b.rect.y : a.rect.x - b.rect.x) || byCodeUnit3(a.entity, b.entity)).forEach((laneNode, idx) => laneBandIndexByEntity.set(laneNode.entity, idx));
  }
  const nodes = rawNodes.map((node) => {
    const presentation = resolved.presentation.entities[node.occurrence];
    const form = presentation?.form;
    const titled = presentation?.text.title !== void 0 && presentation.text.title !== "";
    const entity = input.document.entities[node.entity];
    const erd2 = entity?.profile === "erd@1";
    const isProcess = entity?.profile === "process@1";
    const kind = erd2 ? "erd" : isProcess ? "process" : form === "legend-key" ? "legend-key" : !titled ? "label" : form === "card" ? "card" : form === "container" || form === "legend" ? "zone" : "label";
    const stepNum = processStepNumbers?.get(node.entity);
    const bandIdx = laneBandIndexByEntity.get(node.entity);
    const processBox = isProcess ? measureProcessBox(input.document, node.entity, {
      width: node.rect.width,
      height: node.rect.height,
      direction: processDirection,
      ...stepNum === void 0 ? {} : { stepNumber: stepNum },
      ...bandIdx === void 0 ? {} : { bandIndex: bandIdx },
      measureLines: input.measureLines
    }) : void 0;
    return {
      occurrence: node.occurrence,
      entity: node.entity,
      kind,
      collapsed: (kind === "zone" || kind === "erd") && collapsed.has(node.occurrence),
      ...erd2 ? { erd: measureErdCard(input.document, node.entity, collapsed.has(node.occurrence), input.measureLines) } : {},
      ...processBox === void 0 ? {} : { processBox },
      rect: node.rect,
      ...presentation === void 0 ? {} : { presentation },
      text: processBox?.title ?? presentation?.text.title ?? presentation?.text.body ?? ""
    };
  });
  const measuredLabels = new Map((result.measurements?.slots ?? []).filter((slot) => slot.role === "edge-label").map((slot) => [slot.occurrence, slot.layout]));
  const headerHeights = new Map((result.measurements?.headers ?? []).map((header) => [header.occurrence, header.height]));
  const blockers = [];
  const connectorCutouts = [];
  const footerWidths = new Map((result.measurements?.slots ?? []).filter((slot) => slot.role === "footer").map((slot) => [slot.occurrence, slot.layout.width]));
  const margin = input.metrics?.labelMargin ?? DEFAULT_LAYOUT_METRICS.labelMargin;
  const erd = input.document.profileRefs.length === 1 && input.document.profileRefs[0] === "erd@1";
  const r7Connectors = !erd && (result.routeSpacing !== void 0 || isR7ConnectorPresentation(input.presentation, input.view ?? view, input.document));
  const processDefaultLabelSize = isProcessDoc ? 12 : void 0;
  const effectiveInputLabelSize = input.metrics?.edgeLabelSize ?? processDefaultLabelSize;
  const edgeLabelMeasure = scaleEdgeLabelMeasurer(input.measureLines, r7Connectors ? effectiveInputLabelSize : void 0, DEFAULT_EDGE_LABEL_SIZE);
  const baseLabelSize = effectiveInputLabelSize ?? DEFAULT_EDGE_LABEL_SIZE;
  const overviewEdgeLabelSize = r7Connectors && paintZoom !== void 0 && baseLabelSize * paintZoom < MIN_EDGE_LABEL_CSS_PX ? Math.ceil(MIN_EDGE_LABEL_CSS_PX / paintZoom * 64) / 64 : void 0;
  const labelScale = overviewEdgeLabelSize === void 0 ? 1 : overviewEdgeLabelSize / baseLabelSize;
  const clearanceZoom = Math.min(LABEL_CLEARANCE_REFERENCE_SCALE, paintZoom ?? LABEL_CLEARANCE_REFERENCE_SCALE);
  const relationPresentation = input.presentation.relations;
  const baseLinkStrokeWidth = r7Connectors ? input.metrics?.linkStrokeWidth ?? DEFAULT_LINK_STROKE_WIDTH : 1.5;
  const paintClearance = margin + baseLinkStrokeWidth / (2 * clearanceZoom);
  const zoneInset = input.metrics?.containerPadding ?? ZONE_GEOMETRY.contentInsetInline;
  const pendingCutouts = [];
  for (const node of nodes) {
    if (node.kind === "process" && node.processBox?.kind === "lane") {
      const header = PROCESS_BOX_GEOMETRY.laneHeaderSize;
      blockers.push(node.processBox.direction === "left-to-right" ? { x: node.rect.x, y: node.rect.y, width: header, height: node.rect.height } : { x: node.rect.x, y: node.rect.y, width: node.rect.width, height: header });
      continue;
    }
    if (node.kind !== "zone" || node.collapsed) {
      blockers.push(node.rect);
      continue;
    }
    const height = headerHeights.get(node.occurrence);
    if (height === void 0)
      continue;
    const zoneGeo = anatomyZoneGeometry(node.presentation?.anatomy);
    const ruleClearance = (zoneGeo.ruleHeight / 2 + 1) / clearanceZoom;
    blockers.push({
      x: node.rect.x,
      y: node.rect.y,
      width: node.rect.width,
      height: zoneGeo.headerInset + height + zoneGeo.ruleHeight / 2 + ruleClearance
    });
    const reserve = node.presentation?.text.footer?.trim() ? lineBoxHeight(zoneGeo.footer.size) + zoneGeo.ruleHeight + 2 * zoneGeo.ruleMargin + zoneGeo.footerBottomInset : 0;
    if (reserve > 0) {
      blockers.push({
        x: node.rect.x,
        y: node.rect.y + node.rect.height - reserve - zoneGeo.borderWidth - ruleClearance,
        width: node.rect.width,
        height: reserve + zoneGeo.borderWidth + ruleClearance
      });
      const inner = Math.max(0, node.rect.width - 2 * zoneInset);
      const lineHeight = lineBoxHeight(zoneGeo.footer.size);
      const bottom = node.rect.y + node.rect.height - zoneGeo.borderWidth - zoneGeo.footerBottomInset;
      pendingCutouts.push({ node, inner, lineHeight, bottom });
    }
  }
  const allFlows = flowIndex(input.document);
  const flowTargets = result.flowTargets ?? {};
  const flows = {
    scenarios: allFlows.scenarios.map((scenario) => ({ ...scenario, steps: scenario.steps.filter((step) => flowTargets[step.relation] !== void 0) })),
    byRelation: Object.fromEntries(Object.entries(allFlows.byRelation).filter(([id]) => flowTargets[id] !== void 0)),
    byEntity: Object.fromEntries(Object.entries(allFlows.byEntity).map(([id, steps]) => [id, steps.filter((step) => flowTargets[step] !== void 0)]))
  };
  const flowAncestors = {};
  for (const node of nodes) {
    const parents = [];
    for (let parent = parentOccurrenceOf(view, node.occurrence); parent !== void 0; parent = parentOccurrenceOf(view, parent))
      parents.push(parent);
    flowAncestors[node.occurrence] = parents;
  }
  const flowRepresentatives = Object.fromEntries(nodes.map((node) => [node.entity, node.occurrence]));
  for (const occurrence of Object.values(view.entityOccurrences).sort((a, b) => byCodeUnit3(a.id, b.id))) {
    const box = representativeOf(view, collapsed, occurrence.id);
    if (flowRepresentatives[occurrence.entity] === void 0 && nodes.some((node) => node.occurrence === box))
      flowRepresentatives[occurrence.entity] = box;
  }
  const flowEnds = {};
  for (const [id, target] of Object.entries(flowTargets)) {
    if (target.kind === "internal") {
      flowEnds[id] = [target.box];
      continue;
    }
    const occurrence = view.relationOccurrences[target.occurrence];
    flowEnds[id] = occurrence?.endpoints.map((end) => view.portOccurrences[end.occurrence]?.ownerOccurrence ?? end.occurrence) ?? [];
  }
  const edges = [];
  const entries = [];
  const labelLines = /* @__PURE__ */ new Map();
  const combSuppressedArrowheads = /* @__PURE__ */ new Set();
  const combCarrierLabels = /* @__PURE__ */ new Map();
  for (const comb of result.combGroups ?? []) {
    if (comb.label !== void 0)
      combCarrierLabels.set(String(comb.carrier), comb.label);
    if (comb.kind === "fan-in") {
      for (const member of comb.members) {
        if (member !== comb.carrier)
          combSuppressedArrowheads.add(String(member));
      }
    }
  }
  for (const id of Object.keys(view.relationOccurrences).sort(byCodeUnit3)) {
    if (!visibleEdges.has(id))
      continue;
    const occurrence = view.relationOccurrences[id];
    if (occurrence.waypoints === void 0 || !visibleEdges.has(id))
      continue;
    const points = relationRoute(view, occurrence.id) ?? [];
    if (points.length < 2)
      continue;
    const flow = flows.byRelation[occurrence.relation];
    const bundle = result.flowBundles?.find((entry) => entry.carrier === occurrence.id);
    const semantic = input.document.relations[occurrence.relation];
    let markers;
    if (semantic?.profile === "erd@1") {
      const first = points[0], second = points[1], last = points[points.length - 1], before = points[points.length - 2];
      markers = renderErdMarkerSvg(erdText(semantic.attributes, "fromCardinality"), first, { x: second.x - first.x, y: second.y - first.y }) + renderErdMarkerSvg(erdText(semantic.attributes, "toCardinality"), last, { x: before.x - last.x, y: before.y - last.y });
    }
    const relStyle = relationPresentation?.[occurrence.id] ?? relationPresentation?.[occurrence.relation];
    const rawStrokeStyle = occurrence.strokeStyle ?? relStyle?.strokeStyle;
    const resolvedStrokeStyle = rawStrokeStyle === void 0 ? void 0 : resolveDashPattern(rawStrokeStyle)?.style;
    const rawArrowhead = occurrence.arrowhead ?? relStyle?.arrowhead;
    const resolvedArrowhead = rawArrowhead === void 0 ? void 0 : resolveArrowhead(rawArrowhead)?.canonicalKind;
    const effectiveArrowhead = combSuppressedArrowheads.has(occurrence.id) ? "none" : resolvedArrowhead;
    const rawEmphasis = occurrence.emphasis ?? relStyle?.emphasis;
    const resolvedEmphasis = rawEmphasis === void 0 ? void 0 : resolveLinkEmphasis(rawEmphasis)?.emphasis;
    const isR7Edge = r7Connectors && markers === void 0 && flow === void 0;
    edges.push({
      ...markers === void 0 ? {} : { markers },
      ...isR7Edge ? { r7: true } : {},
      occurrence: occurrence.id,
      points,
      directed: flow !== void 0,
      arrows: result.arrowBoxes?.[occurrence.id] ?? [],
      ...flow === void 0 ? {} : { flow },
      ...bundle === void 0 ? {} : { bundle },
      ...isR7Edge && resolvedStrokeStyle !== void 0 && resolvedStrokeStyle !== "solid" ? { strokeStyle: resolvedStrokeStyle } : {},
      ...isR7Edge && effectiveArrowhead !== void 0 && effectiveArrowhead !== "arrow" ? { arrowhead: effectiveArrowhead } : {},
      ...isR7Edge && resolvedEmphasis === "emphasis" ? { emphasis: resolvedEmphasis } : {}
    });
    if (result.labelBoxes !== void 0 && result.labelBoxes[id] === void 0)
      continue;
    const label = result.edgeBundles?.[id]?.label ?? combCarrierLabels.get(id) ?? (semantic?.profile === "erd@1" ? ["fromRole", "toRole"].map((role3) => erdText(semantic.attributes, role3)).filter(Boolean).join(" / ") || edgeLabelOf2(input.document, occurrence.relation) : edgeLabelOf2(input.document, occurrence.relation));
    if (label === void 0)
      continue;
    const layout = measuredLabels.get(id) ?? edgeLabelMeasure({
      text: label,
      role: "edge-label",
      availableWidth: EDGE_LABEL_ALLOCATION,
      allocatedLines: DEFAULT_ALLOCATED_LINES["edge-label"],
      folded: false
    });
    const lines = semantic?.profile === "erd@1" ? wrapErdText(label, ERD_GEOMETRY.labelWidth, input.measureLines) : layout.lines;
    labelLines.set(id, lines);
    entries.push({ id, route: points, size: semantic?.profile === "erd@1" ? { width: ERD_GEOMETRY.labelWidth, height: lines.length * ERD_GEOMETRY.lineHeight } : { width: layout.width, height: layout.height } });
  }
  const labels = [];
  let bounds;
  for (const item of items) {
    const box = item.kind === "edge" ? item.bounds : item.rect;
    bounds = bounds === void 0 ? box : rectUnion(bounds, box);
  }
  const placements = erd ? placeErdRoleLabels(entries, blockers, margin) : result.labelBoxes === void 0 ? placeEdgeLabels(entries, blockers, margin) : new Map(Object.entries(result.labelBoxes).map(([id, box]) => [id, { box }]));
  const labelled = new Set(entries.map((entry) => entry.id));
  for (const [id, placement] of placements) {
    if (placement === void 0 || !labelled.has(id))
      continue;
    const { box } = placement;
    const scaledBox = labelScale === 1 ? box : {
      x: box.x - box.width * (labelScale - 1) / 2,
      y: box.y - box.height * (labelScale - 1) / 2,
      width: box.width * labelScale,
      height: box.height * labelScale
    };
    const bundle = result.edgeBundles?.[id];
    const chip = bundle?.relations === void 0 ? void 0 : bundle.chip ?? measureBundleLabel(bundle.relations, edgeLabelMeasure, input.metrics?.bundleLabelMaxWidth);
    labels.push({
      occurrence: id,
      lines: labelLines.get(id) ?? [],
      box: scaledBox,
      ...erd ? { erd: true } : {},
      ..."leader" in placement ? { leader: placement.leader } : {},
      ...result.edgeBundles?.[id] === void 0 ? {} : { title: result.edgeBundles[id].title },
      ...chip === void 0 ? {} : { bundle: labelScale === 1 ? chip : {
        ...chip,
        groups: chip.groups.map((group) => ({ ...group, top: group.top * labelScale, height: group.height * labelScale }))
      } }
    });
  }
  const badges = [];
  for (const step of flows.scenarios.flatMap((scenario) => scenario.steps)) {
    const target = flowTargets[step.relation];
    if (target === void 0 || target.kind === "internal" || !target.badge || badges.some((badge) => badge.occurrence === target.occurrence))
      continue;
    const box = result.badgeBoxes?.[target.occurrence];
    if (box === void 0)
      continue;
    const bundle = result.flowBundles?.find((entry) => entry.id === (target.kind === "bundle" ? target.id : ""));
    const text3 = bundle === void 0 ? step.badge : (input.flows?.countTemplate ?? "{n}").replaceAll("{n}", String(bundle.members.length));
    badges.push({ id: target.occurrence, occurrence: target.occurrence, kind: bundle === void 0 ? "step" : "count", text: text3, box, target: target.kind === "bundle" ? { kind: "bundle", id: target.id } : { kind: "edge", occurrence: target.occurrence } });
    bounds = bounds === void 0 ? box : rectUnion(bounds, box);
  }
  for (const arrows of Object.values(result.arrowBoxes ?? {}))
    for (const arrow of arrows)
      bounds = bounds === void 0 ? arrow.box : rectUnion(bounds, arrow.box);
  const cornerRadius = r7Connectors ? input.metrics?.edgeCornerRadius ?? DEFAULT_EDGE_CORNER_RADIUS : 0;
  for (const { node, inner, lineHeight, bottom } of pendingCutouts) {
    if (!r7Connectors) {
      const pad3 = paintClearance + CONNECTOR_CUTOUT_SLACK;
      connectorCutouts.push({
        x: node.rect.x + zoneInset - pad3,
        y: bottom - lineHeight - pad3,
        width: Math.min(footerWidths.get(node.occurrence) ?? inner, inner) + 2 * pad3,
        height: lineHeight + 2 * pad3
      });
      continue;
    }
    const basePad = Math.max(paintClearance + CONNECTOR_CUTOUT_SLACK, margin + baseLinkStrokeWidth / clearanceZoom + 1.15);
    let pad2 = basePad;
    for (const edge of edges) {
      if (!edge.r7)
        continue;
      const width = connectorStrokeWidth(edge, input.metrics);
      const edgePad = Math.max(margin + width / (2 * clearanceZoom) + CONNECTOR_CUTOUT_SLACK, margin + width / clearanceZoom + 1.15);
      if (edgePad <= pad2)
        continue;
      const cutoutLeft = node.rect.x + zoneInset - edgePad;
      const cutoutRight = cutoutLeft + Math.min(footerWidths.get(node.occurrence) ?? inner, inner) + 2 * edgePad;
      const cutoutTop2 = bottom - lineHeight - edgePad;
      const cutoutBottom2 = Math.min(node.rect.y + node.rect.height, bottom + edgePad);
      if (edge.points.slice(1).some((point, i) => {
        const prev = edge.points[i];
        return Math.min(prev.x, point.x) <= cutoutRight && cutoutLeft <= Math.max(prev.x, point.x) && Math.min(prev.y, point.y) <= cutoutBottom2 && cutoutTop2 <= Math.max(prev.y, point.y);
      }))
        pad2 = edgePad;
    }
    const cutoutTop = bottom - lineHeight - pad2;
    const cutoutBottom = Math.min(node.rect.y + node.rect.height, bottom + pad2);
    connectorCutouts.push({
      x: node.rect.x + zoneInset - pad2,
      y: cutoutTop,
      width: Math.min(footerWidths.get(node.occurrence) ?? inner, inner) + 2 * pad2,
      height: cutoutBottom - cutoutTop
    });
  }
  const clearedLabels = r7Connectors ? clearSceneLabels(labels, edges.map((edge) => edge.points), [...blockers, ...badges.map((badge) => badge.box), ...edges.flatMap((edge) => edge.arrows.map((arrow) => arrow.box))], paintClearance, cornerRadius, edges.map((edge) => edge.r7 ? Math.max(0, connectorStrokeWidth(edge, input.metrics) - baseLinkStrokeWidth) / (2 * clearanceZoom) : 0)) : clearSceneLabels(labels, edges.map((edge) => edge.points), [...blockers, ...badges.map((badge) => badge.box), ...edges.flatMap((edge) => edge.arrows.map((arrow) => arrow.box))], paintClearance);
  for (const { box } of clearedLabels) {
    const padded = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin };
    bounds = bounds === void 0 ? padded : rectUnion(bounds, padded);
  }
  const effectiveLegendAnchor = input.legend ?? (isProcessDoc ? "none" : void 0);
  const linkLegend = result.legendResolved ? result.linkLegend : buildSceneLinkLegend({
    edges,
    contentBounds: bounds,
    measureLines: input.measureLines,
    ...effectiveLegendAnchor === void 0 ? {} : { anchor: effectiveLegendAnchor },
    ...input.legendTitle === void 0 ? {} : { title: input.legendTitle },
    ...input.legendLabels === void 0 ? {} : { labels: input.legendLabels },
    ...effectiveInputLabelSize === void 0 ? {} : { fontSize: effectiveInputLabelSize }
  });
  if (linkLegend !== void 0) {
    bounds = bounds === void 0 ? linkLegend.rect : rectUnion(bounds, linkLegend.rect);
  }
  if (bounds !== void 0) {
    const x = Math.floor(bounds.x * 64) / 64, y = Math.floor(bounds.y * 64) / 64;
    bounds = { x, y, width: Math.ceil((bounds.x + bounds.width) * 64) / 64 - x, height: Math.ceil((bounds.y + bounds.height) * 64) / 64 - y };
  }
  const nodeTargets = nodes.filter((node) => Object.values(flowEnds).some((ends) => ends.some((id) => id === node.occurrence || (flowAncestors[id] ?? []).includes(node.occurrence)))).map((node) => ({ occurrence: node.occurrence, entity: node.entity, anchor: { x: node.rect.x, y: node.rect.y } }));
  return {
    badges,
    flows,
    flowTargets,
    nodeTargets,
    flowEnds,
    flowRepresentatives,
    flowAncestors,
    flowSummaryLabels: Object.fromEntries(Object.entries(view.summaryLabels ?? {}).map(([id, definition]) => [id, definition.label])),
    contentSize: sceneContentSize(result),
    nodes,
    edges,
    labels: clearedLabels,
    ...overviewEdgeLabelSize === void 0 ? {} : { overviewEdgeLabelSize },
    r7Connectors,
    connectorCutouts,
    ...linkLegend === void 0 ? {} : { linkLegend },
    ...bounds === void 0 ? {} : { bounds },
    orientations: result.orientations ?? {}
  };
}
var DEFAULT_SCENE_LABELS = Object.freeze({
  ...DEFAULT_FLOW_STRINGS,
  controls: "Zoom",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Fit",
  viewAll: "View all",
  fullscreen: "Fullscreen",
  zoomLevel: (percent) => `Zoom ${percent} %`,
  viewport: "Diagram",
  expand: (title) => `Expand ${title}`,
  collapse: (title) => `Collapse ${title}`,
  contains: "includes",
  legend: "Legend"
});
var FIT_QUANTUM = 1e-3;
function sceneFit(input) {
  return cameraFit({
    ...input.bounds === void 0 ? {} : { bounds: input.bounds },
    viewWidth: input.viewWidth,
    windowHeight: input.windowHeight,
    ...input.viewHeight === void 0 ? {} : { viewHeight: input.viewHeight },
    ...input.scrollbarHeight === void 0 ? {} : { scrollbarHeight: input.scrollbarHeight },
    ...input.maxDisplayScale === void 0 ? {} : { maxDisplayScale: input.maxDisplayScale },
    ...input.minReadableScale === void 0 ? {} : { minReadableScale: input.minReadableScale },
    ...input.unconstrained === void 0 ? {} : { unconstrained: input.unconstrained },
    ...input.fitToWindow === void 0 ? {} : { fitToWindow: input.fitToWindow },
    zoomQuantum: FIT_QUANTUM
  });
}
var shippedSceneRegistry = createProfileRegistry([
  generic2Profile,
  archimate2Profile,
  uml2Profile,
  erdProfile,
  processProfile
]);
var cachedSceneBindings;
var shippedSceneBindings = {
  schemaVersion: "1",
  get rows() {
    if (cachedSceneBindings === void 0) {
      cachedSceneBindings = {
        schemaVersion: "1",
        rows: shippedExecutorBindings.rows.filter((row) => shippedSceneRegistry.has(row.profileId))
      };
    }
    return cachedSceneBindings.rows;
  }
};
function validateSceneDocument(document, options = {}) {
  return validateDocument(document, {
    registry: options.registry ?? shippedSceneRegistry,
    bindings: options.bindings ?? shippedSceneBindings
  });
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/renderCardSvg.js
function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
var FONT_STACK = "var(--st-font-sans, system-ui, sans-serif)";
function iconGroupFor(name, glyph2, x, y, size) {
  if (glyph2 === void 0)
    return "";
  const scale = size / 64;
  const lineStroke = glyph2.darkLine === true ? "var(--st-component-diagramIcon-lineDarkStroke, var(--st-semantic-feedback-info))" : "var(--st-component-diagramIcon-lineStroke, var(--st-semantic-surface-raised))";
  return `<g class="st-diagramCard-icon" data-diagram-icon="${escapeXml(name)}" transform="translate(${x} ${y}) scale(${scale})" aria-hidden="true"><path d="${DIAGRAM_GLYPH_BASE}" fill="var(--st-component-diagramIcon-baseFill, color-mix(in srgb, var(--st-semantic-feedback-info) 18%, var(--st-semantic-surface-raised)))"/><path d="${escapeXml(glyph2.face)}" fill="var(--st-component-diagramIcon-faceFill, color-mix(in srgb, var(--st-semantic-feedback-info) 75%, var(--st-semantic-surface-raised)))" stroke="var(--st-component-diagramIcon-faceStroke, var(--st-semantic-feedback-info))" stroke-width="1.5" stroke-linejoin="round"/>` + (glyph2.line === void 0 ? "" : `<path d="${escapeXml(glyph2.line)}" fill="none" stroke="${lineStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`) + (glyph2.text === void 0 ? "" : `<text x="32" y="47" text-anchor="middle" fill="var(--st-component-diagramIcon-lineStroke, var(--st-semantic-surface-raised))" font-size="13" font-weight="750">${escapeXml(glyph2.text)}</text>`) + `</g>`;
}
function textLines(lines, className, fill, extra) {
  return lines.map((line) => `<text class="${className}" x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor === "middle" ? "middle" : "start"}" font-size="${line.size}" font-weight="${line.weight}" fill="${fill}"${extra}>${escapeXml(line.text)}</text>`).join("");
}
function renderCardContent(props, measure2 = defaultCardMeasure) {
  const layout = layoutCard(props, measure2);
  const g = { ...anatomyCardGeometry(layout.anatomyFallback ?? props.anatomy), width: layout.box.width, height: layout.box.height };
  const parts = [`<title>${escapeXml(cardFullText(props))}</title><desc>${escapeXml(cardFullText(props))}</desc>`];
  const surfaceFill = props.surface === void 0 ? "var(--st-component-diagramCard-surface, var(--st-semantic-surface-raised))" : `var(--st-component-diagramZone-${props.surface}, var(--st-semantic-surface-${props.surface === "surface1" ? "raised" : "subtle"}))`;
  parts.push(`<rect x="1" y="1" width="${g.width - 2}" height="${g.height - 2}" fill="${surfaceFill}" stroke="var(--st-component-diagramCard-border, var(--st-semantic-border-strong))" stroke-width="${g.borderWidth}"${props.proposed === true ? ` stroke-dasharray="var(--st-component-diagramCard-proposedDashArray, 4 5)"` : ""}/>`);
  parts.push(`<rect x="0" y="0" width="${g.accentWidth}" height="${g.height}" fill="var(--st-component-diagramCard-border, var(--st-semantic-border-strong))"/>`);
  if (layout.iconBox !== void 0) {
    parts.push(iconGroupFor(layout.icon.name, layout.icon.glyph, layout.iconBox.x, layout.iconBox.y, layout.iconBox.size));
  }
  if (layout.kicker.length > 0) {
    parts.push(textLines(layout.kicker, "st-diagramCard-kicker", "var(--st-component-diagramCard-secondaryText, var(--st-semantic-text-secondary))", ` letter-spacing="0.04em" style="text-transform:uppercase"`));
  }
  if (layout.title.length > 0) {
    parts.push(textLines(layout.title, "st-diagramCard-title", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
  }
  if (layout.body.length > 0) {
    const secondary = layout.body.filter((line) => line.secondary);
    const primary = layout.body.filter((line) => !line.secondary);
    if (primary.length > 0) {
      parts.push(textLines(primary, "st-diagramCard-body", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
    }
    if (secondary.length > 0) {
      parts.push(textLines(secondary, "st-diagramCard-detail", "var(--st-component-diagramCard-secondaryText, var(--st-semantic-text-secondary))", ""));
    }
  }
  if (layout.ruleY !== void 0) {
    parts.push(`<line class="st-diagramCard-rule" x1="${layout.ruleX1}" x2="${layout.ruleX2}" y1="${layout.ruleY}" y2="${layout.ruleY}" stroke="var(--st-component-diagramCard-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
  }
  if (layout.footerLines.length > 0) {
    parts.push(textLines(layout.footerLines, "st-diagramCard-footer", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
  }
  if (layout.toggleBox !== void 0 && props.toggle !== void 0) {
    parts.push(toggleGlyph(props.toggle, layout.toggleBox));
  }
  return { content: parts.join(""), layout };
}
function toggleGlyph(toggle, box) {
  const center = box.size / 2;
  const arm = 7;
  const glyph2 = toggle.collapsed ? `<path d="M ${center - arm} ${center} H ${center + arm} M ${center} ${center - arm} V ${center + arm}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` : `<path d="M ${center - arm} ${center} H ${center + arm}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  return `<g class="st-diagramCard-toggle" data-toggle="true" data-collapsed="${toggle.collapsed ? "true" : "false"}" transform="translate(${box.x} ${box.y})" color="var(--st-semantic-text-primary)" aria-hidden="true"><title>${escapeXml(toggle.label)}</title><rect width="${box.size}" height="${box.size}" fill="transparent"/>${glyph2}</g>`;
}
function renderCardSvg(props, measure2 = defaultCardMeasure) {
  const { content, layout } = renderCardContent(props, measure2);
  const g = { ...anatomyCardGeometry(layout.anatomyFallback ?? props.anatomy), width: layout.box.width, height: layout.box.height };
  const overflowSlots = layout.diagnostics.filter((diagnostic2) => diagnostic2.code === "card-overflow" && diagnostic2.reason !== "fallback-v1").map((diagnostic2) => diagnostic2.slot);
  const unknownIcon = layout.diagnostics.some((diagnostic2) => diagnostic2.code === "card-icon-unknown");
  const firstOverflow = overflowSlots.length === 0 ? void 0 : overflowSlots[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="st-diagramCard" data-entity="${escapeXml(props.entityId)}"${props.tone === void 0 ? "" : ` data-tone="${escapeXml(props.tone)}"`}${props.proposed === true ? ' data-proposed="true"' : ""}${firstOverflow === void 0 ? "" : ` data-card-overflow="${firstOverflow}"`}${unknownIcon ? ` data-card-icon-unknown=""` : ""} width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${escapeXml(props.title)}" aria-description="${escapeXml(cardFullText(props))}" style="font-family:${FONT_STACK}">` + content + `</svg>`;
  return {
    kind: "rendered",
    svg,
    diagnostics: layout.diagnostics,
    layout
  };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/renderZoneSvg.js
function escapeXml2(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
var FONT_STACK2 = "var(--st-font-sans, system-ui, sans-serif)";
function textLines2(lines, className, fill, extra) {
  return lines.map((line) => `<text class="${className}" x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor === "middle" ? "middle" : "start"}" font-size="${line.size}" font-weight="${line.weight}" fill="${fill}"${extra}>${escapeXml2(line.text)}</text>`).join("");
}
function childContent(child, measure2) {
  if (child.kind === "card") {
    if (child.card === void 0)
      throw new Error("fixture-error: card child without card props");
    const { content, layout } = renderCardContent(child.card, measure2);
    const diagnostics = layout.diagnostics.map((diagnostic2) => ({
      code: diagnostic2.code,
      slot: diagnostic2.slot,
      entityId: diagnostic2.entityId,
      neededPx: diagnostic2.neededPx,
      allocatedPx: diagnostic2.allocatedPx,
      ...diagnostic2.text === void 0 ? {} : { text: diagnostic2.text },
      ...diagnostic2.hiddenLength === void 0 ? {} : { hiddenLength: diagnostic2.hiddenLength, severity: "info", reason: "truncated" }
    }));
    return { content, diagnostics };
  }
  if (child.zone === void 0)
    throw new Error("fixture-error: zone child without zone props");
  const rendered = zoneContent(child.zone, child.children ?? [], measure2);
  return { content: rendered.content, diagnostics: rendered.diagnostics };
}
function zoneContent(props, children, measure2) {
  const g = anatomyZoneGeometry(props.anatomy);
  const layout = layoutZone(props, measure2, children);
  const x = layout.box.x;
  const y = layout.box.y;
  const parts = [`<title>${escapeXml2(zoneFullText(props))}</title><desc>${escapeXml2(zoneFullText(props))}</desc>`];
  const descendantDiagnostics = [];
  if (layout.collapsed) {
    const cardProps = zoneCollapsedCardProps(props);
    const { content } = renderCardContent(cardProps, measure2);
    parts.push(content);
    return { content: parts.join(""), layout, diagnostics: layout.diagnostics };
  }
  const header = layout.header;
  if (header === void 0)
    throw new Error("fixture-error: expanded zone without header layout");
  const width = layout.box.width;
  const height = layout.box.height;
  const surfaceFill = props.depth === void 0 && props.depthParityStart === void 0 ? "var(--st-component-diagramZone-surface, var(--st-semantic-surface-raised))" : `var(--st-component-diagramZone-${layout.surface ?? "surface1"}, var(--st-semantic-surface-${(layout.surface ?? "surface1") === "surface1" ? "raised" : "subtle"}))`;
  parts.push(`<rect class="st-diagramZone-frame" x="0" y="0" width="${width}" height="${height}" rx="${g.radius}" fill="${surfaceFill}" stroke="var(--st-component-diagramZone-border, var(--st-semantic-border-strong))" stroke-width="${g.borderWidth}"${props.proposed === true ? ` stroke-dasharray="var(--st-component-diagramZone-proposedDashArray, 4 5)"` : ""}/>`);
  if (header.iconBox !== void 0) {
    parts.push(iconGroupFor(layout.icon.name, layout.icon.glyph, header.iconBox.x - x, header.iconBox.y - y, header.iconBox.size));
  }
  if (header.kicker.length > 0) {
    parts.push(textLines2(header.kicker.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-kicker", "var(--st-component-diagramZone-secondaryText, var(--st-semantic-text-secondary))", ` letter-spacing="0.04em" style="text-transform:uppercase"`));
  }
  if (header.title.length > 0) {
    parts.push(textLines2(header.title.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-title", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  if (header.subtitle.length > 0) {
    parts.push(textLines2(header.subtitle.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-subtitle", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  parts.push(`<line class="st-diagramZone-rule" x1="${g.ruleInsetStart}" x2="${width - g.ruleInsetEnd}" y1="${header.ruleY - y}" y2="${header.ruleY - y}" stroke="var(--st-component-diagramZone-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
  if (header.toggleBox !== void 0 && props.toggleLabel !== void 0) {
    parts.push(toggleGlyph({ collapsed: false, label: props.toggleLabel }, { x: header.toggleBox.x - x, y: header.toggleBox.y - y, size: header.toggleBox.size }));
  }
  if (header.footer.length > 0) {
    if (header.footerRuleY !== void 0) {
      parts.push(`<line class="st-diagramZone-footerRule" x1="${g.ruleInsetStart}" x2="${width - g.ruleInsetEnd}" y1="${header.footerRuleY - y}" y2="${header.footerRuleY - y}" stroke="var(--st-component-diagramZone-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
    }
    parts.push(textLines2(header.footer.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-footer", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  for (const child of children) {
    const rendered = childContent(child, measure2);
    descendantDiagnostics.push(...rendered.diagnostics);
    parts.push(`<g class="st-diagramZone-child" data-child-kind="${child.kind}" transform="translate(${child.x - x} ${child.y - y})">${rendered.content}</g>`);
  }
  return {
    content: parts.join(""),
    layout,
    diagnostics: [...layout.diagnostics, ...descendantDiagnostics]
  };
}
function renderZoneSvg(props, opts = {}) {
  const measure2 = opts.measure ?? defaultCardMeasure;
  const children = opts.children ?? [];
  const { content, layout, diagnostics } = zoneContent(props, children, measure2);
  const { x, y, width, height } = layout.box;
  const overflowSlots = diagnostics.filter((diagnostic2) => diagnostic2.code === "zone-overflow" && diagnostic2.reason !== "fallback-v1").map((diagnostic2) => diagnostic2.slot);
  const unknownIcon = diagnostics.some((diagnostic2) => diagnostic2.code === "zone-icon-unknown");
  const firstOverflow = overflowSlots.length === 0 ? void 0 : overflowSlots[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="st-diagramZoneSvg" width="${x + width}" height="${y + height}" viewBox="0 0 ${x + width} ${y + height}" role="img" aria-label="${escapeXml2(props.title)}" aria-description="${escapeXml2(zoneFullText(props))}" style="font-family:${FONT_STACK2}"><g class="st-diagramZone${layout.collapsed ? " st-diagramZone--collapsed" : " st-diagramZone--expanded"}" data-entity="${escapeXml2(props.entityId)}" data-collapsed="${layout.collapsed ? "true" : "false"}"${props.tone === void 0 ? "" : ` data-tone="${escapeXml2(props.tone)}"`}${props.proposed === true ? ' data-proposed="true"' : ""}${firstOverflow === void 0 ? "" : ` data-zone-overflow="${firstOverflow}"`}${unknownIcon ? ` data-zone-icon-unknown=""` : ""} transform="translate(${x} ${y})">` + content + `</g></svg>`;
  return { kind: "rendered", svg, diagnostics, layout };
}

// node_modules/@sentropic/diagram-canvas/dist/presentation/renderSceneSvg.js
var escape = (text3) => text3.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function renderSceneSvg(input, options = {}) {
  const fallback = sceneCardMeasure(defaultCardMeasure);
  const measureFor = (folded) => options.measure ?? (input.measureLines === void 0 ? fallback : (text3, role3, availableWidth, allocatedLines) => {
    const measured = input.measureLines({ text: text3, role: role3, availableWidth, allocatedLines, folded });
    return { lines: measured.lines, tooWide: measured.width > availableWidth, lineWidths: measured.lines.map(() => measured.width) };
  });
  const measure2 = measureFor(false);
  const measuredInput = { ...input, measureLines: options.measure === void 0 ? input.measureLines ?? cardLineMeasurer(measure2) : cardLineMeasurer(measure2) };
  const result = layoutScene2(measuredInput);
  if (result.status !== "laid-out")
    throw new Error("Scene refused: " + JSON.stringify(result.refusals));
  const viewportWidth = input.targetWidth ?? 1440;
  const viewport = { viewWidth: viewportWidth, windowHeight: options.windowHeight ?? 900, fitToWindow: options.fitToWindow ?? false };
  const isProcess = input.document.profileRefs.length === 1 && input.document.profileRefs[0] === "process@1";
  const resolvedViewport = isProcess ? { ...viewport, maxDisplayScale: 1 } : viewport;
  const scene = resolveScene(result, measuredInput, resolvedViewport), box = scene.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const fit = sceneFit({ bounds: box, ...resolvedViewport, ...isProcess && !viewport.fitToWindow ? { viewHeight: Math.max(1, box.height + 16) } : {} });
  const cornerRadius = input.metrics?.edgeCornerRadius ?? DEFAULT_EDGE_CORNER_RADIUS;
  const linkStrokeWidth = input.metrics?.linkStrokeWidth ?? DEFAULT_LINK_STROKE_WIDTH;
  const edgeLabelSize = scene.overviewEdgeLabelSize ?? (scene.r7Connectors ? input.metrics?.edgeLabelSize : void 0) ?? (isProcess ? 12 : DEFAULT_EDGE_LABEL_SIZE);
  const markerIds = connectorMarkerIds("scene-arrow");
  const extraMarkers = extraConnectorMarkers(scene.edges, markerIds);
  const extraMarkerDefs = extraMarkers.map((marker) => {
    const strokeAttrs = marker.stroke === void 0 ? "" : ` stroke="${escape(marker.stroke)}" stroke-width="${marker.strokeWidth ?? 1.5}"`;
    return `<marker id="${escape(marker.id)}" data-arrowhead-kind="${escape(marker.kind)}" data-arrowhead-emphasis="${escape(marker.emphasis)}" viewBox="${marker.viewBox}" refX="${marker.refX}" refY="${marker.refY}" markerUnits="${marker.markerUnits}" markerWidth="${marker.markerWidth}" markerHeight="${marker.markerHeight}" orient="${marker.orient}"><path d="${marker.path}" fill="${escape(marker.fill)}"${strokeAttrs}/></marker>`;
  }).join("");
  const edges = scene.edges.map((edge) => {
    if (!edge.r7) {
      const markerAttr = edge.markers === void 0 ? ' marker-end="url(#scene-arrow)"' : "";
      return `<polyline data-scene-edge="${escape(edge.occurrence)}" points="${edge.points.map((p) => p.x + "," + p.y).join(" ")}" fill="none" stroke="var(--st-component-diagramScene-edgeStroke, #64748b)" stroke-width="1.5" stroke-linejoin="round"${markerAttr}/>${edge.markers ?? ""}`;
    }
    const emphasized = edge.emphasis === "emphasis";
    const stroke = emphasized ? LINK_EMPHASIS_STROKE : "var(--st-component-diagramScene-edgeStroke, #64748b)";
    const strokeWidth2 = connectorStrokeWidth(edge, input.metrics);
    const dash = connectorDashArray(edge.strokeStyle);
    const markerRef = connectorMarkerRef(edge, markerIds);
    const attrs = [
      `data-scene-edge="${escape(edge.occurrence)}"`,
      'data-connector-mode="r7"',
      `d="${connectorPath(edge.points, cornerRadius)}"`,
      ...edge.strokeStyle === void 0 ? [] : [`data-edge-stroke="${escape(edge.strokeStyle)}"`],
      ...edge.arrowhead === void 0 ? [] : [`data-edge-arrowhead="${escape(edge.arrowhead)}"`],
      ...edge.emphasis === void 0 ? [] : [`data-edge-emphasis="${escape(edge.emphasis)}"`],
      'fill="none"',
      `stroke="${stroke}"`,
      `stroke-width="${strokeWidth2}"`,
      'vector-effect="non-scaling-stroke"',
      'stroke-linejoin="round"',
      ...dash === void 0 ? [] : [`stroke-dasharray="${dash}"`, `style="${connectorDashPaint(edge.strokeStyle)}"`],
      ...markerRef === void 0 ? [] : [`marker-end="${markerRef}"`]
    ].join(" ");
    return `<path ${attrs}/>${edge.markers ?? ""}`;
  }).join("");
  const drawNode = (node) => {
    const measure3 = measureFor(node.collapsed);
    if (node.kind === "erd" && node.erd !== void 0)
      return `<g data-scene-occurrence="${escape(node.occurrence)}" transform="translate(${node.rect.x} ${node.rect.y})">${renderErdCardSvg(node.erd)}</g>`;
    if (node.kind === "process" && node.processBox !== void 0)
      return `<g data-scene-occurrence="${escape(node.occurrence)}" transform="translate(${node.rect.x} ${node.rect.y})">${renderProcessBoxSvg(node.processBox)}</g>`;
    const props = { entityId: node.entity, resolveGlyph: input.resolveGlyph ?? getDiagramGlyph };
    const projected = node.kind === "zone" ? projectZoneProps(node.presentation, { ...props, collapsed: node.collapsed, ...input.metrics?.containerPadding === void 0 ? {} : { containerPadding: input.metrics.containerPadding }, width: node.rect.width, height: node.rect.height, toggleLabel: node.collapsed ? "Expand" : "Collapse" }) : projectCardProps(node.presentation, props);
    if (projected.kind === "label")
      return `<text x="${node.rect.x}" y="${node.rect.y + 24}">${escape(node.text)}</text>`;
    const rendered = projected.kind === "zone" ? renderZoneSvg({ ...projected.props, autoSize: true }, { measure: measure3 }) : renderCardSvg({ ...projected.props, autoSize: true, height: node.rect.height }, measure3);
    if (rendered.kind !== "rendered")
      throw new Error("Content must never refuse a component");
    return `<g data-scene-occurrence="${escape(node.occurrence)}" transform="translate(${node.rect.x} ${node.rect.y})">${rendered.svg}</g>`;
  };
  const mask = sceneConnectorMask(scene);
  const box4 = (r) => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;
  const maskDef = mask === void 0 ? "" : `<mask id="scene-connector-mask" maskUnits="userSpaceOnUse" ${box4(mask.region)}><rect ${box4(mask.region)} fill="#fff"/>${mask.cutouts.map((cutout) => `<rect data-scene-cutout="" ${box4(cutout)} fill="#000"/>`).join("")}</mask>`;
  const connectors = `<g data-scene-connectors=""${mask === void 0 ? "" : ' mask="url(#scene-connector-mask)"'}>${edges}</g>`;
  const frames = sceneNodesOnPlane(scene.nodes, "frame").map(drawNode).join("");
  const boxes = sceneNodesOnPlane(scene.nodes, "box").map(drawNode).join("");
  const labels = scene.labels.map((label) => {
    const b = label.box;
    const labelLineHeight = Math.round(22 * (edgeLabelSize / DEFAULT_EDGE_LABEL_SIZE));
    const firstBaseline = Math.round(edgeLabelSize);
    let text3 = "";
    if (label.bundle) {
      text3 = `<text x="${b.width / 2}" y="${labelLineHeight}" text-anchor="middle">${escape(label.bundle.header)}</text>`;
      label.bundle.groups.forEach((group, index) => {
        text3 += `<g data-bundle-relation="${index}"><path d="M0 ${group.top}H${b.width}" stroke="var(--st-component-diagramScene-labelBorder, #cbd5e1)"/><text x="5" y="${group.top + labelLineHeight}">\u2022</text>`;
        group.lines.forEach((line, i) => {
          text3 += `<text x="22" y="${group.top + labelLineHeight + i * labelLineHeight}">${escape(line)}</text>`;
        });
        text3 += "</g>";
      });
    } else
      label.lines.forEach((line, i) => {
        text3 += `<text x="${b.width / 2}" y="${firstBaseline + i * labelLineHeight}" text-anchor="middle">${escape(line)}</text>`;
      });
    const leader = label.leader === void 0 ? "" : scene.r7Connectors && !label.erd ? `<path data-scene-leader="${escape(label.occurrence)}" data-connector-mode="r7" d="${connectorPath(label.leader, cornerRadius)}" fill="none" stroke="var(--st-component-diagramScene-edgeStroke, #64748b)" stroke-width="${linkStrokeWidth}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : `<polyline points="${label.leader.map((p) => p.x + "," + p.y).join(" ")}" fill="none" stroke="var(--st-component-diagramScene-edgeStroke, #64748b)"/>`;
    return leader + `<g data-scene-label="${escape(label.occurrence)}" transform="translate(${b.x} ${b.y})" font-size="${edgeLabelSize}" fill="var(--st-component-diagramScene-labelText, #172033)"><rect width="${b.width}" height="${b.height}" fill="var(--st-component-diagramScene-labelSurface, #ffffff)" stroke="var(--st-component-diagramScene-labelBorder, #cbd5e1)"/>${text3}</g>`;
  }).join("");
  const defaultMarker = scene.r7Connectors ? '<marker id="scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10.5" markerHeight="10.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="var(--st-component-diagramScene-edgeStroke, #64748b)"/></marker>' : '<marker id="scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="var(--st-component-diagramScene-edgeStroke, #64748b)"/></marker>';
  const legend = (() => {
    const l = scene.linkLegend;
    if (l === void 0)
      return "";
    const r = l.rect;
    const ruleY = l.padding + l.headerHeight - 0.5;
    const titleY = l.padding + l.headerHeight / 2 + l.fontSize * 0.35;
    const rows = l.entries.map((entry) => {
      const swatch = linkLegendSwatchGeometry(entry, input.metrics);
      const swatchY = entry.rowY + (entry.rowHeight - swatch.height) / 2;
      const lineAttrs = [
        `data-legend-swatch="${escape(entry.key)}"`,
        `d="${swatch.linePath}"`,
        'fill="none"',
        `stroke="${escape(swatch.stroke)}"`,
        `stroke-width="${swatch.strokeWidth}"`,
        'vector-effect="non-scaling-stroke"',
        ...swatch.dashArray === void 0 ? [] : [`stroke-dasharray="${escape(swatch.dashArray)}"`, `style="${connectorDashPaint(entry.strokeStyle)}"`]
      ].join(" ");
      const arrow = swatch.arrowPath === void 0 ? "" : `<path d="${swatch.arrowPath}" fill="${escape(swatch.arrowFill ?? swatch.stroke)}"${swatch.arrowStroke === void 0 ? "" : ` stroke="${escape(swatch.arrowStroke)}" stroke-width="${swatch.arrowStrokeWidth ?? 1.5}"`}/>`;
      const textX = l.padding + l.swatchWidth + l.swatchGap;
      const textY = entry.rowY + entry.rowHeight / 2 + l.fontSize * 0.35;
      return `<g data-legend-style="${escape(entry.key)}" data-edge-stroke="${escape(entry.strokeStyle)}" data-edge-arrowhead="${escape(entry.arrowhead)}" data-edge-emphasis="${escape(entry.emphasis)}"><g transform="translate(${l.padding} ${swatchY})"><path ${lineAttrs}/>${arrow}</g><text x="${textX}" y="${textY}" font-size="${l.fontSize}" fill="var(--st-component-diagramScene-labelText, #172033)">${escape(entry.label)}</text></g>`;
    }).join("");
    return `<g data-scene-legend="" data-legend-anchor="${escape(l.anchor)}" transform="translate(${r.x} ${r.y})"><rect width="${r.width}" height="${r.height}" fill="var(--st-component-diagramScene-labelSurface, #ffffff)" stroke="var(--st-component-diagramScene-labelBorder, #cbd5e1)"/><text x="${l.padding}" y="${titleY}" font-size="${l.fontSize}" font-weight="700" fill="var(--st-component-diagramScene-labelText, #172033)">${escape(l.title)}</text><path d="M${l.padding} ${ruleY}H${r.width - l.padding}" stroke="var(--st-component-diagramScene-labelBorder, #cbd5e1)"/>${rows}</g>`;
  })();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x - 2} ${box.y - 2} ${box.width + 4} ${box.height + 4}" width="${(box.width + 4) * fit.zoom}" height="${(box.height + 4) * fit.zoom}" data-viewport-width="${viewportWidth}" data-display-scale="${fit.zoom}" role="img" aria-label="${escape(options.title ?? input.document.documentId)}" font-family="Inter, system-ui, sans-serif"><title>${escape(options.title ?? input.document.documentId)}</title><style>${scene.r7Connectors ? `@font-face{font-family:Inter;src:local('Inter');font-weight:100 900}svg:root{--st-font-sans:Inter,system-ui,sans-serif;--st-semantic-surface-raised:#fff;--st-semantic-surface-subtle:#f8fafc;--st-component-diagramZone-surface1:#fff;--st-component-diagramZone-surface2:#f8fafc;--st-semantic-text-primary:#172033;--st-semantic-text-secondary:#475569;--st-semantic-border-strong:#64748b;--st-semantic-border-subtle:#cbd5e1;--st-semantic-border-interactive:#2563eb;--st-semantic-feedback-info:#2563eb;--st-component-diagramScene-edgeStroke:#64748b;--st-component-diagramScene-linkStrokeWidth:2.5px;--st-component-diagramScene-linkRelatedStrokeWidth:3px;--st-component-diagramScene-linkPrimaryStrokeWidth:3.5px;--st-component-diagramScene-linkEmphasisStroke:${LINK_EMPHASIS_STROKE_FALLBACK};--st-component-diagramScene-linkEmphasisStrokeWidth:3.5px;--st-component-diagramScene-linkDashDashed:8 6;--st-component-diagramScene-linkDashDotted:2 5;--st-component-diagramScene-edgeCornerRadius:12px;--st-component-diagramScene-edgeLabelSize:18px}` : "@font-face{font-family:Inter;src:local('Inter');font-weight:100 900}svg:root{--st-font-sans:Inter,system-ui,sans-serif;--st-semantic-surface-raised:#fff;--st-semantic-surface-subtle:#f8fafc;--st-component-diagramZone-surface1:#fff;--st-component-diagramZone-surface2:#f8fafc;--st-semantic-text-primary:#172033;--st-semantic-text-secondary:#475569;--st-semantic-border-strong:#64748b;--st-semantic-border-subtle:#cbd5e1;--st-semantic-feedback-info:#2563eb}"}</style><defs>${defaultMarker}${extraMarkerDefs}${maskDef}</defs>${frames}${connectors}${boxes}${labels}${legend}</svg>`;
  return { svg, result, scene };
}

// ecosystem.json
var ecosystem_default = {
  version: 1,
  description: "Conceptual component relationships, not a live deployment inventory. Recheck against the dossier scope before presenting.",
  sources: [
    "packages/h2a/package.json",
    "packages/h2a-runtime/package.json",
    "packages/h2a/src/runtime/drive/cluster-mesh-outer.ts",
    "packages/h2a-runtime/src/gateway-host/host.ts",
    "apps/focus/package.json"
  ],
  scenes: {
    overview: {
      title: "\xC9cosyst\xE8me Sentropic",
      description: "h2a : Coordonne les agents et les d\xE9cisions\ncluster-mesh : Relie services et identit\xE9s\nllm-gateway : Achemine les demandes de mod\xE8les\nllm-mesh : G\xE8re comptes et fournisseurs de mod\xE8les\ntrack : Conserve travail et d\xE9cisions\nengram : Apporte la m\xE9moire des agents\ndesign-system : Fournit les composants visuels\nApplications Sentropic : Composent les briques de l\u2019\xE9cosyst\xE8me\nCodex : Commande officielle pour agents\nClaude Code : Commande officielle pour agents\nVibe : Commande officielle pour agents\nCommandes Sentropic : h2a, track et commandes du socle",
      document: {
        documentId: "document:ecosystem-overview",
        schemaVersion: {
          major: 1,
          minor: 1
        },
        revision: 0,
        profileRefs: [
          "generic@1"
        ],
        typeDefinitions: {},
        entities: {
          "entity:h2a": {
            id: "entity:h2a",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "h2a"
              }
            }
          },
          "entity:cluster-mesh": {
            id: "entity:cluster-mesh",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "cluster-mesh"
              }
            }
          },
          "entity:llm-gateway": {
            id: "entity:llm-gateway",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "llm-gateway"
              }
            }
          },
          "entity:llm-mesh": {
            id: "entity:llm-mesh",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "llm-mesh"
              }
            }
          },
          "entity:track": {
            id: "entity:track",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "track"
              }
            }
          },
          "entity:engram": {
            id: "entity:engram",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "engram"
              }
            }
          },
          "entity:design-system": {
            id: "entity:design-system",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "design-system"
              }
            }
          },
          "entity:sentropic-apps": {
            id: "entity:sentropic-apps",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Applications Sentropic"
              }
            }
          },
          "entity:codex": {
            id: "entity:codex",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Codex"
              }
            }
          },
          "entity:claude": {
            id: "entity:claude",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Claude Code"
              }
            }
          },
          "entity:vibe": {
            id: "entity:vibe",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Vibe"
              }
            }
          },
          "entity:sentropic-cli": {
            id: "entity:sentropic-cli",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Commandes Sentropic"
              }
            }
          }
        },
        relations: {
          "relation:overview-0": {
            id: "relation:overview-0",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:cluster-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "coordination distribu\xE9e"
              }
            }
          },
          "relation:overview-1": {
            id: "relation:overview-1",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:llm-gateway"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "ex\xE9cution via le runtime"
              }
            }
          },
          "relation:overview-2": {
            id: "relation:overview-2",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-gateway"
              },
              {
                role: "target",
                target: "entity:llm-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "routage des mod\xE8les"
              }
            }
          },
          "relation:overview-3": {
            id: "relation:overview-3",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:track"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "travail et d\xE9cisions"
              }
            }
          },
          "relation:overview-4": {
            id: "relation:overview-4",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:engram"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "m\xE9moire via le runtime"
              }
            }
          },
          "relation:overview-5": {
            id: "relation:overview-5",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:design-system"
              },
              {
                role: "target",
                target: "entity:sentropic-apps"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "composants visuels"
              }
            }
          },
          "relation:overview-6": {
            id: "relation:overview-6",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:sentropic-apps"
              },
              {
                role: "target",
                target: "entity:cluster-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "socle de services"
              }
            }
          },
          "relation:overview-7": {
            id: "relation:overview-7",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:codex"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          },
          "relation:overview-8": {
            id: "relation:overview-8",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:claude"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          },
          "relation:overview-9": {
            id: "relation:overview-9",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:vibe"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          },
          "relation:overview-10": {
            id: "relation:overview-10",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:sentropic-cli"
              },
              {
                role: "target",
                target: "entity:h2a"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "commandes de coordination"
              }
            }
          }
        },
        ports: {},
        resources: {},
        extensions: []
      }
    },
    models: {
      title: "Du coordinateur aux mod\xE8les",
      description: "h2a : Coordonne les agents et les d\xE9cisions\nllm-gateway : Achemine les demandes de mod\xE8les\nllm-mesh : G\xE8re comptes et fournisseurs de mod\xE8les\nCodex : Commande officielle pour agents\nClaude Code : Commande officielle pour agents\nVibe : Commande officielle pour agents",
      document: {
        documentId: "document:ecosystem-models",
        schemaVersion: {
          major: 1,
          minor: 1
        },
        revision: 0,
        profileRefs: [
          "generic@1"
        ],
        typeDefinitions: {},
        entities: {
          "entity:h2a": {
            id: "entity:h2a",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "h2a"
              }
            }
          },
          "entity:llm-gateway": {
            id: "entity:llm-gateway",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "llm-gateway"
              }
            }
          },
          "entity:llm-mesh": {
            id: "entity:llm-mesh",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "llm-mesh"
              }
            }
          },
          "entity:codex": {
            id: "entity:codex",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Codex"
              }
            }
          },
          "entity:claude": {
            id: "entity:claude",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Claude Code"
              }
            }
          },
          "entity:vibe": {
            id: "entity:vibe",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Vibe"
              }
            }
          }
        },
        relations: {
          "relation:models-0": {
            id: "relation:models-0",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:llm-gateway"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "ex\xE9cution via le runtime"
              }
            }
          },
          "relation:models-1": {
            id: "relation:models-1",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-gateway"
              },
              {
                role: "target",
                target: "entity:llm-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "routage des mod\xE8les"
              }
            }
          },
          "relation:models-2": {
            id: "relation:models-2",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:codex"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          },
          "relation:models-3": {
            id: "relation:models-3",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:claude"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          },
          "relation:models-4": {
            id: "relation:models-4",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:llm-mesh"
              },
              {
                role: "target",
                target: "entity:vibe"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "comptes et ex\xE9cution"
              }
            }
          }
        },
        ports: {},
        resources: {},
        extensions: []
      }
    },
    knowledge: {
      title: "Travail et m\xE9moire",
      description: "h2a : Coordonne les agents et les d\xE9cisions\ntrack : Conserve travail et d\xE9cisions\nengram : Apporte la m\xE9moire des agents",
      document: {
        documentId: "document:ecosystem-knowledge",
        schemaVersion: {
          major: 1,
          minor: 1
        },
        revision: 0,
        profileRefs: [
          "generic@1"
        ],
        typeDefinitions: {},
        entities: {
          "entity:h2a": {
            id: "entity:h2a",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "h2a"
              }
            }
          },
          "entity:track": {
            id: "entity:track",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "track"
              }
            }
          },
          "entity:engram": {
            id: "entity:engram",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "engram"
              }
            }
          }
        },
        relations: {
          "relation:knowledge-0": {
            id: "relation:knowledge-0",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:track"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "travail et d\xE9cisions"
              }
            }
          },
          "relation:knowledge-1": {
            id: "relation:knowledge-1",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:engram"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "m\xE9moire via le runtime"
              }
            }
          }
        },
        ports: {},
        resources: {},
        extensions: []
      }
    },
    interfaces: {
      title: "Applications et commandes",
      description: "h2a : Coordonne les agents et les d\xE9cisions\ncluster-mesh : Relie services et identit\xE9s\ndesign-system : Fournit les composants visuels\nApplications Sentropic : Composent les briques de l\u2019\xE9cosyst\xE8me\nCommandes Sentropic : h2a, track et commandes du socle",
      document: {
        documentId: "document:ecosystem-interfaces",
        schemaVersion: {
          major: 1,
          minor: 1
        },
        revision: 0,
        profileRefs: [
          "generic@1"
        ],
        typeDefinitions: {},
        entities: {
          "entity:h2a": {
            id: "entity:h2a",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "h2a"
              }
            }
          },
          "entity:cluster-mesh": {
            id: "entity:cluster-mesh",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "cluster-mesh"
              }
            }
          },
          "entity:design-system": {
            id: "entity:design-system",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "design-system"
              }
            }
          },
          "entity:sentropic-apps": {
            id: "entity:sentropic-apps",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Applications Sentropic"
              }
            }
          },
          "entity:sentropic-cli": {
            id: "entity:sentropic-cli",
            profile: "generic@1",
            type: "node",
            attributes: {
              name: {
                kind: "text",
                value: "Commandes Sentropic"
              }
            }
          }
        },
        relations: {
          "relation:interfaces-0": {
            id: "relation:interfaces-0",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:h2a"
              },
              {
                role: "target",
                target: "entity:cluster-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "coordination distribu\xE9e"
              }
            }
          },
          "relation:interfaces-1": {
            id: "relation:interfaces-1",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:design-system"
              },
              {
                role: "target",
                target: "entity:sentropic-apps"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "composants visuels"
              }
            }
          },
          "relation:interfaces-2": {
            id: "relation:interfaces-2",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:sentropic-apps"
              },
              {
                role: "target",
                target: "entity:cluster-mesh"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "socle de services"
              }
            }
          },
          "relation:interfaces-3": {
            id: "relation:interfaces-3",
            profile: "generic@1",
            type: "link",
            endpoints: [
              {
                role: "source",
                target: "entity:sentropic-cli"
              },
              {
                role: "target",
                target: "entity:h2a"
              }
            ],
            attributes: {
              label: {
                kind: "text",
                value: "commandes de coordination"
              }
            }
          }
        },
        ports: {},
        resources: {},
        extensions: []
      }
    }
  }
};

// src/ds-diagram-bridge.js
var FOCUS_PROCESS_TARGET_WIDTH = 640;
var FOCUS_PHONE_TARGET_WIDTH = 340;
var PROCESS_FLOW_EXTENSION_NAMESPACE2 = "sentropic:process-flow";
var ALLOWED_FOCUS_PROFILES = /* @__PURE__ */ new Set(["generic@1", "process@1"]);
var FOCUS_OPTIONAL_TEXT_ATTRS = /* @__PURE__ */ new Set(["description", "kicker", "footer", "icon"]);
var PRESENTATION_CONTRACT_PIN = {
  id: "diagram-presentation",
  version: "1",
  contentDigest: "74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae"
};
var LAYOUT_FAILURES = /* @__PURE__ */ new Set([
  "label-unplaced",
  "label-budget-exhausted",
  "route-obstructed",
  "route-spacing-conflict",
  "channel-unresolved",
  "channel-capacity-exceeded",
  "docking-overflow"
]);
var ECOSYSTEM_ICONS = {
  "entity:h2a": "robot",
  "entity:cluster-mesh": "cluster",
  "entity:llm-gateway": "api",
  "entity:llm-mesh": "llm",
  "entity:track": "check",
  "entity:engram": "brain",
  "entity:design-system": "window",
  "entity:sentropic-apps": "web",
  "entity:codex": "workstation",
  "entity:claude": "workstation",
  "entity:vibe": "workstation",
  "entity:sentropic-cli": "workstation"
};
var foldableGenericProfile = {
  id: "generic@1",
  name: "generic",
  version: 1,
  completeness: "complete",
  entityTypes: [
    {
      id: "node",
      label: "Node",
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "state", kind: "enum", values: ["draft", "active", "retired"] },
        { name: "weight", kind: "quantity", units: ["unit"] },
        { name: "duration", kind: "quantity", units: ["s", "min", "h"] },
        { name: "createdAt", kind: "date" },
        { name: "pinned", kind: "boolean" },
        { name: "tags", kind: "collection", item: { kind: "text", maxLength: 40 }, maxItems: 8 },
        { name: "owner", kind: "reference", refKind: "entity" }
      ]
    },
    {
      id: "container",
      label: "Container",
      container: true,
      attributes: [
        { name: "name", kind: "text", required: true, maxLength: 200 },
        { name: "collapsed", kind: "boolean" }
      ]
    }
  ],
  portTypes: [
    {
      id: "port",
      label: "Port",
      directions: ["in", "out", "inout"],
      attributes: [{ name: "label", kind: "text", maxLength: 80 }]
    }
  ],
  relationTypes: [
    {
      id: "link",
      label: "Link",
      direction: "directed",
      roles: [
        { role: "source", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] },
        { role: "target", cardinality: { min: 1, max: 1 }, targets: ["entity", "port"] }
      ],
      attributes: [
        { name: "label", kind: "text", maxLength: 120 },
        { name: "weight", kind: "quantity", units: ["unit"] }
      ]
    },
    {
      id: "contains",
      label: "Contains",
      direction: "directed",
      roles: [
        { role: "parent", cardinality: { min: 1, max: 1 }, targets: ["entity"], entityTypes: ["container"] },
        { role: "child", cardinality: { min: 1, max: 1 }, targets: ["entity"] }
      ],
      hierarchy: { id: "containment", shape: "tree", parentRole: "parent", childRole: "child" }
    },
    {
      id: "association",
      label: "Association",
      direction: "undirected",
      roles: [{ role: "member", cardinality: { min: 2, max: 8 }, targets: ["entity"] }],
      attributes: [{ name: "label", kind: "text", maxLength: 120 }]
    }
  ],
  constraints: [
    { kind: "acyclic-hierarchy", hierarchyId: "containment" },
    { kind: "unique-attribute", entityType: "container", attribute: "name" },
    { kind: "max-entities-of-type", entityType: "container", max: 64 }
  ],
  limits: { maxEntities: 1e5, maxRelations: 5e5, maxEndpointsPerRelation: 8 },
  notes: ["Foldable generic@1 profile for Focus dossier diagrams."]
};
var focusSceneRegistry = {
  get: (id) => id === "generic@1" ? foldableGenericProfile : shippedSceneRegistry.get(id),
  has: (id) => id === "generic@1" || shippedSceneRegistry.has(id),
  list: () => ["generic@1", ...shippedSceneRegistry.list().filter((id) => id !== "generic@1")]
};
var focusSceneBindings = {
  schemaVersion: "1",
  rows: [
    {
      profileId: "generic@1",
      profilePin: {
        id: "generic@1",
        version: 1,
        contentDigest: "a003981971bdf75b50f455f19d701130c81fd896aeb7f4b0f0f9fe49dd874b8a"
      },
      declarationAdapter: "legacy-constraints@1"
    },
    ...shippedSceneBindings.rows
  ]
};
var measure = sceneCardMeasure(defaultCardMeasure);
var measureLines = cardLineMeasurer(measure);
var processMeasureLines = (request) => {
  const layout = measureLines(request);
  if (request.role !== "edge-label" || layout.width === 0) return layout;
  return { ...layout, width: layout.width + 8, height: layout.height + 6 };
};
var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var closed = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
var localIdOf2 = (ref) => ref.slice(ref.indexOf(":") + 1);
var occurrenceRef2 = (id) => `occurrence:${id}`;
var textAttr2 = (entityOrRel, key) => {
  const attr = entityOrRel?.attributes?.[key];
  return attr?.kind === "text" && typeof attr.value === "string" && attr.value.trim() ? attr.value.trim() : void 0;
};
function isClosedScalarValue(value) {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "text":
    case "date":
    case "enum":
    case "reference":
      return closed(value, ["kind", "value"]) && typeof value.value === "string";
    case "boolean":
      return closed(value, ["kind", "value"]) && typeof value.value === "boolean";
    case "quantity":
      return closed(value, ["kind", "value", "unit"]) && typeof value.value === "number" && typeof value.unit === "string";
    default:
      return false;
  }
}
function isClosedAttributeValue(value) {
  if (isClosedScalarValue(value)) return true;
  return closed(value, ["kind", "items"]) && value.kind === "collection" && Array.isArray(value.items) && value.items.every(isClosedScalarValue);
}
function isClosedAttributes(value) {
  return isRecord(value) && Object.values(value).every(isClosedAttributeValue);
}
function fnv1a64(content) {
  const bytes = new TextEncoder().encode(content);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x00000100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) * prime & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
function createProcessDirectionExtension(direction) {
  const source = JSON.stringify({ direction });
  return {
    namespace: PROCESS_FLOW_EXTENSION_NAMESPACE2,
    schemaVersion: "1",
    scope: { kind: "document" },
    validation: "validated",
    contentHash: fnv1a64(source),
    source
  };
}
function prepareGenericSceneForEngine(scene, refuse) {
  const profileId = scene.profileRefs?.[0];
  if (profileId !== "generic@1") return scene;
  const cleanEntities = {};
  for (const [id, entity] of Object.entries(scene.entities)) {
    const cleanAttrs = {};
    for (const [k, v] of Object.entries(entity.attributes)) {
      if (FOCUS_OPTIONAL_TEXT_ATTRS.has(k)) {
        if (!closed(v, ["kind", "value"]) || v.kind !== "text" || typeof v.value !== "string") {
          refuse(`Invalid optional text attribute "${k}" on "${id}"`);
        }
        continue;
      }
      cleanAttrs[k] = v;
    }
    cleanEntities[id] = { ...entity, attributes: cleanAttrs };
  }
  return { ...scene, entities: cleanEntities };
}
function validateCheckedFocusScene(scene, errorPrefix = "") {
  const refuse = (reason) => {
    const msg = reason ?? "Unsupported diagram-core document: expected generic@1 or process@1 without views, geometry or layout hints";
    throw new Error(errorPrefix ? `${errorPrefix}${msg}` : msg);
  };
  if (!isRecord(scene)) refuse("Expected a semantic scene object");
  const {
    documentId,
    schemaVersion,
    revision,
    profileRefs,
    typeDefinitions,
    entities,
    relations,
    ports,
    resources,
    extensions
  } = scene;
  if (!closed(scene, [
    "documentId",
    "schemaVersion",
    "revision",
    "profileRefs",
    "typeDefinitions",
    "entities",
    "relations",
    "ports",
    "resources",
    "extensions"
  ]) || typeof documentId !== "string" || !documentId.startsWith("document:") || !closed(schemaVersion, ["major", "minor"]) || schemaVersion.major !== 1 || schemaVersion.minor !== 1 || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || !Array.isArray(profileRefs) || profileRefs.length !== 1 || typeof profileRefs[0] !== "string" || !ALLOWED_FOCUS_PROFILES.has(profileRefs[0]) || !closed(typeDefinitions, []) || !closed(ports, []) || !closed(resources, []) || !Array.isArray(extensions)) {
    refuse();
  }
  const profileId = profileRefs[0];
  if (profileId === "generic@1" && extensions.length !== 0) refuse();
  if (profileId === "process@1") {
    if (extensions.length > 1) refuse("Unsupported extension on process@1 scene");
    for (const ext of extensions) {
      if (!closed(ext, ["namespace", "schemaVersion", "scope", "validation", "contentHash", "source"]) || ext.namespace !== PROCESS_FLOW_EXTENSION_NAMESPACE2 || typeof ext.schemaVersion !== "string" || !closed(ext.scope, ["kind"]) || ext.scope.kind !== "document" || typeof ext.validation !== "string" || typeof ext.contentHash !== "string" || ext.source !== void 0 && typeof ext.source !== "string") {
        refuse("Unsupported extension on process@1 scene");
      }
    }
  }
  if (!isRecord(entities) || !isRecord(relations)) refuse();
  const nodes = Object.entries(entities);
  const edges = Object.entries(relations);
  if (nodes.length === 0 || nodes.length > 80 || edges.length > 240) refuse();
  for (const [id, entity] of nodes) {
    if (!id.startsWith("entity:") || !closed(entity, ["id", "profile", "type", "attributes"]) || typeof entity.id !== "string" || typeof entity.profile !== "string" || typeof entity.type !== "string" || !isClosedAttributes(entity.attributes)) {
      refuse();
    }
  }
  for (const [id, relation] of edges) {
    if (!id.startsWith("relation:") || !closed(relation, ["id", "profile", "type", "endpoints", "attributes"]) || typeof relation.id !== "string" || typeof relation.profile !== "string" || typeof relation.type !== "string" || !Array.isArray(relation.endpoints) || !relation.endpoints.every(
      (ep) => closed(ep, ["role", "target"]) && typeof ep.role === "string" && typeof ep.target === "string"
    ) || !isClosedAttributes(relation.attributes)) {
      refuse();
    }
  }
  const engineDoc = prepareGenericSceneForEngine(scene, refuse);
  const diagnostics = validateSceneDocument(engineDoc, {
    registry: focusSceneRegistry,
    bindings: focusSceneBindings
  });
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    refuse(`Unsupported diagram-core document: ${errors.map((d) => d.message).join("; ")}`);
  }
  return engineDoc;
}
function parseFlowchartToScene(source, id, profile = "process@1") {
  const lines = String(source ?? "").trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = /^flowchart (LR|TB|TD)$/.exec(lines.shift() ?? "");
  if (header === null) {
    throw new Error("Unsupported diagram: use ecosystem:<scene> or the documented Mermaid flowchart profile");
  }
  const direction = header[1];
  const isProcess = profile === "process@1";
  const entities = {};
  const relations = {};
  const pairCounts = /* @__PURE__ */ new Map();
  let edgeCount = 0;
  for (const line of lines) {
    const node = /^([a-z][a-z0-9_-]*)\["([^"<>\n]+)"\]$/.exec(line);
    const edge = /^([a-z][a-z0-9_-]*) -->\|([^|<>\n]+)\| ([a-z][a-z0-9_-]*)$/.exec(line);
    if (node !== null) {
      const entityId = `entity:${node[1]}`;
      if (Object.hasOwn(entities, entityId)) {
        throw new Error(`Duplicate diagram node: ${node[1]}`);
      }
      entities[entityId] = {
        id: entityId,
        profile,
        type: isProcess ? "step" : "node",
        attributes: { name: { kind: "text", value: node[2] } }
      };
    } else if (edge !== null) {
      edgeCount += 1;
      const pairKey = `${edge[1]}.${edge[3]}`;
      const ordinal = (pairCounts.get(pairKey) ?? 0) + 1;
      pairCounts.set(pairKey, ordinal);
      const relationId = ordinal === 1 ? `relation:${pairKey}` : `relation:${pairKey}.${ordinal}`;
      relations[relationId] = {
        id: relationId,
        profile,
        type: isProcess ? "transition" : "link",
        endpoints: [
          { role: "source", target: `entity:${edge[1]}` },
          { role: "target", target: `entity:${edge[3]}` }
        ],
        attributes: { label: { kind: "text", value: edge[2] } }
      };
    } else {
      throw new Error(`Unsupported flowchart line: ${line}`);
    }
  }
  const entityCount = Object.keys(entities).length;
  if (entityCount === 0 || entityCount > 80 || edgeCount > 160) {
    throw new Error("Diagram needs 1\u201380 nodes and at most 160 edges");
  }
  const scene = {
    documentId: `document:${id}`,
    schemaVersion: { major: 1, minor: 1 },
    revision: 0,
    profileRefs: [profile],
    typeDefinitions: {},
    entities,
    relations,
    ports: {},
    resources: {},
    extensions: isProcess && (direction === "TB" || direction === "TD") ? [createProcessDirectionExtension("TB")] : []
  };
  validateCheckedFocusScene(scene);
  return { scene, direction };
}
function sceneToMermaidFallback(scene) {
  let direction = "LR";
  if (Array.isArray(scene.extensions)) {
    const ext = scene.extensions.find((item) => item?.namespace === PROCESS_FLOW_EXTENSION_NAMESPACE2);
    if (ext && typeof ext.source === "string") {
      try {
        const parsed = JSON.parse(ext.source);
        if (parsed?.direction === "TB" || parsed?.direction === "TD") direction = parsed.direction;
      } catch {
      }
    }
  }
  const entries = Object.entries(scene.entities);
  const ids = new Map(entries.map(([id], index) => [id, `node${index}`]));
  const lines = [`flowchart ${direction}`];
  for (const [id, entity] of entries) {
    lines.push(`${ids.get(id)}[${JSON.stringify(textAttr2(entity, "name") ?? id)}]`);
  }
  for (const relation of Object.values(scene.relations)) {
    if (relation.type !== "link" && relation.type !== "transition") continue;
    const from = relation.endpoints?.find((e) => e.role === "source")?.target;
    const to = relation.endpoints?.find((e) => e.role === "target")?.target;
    if (!ids.has(from) || !ids.has(to)) continue;
    const label = textAttr2(relation, "label");
    lines.push(`${ids.get(from)} -->|${label ? label.replace(/\|/g, "&#124;") : " "}| ${ids.get(to)}`);
  }
  return lines.join("\n");
}
function resolveDossierDiagramScene(section, options = {}) {
  const catalog = options.ecosystemCatalog ?? ecosystem_default;
  if (section.sourceRef !== void 0) {
    throw new Error(
      `Reference diagram "${section.id}" (${section.renderComponent} -> ${section.sourceRef}) requires a host diagramResolver; offline portable bundles support inline diagrams only`
    );
  }
  const diagramType = section.diagramType;
  if (diagramType !== void 0 && diagramType !== "workflow" && diagramType !== "architecture") {
    throw new Error(
      `Diagram "${section.id}": diagramType "${diagramType}" is not supported by the offline Focus builder in Lot 1 (supported: "workflow", "architecture")`
    );
  }
  const catalogByDocId = new Map(
    Object.values(catalog.scenes).map((entry) => [
      entry.document.documentId,
      { title: entry.title, description: entry.description }
    ])
  );
  if (section.scene !== void 0) {
    validateCheckedFocusScene(section.scene);
    const profile = section.scene.profileRefs[0];
    if (diagramType === "architecture" && profile !== "generic@1") {
      throw new Error(`Diagram "${section.id}": diagramType "architecture" requires a generic@1 scene in Lot 1 (received ${profile})`);
    }
    if (diagramType === "workflow" && profile !== "process@1") {
      throw new Error(`Diagram "${section.id}": diagramType "workflow" requires a process@1 scene (received ${profile})`);
    }
    const matched = profile === "generic@1" && typeof section.scene.documentId === "string" ? catalogByDocId.get(section.scene.documentId) : void 0;
    const enrichment = matched ? { ...matched, ecosystemIcons: true } : void 0;
    return {
      scene: section.scene,
      source: sceneToMermaidFallback(section.scene),
      renderedAsArchitecture: profile === "generic@1",
      direction: "LR",
      ...enrichment ? { enrichment } : {}
    };
  }
  if (section.syntax !== "mermaid") {
    throw new Error("Unsupported diagram syntax: use mermaid flowcharts or ecosystem references");
  }
  if (section.source.startsWith("ecosystem:")) {
    if (diagramType === "workflow") {
      throw new Error(`Diagram "${section.id}": ecosystem references represent architecture components and cannot use diagramType "workflow"`);
    }
    const name = section.source.slice("ecosystem:".length);
    if (!Object.hasOwn(catalog.scenes, name)) {
      throw new Error(`Unknown ecosystem scene: ${name}`);
    }
    const entry = catalog.scenes[name];
    validateCheckedFocusScene(entry.document);
    const enrichment = { title: entry.title, description: entry.description, ecosystemIcons: true };
    const fallback = sceneToMermaidFallback(entry.document) + "\n" + entry.description.split("\n").map((line) => `%% ${line}`).join("\n");
    return {
      scene: entry.document,
      source: fallback,
      renderedAsArchitecture: true,
      direction: "LR",
      enrichment
    };
  }
  const targetProfile = diagramType === "architecture" ? "generic@1" : "process@1";
  const { scene, direction } = parseFlowchartToScene(section.source, section.id, targetProfile);
  return {
    scene,
    source: section.source,
    renderedAsArchitecture: targetProfile === "generic@1",
    direction
  };
}
function findLinearChainArchitectureWarning(sectionId, scene) {
  if (!isRecord(scene) || !isRecord(scene.entities) || !isRecord(scene.relations)) {
    return void 0;
  }
  const entities = Object.values(scene.entities);
  const relations = Object.values(scene.relations);
  if (entities.some((e) => e?.type === "container") || relations.some((r) => r?.type === "contains")) {
    return void 0;
  }
  const n = entities.length;
  const links = relations.filter((r) => r?.type === "link");
  if (n < 3 || links.length !== n - 1 || links.length !== relations.length) {
    return void 0;
  }
  const nodeIds = new Set(entities.map((e) => e.id));
  const inDegree = new Map([...nodeIds].map((id) => [id, 0]));
  const nextOf = /* @__PURE__ */ new Map();
  for (const link of links) {
    const src = link.endpoints?.find((ep) => ep.role === "source")?.target;
    const dst = link.endpoints?.find((ep) => ep.role === "target")?.target;
    if (!nodeIds.has(src) || !nodeIds.has(dst) || src === dst || nextOf.has(src)) {
      return void 0;
    }
    nextOf.set(src, dst);
    inDegree.set(dst, (inDegree.get(dst) ?? 0) + 1);
  }
  let startId;
  let endCount = 0;
  for (const id of nodeIds) {
    const ind = inDegree.get(id) ?? 0;
    const outd = nextOf.has(id) ? 1 : 0;
    if (ind === 0 && outd === 1) {
      if (startId !== void 0) return void 0;
      startId = id;
    } else if (ind === 1 && outd === 0) {
      endCount += 1;
    } else if (!(ind === 1 && outd === 1)) {
      return void 0;
    }
  }
  if (startId === void 0 || endCount !== 1) return void 0;
  const visited = /* @__PURE__ */ new Set();
  for (let current = startId; current !== void 0; current = nextOf.get(current)) {
    if (visited.has(current)) return void 0;
    visited.add(current);
  }
  if (visited.size !== n) return void 0;
  return `linear_chain_as_architecture_cards: ${sectionId} (${n} nodes, 0 containers) \u2014 set diagramType "workflow" if this describes a process`;
}
function parseCatalogRoles(description) {
  const roles = /* @__PURE__ */ new Map();
  if (!description) return roles;
  for (const line of String(description).split(/\r?\n/)) {
    const idx = line.indexOf(" : ");
    if (idx > 0) roles.set(line.slice(0, idx).trim(), line.slice(idx + 3).trim());
  }
  return roles;
}
function buildPresentation(scene, enrichment) {
  const isProcess = scene.profileRefs.length === 1 && scene.profileRefs[0] === "process@1";
  if (isProcess) {
    return { contractPin: PRESENTATION_CONTRACT_PIN, entities: {}, legends: {}, categoryTokens: [] };
  }
  const hasChildren = /* @__PURE__ */ new Set();
  for (const rel of Object.values(scene.relations ?? {})) {
    if (rel.type === "contains") {
      const parent = rel.endpoints?.find((ep) => ep.role === "parent")?.target;
      if (parent) hasChildren.add(parent);
    }
  }
  const catalogRoles = parseCatalogRoles(enrichment?.description);
  const useEcosystemIcons = Boolean(enrichment?.ecosystemIcons);
  const entities = {};
  for (const entity of Object.values(scene.entities ?? {})) {
    const isZone = entity.type === "container" && hasChildren.has(entity.id);
    const title = textAttr2(entity, "name") ?? entity.id;
    const kicker = textAttr2(entity, "kicker");
    const explicitBody = textAttr2(entity, "description");
    const catalogBody = !isZone && !explicitBody ? catalogRoles.get(title) : void 0;
    const body = explicitBody ?? catalogBody;
    const footer = textAttr2(entity, "footer");
    const explicitIcon = textAttr2(entity, "icon");
    const ecoIcon = useEcosystemIcons ? ECOSYSTEM_ICONS[entity.id] : void 0;
    const icon = explicitIcon ?? ecoIcon;
    entities[occurrenceRef2(`e.${localIdOf2(entity.id)}`)] = {
      form: isZone ? "container" : "card",
      text: {
        title,
        ...kicker ? { kicker } : {},
        ...body ? isZone ? { subtitle: body } : { body } : {},
        ...footer ? { footer } : {}
      },
      ...icon ? { icon } : {}
    };
  }
  return { contractPin: PRESENTATION_CONTRACT_PIN, entities, legends: {}, categoryTokens: [] };
}
function decorateStaticSvg(svg, variantName) {
  const withoutToggles = svg.replace(/<g class="st-diagramCard-toggle"[\s\S]*?<\/g>/g, "");
  const prefix = '<svg xmlns="http://www.w3.org/2000/svg"';
  const attrs = ` class="ds-diagram-svg" data-variant="${variantName}"`;
  if (withoutToggles.startsWith(prefix)) {
    return `${prefix}${attrs}${withoutToggles.slice(prefix.length)}`;
  }
  return withoutToggles.replace("<svg ", `<svg${attrs} `);
}
function renderVariant(engineDoc, scene, presentation, targetWidth, variantName, title) {
  const isProcess = engineDoc.profileRefs[0] === "process@1";
  const containers = isProcess ? [] : Object.entries(presentation.entities).filter(([, ent]) => ent.form === "container").map(([occId]) => occId);
  const input = {
    document: engineDoc,
    registry: focusSceneRegistry,
    bindings: focusSceneBindings,
    presentation,
    measureLines: isProcess ? processMeasureLines : measureLines,
    containers,
    targetWidth,
    collapsed: []
  };
  let drawing;
  try {
    drawing = renderSceneSvg(input, isProcess ? { title } : { title, measure });
  } catch (error) {
    const result = layoutScene(input);
    if (result.status !== "laid-out") {
      const diagnostics = [...result.refusals ?? [], ...result.diagnostics ?? []].map((d) => ({
        code: d.code ?? "scene-refused",
        slot: d.slot ?? "scene",
        entityId: d.entityId ?? d.path ?? engineDoc.documentId,
        neededPx: d.neededPx ?? 1,
        allocatedPx: d.allocatedPx ?? 0,
        ...d.text ? { text: d.text } : d.message ? { text: d.message } : {}
      }));
      return { kind: "refused", diagnostics };
    }
    throw error;
  }
  const cardDiagnostics = drawing.scene.nodes.flatMap((node) => {
    if (node.kind === "process" || node.kind === "erd") return [];
    const opts = { entityId: node.entity, resolveGlyph: (name) => DIAGRAM_GLYPHS[name] };
    const projected = node.kind === "zone" ? projectZoneProps(node.presentation, {
      ...opts,
      collapsed: node.collapsed,
      width: node.rect.width,
      height: node.rect.height
    }) : projectCardProps(node.presentation, opts);
    if (projected.kind === "label") return [];
    const layoutResult = projected.kind === "zone" ? layoutZone({ ...projected.props, autoSize: true }, measure) : layoutCard({ ...projected.props, height: node.rect.height, autoSize: true }, measure);
    return layoutResult.diagnostics.filter(
      (item) => (item.code === "card-overflow" || item.code === "zone-overflow") && item.reason !== "fallback-v1"
    );
  });
  const warningDiagnostics = (drawing.result.warnings ?? []).filter(({ code }) => LAYOUT_FAILURES.has(code) || code.endsWith("-overflow")).map((w) => ({
    code: w.code,
    slot: w.slot ?? "scene",
    entityId: w.entityId ?? engineDoc.documentId,
    neededPx: w.neededPx ?? 1,
    allocatedPx: w.allocatedPx ?? 0,
    ...w.text ? { text: w.text } : w.message ? { text: w.message } : {}
  }));
  const blocking = [...cardDiagnostics, ...warningDiagnostics];
  if (blocking.length > 0) {
    return { kind: "refused", diagnostics: blocking };
  }
  const widthMatch = /width="([^"]+)"/.exec(drawing.svg);
  const scaleMatch = /data-display-scale="([^"]+)"/.exec(drawing.svg);
  const boundsW = drawing.scene.bounds?.width ?? Number(widthMatch?.[1] ?? 0);
  const boundsH = drawing.scene.bounds?.height ?? 0;
  const displayWidth = Math.ceil(Number(widthMatch?.[1] ?? boundsW));
  const displayScale = Number(scaleMatch?.[1] ?? 1);
  const cards = drawing.scene.nodes.filter((node) => node.kind === "card").map((node) => node.entity);
  const zones = drawing.scene.nodes.filter((node) => node.kind === "zone").map((node) => node.entity);
  const steps = drawing.scene.nodes.filter((node) => node.kind === "process").map((node) => node.entity);
  const edges = (drawing.scene.edges ?? []).map((edge) => ({
    id: edge.occurrence,
    from: edge.from,
    to: edge.to,
    style: edge.strokeStyle ?? "solid",
    label: edge.label ?? ""
  }));
  return {
    kind: "rendered",
    variant: {
      svg: decorateStaticSvg(drawing.svg, variantName),
      width: Math.ceil(boundsW),
      height: Math.ceil(boundsH),
      displayWidth,
      displayScale,
      orientation: drawing.scene.r7Connectors ? drawing.scene.orientation ?? "LR" : void 0,
      problems: [],
      cards,
      zones,
      steps,
      panels: [],
      edges
    }
  };
}
function renderDossierDiagram(scene, options = {}) {
  let engineDoc;
  try {
    engineDoc = validateCheckedFocusScene(scene);
  } catch (error) {
    return {
      kind: "refused",
      diagnostics: [
        {
          code: "diagram-source-unsupported",
          slot: "scene",
          entityId: scene?.documentId ?? "diagram",
          neededPx: 1,
          allocatedPx: 0,
          text: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
  const isProcess = engineDoc.profileRefs[0] === "process@1";
  const presentation = buildPresentation(scene, options.enrichment);
  const title = options.title ?? options.alt ?? engineDoc.documentId;
  const wide = renderVariant(engineDoc, scene, presentation, 1440, "wide", title);
  if (wide.kind !== "rendered") return wide;
  const narrow = renderVariant(engineDoc, scene, presentation, FOCUS_PROCESS_TARGET_WIDTH, "narrow", title);
  if (narrow.kind !== "rendered") return narrow;
  let phoneVariant;
  if (isProcess && narrow.variant.displayWidth > FOCUS_PHONE_TARGET_WIDTH) {
    const phone = renderVariant(engineDoc, scene, presentation, FOCUS_PHONE_TARGET_WIDTH, "phone", title);
    if (phone.kind !== "rendered") return phone;
    if (phone.variant.displayWidth < narrow.variant.displayWidth) {
      phoneVariant = phone.variant;
    }
  }
  return {
    kind: "rendered",
    renderer: "r7",
    profile: engineDoc.profileRefs[0],
    wide: wide.variant,
    narrow: narrow.variant,
    ...phoneVariant ? { phone: phoneVariant } : {},
    ...isProcess ? { processTable: renderProcessTable(engineDoc) } : {}
  };
}

// src/diagram-model.js
var DS_RENDER_PRIMITIVES = {
  renderCardSvg,
  renderZoneSvg,
  renderProcessTable,
  DIAGRAM_GLYPHS,
  CARD_GEOMETRY,
  ZONE_GEOMETRY,
  cardLineMeasurer,
  defaultCardMeasure,
  sceneCardMeasure,
  layoutScene: layoutScene2
};
function renderR7Diagram(document, options = {}) {
  return renderDossierDiagram(document, options);
}
var CARD = { width: 460, height: 200 };
var ZONE_INSET = 16;
var GRID = { columns: 2, columnGap: 60, rowGap: 50 };
function containmentOf(document) {
  const children = /* @__PURE__ */ new Map([[void 0, []]]);
  const parents = /* @__PURE__ */ new Map();
  for (const relation of Object.values(document.relations)) {
    if (relation.type !== "contains") continue;
    const parent = relation.endpoints.find((e) => e.role === "parent").target;
    const child = relation.endpoints.find((e) => e.role === "child").target;
    parents.set(child, parent);
  }
  for (const entity of Object.values(document.entities)) {
    const parent = parents.get(entity.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  return { children, parents };
}
function projectionOf(entity) {
  return { entityId: entity.id, kicker: entity.type, title: entity.attributes.name.value };
}
function interimLayout(document) {
  const { children, parents } = containmentOf(document);
  const zones = new Set(
    Object.values(document.entities).filter((entity) => entity.type === "container" && (children.get(entity.id)?.length ?? 0) > 0).map((entity) => entity.id)
  );
  const widths = /* @__PURE__ */ new Map();
  const widthOf = (entityId) => {
    if (widths.has(entityId)) return widths.get(entityId);
    let width = CARD.width;
    if (zones.has(entityId)) {
      const siblings = children.get(entityId) ?? [];
      let max = CARD.width + 2 * ZONE_INSET;
      let row = ZONE_INSET;
      const flush = () => {
        max = Math.max(max, row + ZONE_INSET);
      };
      for (const [index, sibling] of siblings.entries()) {
        if (index % GRID.columns === 0 && index) {
          flush();
          row = ZONE_INSET;
        }
        row += (row > ZONE_INSET ? GRID.columnGap : 0) + widthOf(sibling.id);
      }
      flush();
      width = max;
    }
    widths.set(entityId, width);
    return width;
  };
  const refusals = [];
  const contentTops = /* @__PURE__ */ new Map();
  for (const zoneId of zones) {
    const probe = renderZoneSvg(
      { ...projectionOf(document.entities[zoneId]), collapsed: false, x: 0, y: 0, width: widthOf(zoneId) },
      { children: [] }
    );
    if (probe.kind === "refused") refusals.push(...probe.diagnostics);
    else contentTops.set(zoneId, probe.layout.header.contentTop);
  }
  const nodes = [];
  const boxes = /* @__PURE__ */ new Map();
  if (refusals.length === 0) place(void 0);
  function place(parentId) {
    const siblings = children.get(parentId) ?? [];
    const parented = parentId !== void 0;
    let rowY = parented ? contentTops.get(parentId) : 0;
    let rowHeight = 0;
    let x = parented ? ZONE_INSET : 0;
    for (const [index, entity] of siblings.entries()) {
      const size = zones.has(entity.id) ? { width: widthOf(entity.id), height: place(entity.id).height } : CARD;
      if (zones.has(entity.id)) boxes.set(entity.id, size);
      if (index % GRID.columns === 0 && index) {
        rowY += rowHeight + GRID.rowGap;
        x = parented ? ZONE_INSET : 0;
        rowHeight = 0;
      }
      nodes.push({
        id: entity.id,
        type: "ecosystem",
        position: { x, y: rowY },
        ...parented ? { parentId, extent: "parent" } : {},
        ...zones.has(entity.id) ? { style: `width: ${size.width}px; height: ${size.height}px;` } : {},
        data: { label: entity.attributes.name.value, container: zones.has(entity.id) }
      });
      x += size.width + GRID.columnGap;
      rowHeight = Math.max(rowHeight, size.height);
    }
    return { height: rowY + rowHeight + ZONE_INSET };
  }
  const depth = (id) => {
    let n = 0;
    for (; parents.has(id); id = parents.get(id)) n++;
    return n;
  };
  nodes.sort((a, b) => depth(a.id) - depth(b.id));
  return { nodes, boxes, contentTops, refusals };
}
function renderDiagramViews(document, options = {}) {
  const layout = interimLayout(document);
  if (layout.refusals.length) return { kind: "refused", diagnostics: layout.refusals };
  const align = options.align === "center" ? { align: "center" } : {};
  const views = {};
  const refusals = [];
  for (const entity of Object.values(document.entities)) {
    const props = { ...projectionOf(entity), ...align };
    if (!layout.boxes.has(entity.id)) {
      const card = renderCardSvg({ ...props, body: [] });
      if (card.kind === "refused") refusals.push(...card.diagnostics);
      else views[entity.id] = { kind: "card", svg: card.svg };
      continue;
    }
    const { width, height } = layout.boxes.get(entity.id);
    const expanded = renderZoneSvg({ ...props, collapsed: false, x: 0, y: 0, width, height }, { children: [] });
    const folded = expanded.kind === "rendered" ? renderZoneSvg({ ...props, collapsed: true, x: 0, y: 0, toggleLabel: `D\xE9plier : ${entity.attributes.name.value}` }, { children: [] }) : null;
    if (expanded.kind === "refused" || folded?.kind === "refused") {
      refusals.push(...expanded.kind === "refused" ? expanded.diagnostics : []);
      if (folded?.kind === "refused") refusals.push(...folded.diagnostics);
    } else {
      views[entity.id] = { kind: "zone", svg: expanded.svg, foldedSvg: folded.svg };
    }
  }
  return refusals.length ? { kind: "refused", diagnostics: refusals } : { kind: "rendered", views };
}
export {
  CARD_GEOMETRY,
  DIAGRAM_GLYPHS,
  DS_RENDER_PRIMITIVES,
  FOCUS_PHONE_TARGET_WIDTH,
  FOCUS_PROCESS_TARGET_WIDTH,
  ZONE_GEOMETRY,
  cardLineMeasurer,
  containmentOf,
  createProcessDirectionExtension,
  defaultCardMeasure,
  findLinearChainArchitectureWarning,
  focusSceneBindings,
  focusSceneRegistry,
  foldableGenericProfile,
  interimLayout,
  layoutScene2 as layoutScene,
  parseFlowchartToScene,
  projectionOf,
  renderCardSvg,
  renderDiagramViews,
  renderDossierDiagram,
  renderProcessTable,
  renderR7Diagram,
  renderZoneSvg,
  resolveDossierDiagramScene,
  sceneCardMeasure,
  sceneToMermaidFallback,
  validateCheckedFocusScene
};
