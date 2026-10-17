// Generated from pinned capsule JSON; compile with tsconfig.session-content-tests.json.
import type {ContentMessageMap} from './session-content-types.js';
type Immutable<T>=T extends object?{readonly [K in keyof T]:Immutable<T[K]>}:T;
const fixtures={
  "archive-admission": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "archive-admission",
    "admission": {
      "archive": "h2a.session-archive/1",
      "snapshotId": "snapshot",
      "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9",
      "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
      "channel": "nativeHistory",
      "retention": {
        "mode": "unbounded"
      },
      "retained": {
        "retainedId": "retained",
        "originScopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
        "acceptedAt": 1800000000000,
        "expiresAt": null
      },
      "descriptorHash": "ef3b22ab1b55303956688e0f981816f2537be9ad0c18858e1b5c52897dea6e5d"
    }
  },
  "capabilities": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "capabilities",
    "content": "h2a.session-content/2",
    "archive": "h2a.session-archive/1",
    "runtime": {
      "packageVersion": "0.0.0-synthetic",
      "gitSha": "0000000000000000000000000000000000000000",
      "packageIntegrity": "sha512-synthetic-not-a-package",
      "hostBuildHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "exporterBuildHash": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    "terminal": true,
    "native": [],
    "importMode": "isolated-data",
    "resumable": false,
    "limits": {
      "segmentDecodedBytes": 262144,
      "segmentEncodedBytes": 1048576,
      "queueBytes": 1048576,
      "fileCount": 10000,
      "fileBytes": 67108864,
      "archiveBytes": 268435456,
      "hostQueueBytes": 4194304,
      "pendingConfirmationsPerOwnerSource": 4,
      "pendingConfirmationsPerHost": 16,
      "ownerChallengeStartsPerMinute": 6,
      "ownerChallengeBurst": 4,
      "hostChallengeStartsPerMinute": 24,
      "hostChallengeBurst": 16,
      "concurrentImportsPerWorkstation": 1,
      "concurrentExportsPerWorkstation": 2,
      "archiveStartsPer10MinutesPerHost": 4,
      "archiveStartBurst": 3,
      "archiveWorkerBufferBytesPerHost": 8388608,
      "queuedArchiveJobs": 0
    }
  },
  "confirmation-challenge": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "confirmation-challenge",
    "challenge": {
      "id": "challenge",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "clientId": "confirmation-client",
      "purpose": "share",
      "target": {
        "kind": "policy",
        "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165"
      },
      "random": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      "issuedAt": 1800000000000,
      "expiresAt": 1800000060000
    },
    "challengeDigest": "ac04213920bcc65b531fd92e1d5cf457e82e87ea4fcb86817b5c216deb932b24"
  },
  "confirmation-proof": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "confirmation-proof",
    "challengeId": "challenge",
    "challengeDigest": "ac04213920bcc65b531fd92e1d5cf457e82e87ea4fcb86817b5c216deb932b24",
    "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6InN5bnRoZXRpYy1maXh0dXJlLW9ubHkiLCJ0eXAiOiJKV1QifQ.eyJhY3IiOiJ1cm46c2VudHJvcGljOmxvYTpwYXNza2V5LWZyZXNoIiwiYW1yIjpbImh3ayIsInVzZXIiLCJtZmEiXSwiYXVkIjoiY29uZmlybWF0aW9uLWNsaWVudCIsImF1dGhfdGltZSI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDYwLCJpYXQiOjE4MDAwMDAwMDAsImlzcyI6Imh0dHBzOi8vc3ludGhldGljLWlkcC5pbnZhbGlkIiwibm9uY2UiOiJyQVFoT1NDOHhsdFRIOWt1SFZ6MFYtZ3VoLXBQeTRhQmUxd2hiZXVUS3lRIiwic3ViIjoic3ludGhldGljLW93bmVyIiwidGVuYW50SWQiOiJ0ZW5hbnQifQ.Cvvqm9bf9B31IJ1o64eRf0mvnTGPd_j0UrhZcLG0doYdiqNwdogIJ03n-oYcijjdaKMj3mk541Shz3D9_tu-6AfJ2SLyjk_XGPxLzVRv-6qqprtP0ca9FOiFjdAAh1W0BiwGzg28Kd2zyO9indG2nqNNLdT0W3s3Vyaq5cd2rv1JTtzXtsA9XWZg7NLmjFYjHOQ4uZQK60cOy2CcBv9nNjz9-z-vSmYQA3hNET7fZOtXdT1PhOqP0Moazt2h-1NrcefpGBLKNJg6xjDFHIgqPoP0w6Nzf-ck5cIva08q5cQQRneb-x6HVsEEcpRtRaIRD4lKrxnj-WfKUqnTiB4daQ"
  },
  "content-revoke": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "content-revoke",
    "requestId": "revoke",
    "connectionId": "connection",
    "target": {
      "kind": "session",
      "scope": {
        "authorityEpoch": "epoch",
        "owner": {
          "issuer": "https://synthetic-idp.invalid",
          "subject": "synthetic-owner"
        },
        "project": {
          "tenantId": "tenant",
          "workspaceId": "workspace",
          "workspaceIncarnation": "workspace-incarnation",
          "projectId": "project"
        },
        "source": {
          "workstationId": "workstation",
          "bindingId": "binding",
          "bindingVersion": 1,
          "sourceId": "source",
          "sourceGeneration": "generation",
          "sourceBootId": "boot"
        },
        "sessionId": "session",
        "sessionIncarnation": "incarnation",
        "policyId": "policy",
        "policyRevision": 1,
        "consentRevision": 1,
        "exclusionRevision": 0,
        "grantId": "grant",
        "grantVersion": 1
      }
    },
    "effect": "capture",
    "denyRevision": 1,
    "reason": "excluded"
  },
  "control-result": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "control-result",
    "requestId": "activate",
    "requestDigest": "52feeb3972c21527cc7cdfd087e765a45647814fb53b2cea005e014a6d372422",
    "sourceAckDigest": "4061ce90b84bf2e4962b4da8f7078b29086cbb96bf85f4652fd77621e5951d56",
    "connectionId": "connection",
    "status": "committed",
    "reason": null
  },
  "grant-activate": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "grant-activate",
    "requestId": "activate",
    "requestNonce": "activate-nonce",
    "connectionId": "connection",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
    "lease": {
      "id": "lease",
      "requestNonce": "lease-nonce",
      "issuedAt": 1800000000000,
      "expiresAt": 1800000060000
    }
  },
  "grant-refresh": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "grant-refresh",
    "requestId": "renew",
    "requestNonce": "renew-nonce",
    "connectionId": "connection",
    "previousScope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "nextScope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
    "lease": {
      "id": "lease-renew",
      "requestNonce": "renew-nonce",
      "issuedAt": 1800000000000,
      "expiresAt": 1800000060000
    },
    "operation": "renew"
  },
  "history-read": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "history-read",
    "authorizationId": "read",
    "owner": {
      "issuer": "https://synthetic-idp.invalid",
      "subject": "synthetic-owner"
    },
    "authSessionRef": "login",
    "retained": {
      "retainedId": "retained",
      "originScopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
      "acceptedAt": 1800000000000,
      "expiresAt": null
    },
    "coverage": {
      "kind": "native",
      "snapshotId": "snapshot",
      "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9",
      "descriptorHash": "ef3b22ab1b55303956688e0f981816f2537be9ad0c18858e1b5c52897dea6e5d"
    },
    "readExpiresAt": 1800000060000
  },
  "import-request": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "import-request",
    "requestId": "import",
    "authorizationId": "read",
    "retained": {
      "retainedId": "retained",
      "originScopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
      "acceptedAt": 1800000000000,
      "expiresAt": null
    },
    "snapshotId": "snapshot",
    "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9",
    "descriptorHash": "ef3b22ab1b55303956688e0f981816f2537be9ad0c18858e1b5c52897dea6e5d",
    "provider": {
      "provider": "claude",
      "cliVersion": "synthetic-unqualified",
      "formatVersion": "synthetic-jsonl/1",
      "exporterVersion": "synthetic/1",
      "importerVersion": "synthetic/1"
    },
    "mode": "isolated-data"
  },
  "import-result": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "import-result",
    "requestId": "import",
    "snapshotId": "snapshot",
    "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9",
    "descriptorHash": "ef3b22ab1b55303956688e0f981816f2537be9ad0c18858e1b5c52897dea6e5d",
    "status": "imported",
    "reason": null,
    "localImportId": "isolated-import",
    "expiresAt": null,
    "resumable": false,
    "processStarted": false,
    "keyboardAcquired": false
  },
  "ingest-ack": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "ingest-ack",
    "requestId": "part",
    "scopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
    "connectionId": "connection",
    "status": "accepted",
    "coverage": {
      "kind": "native",
      "snapshotId": "snapshot",
      "fileSha256": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657",
      "acceptedThroughByteOffset": 49
    },
    "retained": {
      "retainedId": "retained",
      "originScopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
      "acceptedAt": 1800000000000,
      "expiresAt": null
    },
    "archiveAdmission": {
      "archive": "h2a.session-archive/1",
      "snapshotId": "snapshot",
      "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9",
      "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
      "channel": "nativeHistory",
      "retention": {
        "mode": "unbounded"
      },
      "retained": {
        "retainedId": "retained",
        "originScopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
        "acceptedAt": 1800000000000,
        "expiresAt": null
      },
      "descriptorHash": "ef3b22ab1b55303956688e0f981816f2537be9ad0c18858e1b5c52897dea6e5d"
    },
    "reason": null
  },
  "native-manifest": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "native-manifest",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "connectionId": "connection",
    "leaseId": "lease",
    "archive": "h2a.session-archive/1",
    "snapshotId": "snapshot",
    "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
    "provider": {
      "provider": "claude",
      "cliVersion": "synthetic-unqualified",
      "formatVersion": "synthetic-jsonl/1",
      "exporterVersion": "synthetic/1",
      "importerVersion": "synthetic/1"
    },
    "ranges": [
      {
        "lineageId": "lineage",
        "checkpointId": "checkpoint",
        "fromRecord": 0,
        "toRecord": 0,
        "inventoryHash": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657"
      }
    ],
    "files": [
      {
        "path": "records/history.jsonl",
        "role": "records",
        "bytes": 49,
        "sha256": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657"
      }
    ],
    "complete": true,
    "resumable": false,
    "manifestHash": "87acdbae31d06b3cbec4cc2ea3a1191dd585e84cc02ef659d28f9ea09478b2b9"
  },
  "native-part": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "native-part",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "connectionId": "connection",
    "leaseId": "lease",
    "snapshotId": "snapshot",
    "fileSha256": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657",
    "byteOffset": 0,
    "byteLength": 49,
    "totalBytes": 49,
    "payloadB64": "eyJ0eXBlIjoidXNlciIsInRleHQiOiJzeW50aGV0aWMgaW5lcnQgaGlzdG9yeSJ9Cg",
    "payloadHash": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657",
    "final": true
  },
  "oidc-context": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "oidc-context",
    "owner": {
      "issuer": "https://synthetic-idp.invalid",
      "subject": "synthetic-owner"
    },
    "tenantId": "tenant",
    "clientId": "source-client",
    "audience": "source-audience",
    "authSessionRef": "login",
    "authSessionVersion": 1,
    "authSessionExpiresAt": 1800000300000,
    "tokenExpiresAt": 1800000120000,
    "acr": "urn:sentropic:loa:passkey-fresh",
    "amr": [
      "hwk",
      "user",
      "mfa"
    ],
    "authTime": 1800000000000,
    "expiresAt": 1800000120000,
    "clientPolicyRevision": 1,
    "mfaEnrolled": true
  },
  "oidc-policy": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "oidc-policy",
    "issuer": "https://synthetic-idp.invalid",
    "sourceClientId": "source-client",
    "sourceAudience": "source-audience",
    "confirmationClientId": "confirmation-client",
    "confirmationAudience": "confirmation-client",
    "requiredAcr": "urn:sentropic:loa:passkey-fresh",
    "requiredAmr": [
      "hwk",
      "user",
      "mfa"
    ],
    "forceReauthEveryAuthorization": true,
    "bindUvEventToAuthorization": true,
    "singleUseUvEvent": true,
    "sourceSessionBinding": "idp-login-record",
    "requireUserVerification": true,
    "denyWeakFallback": true,
    "policyRevision": 1,
    "allowedSubject": "synthetic-owner",
    "tenantId": "tenant",
    "maxConfirmationSeconds": 60,
    "maxClockErrorMs": 5000
  },
  "oidc-session": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "oidc-session",
    "authSessionRef": "login",
    "owner": {
      "issuer": "https://synthetic-idp.invalid",
      "subject": "synthetic-owner"
    },
    "tenantId": "tenant",
    "authenticatedAt": 1800000000000,
    "sessionExpiresAt": 1800000300000,
    "sessionVersion": 1,
    "status": "active",
    "credentialRefs": [
      "synthetic-credential"
    ],
    "revokedAt": null,
    "revocationReason": null,
    "tokenRefs": [
      "synthetic-token-reference"
    ]
  },
  "project-policy": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "project-policy",
    "policy": {
      "id": "policy",
      "revision": 1,
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "destination": "https://synthetic-sentropic.invalid",
      "sources": [
        {
          "workstationId": "workstation",
          "bindingId": "binding",
          "bindingVersion": 1,
          "sourceId": "source",
          "sourceGeneration": "generation",
          "sourceBootId": "boot"
        }
      ],
      "sessions": {
        "selected": [
          "session"
        ],
        "future": false
      },
      "channels": {
        "terminalLive": true,
        "terminalCache": true,
        "nativeHistory": true
      },
      "history": {
        "mode": "selected",
        "selected": [
          {
            "lineageId": "lineage",
            "checkpointId": null,
            "fromRecord": null,
            "toRecord": null
          }
        ]
      },
      "retentionByChannel": {
        "terminalCache": {
          "mode": "duration",
          "durationSeconds": 604800
        },
        "nativeHistory": {
          "mode": "unbounded"
        }
      },
      "exclusionRevision": 0
    },
    "policyDigest": "08fc651043cee52ad207235b626d686b342d1981be90cb75f2b387634a3f4165",
    "confirmation": {
      "id": "confirmation",
      "challengeId": "challenge",
      "proofDigest": "ed2d98b042cdc24926031998956f5553db3ea3d13ecfa47606e4812599e24f62",
      "authSessionRef": "login",
      "purpose": "share",
      "confirmedAt": 1800000000000
    }
  },
  "refusals": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "refusals",
    "cases": [
      {
        "name": "old-version",
        "fixture": "capabilities.v2.json",
        "mutation": {
          "pointer": "/protocolVersion",
          "value": 1
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      },
      {
        "name": "unknown-field",
        "fixture": "project-policy.v2.json",
        "mutation": {
          "pointer": "/unexpected",
          "value": true
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      },
      {
        "name": "wrong-owner",
        "fixture": "project-policy.v2.json",
        "mutation": {
          "pointer": "/policy/owner/subject",
          "value": "other"
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      },
      {
        "name": "wrong-policy",
        "fixture": "grant-activate.v2.json",
        "mutation": {
          "pointer": "/policyDigest",
          "value": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      },
      {
        "name": "unsupported-import",
        "fixture": "import-request.v2.json",
        "mutation": {
          "pointer": "/mode",
          "value": "resume"
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      },
      {
        "name": "changed-snapshot",
        "fixture": "archive-admission.v2.json",
        "mutation": {
          "pointer": "/admission/snapshotId",
          "value": "other"
        },
        "expected": {
          "code": "contract_refused",
          "sourceContentReads": 0,
          "contentSubscriptions": 0,
          "serializedContentBytes": 0,
          "exportBytes": 0,
          "ingressBodyReads": 0,
          "storedBytes": 0,
          "importCommits": 0,
          "nativeWrites": 0,
          "processStarts": 0,
          "keyboardAcquires": 0
        }
      }
    ]
  },
  "source-ack": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "source-ack",
    "requestId": "activate",
    "requestDigest": "52feeb3972c21527cc7cdfd087e765a45647814fb53b2cea005e014a6d372422",
    "connectionId": "connection",
    "operation": "activate",
    "status": "staged",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "boundary": {
      "startAfterSeq": 7,
      "native": {
        "provider": {
          "provider": "claude",
          "cliVersion": "synthetic-unqualified",
          "formatVersion": "synthetic-jsonl/1",
          "exporterVersion": "synthetic/1",
          "importerVersion": "synthetic/1"
        },
        "selections": [
          {
            "lineageId": "lineage",
            "checkpointId": null,
            "fromRecord": null,
            "toRecord": null
          }
        ],
        "boundaryId": "opaque-metadata-boundary"
      }
    },
    "lease": {
      "id": "lease",
      "requestNonce": "lease-nonce",
      "issuedAt": 1800000000000,
      "expiresAt": 1800000060000
    },
    "reason": null
  },
  "source-admission": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "source-admission",
    "method": "POST",
    "path": "/api/v1/auth/session/content/binding/fragments",
    "sourceSessionId": "source-session",
    "connectionId": "connection",
    "requestId": "fragment",
    "scopeDigest": "1c9acfc3d78f2b40977bedbee13d5089d9b116784a5b51237e9d9288995117ac",
    "leaseId": "lease",
    "bodyBytes": 957,
    "bodyHash": "779587e35e2bc84cb5dfbc0f1eb1b150a600a49e13acdad160dca096a26e630a"
  },
  "source-open": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "source-open",
    "requestId": "open",
    "requestNonce": "open-nonce",
    "bindingId": "binding",
    "sourceGeneration": "generation",
    "sourceBootId": "boot",
    "runtime": {
      "packageVersion": "0.0.0-synthetic",
      "gitSha": "0000000000000000000000000000000000000000",
      "packageIntegrity": "sha512-synthetic-not-a-package",
      "hostBuildHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "exporterBuildHash": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    "capabilitiesDigest": "43efcd6ba40fac209167fe1c73ca1b076e53298f4220586e7a822530e3290859"
  },
  "source-session": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "source-session",
    "requestId": "open",
    "requestNonce": "open-nonce",
    "sourceSessionId": "source-session",
    "sourceToken": "synthetic-secret-not-authority",
    "owner": {
      "issuer": "https://synthetic-idp.invalid",
      "subject": "synthetic-owner"
    },
    "authSessionRef": "login",
    "authSessionVersion": 1,
    "authSessionExpiresAt": 1800000300000,
    "source": {
      "workstationId": "workstation",
      "bindingId": "binding",
      "bindingVersion": 1,
      "sourceId": "source",
      "sourceGeneration": "generation",
      "sourceBootId": "boot"
    },
    "connectionId": "connection",
    "issuedAt": 1800000000000,
    "expiresAt": 1800000060000,
    "operations": [
      "source-control",
      "content-upload",
      "source-ack"
    ]
  },
  "terminal-fragment": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "terminal-fragment",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "connectionId": "connection",
    "leaseId": "lease",
    "channel": "terminal.live",
    "rawSeq": 8,
    "byteOffset": 0,
    "byteLength": 49,
    "totalBytes": 49,
    "payloadB64": "eyJ0eXBlIjoidXNlciIsInRleHQiOiJzeW50aGV0aWMgaW5lcnQgaGlzdG9yeSJ9Cg",
    "payloadHash": "c3e1919b990362bd942a27b2d117ce41afa06495c3daf33fe5084bba03b57657",
    "final": true
  },
  "terminal-gap": {
    "protocol": "h2a.session-content",
    "protocolVersion": 2,
    "kind": "terminal-gap",
    "scope": {
      "authorityEpoch": "epoch",
      "owner": {
        "issuer": "https://synthetic-idp.invalid",
        "subject": "synthetic-owner"
      },
      "project": {
        "tenantId": "tenant",
        "workspaceId": "workspace",
        "workspaceIncarnation": "workspace-incarnation",
        "projectId": "project"
      },
      "source": {
        "workstationId": "workstation",
        "bindingId": "binding",
        "bindingVersion": 1,
        "sourceId": "source",
        "sourceGeneration": "generation",
        "sourceBootId": "boot"
      },
      "sessionId": "session",
      "sessionIncarnation": "incarnation",
      "policyId": "policy",
      "policyRevision": 1,
      "consentRevision": 1,
      "exclusionRevision": 0,
      "grantId": "grant",
      "grantVersion": 1
    },
    "connectionId": "connection",
    "channel": "terminal.live",
    "fromSeq": 1,
    "toSeq": 7,
    "reason": "not-collected",
    "contiguousThroughSeq": 0
  }
} as const satisfies Immutable<ContentMessageMap>;
void fixtures;
