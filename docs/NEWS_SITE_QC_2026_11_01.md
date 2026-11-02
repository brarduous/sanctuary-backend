# News freshness and assessment repair — November 1, 2026

The public Politics feed returned no stories while the database contained November 1 coverage. Its filter resolved only the first 1,000 unordered lifetime relationships before sorting. The topic directory similarly exposed the first 1,000 of 19,730 topics. Activity counts included withheld stories and used ingestion dates.

The feed now scans published canonical candidates in deterministic source-date order and matches taxonomy links in bounded batches. It handles topic/category intersections without a nested PostgREST join or a lifetime relationship cutoff. Date filters use the source date, falling back to creation only when absent, and reject future dates. Impact ranking is restricted to a recent window and decays impact with age. Taxonomy activity counts only current public canonical coverage; navigation topics come from active IDs rather than the first page of historical tags. Individual historical topic URLs remain available.

Christian assessments now judge only the conduct central to the article, with an explicit actor/action focus. Recommended reader responses cannot substitute for that assessment. Deliberate violence and demeaning insults must not be labeled aligned by switching focus to caring for victims or seeking truth. Accidents and illness are not inherently sinful; unknown culpability stays unclear. The writer, validator, independent automated reader review, daily brief and cluster synthesis follow this contract. This is a theological interpretation of supplied reporting, not independent fact verification or human review.

Generated topic-image prompts now require clearly illustrated nonhuman editorial still lifes. Photorealistic staged news events, political caricatures and generic religious imagery are prohibited. The frontend removes legacy synthetic assets and stale topic summaries from news presentation rather than relabeling them as documentary photographs.

The repair command keeps private before/after and actual writer/reviewer response IDs outside Git, skips concurrent changes, and applies only independently accepted reader copy. Source records, publication state, correction records and human review history are retained.

Validation: backend syntax check; 234 full-suite tests; live read-only comparison of Politics, Elections and James Comey feeds; all regression tests for >1,000 relationships, sparse matches, combined filters, source dates, future dates and publisher/topic activity. Live repair and release evidence are added after verification.
