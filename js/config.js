// Game data: weapons, upgrades, enemies, missions
export const GAME_TITLE = 'VANTA PROTOCOL';
export const SAVE_KEY = 'vanta_protocol_save_v1';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P-9 VIPER', cls: 'SIDEARM', slot: 1, dmg: 30, rpm: 400, auto: false, mag: 14, reserve: Infinity, reload: 1.25, hip: 0.011, ads: 0.0015, kick: [1.5, 0.5], adsFov: 0.82, range: [20, 50], head: 2.2, sound: 'shot_pistol', cost: 0, move: 1.0, shake: 0.5, desc: 'Reliable sidearm with unlimited reserve ammo.' },
  rifle: { id: 'rifle', name: 'HARRIER MK2', cls: 'ASSAULT RIFLE', slot: 2, dmg: 27, rpm: 640, auto: true, mag: 30, reserve: 210, reload: 1.95, hip: 0.019, ads: 0.0022, kick: [0.95, 0.42], adsFov: 0.66, range: [32, 75], head: 2.0, sound: 'shot_ar', cost: 0, move: 0.94, shake: 0.6, desc: 'Balanced automatic rifle. Standard issue.' },
  smg: { id: 'smg', name: 'KESTREL-45', cls: 'SUBMACHINE GUN', slot: 3, dmg: 18, rpm: 920, auto: true, mag: 36, reserve: 252, reload: 1.65, hip: 0.024, ads: 0.007, kick: [0.62, 0.5], adsFov: 0.78, range: [14, 34], head: 1.8, sound: 'shot_smg', cost: 900, move: 1.0, shake: 0.4, desc: 'Blistering fire rate. Dominates close quarters.' },
  shotgun: { id: 'shotgun', name: 'BREAKER-12', cls: 'SHOTGUN', slot: 4, dmg: 14, pellets: 10, rpm: 82, auto: false, mag: 7, reserve: 42, reload: 0.48, shellReload: true, hip: 0.062, ads: 0.048, kick: [5.5, 1.3], adsFov: 0.84, range: [9, 24], head: 1.5, sound: 'shot_shotgun', cost: 1500, move: 0.95, shake: 1.6, desc: 'Ten pellets of pump-action persuasion.' },
  marksman: { id: 'marksman', name: 'LONGBOW DMR', cls: 'MARKSMAN RIFLE', slot: 5, dmg: 110, rpm: 150, auto: false, mag: 8, reserve: 48, reload: 2.35, hip: 0.04, ads: 0.0, kick: [4.2, 0.7], adsFov: 0.24, scope: true, range: [90, 200], head: 2.6, sound: 'shot_sniper', cost: 2400, move: 0.88, shake: 1.5, pierce: 1, desc: 'Scoped precision. Punches through weak points.' },
  launcher: { id: 'launcher', name: 'THUMPER GL', cls: 'GRENADE LAUNCHER', slot: 6, dmg: 170, rpm: 75, auto: false, mag: 6, reserve: 18, reload: 2.9, hip: 0.01, ads: 0.004, kick: [4.5, 0.8], adsFov: 0.8, range: [100, 100], head: 1, sound: 'shot_launcher', cost: 3400, move: 0.9, shake: 1.2, projectile: 'grenade', radius: 5.5, desc: 'Six-shot rotary launcher. Clears rooms and shields.' },
  rail: { id: 'rail', name: 'ARC LANCE', cls: 'RAILGUN', slot: 7, dmg: 300, rpm: 55, auto: false, mag: 4, reserve: 16, reload: 2.6, hip: 0.004, ads: 0.0, kick: [6.5, 0.6], adsFov: 0.55, range: [200, 300], head: 2.0, sound: 'shot_rail', cost: 5200, move: 0.85, shake: 2.2, charge: 0.55, pierce: 99, energy: true, desc: 'Charged hyper-velocity slug. Pierces everything in line.' },
};
export const WEAPON_ORDER = ['pistol', 'rifle', 'smg', 'shotgun', 'marksman', 'launcher', 'rail'];

export const WEAPON_UPGRADES = [
  { id: 'dmg', name: 'DAMAGE', per: 0.12, desc: '+12% damage per level' },
  { id: 'mag', name: 'CAPACITY', per: 0.2, desc: '+20% magazine & reserve per level' },
  { id: 'handling', name: 'HANDLING', per: 0.1, desc: '-10% reload time & recoil per level' },
];
export const upgradeCost = (weapon, lvl) => Math.round((300 + WEAPONS[weapon].cost * 0.22) * (1 + lvl * 0.9));

export const PERKS = [
  { id: 'vitality', name: 'VITALITY', max: 4, base: 500, desc: '+20 max health per level' },
  { id: 'shield', name: 'AEGIS CELL', max: 4, base: 500, desc: '+20 max shield, faster recharge' },
  { id: 'grenadier', name: 'GRENADIER', max: 3, base: 600, desc: '+1 frag grenade capacity' },
  { id: 'focus', name: 'NEURAL FOCUS', max: 3, base: 700, desc: '+25% Focus duration, faster charge' },
  { id: 'scavenger', name: 'SCAVENGER', max: 3, base: 450, desc: '+20% ammo & credits from drops' },
];
export const perkCost = (p, lvl) => Math.round(p.base * (1 + lvl * 0.85));

export const DIFFICULTY = {
  recruit: { name: 'RECRUIT', hp: 0.8, dmg: 0.6, credits: 0.8, desc: 'Enemies are weaker.' },
  veteran: { name: 'VETERAN', hp: 1.0, dmg: 1.0, credits: 1.0, desc: 'The intended experience.' },
  elite: { name: 'ELITE', hp: 1.35, dmg: 1.5, credits: 1.4, desc: 'Lethal. +40% credits.' },
};

export const ENEMIES = {
  drone: { name: 'WASP', hp: 55, speed: 7, score: 100, credits: 14, cost: 1, radius: 0.55 },
  trooper: { name: 'SENTINEL', hp: 125, speed: 3.3, score: 150, credits: 20, cost: 2, radius: 0.5 },
  crawler: { name: 'SKITTER', hp: 55, speed: 7.2, score: 120, credits: 14, cost: 1.5, radius: 0.55 },
  lancer: { name: 'LANCER', hp: 95, speed: 2.9, score: 250, credits: 34, cost: 3, radius: 0.5 },
  heavy: { name: 'BULWARK', hp: 700, shield: 220, speed: 1.9, score: 800, credits: 110, cost: 9, radius: 1.0 },
  boss: { name: 'COLOSSUS', hp: 11000, speed: 2.2, score: 10000, credits: 1500, cost: 99, radius: 4.2 },
};

// Missions. phases run in order. wave entries: [type, count]
export const MISSIONS = [
  {
    id: 'm1', name: 'COLD START', sub: 'Perimeter Yard — 18:42', theme: 'yard', sky: 'golden', seed: 3, reward: 600, par: 9000,
    brief: 'Kestrel Station has gone dark. Its autonomous security grid is executing an unknown directive: VANTA. Breach the perimeter yard and clear out the first responders.',
    phases: [
      { type: 'eliminate', text: 'Eliminate hostile machines', waves: [[['drone', 4]], [['trooper', 3], ['drone', 3]], [['trooper', 5], ['drone', 4]]] },
    ],
  },
  {
    id: 'm2', name: 'SIGNAL LOSS', sub: 'Logistics Yard — 20:10', theme: 'yard', sky: 'dusk', seed: 11, reward: 800, par: 14000,
    brief: 'Three uplink terminals still hold fragments of the station log. Hold position at each terminal while the data transfers. Expect resistance — fast, and low to the ground.',
    phases: [
      { type: 'uplink', text: 'Upload data at the terminals', count: 3, time: 22, pressure: [['trooper', 2], ['crawler', 3], ['drone', 2]] },
      { type: 'eliminate', text: 'Clear the counter-attack', waves: [[['crawler', 6], ['trooper', 4], ['drone', 4]]] },
    ],
  },
  {
    id: 'm3', name: 'DEADWEIGHT', sub: 'Refinery Block — 23:55', theme: 'refinery', sky: 'storm', seed: 5, reward: 1000, par: 17000,
    brief: 'The storm is cover. Four power cores feed the grid that keeps VANTA awake. Destroy them. Watch the long sightlines — Lancers have been sighted.',
    phases: [
      { type: 'destroy', text: 'Destroy the power cores', count: 4, pressure: [['trooper', 3], ['lancer', 1], ['drone', 3], ['crawler', 2]] },
      { type: 'eliminate', text: 'Eliminate the response force', waves: [[['lancer', 2], ['trooper', 5], ['crawler', 5]], [['heavy', 1], ['drone', 5], ['trooper', 3]]] },
    ],
  },
  {
    id: 'm4', name: 'BLACK ICE', sub: 'Coolant Fields — 05:20', theme: 'refinery', sky: 'dawn', seed: 23, reward: 1200, par: 20000,
    brief: 'Extraction is inbound but the fog is thick and so are they. Hold out until the dropship arrives, then get to the beacon. Bulwark heavy units are confirmed.',
    phases: [
      { type: 'survive', text: 'Survive until extraction', time: 150, pressure: [['trooper', 4], ['crawler', 4], ['drone', 4], ['lancer', 1], ['heavy', 1]] },
      { type: 'extract', text: 'Reach the extraction beacon' },
    ],
  },
  {
    id: 'm5', name: 'FURNACE', sub: 'Foundry Core — 19:03', theme: 'foundry', sky: 'ember', seed: 31, reward: 1500, par: 26000,
    brief: 'The foundry is printing reinforcements faster than we can scrap them. Kill the two fabricator cores, then upload the kill-code. Every unit type is in play.',
    phases: [
      { type: 'destroy', text: 'Destroy the fabricator cores', count: 2, pressure: [['trooper', 4], ['heavy', 1], ['drone', 4], ['crawler', 3], ['lancer', 1]] },
      { type: 'uplink', text: 'Upload the kill-code', count: 2, time: 28, pressure: [['trooper', 4], ['crawler', 5], ['lancer', 2], ['drone', 3]] },
      { type: 'eliminate', text: 'Eliminate the elite guard', waves: [[['heavy', 2], ['lancer', 2], ['trooper', 4], ['drone', 4]]] },
    ],
  },
  {
    id: 'm6', name: 'PROTOCOL ZERO', sub: 'The Crucible — Totality', theme: 'core', sky: 'eclipse', seed: 41, size: 48, reward: 3000, par: 30000,
    brief: 'VANTA has a body. COLOSSUS — a siege walker built to end sieges. Its armour is impenetrable, but its heat cores are not. Bring it down. End the protocol.',
    phases: [
      { type: 'boss', text: 'Destroy COLOSSUS' },
    ],
  },
];

export const ONSLAUGHT = { id: 'onslaught', name: 'ONSLAUGHT', sub: 'Endless Survival', themes: ['yard', 'refinery', 'foundry'], skies: ['golden', 'dusk', 'storm', 'dawn', 'ember', 'eclipse'] };

export const RANKS = ['RECRUIT', 'OPERATIVE', 'SPECIALIST', 'VANGUARD', 'SENTINEL-BREAKER', 'SPECTRE', 'WARDEN', 'PROTOCOL ZERO'];
export const rankFor = (xp) => { let lvl = 1, need = 1500; while (xp >= need) { xp -= need; lvl++; need = Math.round(need * 1.18); } return { lvl, xp, need, name: RANKS[Math.min(RANKS.length - 1, ((lvl - 1) / 4) | 0)] }; };
