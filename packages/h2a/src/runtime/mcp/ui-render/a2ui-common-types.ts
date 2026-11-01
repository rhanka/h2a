/**
 * GENERATED FILE — do not edit. Regenerate with `npm run catalog:generate` in
 * packages/elements (the generator is the single source, §5.1).
 *
 * Mirrored verbatim into @sentropic/h2a (json-render L3) from
 * sent-tech-design-system cc29be886b543ffa29592afbc6b4482c104b1fb4
 * `packages/elements/src/generated/a2ui-common-types.ts`: the vendored
 * elements build (29 files) carries no Node-side schema set, so h2a compiles
 * the vendored catalogue entries against the same registered documents the
 * DS validator uses. Any catalogue refresh must re-mirror this file.
 *
 * 1. common_types.json, vendored from @a2ui/web_core@0.14.0
 *    (src/v0_9/schemas — the installed SDK ships no v0_9_1 schema set; only
 *    v0_8, v0_9 and v1_0 exist, measured). Original $id https://a2ui.org/specification/v0_9/common_types.json,
 *    sha256 a7a349b1e9abda9dbdf2342ac9ac671d8da7a8576c7b29a9786331faf70b9900; $id rewritten to
 *    https://a2ui.org/specification/v0_9_1/common_types.json — the URI the catalogue's entries
 *    reference ComponentCommon by (§5.2).
 *
 * 2. catalog.json, BUILT (not vendored): the sibling URI common_types
 *    references anyFunction by (https://a2ui.org/specification/v0_9_1/catalog.json), carrying
 *    the single anyFunction definition of an EMPTY function set (§5.2
 *    `functions: {}`): the empty union `{ "not": {} }`, exactly as the
 *    SDK serialises one (schema_serializer.js EMPTY_UNION). The A2UI
 *    basic catalogue is deliberately NOT vendored — no A2UI function or
 *    basic component may validate inside an envelope (§4.1, §4.2).
 *
 * The validator registers both documents under their $ids so every entry
 * reference resolves without network or file access.
 */
export const a2uiCommonTypes: Record<string, unknown> = {
  "$defs": {
    "AccessibilityAttributes": {
      "description": "Attributes to enhance accessibility when using assistive technologies like screen readers.",
      "properties": {
        "description": {
          "$ref": "#/$defs/DynamicString",
          "description": "Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'."
        },
        "label": {
          "$ref": "#/$defs/DynamicString",
          "description": "A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'."
        }
      },
      "type": "object"
    },
    "Action": {
      "description": "Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.",
      "oneOf": [
        {
          "additionalProperties": false,
          "description": "Triggers a server-side event.",
          "properties": {
            "event": {
              "additionalProperties": false,
              "description": "The event to dispatch to the server.",
              "properties": {
                "context": {
                  "additionalProperties": {
                    "$ref": "#/$defs/DynamicValue"
                  },
                  "description": "A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.",
                  "type": "object"
                },
                "name": {
                  "description": "The name of the action to be dispatched to the server.",
                  "type": "string"
                }
              },
              "required": [
                "name"
              ],
              "type": "object"
            }
          },
          "required": [
            "event"
          ],
          "type": "object"
        },
        {
          "additionalProperties": false,
          "description": "Executes a local client-side function.",
          "properties": {
            "functionCall": {
              "$ref": "#/$defs/FunctionCall"
            }
          },
          "required": [
            "functionCall"
          ],
          "type": "object"
        }
      ]
    },
    "CheckRule": {
      "additionalProperties": false,
      "description": "A single validation rule applied to an input component.",
      "properties": {
        "condition": {
          "$ref": "#/$defs/DynamicBoolean"
        },
        "message": {
          "description": "The error message to display if the check fails.",
          "type": "string"
        }
      },
      "required": [
        "condition",
        "message"
      ],
      "type": "object"
    },
    "Checkable": {
      "description": "Properties for components that support client-side checks.",
      "properties": {
        "checks": {
          "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
          "items": {
            "$ref": "#/$defs/CheckRule"
          },
          "type": "array"
        }
      },
      "type": "object"
    },
    "ChildList": {
      "oneOf": [
        {
          "description": "A static list of child component IDs.",
          "items": {
            "$ref": "#/$defs/ComponentId"
          },
          "type": "array"
        },
        {
          "additionalProperties": false,
          "description": "A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.",
          "properties": {
            "componentId": {
              "$ref": "#/$defs/ComponentId"
            },
            "path": {
              "description": "The path to the list of component property objects in the data model.",
              "type": "string"
            }
          },
          "required": [
            "componentId",
            "path"
          ],
          "type": "object"
        }
      ]
    },
    "ComponentCommon": {
      "properties": {
        "accessibility": {
          "$ref": "#/$defs/AccessibilityAttributes"
        },
        "id": {
          "$ref": "#/$defs/ComponentId"
        }
      },
      "required": [
        "id"
      ],
      "type": "object"
    },
    "ComponentId": {
      "description": "The unique identifier for a component, used for both definitions and references within the same surface.",
      "type": "string"
    },
    "DataBinding": {
      "additionalProperties": false,
      "properties": {
        "path": {
          "description": "A JSON Pointer path to a value in the data model.",
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "type": "object"
    },
    "DynamicBoolean": {
      "description": "A boolean value that can be a literal, a path, or a function call returning a boolean.",
      "oneOf": [
        {
          "type": "boolean"
        },
        {
          "$ref": "#/$defs/DataBinding"
        },
        {
          "allOf": [
            {
              "$ref": "#/$defs/FunctionCall"
            },
            {
              "properties": {
                "returnType": {
                  "const": "boolean"
                }
              }
            }
          ]
        }
      ]
    },
    "DynamicNumber": {
      "description": "Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.",
      "oneOf": [
        {
          "type": "number"
        },
        {
          "$ref": "#/$defs/DataBinding"
        },
        {
          "allOf": [
            {
              "$ref": "#/$defs/FunctionCall"
            },
            {
              "properties": {
                "returnType": {
                  "const": "number"
                }
              }
            }
          ]
        }
      ]
    },
    "DynamicString": {
      "description": "Represents a string",
      "oneOf": [
        {
          "type": "string"
        },
        {
          "$ref": "#/$defs/DataBinding"
        },
        {
          "allOf": [
            {
              "$ref": "#/$defs/FunctionCall"
            },
            {
              "properties": {
                "returnType": {
                  "const": "string"
                }
              }
            }
          ]
        }
      ]
    },
    "DynamicStringList": {
      "description": "Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.",
      "oneOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "$ref": "#/$defs/DataBinding"
        },
        {
          "allOf": [
            {
              "$ref": "#/$defs/FunctionCall"
            },
            {
              "properties": {
                "returnType": {
                  "const": "array"
                }
              }
            }
          ]
        }
      ]
    },
    "DynamicValue": {
      "description": "A value that can be a literal, a path, or a function call returning any type.",
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "array"
        },
        {
          "$ref": "#/$defs/DataBinding"
        },
        {
          "$ref": "#/$defs/FunctionCall"
        }
      ]
    },
    "FunctionCall": {
      "description": "Invokes a named function on the client.",
      "oneOf": [
        {
          "$ref": "catalog.json#/$defs/anyFunction"
        }
      ],
      "properties": {
        "args": {
          "additionalProperties": {
            "anyOf": [
              {
                "$ref": "#/$defs/DynamicValue"
              },
              {
                "description": "A literal object argument (e.g. configuration).",
                "type": "object"
              }
            ]
          },
          "description": "Arguments passed to the function.",
          "type": "object"
        },
        "call": {
          "description": "The name of the function to call.",
          "type": "string"
        },
        "returnType": {
          "default": "boolean",
          "description": "The expected return type of the function call.",
          "enum": [
            "any",
            "array",
            "boolean",
            "number",
            "object",
            "string",
            "void"
          ],
          "type": "string"
        }
      },
      "required": [
        "call"
      ],
      "type": "object"
    }
  },
  "$id": "https://a2ui.org/specification/v0_9_1/common_types.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Common type definitions used across A2UI schemas.",
  "title": "A2UI Common Types"
};

export const a2uiSdkCatalogSchema: Record<string, unknown> = {
  "$defs": {
    "anyFunction": {
      "not": {}
    }
  },
  "$id": "https://a2ui.org/specification/v0_9_1/catalog.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema"
};
