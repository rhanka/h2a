---
name: h2a-send
description: Compose and send an h2a envelope to a named peer agent. Use when the user wants to forward a question, deliverable, file path, or update to another CLI agent on the shared workspace.
---

# /h2a-send

When the user invokes `/h2a-send`:

## 1. Identify the recipient

If the user named a peer (`/h2a-send to codex:backend "look at this"`), use it. Otherwise call `h2a_discover_sessions` and ask the user to pick.

## 2. Compose the envelope

Build an H2AEnvelope JSON object:

```json
{
  "protocol": "sentropic.h2a",
  "version": "0.1",
  "id": "env:<timestamp>:<short-random>",
  "type": "event",
  "actor": {
    "instance": "<this-agent-instance>",
    "role": "<this-agent-role-or-AGENTS>",
    "scope": "<shared-scope>"
  },
  "body": {
    "kind": "<message-kind>",
    "text": "<user-content>"
  },
  "createdAt": "<ISO-8601-now>"
}
```

- `id`: must be unique. Use `env:` prefix + epoch ms + 4 hex chars.
- `body.kind`: a short category — `message`, `question`, `file-pointer`, `deliverable`, `status-update`. Ask if ambiguous.
- `body.text` (or `body.payload`): the actual content. For file pointers, use `{ kind: "file-pointer", path: "<abs-path>" }`.

## 3. Send via MCP

Call `h2a_inbox` with:

```json
{
  "action": "put",
  "instance": "<recipient-instance>",
  "envelope": <composed-envelope>
}
```

## 4. Confirm

Show the user:
- the envelope id sent
- the recipient
- *"Delivered to `<recipient>`'s inbox. They will see a push notification if their session is subscribed to `inbox.envelope_arrived`."*

## 5. Optional: wait for ack

If the user says they want to wait for a reply, listen for `notifications/h2a` with `topic: "inbox.envelope_arrived"` on this agent's inbox, and read incoming envelopes whose `body.kind` matches an expected reply category. Time out gracefully after the user's chosen delay (default 60s).

## Failure modes

- Recipient does not exist (`h2a_discover_sessions` doesn't list them): warn the user, suggest checking spelling or asking the recipient to run `/h2a-connect`.
- `h2a_inbox put` returns `{ error: ... }`: surface and stop.
- No active session for this agent (`h2a_session_open` was never called): suggest `/h2a-connect` first; do not silently put without a session as it bypasses presence.
