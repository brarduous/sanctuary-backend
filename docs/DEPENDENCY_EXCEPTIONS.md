# Dependency security review

Critical and high production advisories block release. Any exception must record the package, advisory, affected execution path, compensating control, owner, approval date, and an expiry no later than 30 days after approval.

No exception is approved by this file. `npm audit --omit=dev --audit-level=high` remains the CI command; remediation must prefer compatible upgrades and removal of unused packages over force-upgrading across breaking versions.
