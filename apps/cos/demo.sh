#!/usr/bin/env bash
#
# Foliage — the local chief of staff, in five scenes (about thirty seconds of model time, when a
# local model is running).
#
# It shows the one claim that is hard to believe until you watch it happen: a private career
# reflection is answered on this machine, nothing leaves it, and the machine can PROVE it did
# not leave rather than assuring you. Whether a language model did the answering depends on
# whether one is running, so the captions read the transcript's PRODUCED BY line and say what
# actually ran. They never claim a model reasoned when a rule answered.
#
# TWO STORES ON PURPOSE. Scenes ①–④ use a store holding device-only material; scene ⑤ uses a
# separate one holding only shareable material. That is not staging — it is the router being
# strict: one tier1-local item in the retrieved set pins the WHOLE request to local-only, so a
# single store containing the private notes can never demonstrate the escalation path. The first
# version of this script tried, and scene ⑤ correctly refused to send anything. Kept as two
# stores because the alternative is a demo that quietly deletes the private material first,
# which would be showing the guarantee off by removing the thing it guards.
#
#   ./apps/cos/demo.sh
#
# Needs: ollama running with a small model (FOLIAGE_LOCAL_MODEL, default llama3.2:3b) for ③,
# and FOLIAGE_FIREWORKS_API_KEY + FOLIAGE_FIREWORKS_MODEL for ⑤. Missing either is not a broken
# demo — those scenes then show the honest refusal, which is worth watching too.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PRIVATE=$(mktemp -d) ; SHAREABLE=$(mktemp -d) ; ASKED=$(mktemp)
trap 'rm -rf "$PRIVATE" "$SHAREABLE" "$ASKED"' EXIT

export FOLIAGE_COS_SECRET="${FOLIAGE_COS_SECRET:-a passphrase typed at the terminal, never stored}"
export FOLIAGE_LOCAL_MODEL="${FOLIAGE_LOCAL_MODEL:-llama3.2:3b}"

# Line-buffered so each line shows as cos prints it: a grep writing into a pipe otherwise holds
# its output until the model has answered.
cos() { node apps/cos/cos.mjs "$@" 2>&1 | grep --line-buffered -v ExperimentalWarning | grep --line-buffered -v trace-warnings; }
scene() { printf '\n\n\033[1m%s\033[0m\n\033[2m%s\033[0m\n\n' "$1" "$2"; }

export FOLIAGE_COS_STORE="$PRIVATE/tier1.foliage"

scene "① A store on your own machine." \
      "Encrypted with a key derived from a passphrase Foliage never sees and never stores."
cos init

scene "② You file two things, and you say what each one IS." \
      "Nothing is inferred. No regex reads your words to guess how sensitive they are."
cos declare perf-notes tier1-local \
  "I was passed over for staff. I think my manager undersold the migration work and I have not raised it."
cos declare migration tier1-local \
  "Led the billing datastore migration; p99 write latency 840ms to 110ms across 14 services."

scene "③ You ask it something you would never type into a chat box." \
      "Watch TIER 3 (was anything sent?) and PRODUCED BY (what actually answered)."
# Shown live (RETRIEVED, DECISION and EGRESS print before the model answers), and kept for the
# captions at the end.
cos ask --as tier1-local "Help me decide how to raise the promotion conversation with my manager." | tee "$ASKED"

scene "④ Now break it. Point the model at a dead port and ask again." \
      "With no model reachable, the deterministic floor answers. The answer never disappears."
FOLIAGE_LOCAL_MODEL_BASE_URL=http://127.0.0.1:9 \
  cos ask --as tier1-local "The same question, with no model reachable at all."

export FOLIAGE_COS_STORE="$SHAREABLE/tier3.foliage"

scene "⑤ A different person, or a different day: only shareable material on file." \
      "Now escalation is permitted — and every item that crosses is named before it goes."
cos init
cos declare recruiter-blurb tier3-shareable \
  "Billing datastore migration across 14 services; p99 write latency 840ms to 110ms."
FOLIAGE_COS_MAY_CROSS=tier3-shareable \
  cos ask --as tier3-shareable "Summarise my migration work for a recruiter in two lines."

printf '\n\n\033[1mWhat you just watched\033[0m\n'
if grep -q '^PRODUCED BY  local-model' "$ASKED"; then
  printf '  · Private material reasoned over on-device by a local model (PRODUCED BY in ③).\n'
  printf '  · Killing the model degraded the answer instead of removing it.\n'
else
  printf '  · No local model answered ③, so nothing was reasoned over: a rule on this machine answered.\n'
  printf '    Run ollama with %s and this script again to see a model answer.\n' "$FOLIAGE_LOCAL_MODEL"
  printf '  · With no model, the deterministic floor answered instead of the answer disappearing.\n'
fi
if grep -q '^TIER 3 .*not attempted — policy-refused' "$ASKED"; then
  printf '  · Nothing in ③ left the machine. TIER 3 read: not attempted — policy-refused.\n'
else
  printf '  · TIER 3 in ③ did not read policy-refused. Read its egress account above before trusting this run.\n'
fi
printf '  · The request itself was routed, not exempt — it appears in the egress plan as <request>.\n'
printf '  · Every answer named what produced it, and every claim about you carried the item it rests on.\n'
printf '  · Nothing here became a portfolio entry. This agent cannot write one — that gate is elsewhere.\n\n'
