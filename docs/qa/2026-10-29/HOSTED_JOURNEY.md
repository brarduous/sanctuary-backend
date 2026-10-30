# Hosted Discovery journey — October 29, 2026

The repeatable runner `npm run qa:discoveries:hosted -- <new-audit-path> --apply` passed all 16 checks against private Supabase preview `nwrozzdrlwlzjpfhgtlk`. It uses real password sign-in and JWTs, the actual Discovery and notification HTTP routers, and the hosted database. The API was served on loopback port 4013. This is hosted database/authentication integration evidence, not a production HTTP deployment or physical-device delivery check.

Supply the staging `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DISCOVERY_QA_API_URL` only through the secure process environment. The runner refuses the known production project and `NODE_ENV=production`. Without `--apply` it reports the target and makes no mutations. Use a new output path for each run. Do not run against another production project.

The checks establish authenticated completion, server-derived ownership/outcome despite misleading client fields, first-event canonicalization, isolation between two accounts, denied direct table reads, default-off trivia consent, capability and timezone registration, and reminder eligibility. At 18:00 New York local time, dry-run dispatch skipped the completed account and selected the supported opted-in account that had not played. Attempted, accepted and failed pushes were all zero; no delivery row was created.

Two disposable `@example.invalid` accounts were created with random passwords held in memory, with confirmed emails to avoid sending mail. Cleanup removed only those test profiles and auth accounts. Both accounts were deleted and their completion rows cascaded to zero. The initial run exposed the legacy noncascading profile foreign key; its two accounts were also explicitly recovered and deleted before the successful repeat. No production account, preference, completion or token was copied or changed.

[Successful audit](hosted-authenticated-journey.json). This small integration exercise does not measure factual precision; the content evidence/craft rubric and independent reviews remain separate release controls.
