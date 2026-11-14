#!/bin/bash
# take.sh — the kill-and-reshoot mechanism for Beat 2 of the demo (see ../../DEMO-SCRIPT.md
# and TAKES.md in this directory for the full runbook).
#
# WHY THIS EXISTS. Beat 2 is the only beat that WRITES anything — grow, review, promote — so it
# is the only beat that can be flubbed in a way a re-take has to undo. Every other beat (3-5)
# only reads the owner's live garden and can be re-filmed by just rolling the camera again. This
# script gives Beat 2 the same property: a bad take is `rm -rf` of the one directory this run
# printed, then run this again. Nothing is patched, nothing is resumed — every take starts from
# zero, grown fresh from this repository's real git history, through the --garden/FOLIAGE_GARDEN
# override block in foliage.mjs. No fixture, no seeded JSON, no hand-written leaflet:
# `grow` shells out to the same intake.mjs/harvest.mjs a real user runs, over this repo's own
# commits.
#
# THE ONE THING THIS SCRIPT REFUSES, ABSOLUTELY: writing to the owner's live garden. The take
# mechanism exists BECAUSE Beat 2 mutates state; pointing that mutation at `~/.foliage` would
# mutate the 235-leaflet portfolio Beats 3-5 film read-only. So every garden this script produces
# is checked, after it is created, against the resolved path of `~/.foliage` — not against the
# literal string, because a symlink or a trailing slash would let the literal comparison pass
# while the two paths were the same directory.
#
# Usage:
#   take.sh [grow]   [--repo <path>] [--identity <email>]... [--subject "<name>"] [--garden <dir>]
#   take.sh promote  --doc <harvest.json> --into <leaf.json>
#
# `grow` is the default when no subcommand is given. `promote` exists so a terminal fallback for
# Beat 2 (foliage.mjs's own `review` and the browser's `/promote` panel are the sanctioned paths
# and already pass both flags — see the block below) has one too. `harvest.mjs promote` (and
# `approve`/`reject`) now REFUSE BY NAME whenever `--doc` is omitted or empty — it no longer
# silently defaults to `apps/leaf/harvest.json` beside the script (F-025, `guarded` in
# `.loop/FINDINGS.md`). This wrapper's own requirement — BOTH flags, non-empty, from its own
# caller, refused by name before either is forwarded — is now BELT-AND-SUSPENDERS on top of that
# product-level refusal, a second layer rather than the only defense, and it exists for a
# DIFFERENT reason of its own: whether --doc and --into name the same SUBJECT is refused at the
# product level, in `promoteApproved` (F-014 + F-024, both `guarded` in `.loop/FINDINGS.md`) —
# but that binds to subject, not to garden, so two takes of the SAME subject (the ordinary
# reshoot) carry IDENTICAL bindings and the product cannot tell them apart. Whether --doc and
# --into name the same GARDEN is this wrapper's own check, below — see the `promote` block.

set -u -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_REPO="$(cd "$HERE" && git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$TOOL_REPO" ] || [ ! -f "$TOOL_REPO/foliage.mjs" ]; then
  echo "take.sh: could not find foliage.mjs above $HERE — this script must live inside the foliage checkout." >&2
  exit 2
fi

# Resolve a path to text, anchored at $PWD if relative, with "." dropped and ".." popped against
# what came before it — all lexically, no filesystem access. Mirrors foliage.mjs's own
# `resolve(gardenOverride)` (Node's path.resolve): a not-yet-created path is anchored to cwd the
# same way, once, before anything downstream runs. `set -u` guards every array read here
# (`"${stack[@]+"${stack[@]}"}"`) because bash 3.2 — the only /bin/bash macOS ships — treats a
# zero-element array as unset, the same trap `${arr[@]+"${arr[@]}"}` guards against below.
#
# NOGLOB AROUND THE SPLIT. `set -- $path` is unquoted ON PURPOSE — that is what makes IFS=/
# split it into words — but bash performs BOTH word-splitting AND pathname expansion on an
# unquoted expansion, and there is no way to ask for only the first. Without `-f`, a --garden
# (or --doc/--into) value containing a glob metacharacter that happens to match a real entry in
# $PWD is silently REPLACED by that unrelated filesystem entry — contradicting this function's
# own "no filesystem access" claim (three-pass review, round 5: reproduced live, `--garden 'x*'`
# from a directory holding a real `xy` resolved to `xy`, and `foliage grow` wrote into it).
# `$-` names every currently-set single-letter option, so `case $- in *f*)` is how a function
# checks "is noglob already on" without a bash-3.2 `local -` (that syntax doesn't exist here);
# restoring to exactly what it was — not unconditionally `+f` — matters because this function,
# unlike its callers, is not guaranteed to always run inside a subshell.
lexically_normalize() {
  local path="$1" part had_noglob
  case "$path" in
  /*) : ;;
  *) path="$PWD/$path" ;;
  esac
  case $- in *f*) had_noglob=1 ;; *) had_noglob= ;; esac
  set -f
  local -a stack=()
  local IFS=/
  set -- $path
  unset IFS
  [ -n "$had_noglob" ] || set +f
  for part in "$@"; do
    case "$part" in
    "" | .) continue ;;
    ..) [ "${#stack[@]}" -gt 0 ] && stack=("${stack[@]:0:$((${#stack[@]} - 1))}") ;;
    *) stack+=("$part") ;;
    esac
  done
  local out="" comp
  for comp in "${stack[@]+"${stack[@]}"}"; do out="$out/$comp"; done
  printf '%s\n' "${out:-/}"
}

# Resolve to a REAL path. THE BUG THIS REPLACES: the old resolve_dir only followed symlinks (via
# `cd`/`pwd -P`) when the whole path already existed, so a not-yet-created `--garden` was
# returned untouched — a bare relative string like "newsubdir" — and refuse_if_live_garden below
# string-compared that against the resolved absolute `~/.foliage` and never matched (PR #15
# review: `cd ~/.foliage && take.sh --garden newsubdir` printed ALLOWED and created
# `$HOME/.foliage/newsubdir`). Existence can no longer gate resolution: this walks the lexically
# normalized path from the root, `cd`/`pwd -P`-ing into the deepest EXISTING ancestor (so a real
# symlink already on disk is still followed, same as before), then appends whatever is left —
# the part nothing can `cd` into yet — as plain, already-normalized text.
#
# THIS SPLIT NEEDS THE SAME NOGLOB GUARD lexically_normalize's does — it is a SEPARATE unquoted
# `set --`, in a separate function, and the input here is already-normalized text that can still
# carry a literal glob metacharacter the caller typed on purpose (round 5 review).
#
# A `cd` THAT FAILS ON AN EXISTING COMPONENT must not become a wrong answer. `[ -d "$candidate" ]`
# only proves the entry is a directory, not that this process may ENTER it (a component can be
# stat-able via execute permission on its PARENT while itself being mode 000). Without a check,
# `real="$(cd "$candidate" && pwd -P)"` silently captures "" on that failure — `&&` short-circuits
# `pwd -P` — and the walk below reassembles the remainder rooted at `/`: a wrong, unrelated path,
# not an error. This dies instead, loudly, exit 2 (round 5 review).
#
# THE TERMINAL COMPONENT CAN BE A FILE, NOT A DIRECTORY — `--doc`/`--into` name harvest.json /
# leaf.json, so `[ -d ]` above is false for it and the walk always stops one component short,
# appending it as literal remainder text. That is correct for a plain file, or a not-yet-created
# name (F-015's fresh-take case) — but WRONG when that literal text is itself a SYMLINK: a
# symlinked `--into` pointing into the live garden used to be appended verbatim, so
# `refuse_if_live_garden` compared the unresolved literal, found no match, and the OS write
# followed the link at the filesystem level into the real garden regardless of what this script
# decided (round 8 review, reproduced live). `depth` (default 0, threaded only by the recursive
# call below) bounds a symlink CYCLE the way the round-5 `cd`-failure check bounds a permission
# failure — every existing call site omits it and gets 0, unchanged.
resolve_dir() {
  local input="$1" depth="${2:-0}"
  local normalized comp candidate real remainder had_noglob link
  if [ "$depth" -gt 40 ]; then
    echo "take.sh: cannot resolve $input: too many levels of symbolic links." >&2
    exit 2
  fi
  normalized="$(lexically_normalize "$input")"
  local -a comps=()
  case $- in *f*) had_noglob=1 ;; *) had_noglob= ;; esac
  set -f
  local IFS=/
  set -- $normalized
  unset IFS
  [ -n "$had_noglob" ] || set +f
  for comp in "$@"; do
    [ -n "$comp" ] && comps+=("$comp")
  done
  real="/"
  local i=0
  while [ "$i" -lt "${#comps[@]}" ]; do
    if [ "$real" = "/" ]; then candidate="/${comps[$i]}"; else candidate="$real/${comps[$i]}"; fi
    [ -d "$candidate" ] || break
    if ! real="$(cd "$candidate" && pwd -P)" || [ -z "$real" ]; then
      echo "take.sh: cannot resolve $candidate: cd failed (permission denied, or removed since checked)." >&2
      exit 2
    fi
    i=$((i + 1))
  done
  remainder=""
  while [ "$i" -lt "${#comps[@]}" ]; do
    remainder="$remainder/${comps[$i]}"
    i=$((i + 1))
  done
  # ONLY the FINAL component: if an earlier one broke the walk (an intermediate name that isn't
  # a directory), the path is simply invalid, not a link to chase.
  if [ "$i" -eq "${#comps[@]}" ] && [ -n "$remainder" ]; then
    candidate="$real$remainder"
    if [ -L "$candidate" ]; then
      # `readlink` with NO flags — `-f` is GNU-only; macOS/BSD's `readlink` doesn't have it —
      # prints this ONE link's stored target exactly as written, relative or absolute. A
      # relative target is relative to the SYMLINK'S OWN directory, never this process's cwd
      # (what `readlink -f`/`realpath` do internally, spelled out here by hand).
      link="$(readlink "$candidate")"
      case "$link" in
      /*) : ;;
      *) link="$real/$link" ;;
      esac
      # `-e` dereferences the WHOLE remaining chain, however many hops — so this one check catches
      # a dangling link whether it breaks here or three hops further on. A promote target that is
      # a dangling link is never legitimate: refuse by name rather than silently resolving to a
      # target that was never going to be readable or writable anyway.
      if [ ! -e "$link" ]; then
        echo "take.sh: REFUSED — $candidate is a dangling symlink (resolves to $link, which does not exist)." >&2
        exit 2
      fi
      # RECURSE rather than loop by hand: a chain (link to a link to a link) resolves the same
      # way a directory symlink already does above, via `cd`/`pwd -P`, through this same
      # function — `depth` bounds it against a cycle instead of a fixed unroll.
      resolve_dir "$link" "$((depth + 1))"
      return
    fi
  fi
  printf '%s\n' "$real$remainder"
}

# Refuses, by name, if $1 IS the live garden or is nested inside it. Used on every garden this
# script is about to hand to foliage.mjs, not just the default one — an explicit --garden
# override gets exactly the same check as the auto-generated temp directory. $2 is an optional
# override for the second explanatory line, so a caller whose relationship to the live garden
# isn't "this script never writes here" (promote's --doc/--into, below) can say what actually
# applies instead of a line that would be misleading for it.
refuse_if_live_garden() {
  local candidate live detail
  # `|| exit $?` on BOTH: resolve_dir's own `exit 2` (a `cd` failure) only kills the command
  # substitution's subshell, not this function's shell — without this, a failed resolution
  # would leave $candidate/$live silently empty instead of stopping the script.
  candidate="$(resolve_dir "$1")" || exit $?
  live="$(resolve_dir "$HOME/.foliage")" || exit $?
  detail="${2:-this script never writes to ~/.foliage. Beats 3-5 film that garden read-only.}"
  case "$candidate" in
  "$live" | "$live"/*)
    echo "take.sh: REFUSED — $1 resolves to $candidate, which is the live garden ($live) or inside it." >&2
    echo "take.sh: $detail" >&2
    return 1
    ;;
  esac
  return 0
}

# A FLAG WITH NO VALUE MUST FAIL LOUDLY, FAST — NOT SPIN. `shift 2` FAILS SILENTLY when fewer than
# two positional parameters remain: it returns 1 but leaves $1 and $# completely unchanged (bash's
# own documented behaviour, reproduced directly against this bash), and this script never checks a
# `shift`'s exit code. Every flag loop below is `while [ $# -gt 0 ]; do case "$1" in --flag) …
# shift 2 ;; …`, so a flag typed last with nothing after it re-matched the SAME "$1" on the next
# iteration forever — 100% CPU, zero output (three-pass review, round 3: reproduced on all six
# flags, `timeout 5` → exit 124 each). Call this BEFORE consuming "$2" for any flag that takes a
# value: $1 is the flag name (for the message), $2 is the caller's CURRENT "$#", $3 is the
# "take.sh" / "take.sh promote" label its other usage errors already use.
require_value() {
  if [ "$2" -lt 2 ]; then
    echo "$3: $1 needs a value." >&2
    exit 2
  fi
}

SUBCOMMAND="${1:-grow}"
case "$SUBCOMMAND" in
grow | promote) shift ;;
--repo | --identity | --subject | --garden)
  # No subcommand given, first token is already a flag for the default `grow`. Do not shift.
  SUBCOMMAND="grow"
  ;;
*)
  echo "take.sh: unknown subcommand \"$SUBCOMMAND\" — expected \"grow\" or \"promote\"." >&2
  exit 2
  ;;
esac

if [ "$SUBCOMMAND" = "promote" ]; then
  DOC=""
  INTO=""
  while [ $# -gt 0 ]; do
    case "$1" in
    --doc)
      require_value "$1" "$#" "take.sh promote"
      DOC="$2"
      shift 2
      ;;
    --into)
      require_value "$1" "$#" "take.sh promote"
      INTO="$2"
      shift 2
      ;;
    *)
      echo "take.sh promote: unknown argument \"$1\" (only --doc and --into are accepted)." >&2
      exit 2
      ;;
    esac
  done
  # THIS CLOSES: harvest.mjs's own `promote` requires --into but not --doc — a caller who forgets
  # --doc gets no error, just the CLI's own default (apps/leaf/harvest.json beside the script,
  # not the garden under review) silently promoted instead. Requiring both, non-empty, from THIS
  # wrapper's own caller closes exactly that omission.
  if [ -z "$DOC" ] || [ -z "$INTO" ]; then
    echo "take.sh promote: both --doc <harvest.json> and --into <leaf.json> are required." >&2
    echo "take.sh promote: leaving either to default is the omission this refuses — whether they name the same GARDEN is checked below (this wrapper), and whether they name the same SUBJECT is checked by harvest.mjs itself (F-014 + F-024, both guarded — see .loop/FINDINGS.md)." >&2
    exit 2
  fi
  # RESOLVE ONCE, then use the resolved forms for the refusal check AND the exec below — same
  # reason GARDEN_OVERRIDE does this in `grow`: no gap between what was checked and what runs.
  # `|| exit $?`: resolve_dir's own fatal exit only kills its command-substitution subshell.
  DOC="$(resolve_dir "$DOC")" || exit $?
  INTO="$(resolve_dir "$INTO")" || exit $?
  # THE SAME-GARDEN RULE — THIS WRAPPER'S OWN CHECK, NOT THE PRODUCT'S. A promote through
  # take.sh is always within ONE take garden: `grow` writes harvest.json and leaf.json SIDE BY
  # SIDE in one directory, and nothing in this runbook ever needs `--doc`/`--into` to point at
  # two different ones. The product's own binding check below (F-014/F-024) cannot catch a
  # transposed path here, because it binds to SUBJECT, not to garden: a leaf's id is
  # `slugify(subject)` (`apps/leaf/intake.mjs`) — a deterministic function of the NAME, not of
  # which directory grew it. take.sh never passes `--subject` unless the caller does, so the
  # ordinary reshoot case — grow twice from the same repo and identity, which is EVERY reshoot
  # this script exists for — produces two take-gardens with IDENTICAL bindings, by design:
  # same subject, same leaf id, two unrelated directories. `promoteApproved` cannot tell them
  # apart because there is nothing to tell (round 10 review, reproduced live: approving a
  # candidate in one take and cross-promoting it into a second take of the SAME subject
  # succeeded, exit 0, spliced — the product's check never fires because nothing mismatched).
  # This is the one thing only THIS wrapper can check: refuse before the product ever sees it.
  DOC_DIR="$(dirname "$DOC")"
  INTO_DIR="$(dirname "$INTO")"
  if [ "$DOC_DIR" != "$INTO_DIR" ]; then
    echo "take.sh promote: REFUSED — --doc and --into are not in the same take-garden directory." >&2
    echo "take.sh promote:   --doc  resolves into $DOC_DIR" >&2
    echo "take.sh promote:   --into resolves into $INTO_DIR" >&2
    echo "take.sh promote: a promote through this wrapper is always within ONE take garden — a different directory is always a transposed path, same subject or not." >&2
    exit 1
  fi
  # F-014 + F-024 ARE CLOSED AT THE PRODUCT LEVEL, NOT HERE — AND ONLY FOR CROSS-SUBJECT
  # MISMATCHES. `promoteApproved` (packages/photosynthesis/src/promote.ts) binds a harvest
  # document's subject/leaf id at propose time and refuses a mismatch by name (F-014, PR #17),
  # a binding that now survives `decide()`/`recordDecision()` too — approve/reject used to
  # rebuild the document as `{ candidates }` only and silently drop it (F-024, PR #19).
  # Reproduced live across the full sanctioned sequence, for a DIFFERENT subject: `take.sh
  # promote --doc take-A/harvest.json --into take-B/leaf.json`, after approving a candidate in
  # take-A first, refuses, citing both the subject and leaf-id mismatch. That check is real, but
  # it cannot see the same-subject case above at all — same-garden is this wrapper's job,
  # cross-subject is the product's; neither substitutes for the other.
  for target in "$DOC" "$INTO"; do
    if ! refuse_if_live_garden "$target" \
      "a real approval that reaches ~/.foliage goes through the product surface — foliage.mjs's own review command or the browser's /promote panel, which resolve their own --doc/--into from the running instance's garden. This wrapper's whole job is writing into a TAKE garden; it is never the path into the live one, on either flag."; then
      exit 1
    fi
  done
  exec node "$TOOL_REPO/apps/leaf/harvest.mjs" promote --doc "$DOC" --into "$INTO" --force
fi

# --- grow: fresh take-garden, real leaflets, no fixture ------------------------------------

REPO="$TOOL_REPO"
IDENTITIES=()
SUBJECT=""
GARDEN_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
  --repo)
    require_value "$1" "$#" "take.sh"
    REPO="$2"
    shift 2
    ;;
  --identity)
    require_value "$1" "$#" "take.sh"
    IDENTITIES+=("$2")
    shift 2
    ;;
  --subject)
    require_value "$1" "$#" "take.sh"
    SUBJECT="$2"
    shift 2
    ;;
  --garden)
    require_value "$1" "$#" "take.sh"
    GARDEN_OVERRIDE="$2"
    shift 2
    ;;
  *)
    echo "take.sh: unknown argument \"$1\"." >&2
    exit 2
    ;;
  esac
done

if [ ! -d "$REPO/.git" ] && ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "take.sh: $REPO is not a git repository — nothing real to grow from." >&2
  exit 2
fi

# IDENTITY, FROM GIT LOG, NOT FROM GIT CONFIG. `foliage.mjs grow` already falls back to
# `git config user.email` when no --identity is given, but a config value can be stale or unset
# in a fresh checkout while the history itself is unambiguous. This asks the history directly:
# the address with the most non-merge commits, the same query `grow`'s own identity-mismatch
# diagnosis tells an operator to run by hand (foliage.mjs, the "IDENTITY 0 of N" branch).
if [ "${#IDENTITIES[@]}" -eq 0 ]; then
  TOP="$(git -C "$REPO" log --no-merges --format='%ae' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
  if [ -z "$TOP" ]; then
    echo "take.sh: $REPO has no non-merge commits to derive an identity from. Pass --identity <email>." >&2
    exit 2
  fi
  IDENTITIES=("$TOP")
fi

# FRESH, ALWAYS. mktemp -d makes a new, empty, uniquely-named directory every single run — there
# is no code path in this script that re-opens a directory a previous take already wrote to, so
# F-015's failure shape (a hand-edited title silently reverted by the next --force re-grow)
# cannot occur through this script: there is nothing here to re-grow INTO, only ever a new one to
# grow FROM SCRATCH. If a caller passes --garden explicitly, the same rule is enforced directly
# below rather than assumed.
if [ -n "$GARDEN_OVERRIDE" ]; then
  # RESOLVE ONCE, THEN USE ONLY THE RESOLVED PATH FROM HERE ON. Resolving here — not just inside
  # refuse_if_live_garden — means the refusal check, the leaf.json/harvest.json existence check,
  # `mkdir -p`, and TAKE_GARDEN all act on the exact same path that was checked; there is no gap
  # where a literal caller-typed string (relative, or carrying a "..") could name one thing at
  # check time and another at write time. `|| exit $?`: resolve_dir's own fatal exit only kills
  # its command-substitution subshell.
  GARDEN_OVERRIDE="$(resolve_dir "$GARDEN_OVERRIDE")" || exit $?
  # THE LIVE-GARDEN CHECK RUNS FIRST, BEFORE ANYTHING TOUCHES DISK. Checking after `mkdir -p`
  # would let a refused path still get an (empty) directory created inside ~/.foliage — a
  # write, even a small one, is exactly what this script exists to never do.
  if ! refuse_if_live_garden "$GARDEN_OVERRIDE"; then
    exit 1
  fi
  if [ -e "$GARDEN_OVERRIDE/leaf.json" ] || [ -e "$GARDEN_OVERRIDE/harvest.json" ]; then
    echo "take.sh: REFUSED — $GARDEN_OVERRIDE already holds a leaf.json or harvest.json." >&2
    echo "take.sh: this is a FRESH-take mechanism, not a resume/edit one (F-015). Pick an empty directory, or none, and let take.sh mktemp one." >&2
    exit 2
  fi
  mkdir -p "$GARDEN_OVERRIDE"
  TAKE_GARDEN="$GARDEN_OVERRIDE"
else
  TAKE_GARDEN="$(mktemp -d "${TMPDIR:-/tmp}/foliage-take.XXXXXX")"
  # Defensive, not decorative: mktemp under $TMPDIR should never land inside ~/.foliage, but a
  # misconfigured TMPDIR pointing there is exactly the kind of silent agreement this check
  # exists to catch instead of trust.
  if ! refuse_if_live_garden "$TAKE_GARDEN"; then
    rmdir "$TAKE_GARDEN" 2>/dev/null
    exit 1
  fi
fi

IDENTITY_ARGS=()
for id in "${IDENTITIES[@]}"; do IDENTITY_ARGS+=(--identity "$id"); done
SUBJECT_ARGS=()
[ -n "$SUBJECT" ] && SUBJECT_ARGS=(--subject "$SUBJECT")

echo "take.sh: take-garden  $TAKE_GARDEN"
echo "take.sh: growing from $REPO as ${IDENTITIES[*]}"
echo

# `${arr[@]+"${arr[@]}"}` rather than a bare `"${arr[@]}"`: macOS ships bash 3.2 as /bin/bash,
# and 3.2's `set -u` treats a zero-element array as an unset variable — SUBJECT_ARGS is exactly
# that whenever --subject was not given. The guarded form expands to nothing on an empty array
# instead of exiting the whole script.
FOLIAGE_GARDEN="$TAKE_GARDEN" node "$TOOL_REPO/foliage.mjs" grow --repo "$REPO" \
  "${IDENTITY_ARGS[@]+"${IDENTITY_ARGS[@]}"}" "${SUBJECT_ARGS[@]+"${SUBJECT_ARGS[@]}"}"
STATUS=$?

echo
echo "take.sh: this take's garden is $TAKE_GARDEN"
echo "take.sh: a bad take is  rm -rf \"$TAKE_GARDEN\" && $0"
echo "take.sh: to work it — foliage up / foliage review / foliage export, one of:"
echo "take.sh:   FOLIAGE_GARDEN=\"$TAKE_GARDEN\" node \"$TOOL_REPO/foliage.mjs\" up --port 4210"
echo "take.sh:   FOLIAGE_GARDEN=\"$TAKE_GARDEN\" node \"$TOOL_REPO/foliage.mjs\" review"
echo "take.sh:   FOLIAGE_GARDEN=\"$TAKE_GARDEN\" node \"$TOOL_REPO/foliage.mjs\" export --out <dir> --confirm"

exit "$STATUS"
