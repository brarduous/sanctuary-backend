require('dotenv').config();
const { runDevotionalQualityReview } = require('../services/devotionalQualityReview');
if (require.main === module) runDevotionalQualityReview({ dryRun: process.argv.includes('--dry-run') })
  .then(report => console.log(JSON.stringify({ start:report.start, end:report.end, skipped:report.skipped, reason:report.reason,
    changes:report.changes, lanes:Object.fromEntries(Object.entries(report.lanes || {}).map(([lane,result]) => [lane,{ averages:result.averages, grades:result.letterGrades, comparison:result.comparison }])) })))
  .catch(error => { console.error('[Devotional Quality]', error.message); process.exitCode = 1; });
