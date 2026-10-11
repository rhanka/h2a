# Isolated multi-workspace terminal demo

Native worktree host; 160×48 client PTY. All screenshots below come from the native capture operation, with an explicit temporary socket.

## 01-counter-and-aggregated-question

```text
*repo-alpha[waiting-for-input-question] | repo-beta[idle]
*counter[running] | question[waiting-for-input-question]
Counter live
counter = 9
```

## 02-switch-session-question

```text
*repo-alpha[waiting-for-input-question] | repo-beta[idle]
counter[running] | *question[waiting-for-input-question]
Proceed? [y/n]
```

## 03-forward-answer

```text
*repo-alpha[running] | repo-beta[idle]
counter[running] | *question[running]
Proceed? [y/n] y
answer accepted: y
```

## 04-switch-workspace-idle

```text
repo-alpha[running] | *repo-beta[idle]
*idle[idle]
Idle session ready
```

## 05-remember-workspace-selection

```text
*repo-alpha[running] | repo-beta[idle]
counter[running] | *question[running]
Proceed? [y/n] y
answer accepted: y
```

## 06-restore-counter-screen

```text
*repo-alpha[running] | repo-beta[idle]
*counter[running] | question[running]
Counter live
counter = 18
```

## 07-run-focuses-existing-same-pty

```text
*repo-alpha[running] | repo-beta[idle]
*counter[running] | question[idle]
Counter live
counter = 22
```

## 08-run-creates-and-focuses

```text
repo-alpha[running] | *repo-beta[running]
idle[idle] | *new-idle[running]
Idle session ready
```

## 09-exited-badge

```text
repo-alpha[running] | *repo-beta[running]
idle[idle] | new-idle[running] | raced-idle[running] | *short[exited]
EXITED (0) — run to reopen
```

## 10-reopen-exited-session

```text
repo-alpha[running] | *repo-beta[running]
idle[idle] | new-idle[idle] | raced-idle[idle] | *short[running]
Idle session ready
```

## Open-or-focus receipts

```json
{
  "clientPtyPid": 403885,
  "counterPid": 403844,
  "existing": {
    "id": "mwt-93b3eb6c1ebb49e3ed14a02dbb3b8f40",
    "created": false,
    "pid": 403844,
    "incarnation": "51830f3d-93aa-4c68-8c5a-ee7131ab74cb"
  },
  "created": {
    "id": "mwt-b0f4f254ea4e03fa69ecace9c144c924",
    "created": true,
    "pid": 406867,
    "incarnation": "29665239-55c1-414c-aee7-7e72597c16c9"
  },
  "concurrent": [
    {
      "id": "mwt-1b5fecdc619bb5f402a42dc10d603f1c",
      "created": true,
      "pid": 407603,
      "incarnation": "68a19cba-243b-48af-b7a6-8a916ebe92d0"
    },
    {
      "id": "mwt-1b5fecdc619bb5f402a42dc10d603f1c",
      "created": false,
      "pid": 407603,
      "incarnation": "68a19cba-243b-48af-b7a6-8a916ebe92d0"
    }
  ],
  "exited": {
    "id": "mwt-648697b80c12964a1ddbe4d812eb2517",
    "created": true,
    "pid": 407987,
    "incarnation": "4be22b6d-b527-4ea1-b391-9f0f5e4b8946"
  },
  "probe": "dead",
  "restarted": {
    "id": "mwt-648697b80c12964a1ddbe4d812eb2517",
    "created": true,
    "pid": 408810,
    "incarnation": "76a719e9-1f4c-4cf0-b14c-d4979426a381"
  }
}
```

## 11-run-starts-client-when-detached

```text
*repo-alpha[running] | repo-beta[running]
*counter[running] | question[running]
Counter live
counter = 38
```
