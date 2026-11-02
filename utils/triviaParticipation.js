"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.participationDays = participationDays;
exports.participationStreak = participationStreak;
// daily-participation-v1: three distinct canonical questions, any score.
// A carried presentation never creates a second award for the same question.
function participationDays(completions) {
    const first = new Map();
    for (const row of completions) {
        const date = row.dailyPlayDate === null ? null : row.dailyPlayDate || row.originalPuzzleDate || row.puzzleDate;
        if (!date || date !== row.localDate || !validDay(date) || ![1, 2, 3].includes(row.setPosition || 0) || !['answered', 'revealed'].includes(row.mode))
            continue;
        const previous = first.get(row.discoveryId);
        if (!previous || date < previous.date)
            first.set(row.discoveryId, { date, position: row.setPosition });
    }
    const days = new Map();
    for (const row of first.values()) {
        const positions = days.get(row.date) || new Set();
        positions.add(row.position);
        days.set(row.date, positions);
    }
    return new Set([...days].filter(([, positions]) => positions.size === 3).map(([date]) => date));
}
function validDay(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function participationStreak(completions, today) {
    if (!validDay(today))
        return 0;
    const days = participationDays(completions);
    const previous = (date) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); };
    let cursor = days.has(today) ? today : previous(today), current = 0;
    while (days.has(cursor)) {
        current++;
        cursor = previous(cursor);
    }
    return current;
}
