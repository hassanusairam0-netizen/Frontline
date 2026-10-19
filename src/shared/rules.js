// Match rules, rewards and progression maths. The server uses these to grant
// online rewards so the client can never decide its own payout.

export const MATCH = {
  roundsToWin: 4,
  roundTime: 90,
  preRound: 4,
  roundEnd: 3.5,
  countdown: 5,
};

export const REWARDS = {
  completion: 120,
  win: 220,
  roundWon: 45,
  elimination: 25,
  headshot: 10,
  flawlessRound: 60,
  accuracyBonusAt: 0.45,
  accuracyBonus: 50,
  practiceScale: { easy: 0.6, normal: 1, hard: 1.35, online: 1.25 },
  maxPerMatch: 1600,
};

/**
 * stats: { won, roundsWon, roundsLost, kills, headshots, shots, hits, flawless, firstBlood }
 * mode: 'easy' | 'normal' | 'hard' | 'online'
 */
export function computeRewards(stats, mode) {
  const lines = [];
  const add = (label, amount) => { if (amount > 0) lines.push({ label, amount }); };
  add('Match completed', REWARDS.completion);
  if (stats.won) add('Victory', REWARDS.win);
  add(`Rounds won ×${stats.roundsWon}`, stats.roundsWon * REWARDS.roundWon);
  add(`Eliminations ×${stats.kills}`, stats.kills * REWARDS.elimination);
  add(`Headshots ×${stats.headshots}`, stats.headshots * REWARDS.headshot);
  if (stats.flawless) add(`Flawless rounds ×${stats.flawless}`, stats.flawless * REWARDS.flawlessRound);
  const acc = stats.shots ? stats.hits / stats.shots : 0;
  if (stats.shots >= 10 && acc >= REWARDS.accuracyBonusAt) add('Marksman (45%+ accuracy)', REWARDS.accuracyBonus);
  const scale = REWARDS.practiceScale[mode] ?? 1;
  let subtotal = lines.reduce((s, l) => s + l.amount, 0);
  let total = Math.min(REWARDS.maxPerMatch, Math.round(subtotal * scale));
  const xp = Math.round(100 + stats.kills * 30 + stats.roundsWon * 40 + (stats.won ? 150 : 0));
  return { lines, scale, subtotal, total, xp };
}

// Level curve: XP needed to go from level n to n+1.
export const xpForLevel = (n) => 400 + (n - 1) * 250;

export function levelFromXp(xp) {
  let level = 1, rest = xp;
  while (rest >= xpForLevel(level) && level < 50) { rest -= xpForLevel(level); level++; }
  return { level, into: rest, need: xpForLevel(level) };
}

// Daily challenges. Three are rolled per day from this pool (deterministic by date).
export const CHALLENGE_POOL = [
  { id: 'win2', text: 'Win 2 matches', stat: 'wins', goal: 2, reward: 300 },
  { id: 'elim10', text: 'Get 10 eliminations', stat: 'kills', goal: 10, reward: 250 },
  { id: 'head6', text: 'Land 6 headshot eliminations', stat: 'headshots', goal: 6, reward: 300 },
  { id: 'ability5', text: 'Use your ability 5 times', stat: 'abilities', goal: 5, reward: 200 },
  { id: 'rounds8', text: 'Win 8 rounds', stat: 'roundsWon', goal: 8, reward: 250 },
  { id: 'side3', text: 'Get 3 eliminations with a sidearm', stat: 'sidearmKills', goal: 3, reward: 275 },
  { id: 'matches3', text: 'Complete 3 matches', stat: 'matches', goal: 3, reward: 200 },
  { id: 'flawless1', text: 'Win a round without taking damage', stat: 'flawless', goal: 1, reward: 250 },
  { id: 'hard1', text: 'Win a match against a HARD bot or online', stat: 'hardWins', goal: 1, reward: 400 },
];

export function dailyChallengesFor(dateKey) {
  let h = 2166136261;
  for (const ch of dateKey) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const pool = CHALLENGE_POOL.slice();
  const out = [];
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

export const todayKey = () => new Date().toISOString().slice(0, 10);

// Gameplay objectives (one-time achievements) that pay out credits.
export const OBJECTIVES = [
  { id: 'firstWin', text: 'Win your first match', reward: 250, test: (m, p) => m.won },
  { id: 'firstHard', text: 'Defeat a HARD opponent', reward: 500, test: (m) => m.won && (m.mode === 'hard' || m.mode === 'online') },
  { id: 'clean', text: 'Win a match without losing a round', reward: 400, test: (m) => m.won && m.roundsLost === 0 },
  { id: 'sharp', text: 'Finish a match with 60%+ accuracy (min. 15 shots)', reward: 300, test: (m) => m.shots >= 15 && m.hits / m.shots >= 0.6 },
  { id: 'veteran', text: 'Complete 10 matches', reward: 600, test: (m, p) => p.stats.matches >= 10 },
  { id: 'collector', text: 'Own three operators', reward: 350, test: (m, p) => p.owned.operators.length >= 3 },
];
