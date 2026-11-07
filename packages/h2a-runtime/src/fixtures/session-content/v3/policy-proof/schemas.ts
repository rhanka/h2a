/**
 * Shape-only schema projection of the 17 sealed r3 ContentPolicy records.
 * Only reachable definitions are included; original bytes and sha256 are
 * retained beside this module. No semantic or authority acceptance.
 */
export const policySchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "ContentPolicyV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "policy"
        },
        "policyId": {
          "$ref": "#/$defs/Id"
        },
        "policyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "bindingId": {
          "$ref": "#/$defs/Id"
        },
        "approvedRegistrationRef": {
          "$ref": "#/$defs/RevisionRef"
        },
        "projectId": {
          "oneOf": [
            {
              "$ref": "#/$defs/Id"
            },
            {
              "type": "null"
            }
          ]
        },
        "sourceBinding": {
          "$ref": "#/$defs/PolicySourceBinding"
        },
        "channels": {
          "type": "object",
          "properties": {
            "session.events": {
              "$ref": "#/$defs/RetainedChannel"
            },
            "terminal.live": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean"
                }
              },
              "required": [
                "enabled"
              ],
              "additionalProperties": false
            },
            "terminal.cache": {
              "$ref": "#/$defs/RetainedChannel"
            },
            "native.mirror": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean"
                },
                "retention": {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "kind": {
                          "const": "none"
                        }
                      },
                      "required": [
                        "kind"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "kind": {
                          "const": "finite"
                        },
                        "durationMs": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 315576000000
                        }
                      },
                      "required": [
                        "kind",
                        "durationMs"
                      ],
                      "additionalProperties": false
                    }
                  ]
                },
                "nativeFormat": {
                  "oneOf": [
                    {
                      "$ref": "#/$defs/Id"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "permittedRangeRef": {
                  "oneOf": [
                    {
                      "$ref": "#/$defs/RevisionRef"
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "required": [
                "enabled",
                "retention",
                "nativeFormat",
                "permittedRangeRef"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "session.events",
            "terminal.live",
            "terminal.cache",
            "native.mirror"
          ],
          "additionalProperties": false
        },
        "createdAt": {
          "$ref": "#/$defs/Timestamp"
        }
      },
      "required": [
        "format",
        "kind",
        "policyId",
        "policyRevision",
        "bindingId",
        "approvedRegistrationRef",
        "projectId",
        "sourceBinding",
        "channels",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "ContentPolicyNonceV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "policy-nonce"
            },
            "nonceId": {
              "$ref": "#/$defs/RandomId"
            },
            "nonce": {
              "$ref": "#/$defs/Key32"
            },
            "proposalId": {
              "$ref": "#/$defs/RandomId"
            },
            "policyOperationId": {
              "$ref": "#/$defs/RandomId"
            },
            "purpose": {
              "enum": [
                "share",
                "amend"
              ]
            },
            "target": {
              "$ref": "#/$defs/Target"
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "priorPolicyDigest": {
              "oneOf": [
                {
                  "$ref": "#/$defs/Digest"
                },
                {
                  "type": "null"
                }
              ]
            },
            "expectedPolicyRevision": {
              "$ref": "#/$defs/Counter"
            },
            "sourceDenialFloor": {
              "$ref": "#/$defs/Counter"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "nonceId",
            "nonce",
            "proposalId",
            "policyOperationId",
            "purpose",
            "target",
            "policyDigest",
            "priorPolicyDigest",
            "expectedPolicyRevision",
            "sourceDenialFloor",
            "issuedAt",
            "expiresAt",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyIntentV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "policy-intent"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "purpose": {
          "enum": [
            "share",
            "amend"
          ]
        },
        "expectedPolicyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "priorPolicyDigest": {
          "oneOf": [
            {
              "$ref": "#/$defs/Digest"
            },
            {
              "type": "null"
            }
          ]
        },
        "policy": {
          "$ref": "#/$defs/ContentPolicyV1"
        }
      },
      "required": [
        "format",
        "kind",
        "policyOperationId",
        "purpose",
        "expectedPolicyRevision",
        "priorPolicyDigest",
        "policy"
      ],
      "additionalProperties": false
    },
    "ContentPolicyProposalV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "policy-proposal"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "purpose": {
          "enum": [
            "share",
            "amend"
          ]
        },
        "target": {
          "$ref": "#/$defs/Target"
        },
        "policy": {
          "$ref": "#/$defs/ContentPolicyV1"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "priorPolicyDigest": {
          "oneOf": [
            {
              "$ref": "#/$defs/Digest"
            },
            {
              "type": "null"
            }
          ]
        },
        "expectedPolicyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "nonce": {
          "$ref": "#/$defs/ContentPolicyNonceV1"
        }
      },
      "required": [
        "format",
        "kind",
        "proposalId",
        "policyOperationId",
        "purpose",
        "target",
        "policy",
        "policyDigest",
        "priorPolicyDigest",
        "expectedPolicyRevision",
        "nonce"
      ],
      "additionalProperties": false
    },
    "ContentPolicyChallengeRequestV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "challenge-request"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "purpose": {
          "enum": [
            "share",
            "amend"
          ]
        },
        "target": {
          "$ref": "#/$defs/Target"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "priorPolicyDigest": {
          "oneOf": [
            {
              "$ref": "#/$defs/Digest"
            },
            {
              "type": "null"
            }
          ]
        },
        "expectedPolicyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "issuedAt": {
          "$ref": "#/$defs/Timestamp"
        },
        "expiresAt": {
          "$ref": "#/$defs/Timestamp"
        }
      },
      "required": [
        "format",
        "kind",
        "proposalId",
        "policyOperationId",
        "purpose",
        "target",
        "policyDigest",
        "priorPolicyDigest",
        "expectedPolicyRevision",
        "issuedAt",
        "expiresAt"
      ],
      "additionalProperties": false
    },
    "ContentPolicyNonceAckV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "nonce-ack"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "nonceDigest": {
          "$ref": "#/$defs/Digest"
        },
        "status": {
          "const": "committed"
        }
      },
      "required": [
        "format",
        "kind",
        "proposalId",
        "policyOperationId",
        "nonceDigest",
        "status"
      ],
      "additionalProperties": false
    },
    "ContentPolicyEvidenceRequestV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "evidence-request"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "purpose": {
          "enum": [
            "share",
            "amend"
          ]
        },
        "targetDigest": {
          "$ref": "#/$defs/Digest"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "priorPolicyDigest": {
          "oneOf": [
            {
              "$ref": "#/$defs/Digest"
            },
            {
              "type": "null"
            }
          ]
        },
        "expectedPolicyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "nonceId": {
          "$ref": "#/$defs/RandomId"
        },
        "sid": {
          "$ref": "#/$defs/Id"
        },
        "sessionVersion": {
          "$ref": "#/$defs/Counter"
        },
        "sessionCredential": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8192
        }
      },
      "required": [
        "format",
        "kind",
        "policyOperationId",
        "proposalId",
        "purpose",
        "targetDigest",
        "policyDigest",
        "priorPolicyDigest",
        "expectedPolicyRevision",
        "nonceId",
        "sid",
        "sessionVersion",
        "sessionCredential"
      ],
      "additionalProperties": false
    },
    "ContentPolicyIdpClaimsV1": {
      "type": "object",
      "properties": {
        "iss": {
          "$ref": "#/$defs/Id"
        },
        "sub": {
          "$ref": "#/$defs/Id"
        },
        "sid": {
          "$ref": "#/$defs/Id"
        },
        "sessionVersion": {
          "$ref": "#/$defs/Counter"
        },
        "tenantId": {
          "$ref": "#/$defs/Id"
        },
        "workspaceId": {
          "$ref": "#/$defs/Id"
        },
        "auth_time": {
          "$ref": "#/$defs/Counter"
        },
        "amr": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Id"
          },
          "minItems": 1,
          "maxItems": 8,
          "uniqueItems": true
        },
        "aud": {
          "$ref": "#/$defs/Id"
        },
        "iat": {
          "$ref": "#/$defs/Counter"
        },
        "exp": {
          "$ref": "#/$defs/Counter"
        },
        "jti": {
          "$ref": "#/$defs/RandomId"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "purpose": {
          "enum": [
            "share",
            "amend"
          ]
        },
        "targetDigest": {
          "$ref": "#/$defs/Digest"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "priorPolicyDigest": {
          "oneOf": [
            {
              "$ref": "#/$defs/Digest"
            },
            {
              "type": "null"
            }
          ]
        },
        "expectedPolicyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "nonceId": {
          "$ref": "#/$defs/RandomId"
        }
      },
      "required": [
        "iss",
        "sub",
        "sid",
        "sessionVersion",
        "tenantId",
        "workspaceId",
        "auth_time",
        "amr",
        "aud",
        "iat",
        "exp",
        "jti",
        "policyOperationId",
        "proposalId",
        "purpose",
        "targetDigest",
        "policyDigest",
        "priorPolicyDigest",
        "expectedPolicyRevision",
        "nonceId"
      ],
      "additionalProperties": false
    },
    "ContentPolicyIdpEvidenceV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "idp-evidence"
        },
        "compactJws": {
          "type": "string",
          "minLength": 1,
          "maxLength": 16384,
          "pattern": "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"
        }
      },
      "required": [
        "format",
        "kind",
        "compactJws"
      ],
      "additionalProperties": false
    },
    "ContentPolicyAppAttestationV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "app-attestation"
            },
            "actor": {
              "$ref": "#/$defs/Actor"
            },
            "tenantId": {
              "$ref": "#/$defs/Id"
            },
            "workspaceId": {
              "$ref": "#/$defs/Id"
            },
            "target": {
              "$ref": "#/$defs/Target"
            },
            "approvedRegistrationRef": {
              "$ref": "#/$defs/RevisionRef"
            },
            "policyOperationId": {
              "$ref": "#/$defs/RandomId"
            },
            "proposalId": {
              "$ref": "#/$defs/RandomId"
            },
            "purpose": {
              "enum": [
                "share",
                "amend"
              ]
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "priorPolicyDigest": {
              "oneOf": [
                {
                  "$ref": "#/$defs/Digest"
                },
                {
                  "type": "null"
                }
              ]
            },
            "expectedPolicyRevision": {
              "$ref": "#/$defs/Counter"
            },
            "nonceId": {
              "$ref": "#/$defs/RandomId"
            },
            "nonce": {
              "$ref": "#/$defs/Key32"
            },
            "membershipRevision": {
              "$ref": "#/$defs/Counter"
            },
            "role": {
              "enum": [
                "member",
                "workspace-admin",
                "workspace-owner"
              ]
            },
            "ownerConsentRevision": {
              "$ref": "#/$defs/Counter"
            },
            "sourceDenialFloor": {
              "$ref": "#/$defs/Counter"
            },
            "sessionEvidenceDigest": {
              "$ref": "#/$defs/Digest"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "actor",
            "tenantId",
            "workspaceId",
            "target",
            "approvedRegistrationRef",
            "policyOperationId",
            "proposalId",
            "purpose",
            "policyDigest",
            "priorPolicyDigest",
            "expectedPolicyRevision",
            "nonceId",
            "nonce",
            "membershipRevision",
            "role",
            "ownerConsentRevision",
            "sourceDenialFloor",
            "sessionEvidenceDigest",
            "issuedAt",
            "expiresAt",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyProofV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "policy-proof"
            },
            "policyOperationId": {
              "$ref": "#/$defs/RandomId"
            },
            "proposalId": {
              "$ref": "#/$defs/RandomId"
            },
            "purpose": {
              "enum": [
                "share",
                "amend"
              ]
            },
            "policy": {
              "$ref": "#/$defs/ContentPolicyV1"
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "priorPolicyDigest": {
              "oneOf": [
                {
                  "$ref": "#/$defs/Digest"
                },
                {
                  "type": "null"
                }
              ]
            },
            "expectedPolicyRevision": {
              "$ref": "#/$defs/Counter"
            },
            "nonce": {
              "$ref": "#/$defs/ContentPolicyNonceV1"
            },
            "idpEvidence": {
              "$ref": "#/$defs/ContentPolicyIdpEvidenceV1"
            },
            "appAttestation": {
              "$ref": "#/$defs/ContentPolicyAppAttestationV1"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "policyOperationId",
            "proposalId",
            "purpose",
            "policy",
            "policyDigest",
            "priorPolicyDigest",
            "expectedPolicyRevision",
            "nonce",
            "idpEvidence",
            "appAttestation",
            "issuedAt",
            "expiresAt",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyActivationAckV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "activation-ack"
            },
            "policyOperationId": {
              "$ref": "#/$defs/RandomId"
            },
            "proposalId": {
              "$ref": "#/$defs/RandomId"
            },
            "policyId": {
              "$ref": "#/$defs/Id"
            },
            "policyRevision": {
              "$ref": "#/$defs/Counter"
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "nonceId": {
              "$ref": "#/$defs/RandomId"
            },
            "targetDigest": {
              "$ref": "#/$defs/Digest"
            },
            "sourceDenialFloor": {
              "$ref": "#/$defs/Counter"
            },
            "nativeConsumptionRef": {
              "$ref": "#/$defs/RevisionRef"
            },
            "phase": {
              "const": "native-consumed"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "policyOperationId",
            "proposalId",
            "policyId",
            "policyRevision",
            "policyDigest",
            "nonceId",
            "targetDigest",
            "sourceDenialFloor",
            "nativeConsumptionRef",
            "phase",
            "issuedAt",
            "expiresAt",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyActivationReceiptV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "activation-receipt"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "policyRevision": {
          "$ref": "#/$defs/Counter"
        },
        "activationAckDigest": {
          "$ref": "#/$defs/Digest"
        },
        "authorityRevision": {
          "$ref": "#/$defs/Counter"
        },
        "phase": {
          "const": "activation-committed"
        },
        "committedAt": {
          "$ref": "#/$defs/Timestamp"
        },
        "expiresAt": {
          "$ref": "#/$defs/Timestamp"
        }
      },
      "required": [
        "format",
        "kind",
        "policyOperationId",
        "proposalId",
        "policyDigest",
        "policyRevision",
        "activationAckDigest",
        "authorityRevision",
        "phase",
        "committedAt",
        "expiresAt"
      ],
      "additionalProperties": false
    },
    "ContentPolicySubmissionV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "submission"
        },
        "policyOperationId": {
          "$ref": "#/$defs/RandomId"
        },
        "proposalId": {
          "$ref": "#/$defs/RandomId"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "state": {
          "enum": [
            "pending-native",
            "activated"
          ]
        },
        "activationReceipt": {
          "oneOf": [
            {
              "$ref": "#/$defs/ContentPolicyActivationReceiptV1"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "format",
        "kind",
        "policyOperationId",
        "proposalId",
        "policyDigest",
        "state",
        "activationReceipt"
      ],
      "additionalProperties": false
    },
    "ContentPolicyCaptureGrantV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "capture-grant"
            },
            "captureGrantId": {
              "$ref": "#/$defs/RandomId"
            },
            "captureGrantRevision": {
              "$ref": "#/$defs/Counter"
            },
            "policyId": {
              "$ref": "#/$defs/Id"
            },
            "policyRevision": {
              "$ref": "#/$defs/Counter"
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "priorActivationReceiptDigest": {
              "$ref": "#/$defs/Digest"
            },
            "target": {
              "$ref": "#/$defs/Target"
            },
            "sourceDenialFloor": {
              "$ref": "#/$defs/Counter"
            },
            "ownerConsentRevision": {
              "$ref": "#/$defs/Counter"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "captureGrantId",
            "captureGrantRevision",
            "policyId",
            "policyRevision",
            "policyDigest",
            "priorActivationReceiptDigest",
            "target",
            "sourceDenialFloor",
            "ownerConsentRevision",
            "issuedAt",
            "expiresAt",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyCaptureAckV1": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "format": {
              "const": "h2a.session-content-policy/1"
            },
            "kind": {
              "const": "capture-ack"
            },
            "captureGrantId": {
              "$ref": "#/$defs/RandomId"
            },
            "captureGrantRevision": {
              "$ref": "#/$defs/Counter"
            },
            "captureGrantDigest": {
              "$ref": "#/$defs/Digest"
            },
            "policyDigest": {
              "$ref": "#/$defs/Digest"
            },
            "targetDigest": {
              "$ref": "#/$defs/Digest"
            },
            "sourceDenialFloor": {
              "$ref": "#/$defs/Counter"
            },
            "nativeFenceRef": {
              "$ref": "#/$defs/RevisionRef"
            },
            "issuedAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "#/$defs/Timestamp"
            },
            "status": {
              "const": "accepted"
            },
            "issuer": {
              "$ref": "#/$defs/Id"
            },
            "kid": {
              "$ref": "#/$defs/Id"
            }
          },
          "required": [
            "format",
            "kind",
            "captureGrantId",
            "captureGrantRevision",
            "captureGrantDigest",
            "policyDigest",
            "targetDigest",
            "sourceDenialFloor",
            "nativeFenceRef",
            "issuedAt",
            "expiresAt",
            "status",
            "issuer",
            "kid"
          ],
          "additionalProperties": false
        },
        "signature": {
          "$ref": "#/$defs/Signature"
        }
      },
      "required": [
        "body",
        "signature"
      ],
      "additionalProperties": false
    },
    "ContentPolicyCaptureReceiptV1": {
      "type": "object",
      "properties": {
        "format": {
          "const": "h2a.session-content-policy/1"
        },
        "kind": {
          "const": "capture-receipt"
        },
        "captureGrantId": {
          "$ref": "#/$defs/RandomId"
        },
        "captureGrantRevision": {
          "$ref": "#/$defs/Counter"
        },
        "captureGrantDigest": {
          "$ref": "#/$defs/Digest"
        },
        "captureAckDigest": {
          "$ref": "#/$defs/Digest"
        },
        "policyDigest": {
          "$ref": "#/$defs/Digest"
        },
        "targetDigest": {
          "$ref": "#/$defs/Digest"
        },
        "committedAt": {
          "$ref": "#/$defs/Timestamp"
        },
        "expiresAt": {
          "$ref": "#/$defs/Timestamp"
        },
        "status": {
          "const": "committed"
        }
      },
      "required": [
        "format",
        "kind",
        "captureGrantId",
        "captureGrantRevision",
        "captureGrantDigest",
        "captureAckDigest",
        "policyDigest",
        "targetDigest",
        "committedAt",
        "expiresAt",
        "status"
      ],
      "additionalProperties": false
    },
    "Id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[\\x20-\\x7e]+$"
    },
    "Counter": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "RevisionRef": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/Id"
        },
        "revision": {
          "$ref": "#/$defs/Counter"
        },
        "digest": {
          "$ref": "#/$defs/Digest"
        }
      },
      "required": [
        "id",
        "revision",
        "digest"
      ],
      "additionalProperties": false
    },
    "Digest": {
      "type": "string",
      "minLength": 64,
      "maxLength": 64,
      "pattern": "^[a-f0-9]{64}$"
    },
    "PolicySourceBinding": {
      "type": "object",
      "properties": {
        "appMeshId": {
          "$ref": "#/$defs/Id"
        },
        "sourceMeshId": {
          "$ref": "#/$defs/Id"
        },
        "nativeAudience": {
          "$ref": "#/$defs/Id"
        },
        "registrationId": {
          "$ref": "#/$defs/Id"
        },
        "tenantId": {
          "$ref": "#/$defs/Id"
        },
        "workspaceId": {
          "$ref": "#/$defs/Id"
        },
        "bindingId": {
          "$ref": "#/$defs/Id"
        },
        "sourceId": {
          "$ref": "#/$defs/Id"
        },
        "sourceSessionId": {
          "$ref": "#/$defs/Id"
        },
        "nativeSessionId": {
          "$ref": "#/$defs/Id"
        },
        "sourceGeneration": {
          "$ref": "#/$defs/Counter"
        },
        "bootGeneration": {
          "$ref": "#/$defs/Counter"
        },
        "custodyEpoch": {
          "$ref": "#/$defs/Counter"
        },
        "controllerEpoch": {
          "$ref": "#/$defs/Counter"
        }
      },
      "required": [
        "appMeshId",
        "sourceMeshId",
        "nativeAudience",
        "registrationId",
        "tenantId",
        "workspaceId",
        "bindingId",
        "sourceId",
        "sourceSessionId",
        "nativeSessionId",
        "sourceGeneration",
        "bootGeneration",
        "custodyEpoch",
        "controllerEpoch"
      ],
      "additionalProperties": false
    },
    "RetainedChannel": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "retention": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "const": "none"
                }
              },
              "required": [
                "kind"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "const": "finite"
                },
                "durationMs": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 315576000000
                }
              },
              "required": [
                "kind",
                "durationMs"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": [
        "enabled",
        "retention"
      ],
      "additionalProperties": false
    },
    "Timestamp": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "RandomId": {
      "type": "string",
      "minLength": 22,
      "maxLength": 22,
      "pattern": "^[A-Za-z0-9_-]{21}[AQgw]$"
    },
    "Key32": {
      "type": "string",
      "minLength": 43,
      "maxLength": 43,
      "pattern": "^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$"
    },
    "Target": {
      "type": "object",
      "properties": {
        "appMeshId": {
          "$ref": "#/$defs/Id"
        },
        "sourceMeshId": {
          "$ref": "#/$defs/Id"
        },
        "nativeAudience": {
          "$ref": "#/$defs/Id"
        },
        "registrationId": {
          "$ref": "#/$defs/Id"
        },
        "tenantId": {
          "$ref": "#/$defs/Id"
        },
        "workspaceId": {
          "$ref": "#/$defs/Id"
        },
        "bindingId": {
          "$ref": "#/$defs/Id"
        },
        "sourceId": {
          "$ref": "#/$defs/Id"
        },
        "sourceSessionId": {
          "$ref": "#/$defs/Id"
        },
        "nativeSessionId": {
          "$ref": "#/$defs/Id"
        },
        "sourceGeneration": {
          "$ref": "#/$defs/Counter"
        },
        "bootGeneration": {
          "$ref": "#/$defs/Counter"
        },
        "custodyEpoch": {
          "$ref": "#/$defs/Counter"
        },
        "controllerEpoch": {
          "$ref": "#/$defs/Counter"
        },
        "connectionId": {
          "$ref": "#/$defs/Id"
        },
        "connectionGeneration": {
          "$ref": "#/$defs/Counter"
        }
      },
      "required": [
        "appMeshId",
        "sourceMeshId",
        "nativeAudience",
        "registrationId",
        "tenantId",
        "workspaceId",
        "bindingId",
        "sourceId",
        "sourceSessionId",
        "nativeSessionId",
        "sourceGeneration",
        "bootGeneration",
        "custodyEpoch",
        "controllerEpoch",
        "connectionId",
        "connectionGeneration"
      ],
      "additionalProperties": false
    },
    "Signature": {
      "type": "object",
      "properties": {
        "alg": {
          "const": "Ed25519"
        },
        "value": {
          "$ref": "#/$defs/Sig64"
        }
      },
      "required": [
        "alg",
        "value"
      ],
      "additionalProperties": false
    },
    "Sig64": {
      "type": "string",
      "minLength": 86,
      "maxLength": 86,
      "pattern": "^[A-Za-z0-9_-]{85}[AQgw]$"
    },
    "Actor": {
      "type": "object",
      "properties": {
        "issuer": {
          "$ref": "#/$defs/Id"
        },
        "sub": {
          "$ref": "#/$defs/Id"
        },
        "sid": {
          "$ref": "#/$defs/Id"
        },
        "sessionVersion": {
          "$ref": "#/$defs/Counter"
        }
      },
      "required": [
        "issuer",
        "sub",
        "sid",
        "sessionVersion"
      ],
      "additionalProperties": false
    }
  }
};
