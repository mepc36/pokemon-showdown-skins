// Wins, losses and peak Elo, kept in local storage under one key.
// `counted` remembers the battle rooms already counted, so a battle whose result line arrives again
// (a reconnect replays the room's log) is not counted twice. Reset clears the wins and losses only.
const KEY = 'ps-mve-record';
const COUNTED_LIMIT = 200;
const count = value => Number.isInteger(value) && value >= 0 ? value : 0;

export function readRecord(storage) {
  let saved = null;
  try { saved = JSON.parse(storage.getItem(KEY)); } catch {}
  return {wins: count(saved?.wins), losses: count(saved?.losses),
    peak: Number.isFinite(saved?.peak) && saved.peak > 0 ? saved.peak : null,
    counted: Array.isArray(saved?.counted) ? saved.counted.filter(room => typeof room === 'string') : []};
}
const write = (storage, record) => storage.setItem(KEY, JSON.stringify(record));

export function recordResult(storage, room, won) {
  const record = readRecord(storage);
  if (record.counted.includes(room)) return;
  if (won) record.wins += 1; else record.losses += 1;
  record.counted = [...record.counted, room].slice(-COUNTED_LIMIT);
  write(storage, record);
}
// The highest Elo this browser has seen for the account.
export function recordElo(storage, elo) {
  const record = readRecord(storage);
  if (!Number.isFinite(elo) || elo <= 0 || record.peak !== null && elo <= record.peak) return;
  write(storage, {...record, peak: elo});
}
export function resetRecord(storage) {
  write(storage, {...readRecord(storage), wins: 0, losses: 0});
}
// After a rated battle the server adds one line per player to the room, as raw HTML:
// "NAME's rating: 1432 &rarr; <strong>1456</strong><br />(+24 for winning)" (server/ladders-remote.ts).
export function ratingChange(html) {
  const match = String(html || '').match(/^(.+)'s rating: (\d+) &rarr; <strong>(\d+)<\/strong>/);
  return match ? {name: match[1], before: Number(match[2]), after: Number(match[3])} : null;
}
