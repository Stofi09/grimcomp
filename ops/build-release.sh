#!/usr/bin/env bash
# Run in a clean reviewed checkout on the builder, never on the shared VPS.
set -euo pipefail
umask 022
[[ $# == 2 ]] || { echo 'usage: ops/build-release.sh FULL_COMMIT EXISTING_OUTPUT_DIRECTORY' >&2; exit 2; }
commit=$1
output=$(cd "$2" && pwd -P)
repo=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$repo"
[[ $output != "$repo" && $output != "$repo/"* ]] \
  || { echo 'Artifact output must be outside the checkout.' >&2; exit 1; }
[[ $commit =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ && $(git rev-parse HEAD) == "$commit" ]] \
  || { echo 'Select one full checked-out reviewed commit.' >&2; exit 1; }
[[ -z $(git status --porcelain --untracked-files=normal) ]] \
  || { echo 'Use a clean reviewed checkout; current WIP is not a release.' >&2; exit 1; }
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] \
  || { echo 'Use Node 24; the account server requires node:sqlite.' >&2; exit 1; }
[[ $(pnpm --version) == 11.5.0 ]] \
  || { echo 'Use the repository-pinned pnpm 11.5.0.' >&2; exit 1; }
# The web suite imports native/shared modules whose root tsconfig extends Expo.
# These are builder-only dependencies; skip native/Sharp lifecycle scripts.
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir web install --frozen-lockfile
pnpm --dir web run check:no-scratch
pnpm --dir web run check:core-boundary
pnpm --dir web run tsc:core
pnpm --dir web run tsc
pnpm --dir web run lint
pnpm --dir web test
node --test server/*.test.mjs
node --test ops/tests/*.test.mjs
python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
pnpm --dir web run build
[[ $(git rev-parse HEAD) == "$commit" && -z $(git status --porcelain --untracked-files=normal) ]] \
  || { echo 'Source changed during the build; refusing artifacts.' >&2; exit 1; }
for kind in web api; do
  source=web/dist
  [[ $kind == web ]] || source=server
  artifact="$output/grimcomp-$kind-$commit.tar.gz"
  python3 ops/grimcomp-release.py package --kind "$kind" --source "$source" \
    --output "$artifact" --release "$commit" --source-commit "$commit" > "$artifact.sha256"
done
echo "Verified web and optional API artifacts: $output"
