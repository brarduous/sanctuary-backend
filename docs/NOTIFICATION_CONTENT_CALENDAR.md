# Sanctuary notification schedule and content calendar

## Recommended cadence

| Send window (recipient local time) | Audience | Notification | Frequency | Goal |
| --- | --- | --- | --- | --- |
| 8:00–9:00 a.m. | Users explicitly opted into devotionals | Daily devotional title and Scripture | Daily | Begin the day in Scripture |
| 12:00–1:00 p.m. | Users explicitly opted into advice | Wisdom check-in | Wednesday only | Invite reflection without competing with the morning devotional |
| 5:00–7:00 p.m. | Users explicitly opted into news | High-impact news alert | Event-driven, maximum 2 per week | Offer a scriptural perspective on genuinely important news |
| Organization-selected time | Users opted into church alerts | Pastoral announcement, study, or event reminder | As needed, maximum 3 routine sends per week | Keep the congregation informed |

Emergency and time-sensitive church alerts are exempt from frequency caps. Do not send routine notifications during 9:00 p.m.–8:00 a.m. local quiet hours.

## Four-week devotional copy rotation

The devotional title must appear in every daily message. Use the personalized devotional when one exists; otherwise use the day's general devotional.

| Week | Title pattern | Body pattern |
| --- | --- | --- |
| 1 | `Your daily devotional is ready` | `{Devotional title} reflects on {Scripture}.` |
| 2 | `A moment for Scripture` | `Today's devotional: {Devotional title}.` |
| 3 | `Begin with what matters` | `{Devotional title} — a reflection on {Scripture}.` |
| 4 | `Pause, pray, and reflect` | `Spend a few minutes with {Devotional title}.` |

Repeat the rotation with newly generated devotional titles. A first name may be used in the title when available, but avoid sensitive personalization in lock-screen copy.

## Weekly supporting content

| Day | Optional content | Example |
| --- | --- | --- |
| Monday | Week-opening encouragement | `What do you want to carry into this week with God?` |
| Wednesday | Advice invitation | `What decision could use a prayerful, scriptural perspective?` |
| Friday | Reflection prompt | `Where did you notice grace this week?` |
| Sunday | Church/community item | Use congregation-authored copy and the relevant service, study, or event link. |

Only send optional content to its matching opted-in audience. Skip it when another non-emergency notification was sent to that user in the previous six hours.

## Operating rules

- Require an explicit per-category opt-in; operating-system permission alone is not consent to every category.
- Deep-link to the exact devotional, article, study, or announcement whenever possible.
- Deduplicate by user, category, content ID, and local calendar day.
- Generate the day's devotional before its notification window. If content is unavailable, skip the send instead of using generic evergreen copy.
- Track attempted, delivered, opened, opted out, and invalid-token counts by campaign and variant.
- Review opt-out and open rates monthly. Reduce cadence before rewriting copy if opt-outs rise materially.

## Rollout

1. Run the devotional notification in dry-run mode and verify opted-in and opted-out recipient counts.
2. Send to an internal test cohort for three days, checking copy, deep links, and time zones.
3. Roll out to 10%, 50%, then 100% of eligible users with a 24-hour observation window between stages.
4. Add recipient-local scheduling and quiet-hour enforcement before expanding the calendar beyond the current morning devotional and Wednesday advice send.
