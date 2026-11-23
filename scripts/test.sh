#!/bin/bash
# The workspace's Rust tests, run side by side (scripts/lib/test-runner.mjs): one build, then the test binaries several at once,
# the slowest first, each into its own log under target/nova-test-logs/.
#
#   scripts/test.sh               quick: everything except the long tests (agents: before handing work back)
#   scripts/test.sh all           everything, the long tests too, each in its own process (the merger, before merging)
#   scripts/test.sh one <name>    the tests whose names contain <name>, long ones included, or one test file's tests
#                                 (scripts/test.sh one mountain_post): while working on something
#   options: --jobs N (test binaries at once, about a third of the cores), -p <package>
#
# A long test is marked #[ignore = "long: ..."] in a file under crates/*/tests/ (so plain `cargo test` skips it too). Other
# ignored tests are measurements or need a device: run those by hand as their notes say. Studio tests: docs/agent-guide.md.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
exec "$repo/scripts/env.sh" node "$repo/scripts/lib/test-runner.mjs" "$@"
