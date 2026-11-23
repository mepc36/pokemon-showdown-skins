// Wins, losses and peak Elo, kept in local storage under one key.
// `counted` remembers the battle rooms already counted, so a battle whose result line arrives again
// (a reconnect replays the room's log) is not counted twice. Reset clears the wins and losses only.
// `recent` holds the last 10 results, oldest first ('W' or 'L'); Reset keeps it. `since` is the time (ms) the
// wins and losses started counting from: the last Reset, or the first result on a record that had none. It is
// null for a record saved before `since` existed, until the next Reset.
const KEY = 'ps-mve-record';
const COUNTED_LIMIT = 200;
const RECENT_LIMIT = 10;
const count = value => Number.isInteger(value) && value >= 0 ? value : 0;

export function readRecord(storage) {
  let saved = null;
  try { saved = JSON.parse(storage.getItem(KEY)); } catch {}
  return {wins: count(saved?.wins), losses: count(saved?.losses),
    peak: Number.isFinite(saved?.peak) && saved.peak > 0 ? saved.peak : null,
    counted: Array.isArray(saved?.counted) ? saved.counted.filter(room => typeof room === 'string') : [],
    recent: Array.isArray(saved?.recent) ? saved.recent.filter(result => result === 'W' || result === 'L').slice(-RECENT_LIMIT) : [],
    since: Number.isFinite(saved?.since) && saved.since > 0 ? saved.since : null};
}
const write = (storage, record) => storage.setItem(KEY, JSON.stringify(record));

export function recordResult(storage, room, won, now = Date.now()) {
  const record = readRecord(storage);
  if (record.counted.includes(room)) return;
  if (record.since === null && record.wins + record.losses === 0) record.since = now;
  if (won) record.wins += 1; else record.losses += 1;
  record.recent = [...record.recent, won ? 'W' : 'L'].slice(-RECENT_LIMIT);
  record.counted = [...record.counted, room].slice(-COUNTED_LIMIT);
  write(storage, record);
}
// The highest Elo this browser has seen for the account.
export function recordElo(storage, elo) {
  const record = readRecord(storage);
  if (!Number.isFinite(elo) || elo <= 0 || record.peak !== null && elo <= record.peak) return;
  write(storage, {...record, peak: elo});
}
export function resetRecord(storage, now = Date.now()) {
  write(storage, {...readRecord(storage), wins: 0, losses: 0, since: now});
}
// "Since 10:15 AM on 11/26": the heading over the wins and losses, from the stored time, in the device's time zone.
export function sinceLabel(since) {
  if (since === null) return 'Since last reset';
  const date = new Date(since), hours = date.getHours();
  return `Since ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'} on ${date.getMonth() + 1}/${date.getDate()}`;
}
// After a rated battle the server adds one line per player to the room, as raw HTML:
// "NAME's rating: 1432 &rarr; <strong>1456</strong><br />(+24 for winning)" (server/ladders-remote.ts).
export function ratingChange(html) {
  const match = String(html || '').match(/^(.+)'s rating: (\d+) &rarr; <strong>(\d+)<\/strong>/);
  return match ? {name: match[1], before: Number(match[2]), after: Number(match[3])} : null;
}
