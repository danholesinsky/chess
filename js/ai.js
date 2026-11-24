// Kid-friendly simple chess opponent:
// Selects from legal moves with high randomness and a mild preference for captures.

const CAPTURE_VALUE_BONUS = {
  p: 0.25,
  n: 0.45,
  b: 0.45,
  r: 0.65,
  q: 0.9,
  k: 0,
};

/**
 * Picks a legal move for the computer opponent.
 * @param {import('../vendor/chess.js').Chess} chess
 * @param {() => number} [rng=Math.random]
 * @returns {object|null} Verbose chess.js move object or null if no legal moves
 */
export function chooseComputerMove(chess, rng = Math.random) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;

  // Assign gentle weights so captures are somewhat favored while keeping lots of variety
  let totalWeight = 0;
  const weighted = moves.map((move) => {
    let weight = 1.0;

    if (move.captured) {
      weight += 1.5 + (CAPTURE_VALUE_BONUS[move.captured] || 0);
    }
    if (move.promotion) {
      // Slightly prefer promoting to queen when promoting
      weight += move.promotion === 'q' ? 1.4 : 0.3;
    }
    if (move.san && move.san.includes('+')) {
      weight += 0.35;
    }

    totalWeight += weight;
    return { move, weight };
  });

  let roll = rng() * totalWeight;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.move;
    }
  }

  return weighted[weighted.length - 1].move;
}
