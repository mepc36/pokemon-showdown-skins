export const toID = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const isBattleRoom = value => /^battle-gen9randombattle-[a-z0-9-]+$/.test(value || '');

export function parsePacket(packet) {
  const lines = String(packet).split('\n');
  const room = lines[0]?.startsWith('>') ? lines.shift().slice(1) : '';
  return {room, lines: lines.filter(Boolean)};
}

export function splitLine(line) {
  const index = line.indexOf('|', 1);
  return index < 0 ? [line.slice(1), ''] : [line.slice(1, index), line.slice(index + 1)];
}

export function availableChoices(request) {
  if (!request || request.wait || request.teamPreview) return {moves: [], switches: [], tera: false};
  const active = request.active?.[0];
  const team = request.side?.pokemon || [];
  const reviving = team.some(p => p.reviving);
  return {
    moves: request.forceSwitch ? [] : (active?.moves || []).map((move, i) => ({
      ...move, index: i + 1, enabled: !move.disabled,
    })),
    switches: team.map((pokemon, i) => ({
      ...pokemon, index: i + 1,
      enabled: !active?.trapped && (reviving ? /fnt/.test(pokemon.condition) : !pokemon.active && !/fnt/.test(pokemon.condition)),
    })),
    tera: !request.forceSwitch && !!active?.canTerastallize,
  };
}

export function choiceCommand(request, kind, index, tera = false) {
  const choices = availableChoices(request);
  const allowed = kind === 'move' ? choices.moves : kind === 'switch' ? choices.switches : [];
  if (!Number.isInteger(index) || !allowed.some(c => c.index === index && c.enabled)) {
    throw new Error('That choice is no longer available.');
  }
  if (tera && (kind !== 'move' || !choices.tera)) throw new Error('Terastallizing is unavailable.');
  if (!Number.isSafeInteger(request.rqid)) throw new Error('Waiting for a fresh server request.');
  return `/choose ${kind} ${index}${tera ? ' terastallize' : ''}|${request.rqid}`;
}

// Feed only simulator events to the renderer. Never render room chat or server HTML.
const rendererEvents = new Set(('player teamsize gametype gen tier rated rule clearpoke poke teampreview start turn switch drag replace swap detailschange move cant faint win tie upkeep done seed t:').split(' '));
export const isBattleEvent = line => {
  const [type] = splitLine(line);
  return rendererEvents.has(type) || /^-[a-zA-Z]/.test(type);
};
