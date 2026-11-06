const toID = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FORMAT = 'gen9randombattle';
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value));

export function parseRating(data, username) {
  if (!data || toID(data.userid || data.username) !== toID(username) || !data.ratings ||
      typeof data.ratings !== 'object' || Array.isArray(data.ratings)) throw new Error('Unexpected rating response');
  const row = data.ratings[FORMAT];
  if (row === undefined) return null;
  if (!row || !numeric(row.elo) || Number(row.elo) < 0) throw new Error('Invalid Elo');
  const count = value => numeric(value) && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  return {elo: Number(row.elo), gxe: numeric(row.gxe) && Number(row.gxe) >= 0 && Number(row.gxe) <= 100 ? Number(row.gxe) : null,
    wins: count(row.w), losses: count(row.l)};
}

export class PlayerRating {
  constructor(username, {fetcher = (...args) => fetch(...args), now = () => Date.now()} = {}) {
    this.username = username; this.fetcher = fetcher; this.now = now;
    this.url = `https://pokemonshowdown.com/users/${toID(username)}.json`;
    this.status = 'idle'; this.value = null; this.checkedAt = 0; this.pending = null;
  }
  load(force = false) {
    if (this.pending) return this.pending;
    if (!force && ['ready', 'unrated'].includes(this.status) && this.now() - this.checkedAt < 60000) return Promise.resolve();
    this.status = 'loading';
    this.pending = Promise.resolve().then(async () => {
      try {
        const response = await this.fetcher(this.url, {credentials: 'omit', mode: 'cors', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('Rating lookup failed');
        this.value = parseRating(await response.json(), this.username);
        this.checkedAt = this.now();
        this.status = this.value ? 'ready' : 'unrated';
      } catch { this.status = 'error'; }
      finally { this.pending = null; }
    });
    return this.pending;
  }
  get label() { return this.status === 'ready' ? `Rating · ${Math.round(this.value.elo)}` : 'Rating'; }
}
