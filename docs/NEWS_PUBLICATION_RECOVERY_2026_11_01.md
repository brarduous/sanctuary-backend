# Direct news publication and feed recovery

The production feed stopped at September 24 while the hourly generator continued. Read-only checks on November 1 found 1,625 newer pending rows. Human-review gates treated sensitive topics, limited confidence and any unresolved context as publication blockers. Generated source entries also frequently omitted publisher labels, producing false independence failures.

Articles now publish directly after automatic structural/source/claim checks. Publisher metadata comes from fetched/stored reporting. Single-source articles remain explicitly provisional, and confidence/context limitations remain visible as assessment notices. Missing verification, unsupported/contradicted/unverifiable claims, incomplete records and manual rejection/archival still prevent publication. No human approval is required for eligible news.

The migration changes only the source-publication trigger: at least one real linked source is required; the existing completeness constraint remains. The rollback restores the two-source rule without deleting or unpublishing history. Apply this migration before releasing the generator.

Every hourly run rechecks at most 200 pending canonical articles from the previous 72 hours. The recovery command defaults to a dry run (`node scripts/reconcileNewsPublication.js`); `--apply` publishes eligible rows and resolves only their obsolete publication-review alerts. It does not send emails or push notifications. Updates retain a conditional pending status so manual state changes are respected. Failed database writes are reported as failures.

Verification: source-policy tests, saved-record/dry-run/idempotency/failure tests, and an isolated PostgreSQL trigger/rollback test. Release production verification should record the published IDs and confirm the public app API and website show current dates. Do not include service-role keys, provider tokens or private operational dumps in the repository.

## Reader positioning

News and daily briefs now use the young-adult devotional voice: a factual TL;DR, a clearly labeled Christian assessment with a real Bible reference, and more factual detail below. Assessments cover reported conduct or a proportionate response using shared Christian principles. Verdicts are aligned, conflicts, mixed or unclear; accidents and victims are never inherently condemned. Genuine passage text and a separate automated source/Scripture/audience check must pass before new copy is saved. Up to two attempts use concrete correction feedback. No human approval or reviewer identity is fabricated. Legacy app versions receive the same judgment through the existing synopsis field.

The additive daily-brief migration adds details and stories; existing synopsis/scripture/prayer fields remain compatible. Apply both news migrations before releasing the jobs.

## November 1 verification

Recovery published 85 eligible canonical articles from the previous 72 hours, held 19 and failed 0 writes. The latest public feed now contains November 1 reporting. Three recent articles were refreshed with the new reader format using actual writer and independent reviewer responses; all three passed and were saved. A new structured daily brief was also generated and saved. Private before/after and model provenance audits remain outside Git.

Backend verification: 214 full-suite tests passed; the one failing file exposed an unrelated local devotional import accidentally copied into the isolated worktree. That import was removed, and all eight tests in the affected audience/reader group passed. The news-focused suite and syntax check were run again on the isolated release.
