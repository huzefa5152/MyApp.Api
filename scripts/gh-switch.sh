#!/usr/bin/env bash
# Quick-switch between multiple GitHub accounts registered with `gh` CLI.
#
# Why this exists:
#   - `gh auth switch` works but requires an interactive pick when you have
#     2+ accounts. This wrapper takes an optional nickname and flips directly.
#   - Also updates git's user.name + user.email so commits are attributed to
#     the right identity (not just the gh token).
#
# Setup prerequisite (one-time, run yourself in a terminal, not via Claude):
#   gh auth login --hostname github.com --web    # add personal account
#   gh auth login --hostname github.com --web    # add company account
#   # both accounts are now in the keyring; this script flips between them
#
# Usage:
#   scripts/gh-switch.sh                    → interactive pick
#   scripts/gh-switch.sh <username>         → direct switch, e.g. gh-switch.sh huzefa5152
#   scripts/gh-switch.sh personal           → alias for huzefa5152
#   scripts/gh-switch.sh company            → alias for the company account
#
# After switching, run:
#   git config user.name  "<your name>"
#   git config user.email "<matching email>"
# …if you want the NEW commits in this repo to be attributed to the switched
# identity (set the ALIAS_CFG block below to automate this per-alias).

set -euo pipefail

# Per-alias git identity config. Edit this block to match your accounts.
# Leave EMAIL/NAME empty to skip the git-config update for that alias.
declare -A ALIAS_MAP
ALIAS_MAP[personal]="huzefa5152"
ALIAS_MAP[company]="huzefakinetic53"

declare -A EMAIL_MAP
EMAIL_MAP[huzefa5152]="huzefa5152@users.noreply.github.com"
EMAIL_MAP[huzefakinetic53]="huzefa.hussain@kineticsoftware.com"

declare -A NAME_MAP
NAME_MAP[huzefa5152]="Huzefa"
NAME_MAP[huzefakinetic53]="Huzefa Hussain"

# Resolve target account
target="${1:-}"
if [[ -z "$target" ]]; then
  echo "Current accounts:"
  gh auth status 2>&1 | grep -E "Logged in to|Active account" | sed 's/^/  /'
  echo
  read -rp "Switch to which account? (or 'list' / 'cancel'): " target
  [[ "$target" == "cancel" || -z "$target" ]] && { echo "Cancelled."; exit 0; }
  [[ "$target" == "list" ]] && { gh auth status; exit 0; }
fi

# Alias resolution
if [[ -n "${ALIAS_MAP[$target]:-}" ]]; then
  target="${ALIAS_MAP[$target]}"
fi

if [[ -z "$target" ]]; then
  echo "Alias has no GitHub username configured. Edit ALIAS_MAP in $0" >&2
  exit 1
fi

# Do the switch
echo "Switching gh to '$target'..."
gh auth switch --user "$target"

# Update git identity if configured
if [[ -n "${NAME_MAP[$target]:-}" ]]; then
  git config user.name "${NAME_MAP[$target]}"
  echo "  git user.name  → ${NAME_MAP[$target]}"
fi
if [[ -n "${EMAIL_MAP[$target]:-}" ]]; then
  git config user.email "${EMAIL_MAP[$target]}"
  echo "  git user.email → ${EMAIL_MAP[$target]}"
fi

echo
echo "Done. Current status:"
gh auth status 2>&1 | grep -E "Active|Logged in"
