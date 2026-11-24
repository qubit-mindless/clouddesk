#!/bin/bash
# PostToolUse (Edit|Write) – formatuje plik po edycji przez Claude'a tak, jak sprawdza CI:
#   backend/**/*.py → ruff format (wersja z backend/.venv, jak w requirements-dev.txt)
#   terraform/*.tf  → terraform fmt
# Tylko formatowanie: bez `ruff check --fix`, bo w trakcie kilku edycji usuwałby świeżo dodane importy.
# Brak jq / ruff / terraform → hook nic nie robi (nie blokuje pracy).
command -v jq >/dev/null || exit 0
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0

repo="$(cd "$(dirname "$0")/../.." && pwd)"
case "$f" in
  "$repo"/backend/*.py)
    ruff="$repo/backend/.venv/bin/ruff"
    [ -x "$ruff" ] || ruff="$(command -v ruff)" || exit 0
    "$ruff" format --quiet "$f"
    ;;
  "$repo"/terraform/*.tf)
    command -v terraform >/dev/null || exit 0
    terraform fmt "$f" >/dev/null
    ;;
esac
exit 0
