# Data governance defaults

- Audit events are append-only and retained for seven years pending legal approval.
- Active ministry records are retained while the organization subscription is active. Soft-deleted critical records have a 30-day recovery window pending legal approval.
- Medical alerts are visible only to authorized check-in staff and lead pastors and should be reviewed annually.
- Organization exports include ministry records and an integrity manifest, but exclude credentials, password hashes, API keys, webhook secrets, and provider tokens.
- Production recovery objectives are placeholders pending infrastructure approval: RPO 24 hours and RTO 8 hours. Restore drills must occur before launch and at least quarterly afterward.
