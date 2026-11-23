# Sourced by scripts/env.sh and scripts/nova-mcp.sh: lets a fresh git worktree (.claude/worktrees/agent-*) use what the main
# checkout of the same repository has already installed and built, without writing anything into the main checkout.
#
#   nova_main_checkout <repo>           prints the main checkout's folder, or nothing when <repo> is the main checkout
#   nova_node_modules <repo>            prints the studio/node_modules to use: the worktree's own, else the main checkout's
#   nova_clone_node_modules <repo>      gives the worktree its own studio/node_modules, a copy-on-write clone of the main
#                                       checkout's (seconds, no extra disk on APFS), when the two package-lock.json are the same
#   nova_pick_bin <repo> <name> <paths> prints the target/release/<name> to use: the worktree's own when it has one; else the
#                                       main checkout's when it is safe (see below); else nothing, with one line on stderr saying
#                                       what to run
#   nova_seed_target <repo> <profile>   gives a worktree that has no target/<profile> yet (debug, release, fast) a copy-on-write
#                                       clone of the main checkout's built dependencies (not the workspace's own crates), so its
#                                       first build compiles only Nova's crates: about a minute less for the tests, more for the
#                                       studio's crate. Cargo still checks every one and rebuilds what does not match.
#
# The main checkout's binary is safe when (1) the main checkout has no uncommitted change under <paths>, (2) this worktree's
# files under <paths> are byte for byte the main checkout's HEAD (no change, nothing untracked) and (3) the binary is newer
# than every file under <paths> in the main checkout (so it was built from those files, not from an older commit).
# Each choice it makes for you is said in one line on stderr, starting "worktree:". Set NOVA_WORKTREE_QUIET=1 to hush them.

# The files the `nova` binary is built from (tests, docs and examples do not change it).
NOVA_RUNTIME_INPUTS="crates/nova-runtime/src crates/nova-runtime/lua crates/nova-runtime/build.rs crates/nova-runtime/Cargo.toml audio/src audio/include audio/CMakeLists.txt vendor licenses Cargo.toml Cargo.lock rust-toolchain.toml"
# The files `nova-ogg` (the music encoder, in the studio's crate) is built from.
NOVA_OGG_INPUTS="studio/src-tauri/src studio/src-tauri/Cargo.toml studio/src-tauri/build.rs Cargo.toml Cargo.lock rust-toolchain.toml"

nova_say() { [ -n "${NOVA_WORKTREE_QUIET:-}" ] || printf 'worktree: %s\n' "$1" >&2; }

nova_main_checkout() {
  local repo="$1" common main
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  [ "$(basename "$common")" = ".git" ] || return 0
  main="$(dirname "$common")"
  [ "$(cd "$main" && pwd -P)" = "$(cd "$repo" && pwd -P)" ] && return 0
  [ -d "$main" ] && printf '%s\n' "$main"
}

nova_node_modules() {
  local repo="$1" main
  if [ -d "$repo/studio/node_modules" ]; then printf '%s\n' "$repo/studio/node_modules"; return 0; fi
  main="$(nova_main_checkout "$repo")"
  if [ -n "$main" ] && [ -d "$main/studio/node_modules" ]; then
    nova_say "this worktree has no studio/node_modules; using the main checkout's ($main/studio/node_modules, read only)"
    printf '%s\n' "$main/studio/node_modules"
  fi
}

nova_clone_node_modules() {
  local repo="$1" main
  [ -d "$repo/studio/node_modules" ] && return 0
  main="$(nova_main_checkout "$repo")"
  [ -n "$main" ] && [ -d "$main/studio/node_modules" ] || return 0
  if ! cmp -s "$repo/studio/package-lock.json" "$main/studio/package-lock.json"; then
    nova_say "studio/package-lock.json differs from the main checkout's, so its node_modules may not fit: install them here with \`cd studio && ../scripts/env.sh npm ci\` (a download: ask first)"
    return 0
  fi
  local tmp="$repo/studio/.node_modules.cloning.$$"
  # copy-on-write clone (APFS, btrfs, XFS): the files are shared until one side writes, so nothing reaches the main checkout
  if cp -cR "$main/studio/node_modules" "$tmp" 2>/dev/null || cp -R --reflink=auto "$main/studio/node_modules" "$tmp" 2>/dev/null; then
    mv "$tmp" "$repo/studio/node_modules"
    nova_say "this worktree had no studio/node_modules; cloned the main checkout's into it (copy-on-write: the main checkout is not touched)"
  else
    rm -rf "$tmp"
    nova_say "could not clone the main checkout's studio/node_modules; run \`cd studio && ../scripts/env.sh npm ci\` (a download: ask first)"
  fi
}

# Prints why the main checkout's binary is not safe for this worktree, or nothing when it is.
nova_bin_unsafe_reason() {
  local repo="$1" main="$2" bin="$3" paths="$4" head
  # shellcheck disable=SC2086
  if [ -n "$(git -C "$main" --no-optional-locks status --porcelain --untracked-files=no -- $paths 2>/dev/null)" ]; then
    echo "the main checkout has uncommitted changes to the engine's sources"; return
  fi
  head="$(git -C "$main" rev-parse HEAD 2>/dev/null)" || { echo "the main checkout's commit cannot be read"; return; }
  # shellcheck disable=SC2086
  if ! git -C "$repo" --no-optional-locks diff --quiet "$head" -- $paths 2>/dev/null; then
    echo "this worktree's engine sources differ from the main checkout's commit ${head:0:8}"; return
  fi
  # shellcheck disable=SC2086
  if [ -n "$(cd "$repo" && git --no-optional-locks ls-files --others --exclude-standard -- $paths 2>/dev/null | head -1)" ]; then
    echo "this worktree has new engine source files"; return
  fi
  local newer="" p
  for p in $paths; do
    [ -e "$main/$p" ] || continue
    newer="$(find "$main/$p" -type f -newer "$bin" -print -quit 2>/dev/null)"
    [ -n "$newer" ] && break
  done
  if [ -n "$newer" ]; then echo "the main checkout's binary is older than its sources (${newer#"$main"/})"; return; fi
}

nova_pick_bin() {
  local repo="$1" name="$2" paths="$3" main reason build
  if [ -x "$repo/target/release/$name" ]; then printf '%s\n' "$repo/target/release/$name"; return 0; fi
  if [ "$name" = nova ]; then build="scripts/env.sh cargo build --release -p nova-runtime --bin nova  (about 4 minutes from nothing, a minute after an engine edit)"
  else build="scripts/env.sh cargo build --release -p nova-studio --bin $name  (a few minutes from nothing)"; fi
  main="$(nova_main_checkout "$repo")"
  if [ -z "$main" ]; then return 0; fi
  if [ ! -x "$main/target/release/$name" ]; then
    nova_say "no $name binary here or in the main checkout; build it in this worktree: $build"; return 0
  fi
  reason="$(nova_bin_unsafe_reason "$repo" "$main" "$main/target/release/$name" "$paths")"
  if [ -n "$reason" ]; then
    nova_say "not using the main checkout's $name: $reason. Build this worktree's own: $build"; return 0
  fi
  nova_say "using the main checkout's $name ($main/target/release/$name): this worktree's engine sources are the same as the ones it was built from"
  printf '%s\n' "$main/target/release/$name"
}

nova_seed_target() {
  local repo="$1" profile="$2" main from tmp
  [ -n "${NOVA_NO_SEED:-}" ] && return 0
  [ -e "$repo/target/$profile" ] && return 0
  main="$(nova_main_checkout "$repo")"
  [ -n "$main" ] || return 0
  from="$main/target/$profile"
  [ -d "$from/.fingerprint" ] && [ -d "$from/deps" ] || return 0
  mkdir -p "$repo/target" || return 0
  tmp="$repo/target/.seeding.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp/deps"
  # The main checkout's files are read while no cargo builds there (a shared hold on its locks for the seconds of the clone;
  # nothing is written there), so no half-written file is cloned. Copy-on-write (APFS): no extra disk until cargo here rewrites
  # a file. Only libraries (lib*.rlib, .rmeta, .dylib, .a), build-script outputs and fingerprints: no test binaries, no
  # incremental caches. The main checkout's own crates come along but never match here (their paths are part of their hash).
  if perl -e '
      use Fcntl ":flock";
      my ($from, $tmp) = @ARGV;
      my @held;
      for my $l (".cargo-lock", ".cargo-build-lock", ".cargo-artifact-lock") {
        next unless -e "$from/$l";
        open(my $f, "<", "$from/$l") or exit 3;
        flock($f, LOCK_SH | LOCK_NB) or exit 4;
        push @held, $f;
      }
      system("cp", "-cRp", "$from/.fingerprint", "$from/build", "$tmp/") == 0 or exit 5;
      opendir(my $d, "$from/deps") or exit 5;
      my @libs = map { "$from/deps/$_" } grep { /^lib.*\.(rlib|rmeta|dylib|a|so)$/ } readdir($d);
      while (my @chunk = splice(@libs, 0, 500)) { system("cp", "-cp", @chunk, "$tmp/deps/") == 0 or exit 5; }
      exit 0;
    ' "$from" "$tmp" 2>/dev/null; then
    if [ -e "$repo/target/$profile" ]; then rm -rf "$tmp"; return 0; fi
    mv "$tmp" "$repo/target/$profile"
    nova_say "this worktree had no target/$profile; seeded it with a copy-on-write clone of the main checkout's built dependencies, so only Nova's own crates build (the main checkout is not touched; NOVA_NO_SEED=1 skips this)"
  else
    rm -rf "$tmp"
    nova_say "did not seed target/$profile from the main checkout (a build is running there, or the clone failed): this first build compiles everything"
  fi
}
