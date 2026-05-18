#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SCOPE="${NPM_SCOPE:-@jitl}"
SOURCE_SCOPE="${SOURCE_NPM_SCOPE:-@opentui}"
PACKAGE_PREFIX="${NPM_PACKAGE_PREFIX:-opentui-}"
VERSION="${VERSION:-}"
TAG="${NPM_TAG:-}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_TESTS="${SKIP_TESTS:-false}"
KEEP_VERSION_CHANGES="${KEEP_VERSION_CHANGES:-false}"
SKIP_EXISTING="${SKIP_EXISTING:-true}"

usage() {
  cat <<'USAGE'
Usage: scripts/jitl-build-test-publish.sh [options]

Build, test, pack, smoke-test, and publish the current checkout as @jitl/* packages using local npm auth.

Options:
  --version <version>       Publish this exact version instead of planning one from npm.
  --scope <scope>           Target npm scope. Defaults to @jitl or NPM_SCOPE.
  --package-prefix <text>   Prefix for package names. Defaults to opentui- or NPM_PACKAGE_PREFIX.
  --tag <tag>               npm dist-tag. Defaults to latest for new base versions, next for SHA versions.
  --dry-run                 Build and run npm publish --dry-run.
  --skip-tests              Build and publish without running tests.
  --keep-version-changes    Leave package.json and bun.lock version edits in the worktree.
  --no-skip-existing        Fail if an exact package version already exists.
  -h, --help                Show this help.

Environment equivalents:
  VERSION, NPM_SCOPE, NPM_PACKAGE_PREFIX, NPM_TAG, DRY_RUN=true, SKIP_TESTS=true,
  KEEP_VERSION_CHANGES=true, SKIP_EXISTING=false
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    --scope)
      SCOPE="${2:-}"
      shift 2
      ;;
    --scope=*)
      SCOPE="${1#--scope=}"
      shift
      ;;
    --package-prefix)
      PACKAGE_PREFIX="${2:-}"
      shift 2
      ;;
    --package-prefix=*)
      PACKAGE_PREFIX="${1#--package-prefix=}"
      shift
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --tag=*)
      TAG="${1#--tag=}"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --skip-tests)
      SKIP_TESTS="true"
      shift
      ;;
    --keep-version-changes)
      KEEP_VERSION_CHANGES="true"
      shift
      ;;
    --no-skip-existing)
      SKIP_EXISTING="false"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! "${SCOPE}" =~ ^@[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "Invalid npm scope: ${SCOPE}" >&2
  exit 1
fi

if [[ -n "${PACKAGE_PREFIX}" && ! "${PACKAGE_PREFIX}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "Invalid npm package prefix: ${PACKAGE_PREFIX}" >&2
  exit 1
fi

for tool in bun git node npm zig; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${tool}" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opentui-jitl-publish.XXXXXX")"
BACKUP_DIR="${TMP_DIR}/backup"
TARBALL_DIR="${TMP_DIR}/npm-tarballs"
mkdir -p "${BACKUP_DIR}"
export NPM_CONFIG_CACHE="${TMP_DIR}/npm-cache"

VERSION_FILES=(
  "bun.lock"
  "packages/core/package.json"
  "packages/react/package.json"
  "packages/solid/package.json"
)

restore_version_files() {
  if [[ "${KEEP_VERSION_CHANGES}" == "true" ]]; then
    echo "Keeping version changes in the worktree."
    return
  fi

  for file in "${VERSION_FILES[@]}"; do
    if [[ -f "${BACKUP_DIR}/${file}" ]]; then
      mkdir -p "${REPO_ROOT}/$(dirname "${file}")"
      cp "${BACKUP_DIR}/${file}" "${REPO_ROOT}/${file}"
    fi
  done
}

cleanup() {
  local status=$?
  restore_version_files
  rm -rf "${TMP_DIR}"
  exit "${status}"
}

trap cleanup EXIT

cd "${REPO_ROOT}"

for file in "${VERSION_FILES[@]}"; do
  if [[ ! -f "${file}" ]]; then
    echo "Missing expected version file: ${file}" >&2
    exit 1
  fi

  mkdir -p "${BACKUP_DIR}/$(dirname "${file}")"
  cp "${file}" "${BACKUP_DIR}/${file}"
done

if [[ "${DRY_RUN}" != "true" ]]; then
  npm whoami >/dev/null
fi

BASE_VERSION="$(bun -e "console.log(require('./packages/core/package.json').version)")"
SHORT_SHA="$(git rev-parse --short=7 HEAD)"
PLAN_PACKAGE_NAME="${SCOPE}/${PACKAGE_PREFIX}core"

if [[ -z "${VERSION}" ]]; then
  if npm view "${PLAN_PACKAGE_NAME}@${BASE_VERSION}" version >/dev/null 2>&1; then
    VERSION="$(bun -e "
      const base = process.argv[1]
      const sha = process.argv[2]
      process.stdout.write(base.includes('-') ? base + '.sha.' + sha : base + '-next.' + sha)
    " -- "${BASE_VERSION}" "${SHORT_SHA}")"
    TAG="${TAG:-next}"
  else
    VERSION="${BASE_VERSION}"
    TAG="${TAG:-latest}"
  fi
else
  TAG="${TAG:-next}"
fi

echo "Publishing plan:"
echo "  scope: ${SCOPE}"
echo "  source scope: ${SOURCE_SCOPE}"
echo "  package prefix: ${PACKAGE_PREFIX}"
echo "  version: ${VERSION}"
echo "  npm tag: ${TAG}"
echo "  dry run: ${DRY_RUN}"
echo "  tests: $([[ "${SKIP_TESTS}" == "true" ]] && echo skipped || echo enabled)"
echo

bun scripts/prepare-release.ts "${VERSION}"

(
  cd packages/core
  bun run build:native --all
  bun run build:lib
)

(
  cd packages/solid
  bun run build
)

(
  cd packages/react
  bun run build
)

if [[ "${SKIP_TESTS}" != "true" ]]; then
  (
    cd packages/core
    bun run test:native
    bun run test:bun
    bun run test:nodejs
  )

  (
    cd packages/solid
    bun run test:bun
    bun run test:nodejs
  )

  (
    cd packages/react
    bun run test:bun
    bun run test:nodejs
  )

  bun run test:dist
fi

PUBLISH_ARGS=(
  "scripts/publish-scoped.ts"
  "--scope"
  "${SCOPE}"
  "--source-scope"
  "${SOURCE_SCOPE}"
  "--package-prefix"
  "${PACKAGE_PREFIX}"
  "--tag"
  "${TAG}"
)

if [[ "${SKIP_EXISTING}" == "true" ]]; then
  PUBLISH_ARGS+=("--skip-existing")
fi

bun "${PUBLISH_ARGS[@]}" --pack-destination "${TARBALL_DIR}" --pack-only

if [[ "${SKIP_TESTS}" != "true" ]]; then
  node scripts/smoke-test-tarballs.mjs "${TARBALL_DIR}" --scope "${SCOPE}" --package-prefix "${PACKAGE_PREFIX}"
fi

PUBLISH_TARBALL_ARGS=(
  "scripts/publish-tarballs.mjs"
  "${TARBALL_DIR}"
  "--tag"
  "${TAG}"
)

if [[ "${DRY_RUN}" == "true" ]]; then
  PUBLISH_TARBALL_ARGS+=("--dry-run")
fi

if [[ "${SKIP_EXISTING}" == "true" ]]; then
  PUBLISH_TARBALL_ARGS+=("--skip-existing")
fi

node "${PUBLISH_TARBALL_ARGS[@]}"
