#!/usr/bin/env bash
# Apply branch protection on main: require the aggregate "CI" status check.
# Requires: gh CLI authenticated with admin rights on the repository.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-nickth3man/bballgenius}"
BRANCH="${1:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH} (required check: CI)..."

gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --method PUT \
  --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
EOF

echo "Done. Verify at: https://github.com/${REPO}/settings/branches"
