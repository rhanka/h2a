#!/usr/bin/env bash
set -euo pipefail

YES=0
REMOUNT_SIZE="none"
DEST_ROOT="/var/tmp"
DROP_CACHES=1

usage() {
  cat <<'EOF'
Usage:
  sudo ./free-tmpfs-now.sh --yes [--remount-size none|2G] [--dest-root /var/tmp]

What it does:
  - lists /tmp usage
  - copies known heavy/dev scratch dirs from /tmp to /var/tmp/preserved-tmp-<timestamp>/
  - removes the originals from /tmp after successful copy
  - does NOT remount /tmp by default (use --remount-size 2G only if explicitly wanted)

Targets preserved/removed:
  /tmp/geo-* /tmp/h2a-* /tmp/a2a-* /tmp/codex-* /tmp/claude-* /tmp/*worktree* /tmp/*worktrees*

Dry-run is default. Use --yes to actually copy+remove.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --remount-size) REMOUNT_SIZE="${2:?missing size}"; shift 2 ;;
    --dest-root) DEST_ROOT="${2:?missing dest root}"; shift 2 ;;
    --no-drop-caches) DROP_CACHES=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run with sudo/root" >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="${DEST_ROOT%/}/preserved-tmp-${stamp}"

have() { command -v "$1" >/dev/null 2>&1; }

copy_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  if have rsync; then
    rsync -aHAX --numeric-ids --info=progress2 "$src/" "$dst/"
  else
    # Fallback if rsync is unavailable. Less fancy than rsync but preserves normal files/dirs well.
    (cd "$src" && tar cpf - .) | (cd "$dst" && tar xpf -)
  fi
}

echo "== memory before =="
free -h || true

echo "== /tmp mount =="
findmnt /tmp || true

echo "== /var/tmp mount =="
findmnt /var/tmp || true

echo "== /tmp df before =="
df -h /tmp || true

echo "== largest /tmp entries before =="
du -xhd1 /tmp 2>/dev/null | sort -h | tail -50 || true

shopt -s nullglob
patterns=(
  '/tmp/geo-*'
  '/tmp/h2a-*'
  '/tmp/a2a-*'
  '/tmp/codex-*'
  '/tmp/claude-*'
  '/tmp/*worktree*'
  '/tmp/*worktrees*'
)

targets=()
for pat in "${patterns[@]}"; do
  for p in $pat; do
    [[ -e "$p" ]] || continue
    [[ "$p" == "/tmp" ]] && continue
    targets+=("$p")
  done
done

# De-duplicate while preserving order.
uniq_targets=()
for p in "${targets[@]}"; do
  seen=0
  for q in "${uniq_targets[@]:-}"; do [[ "$p" == "$q" ]] && seen=1 && break; done
  [[ $seen -eq 0 ]] && uniq_targets+=("$p")
done

echo "== targets =="
if [[ ${#uniq_targets[@]} -eq 0 ]]; then
  echo "No matching targets found."
else
  printf '%s\n' "${uniq_targets[@]}"
fi

if [[ "$YES" -ne 1 ]]; then
  echo
  echo "DRY-RUN ONLY. Re-run with: sudo $0 --yes"
  exit 0
fi

mkdir -p "$dest"
chmod 700 "$dest"

echo "== preserving to $dest =="
for p in "${uniq_targets[@]}"; do
  [[ -e "$p" ]] || continue
  base="$(basename "$p")"
  out="$dest/$base"
  if [[ -e "$out" ]]; then
    out="$dest/${base}.$(date +%s%N)"
  fi

  echo "-- preserve: $p -> $out"
  if [[ -d "$p" ]]; then
    copy_tree "$p" "$out"
  else
    mkdir -p "$(dirname "$out")"
    cp -a "$p" "$out"
  fi

  echo "-- remove from tmpfs: $p"
  rm -rf --one-file-system "$p"
done

sync || true

if [[ "$DROP_CACHES" -eq 1 && -w /proc/sys/vm/drop_caches ]]; then
  echo "== drop page cache =="
  echo 3 > /proc/sys/vm/drop_caches || true
fi

if [[ "$REMOUNT_SIZE" != "none" ]]; then
  if findmnt -no FSTYPE /tmp 2>/dev/null | grep -qx tmpfs; then
    echo "== remount /tmp tmpfs size=$REMOUNT_SIZE =="
    mount -o "remount,size=$REMOUNT_SIZE" /tmp
  else
    echo "== /tmp is not tmpfs; skip remount =="
  fi
fi

echo "== /tmp df after =="
df -h /tmp || true

echo "== largest /tmp entries after =="
du -xhd1 /tmp 2>/dev/null | sort -h | tail -50 || true

echo "== memory after =="
free -h || true

echo "DONE. Preserved copy: $dest"
