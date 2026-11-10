#!/usr/bin/env bash
# The updater of the OpenBot Personal fork.
#
# It merges the next upstream release tag into the personal desktop line, builds the desktop app
# from it, installs the build under the personal updates home, and flips the "current" link there.
# The app reaches the same script from its settings; each run's status lands in one JSON file that
# the app reads.
#
# Usage:
#   scripts/personal-app-update.sh --repo <worktree> check
#   scripts/personal-app-update.sh --repo <worktree> update [--tag <tag>] [--rebuild] [--wait-pid <pid>]
#
# `check` reports the newest release the branch does not have yet. `update` merges, checks, builds,
# and installs. `--rebuild` skips the merge and runs only the build and the install, which is what
# a resolved conflict or a failed install retries. `--wait-pid` waits for the running app to quit
# and then starts the new build; the app's own restart carries its relauncher.
set -euo pipefail

REPO=""
COMMAND=""
TAG=""
REBUILD="no"
WAIT_PID=""
UPDATES_BASE="${OPENBOT_PERSONAL_UPDATE_BASE:-$HOME/.local/opt/openbot-personal}"
BRANCH="fix/local-login-isolation"
tag=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --rebuild) REBUILD="yes"; shift ;;
    --wait-pid) WAIT_PID="$2"; shift 2 ;;
    --*) echo "Unknown option: $1" >&2; exit 64 ;;
    *) if [ -n "$COMMAND" ]; then echo "Unexpected extra argument." >&2; exit 64; fi; COMMAND="$1"; shift ;;
  esac
done
if [ "$COMMAND" != "check" ] && [ "$COMMAND" != "update" ]; then
  echo "Usage: $0 --repo <worktree> check|update" >&2
  exit 64
fi
if [ -z "$REPO" ] || [ ! -d "$REPO" ]; then
  echo "Supply the worktree with --repo." >&2
  exit 64
fi
# The tools reach $HOME/.bun and the mirrors. The app may start with a trimmed HOME, so the script
# pins the real user home that its caller passes.
if [ -n "${OPENBOT_PERSONAL_USER_HOME:-}" ]; then
  export HOME="$OPENBOT_PERSONAL_USER_HOME"
  export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache"
fi
if ! command -v bun >/dev/null; then
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
fi
command -v bun >/dev/null || { echo "OpenBot could not find bun." >&2; exit 65; }

STATUS_FILE="$UPDATES_BASE/app-update-status.json"
LOG_FILE="$UPDATES_BASE/app-update.log"
STARTED="$(date -u +%FT%TZ)"
mkdir -p "$UPDATES_BASE"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

# One status writer: it records the phase, the target, the installed version, and any conflicted
# files. The app polls this file; the log keeps the full detail.
write_status() { # phase message [tag] [version] [install-dir] [conflicts-comma] [started] [finished]
  python3 - "$@" <<'PY'
import json, os, sys
def field(index):
    raw = sys.argv[index] if len(sys.argv) > index else "-"
    return None if raw in ("-", "") else raw
data = {
    "phase": sys.argv[1],
    "message": sys.argv[2],
    "tag": field(3),
    "version": field(4),
    "installDir": field(5),
    "conflicts": [item for item in ("" if (sys.argv[6] if len(sys.argv) > 6 else "") == "-" else sys.argv[6] if len(sys.argv) > 6 else "").split(",") if item],
    "startedAt": field(7),
    "finishedAt": field(8) or os.environ.get("OPENBOT_PERSONAL_UPDATE_FINISHED"),
}
temporary = os.environ["OPENBOT_PERSONAL_STATUS_FILE"] + ".next"
with open(temporary, "w", encoding="utf-8") as file:
    file.write(json.dumps(data))
os.replace(temporary, os.environ["OPENBOT_PERSONAL_STATUS_FILE"])
PY
}
export OPENBOT_PERSONAL_STATUS_FILE="$STATUS_FILE" OPENBOT_PERSONAL_UPDATE_FINISHED=""
mark_finished() { OPENBOT_PERSONAL_UPDATE_FINISHED="$(date -u +%FT%TZ)"; }

echo "== personal update: $COMMAND at $STARTED =="
if [ ! -e "$REPO/.git" ]; then
  mark_finished
  write_status error "The repo worktree is gone." "-" "-" "-" "-" "$STARTED"
  echo "ERROR: missing worktree" >&2
  exit 1
fi
branch="$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || true)"
if [ "$branch" != "$BRANCH" ]; then
  mark_finished; write_status error "The worktree holds the $branch branch, not $BRANCH." "-" "-" "-" "-" "$STARTED"
  echo "ERROR: wrong branch" >&2; exit 1
fi
dirty="$(git -C "$REPO" status --porcelain | head -5)"
if [ -n "$dirty" ]; then
  echo "$dirty"
  mark_finished; write_status error "The repo has unfinished changes. Commit or clean them first." "-" "-" "-" "-" "$STARTED"
  echo "ERROR: dirty repo" >&2; exit 1
fi
if [ "$COMMAND" = "update" ] && [ "$REBUILD" = "no" ]; then
  fusion="$(git -C "$REPO" rev-parse -q --verify MERGE_HEAD || true)"
  if [ -n "$fusion" ]; then
    mark_finished
    write_status conflict "An earlier merge still waits for its conflict fixes. Fix them in the repo, then press Update again." "-" "-" "-" "-" "$STARTED"
    exit 0
  fi
fi

# The previous run's end phase: a run that failed after its merge retries as a build without one.
previous_phase="$(python3 -c '
import json, os
try:
    with open(os.environ[\"OPENBOT_PERSONAL_STATUS_FILE\"], encoding=\"utf-8\") as handle:
        print(json.load(handle)[\"phase\"])
except Exception:
    print(\"idle\")
' 2>/dev/null || echo idle)"
echo "-- fetching upstream --"
# Only the release tags follow: a plain --tags run clobbers on forks that keep a local tag where an
# upstream branch shares its name.
if ! git -C "$REPO" fetch upstream --no-tags --prune '+refs/tags/v*:refs/tags/v*'; then
  mark_finished; write_status error "OpenBot could not fetch the nightly-labs repo." "-" "-" "-" "-" "$STARTED"
  echo "ERROR: fetch failed" >&2; exit 1
fi

# The newest release tag that upstream ships and the branch does not have yet.
pick() {
  for candidate in $(git -C "$REPO" for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/tags/v*'); do
    if git -C "$REPO" merge-base --is-ancestor "$candidate" "upstream/main" &&
      ! git -C "$REPO" merge-base --is-ancestor "$candidate" "$BRANCH"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if [ "$COMMAND" = "check" ]; then
  if tag="$(pick)"; then
    version="$(git -C "$REPO" show "$tag:package.json" | sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    mark_finished
    write_status available "Release $tag waits to merge and build." "$tag" "$version" "-" "-" "$STARTED"
  else
    latest="$(git -C "$REPO" for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/tags/v*' | head -1)"
    mark_finished
    write_status current "The fork already has $latest." "$latest" "-" "-" "-" "$STARTED"
  fi
  exit 0
fi

if [ "$REBUILD" != "yes" ]; then
  if [ -n "$TAG" ]; then
    git -C "$REPO" rev-parse -q --verify "$TAG^{tag}" >/dev/null || true
    tag="$TAG"
    if git -C "$REPO" merge-base --is-ancestor "$tag" "$BRANCH"; then
      mark_finished
      write_status current "The fork already has $tag." "$tag" "-" "-" "-" "$STARTED"
      exit 0
    fi
  else
    if tag="$(pick)"; then
      :
    else
      tag=""
      if [ "$previous_phase" != "error" ]; then
        # Nothing waits to merge. A run that failed after its merge retries as a build; any other
        # end phase means the fork is current.
        latest="$(git -C "$REPO" for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/tags/v*' | head -1)"
        mark_finished
        write_status current "The fork already has $latest." "$latest" "-" "-" "-" "$STARTED"
        exit 0
      fi
    fi
  fi
  if [ "$tag" != "" ]; then
    echo "-- merging $tag into $BRANCH --"
    write_status fetching "Reading release $tag." "$tag" "-" "-" "-" "$STARTED"
    write_status merging "Merging $tag into the fork." "$tag" "-" "-" "-" "$STARTED"
    backup="backup/personal-pre-update-$(date -u +%Y%m%d-%H%M%S)"
    git -C "$REPO" branch "$backup" "$BRANCH" 2>/dev/null || true
    if ! git -C "$REPO" merge --no-edit "$tag"; then
      conflicts="$(git -C "$REPO" diff --name-only --diff-filter=U | paste -sd, -)"
      git -C "$REPO" merge --abort
      mark_finished
      write_status conflict "The merge clashes with archived fork edits." "$tag" "-" "-" "$conflicts" "$STARTED"
      echo "NOTE: the merge stopped on conflicts and was aborted; nothing of the branch changed. Resolve the listed files in the repo (rerere replays recorded fixes), merge the release tag again, then run Update again or 'bash scripts/personal-app-update.sh --repo <worktree> update --rebuild'."
      exit 0
    fi
    if ! git -C "$REPO" push origin "$BRANCH"; then
      echo "WARN: push of $BRANCH failed; the merge stays local."
    fi
  fi
fi

version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/package.json" | head -1)"
if [ -z "$version" ]; then
  mark_finished; write_status error "The package.json of the repo lost its version line." "-" "-" "-" "-" "$STARTED"
  echo "ERROR: no version" >&2; exit 1
fi

echo "-- installing dependencies --"
write_status installing-deps "Preparing the dependencies." "$tag" "$version" "-" "-" "$STARTED"
if ! (cd "$REPO" && bun install --frozen-lockfile); then
  mark_finished; write_status error "The dependencies did not install." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi

echo "-- typechecking --"
write_status typechecking "Typechecking the merged fork." "$tag" "$version" "-" "-" "$STARTED"
if ! (cd "$REPO" && bun run typecheck:node); then
  mark_finished
  write_status error "The merge does not typecheck. Fix the repo, then press Update again." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi

echo "-- building --"
write_status building "Building the app." "$tag" "$version" "-" "-" "$STARTED"
if ! (cd "$REPO" && bun run build); then
  mark_finished; write_status error "The app build failed." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi

echo "-- packaging --"
write_status packaging "Packing the desktop app." "$tag" "$version" "-" "-" "$STARTED"
if ! (cd "$REPO" && bunx electron-builder --dir --linux --x64 --publish never); then
  mark_finished; write_status error "The desktop packaging failed." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi
if [ ! -x "$REPO/dist/linux-unpacked/openbot-personal" ]; then
  mark_finished; write_status error "The packaging left no desktop app." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi

direction="$UPDATES_BASE/$version-any-workspace"
if [ -d "$direction" ] && [ "$(basename "$(readlink -f "$UPDATES_BASE/current")")" = "$version-any-workspace" ]; then
  # The link already points into this version: the run installs under a stamped name, so it never
  # rewrites the build the running app executes.
  direction="$UPDATES_BASE/$version-any-workspace-$(date -u +%Y%m%dT%H%M%S)"
fi
echo "-- installing $version under $direction --"
write_status installing "Installing $version." "$tag" "$version" "-" "-" "$STARTED"
if ! rsync -a --delete "$REPO/dist/linux-unpacked/" "$direction/"; then
  mark_finished; write_status error "The install rsync failed." "$tag" "$version" "-" "-" "$STARTED"
  exit 1
fi
ln -sfn "$(basename "$direction")" "$UPDATES_BASE/current"
mark_finished
write_status ready "Version $version is installed. Restart OpenBot to use it." "$tag" "$version" "$direction" "-" "$STARTED"

if [ -n "$WAIT_PID" ]; then
  echo "-- waiting for the app with pid $WAIT_PID --"
  waited=0
  while kill -0 "$WAIT_PID" 2>/dev/null; do
    sleep 5
    waited=$((waited + 5))
    if [ "$waited" -ge 900 ]; then
      echo "The app held on for 15 minutes; the new build stays installed."
      exit 0
    fi
  done
  sleep 1
  echo "-- starting the new build --"
  setsid nohup "$UPDATES_BASE/current/openbot-personal" --force-renderer-accessibility --password-store=gnome-libsecret >>"$UPDATES_BASE/launch.log" 2>&1 &
fi
