// Ranked: rating (MMR), tiers and divisions, Elo-style updates
import { clamp } from '../util.js';

export const TIERS = [
  { name: 'IRON', min: 0, color: '#8a8f96' },
  { name: 'BRONZE', min: 800, color: '#c07a45' },
  { name: 'SILVER', min: 950, color: '#c9d2dc' },
  { name: 'GOLD', min: 1100, color: '#f2b53d' },
  { name: 'PLATINUM', min: 1250, color: '#5fe0c9' },
  { name: 'DIAMOND', min: 1400, color: '#7ab8ff' },
  { name: 'VANTA ELITE', min: 1550, color: '#ff5a7a' },
];
export const START_MMR = 1000;
export const PLACEMENT_MATCHES = 5;

export function tierOf(mmr) {
  let i = 0; while (i + 1 < TIERS.length && mmr >= TIERS[i + 1].min) i++;
  const t = TIERS[i], next = TIERS[i + 1];
  if (!next) return { ...t, idx: i, div: '', label: t.name, progress: clamp((mmr - t.min) / 300, 0, 1), toNext: null };
  const span = next.min - t.min, step = span / 3, d = clamp(Math.floor((mmr - t.min) / step), 0, 2);
  const lo = t.min + d * step;
  return { ...t, idx: i, div: ['III', 'II', 'I'][d], label: `${t.name} ${['III', 'II', 'I'][d]}`, progress: clamp((mmr - lo) / step, 0, 1), toNext: Math.ceil(lo + step - mmr) };
}

export function mpDefaults() {
  return { mmr: START_MMR, best: START_MMR, matches: 0, wins: 0, kills: 0, deaths: 0, name: '', history: [] };
}

// score: 1 = win, 0 = loss, 0.5 = draw (deathmatch uses placement scaled to 0..1)
export function rateMatch(mp, oppAvg, score, perf = 0) {
  const expect = 1 / (1 + Math.pow(10, (oppAvg - mp.mmr) / 400));
  const K = mp.matches < PLACEMENT_MATCHES ? 48 : 28;
  let delta = Math.round(K * (score - expect) + clamp(perf, -6, 6));
  if (score >= 0.5 && delta < 3) delta = 3;            // a win never costs rating
  if (score < 0.5 && delta > -2) delta = -2;
  return delta;
}

// how strong AI fill-ins should be for a lobby with this average rating
export const botSkillFor = (mmr) => clamp(0.35 + (mmr - 800) / 1000, 0.3, 0.95);

const ADJ = ['Silent', 'Iron', 'Rapid', 'Ghost', 'Night', 'Steel', 'Red', 'Cold', 'Vector', 'Echo', 'Storm', 'Ash', 'Nova', 'Hollow', 'Grim', 'Lucky'];
const NOUN = ['Viper', 'Falcon', 'Rook', 'Warden', 'Jackal', 'Lancer', 'Mantis', 'Raven', 'Saber', 'Hound', 'Comet', 'Wolf', 'Reaper', 'Kite', 'Bishop', 'Cobra'];
export function randomCallsign(rng = Math.random) { return ADJ[(rng() * ADJ.length) | 0] + NOUN[(rng() * NOUN.length) | 0] + (rng() < 0.5 ? '' : String((rng() * 90 + 10) | 0)); }
export function cleanName(s) { return String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16); }
