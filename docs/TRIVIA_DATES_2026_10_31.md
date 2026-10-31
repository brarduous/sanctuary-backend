# Trivia dates and Pro archive — October 31, 2026

Shared results display MM/DD/YYYY (for example, 10/31/2026) and always link to https://sanctuaryapp.us/trivia. Opening that link selects the viewer’s current local date; no query variable is required. A dated archive link remains usable by signed-in Pro users.

Web and mobile offer previous/next navigation and a Today action. The web date picker caps selection at today. Future or invalid web links resolve to today. Today is free; past dates require a current Pro profile. The API checks the authenticated user's subscription_tier, rejects future dates, and returns only today by default. Upcoming offline bundles are no longer supplied. Direct question reads enforce the same archive and local-date boundary.

Validation: both clients typecheck; seven daily-set tests cover all 64 share patterns, date formatting, calendar validity, day boundaries and matching web/mobile output. All 207 backend tests pass, including actual SQL-backed Pro/free/guest archive reads, ignored client entitlement hints, downgrade rejection, future reads and bundle filtering. Browser checks cover today without a query, future-link normalization, disabled forward navigation and the guest archive gate. No production account tier was changed for testing.

CI identified the existing follow-redirects 1.16.1 dependency advisory [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). Both lockfiles now select patched 1.16.2; the production dependency audit passes. No audit gate was relaxed.

Production deployment is verified. [Cross-platform release evidence](https://github.com/brarduous/sanctuary-mobile/blob/main/docs/releases/TRIVIA_DATES_2026_10_31.md) records the web/API deployment, native reviews, screenshot publication and precise QA limits.
