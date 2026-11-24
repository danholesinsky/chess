import assert from 'node:assert/strict';
import {
  Chess,
  evaluateGameState,
  getCapturedSquare,
  getCastlingRookMove,
  explainInvalidMove,
  formatMoveCs,
} from '../js/engine.js';
import { chooseComputerMove } from '../js/ai.js';
import { computeAnimationDuration } from '../js/animator.js';
import { PIECE_SVGS, PIECE_NAMES_CS } from '../js/pieces.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('Regression FEN 1: checkmate with bishop on b2', () => {
  const chess = new Chess('8/5Q2/2P5/2PP1k1p/1R3ppP/8/PB1P4/5K2 b - - 0 1');
  const gs = evaluateGameState(chess);
  assert.equal(gs.inCheck, true);
  assert.equal(chess.moves().length, 0);
  assert.equal(gs.over, true);
  assert.equal(gs.status, 'checkmate');
  assert.equal(gs.winner, 'w');
  assert.equal(gs.checkedKingSquare, 'f5');
});

test('Regression FEN 2: NOT checkmate without bishop on b2 (Ke5 is legal)', () => {
  const chess = new Chess('8/5Q2/2P5/2PP1k1p/1R3ppP/8/P2P4/5K2 b - - 0 1');
  const gs = evaluateGameState(chess);
  assert.equal(gs.inCheck, true);
  assert.equal(gs.over, false);
  assert.equal(gs.status, 'check');
  assert.equal(gs.winner, null);
  const moves = chess.moves();
  assert.ok(moves.includes('Ke5'), `Expected Ke5 in legal moves, got: ${moves.join(', ')}`);
});

test('Stalemate is strictly stalemate (draw), NEVER checkmate', () => {
  const chess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const gs = evaluateGameState(chess);
  assert.equal(gs.over, true);
  assert.equal(gs.inCheck, false);
  assert.equal(gs.status, 'stalemate');
  assert.notEqual(gs.status, 'checkmate');
  assert.equal(gs.winner, null);
});

test('Insufficient material detected as draw', () => {
  const chess = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  const gs = evaluateGameState(chess);
  assert.equal(gs.over, true);
  assert.equal(gs.status, 'draw');
  assert.equal(gs.winner, null);
});

test('En passant captured square points to actual captured pawn square', () => {
  const chess = new Chess('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  const epMove = chess.moves({ square: 'e5', verbose: true }).find((m) => m.to === 'd6');
  assert.ok(epMove, 'En passant move e5xd6 should be legal');
  assert.equal(getCapturedSquare(epMove), 'd5');
  assert.match(formatMoveCs(epMove), /mimochodem/);
});

test('Castling rook moves resolved for both kingside and queenside', () => {
  const chess = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const moves = chess.moves({ square: 'e1', verbose: true });
  const oo = moves.find((m) => m.to === 'g1');
  const ooo = moves.find((m) => m.to === 'c1');
  assert.deepEqual(getCastlingRookMove(oo), { from: 'h1', to: 'f1', side: 'k' });
  assert.deepEqual(getCastlingRookMove(ooo), { from: 'a1', to: 'd1', side: 'q' });
});

test('Pawn promotion offers all 4 standard pieces (q, r, b, n)', () => {
  const chess = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promos = chess.moves({ square: 'a7', verbose: true }).filter((m) => m.to === 'a8');
  const types = promos.map((m) => m.promotion).sort();
  assert.deepEqual(types, ['b', 'n', 'q', 'r']);
});

test('Invalid move explanations handle check, pin, and illegal geometry', () => {
  // King in check
  const checkChess = new Chess('4k3/8/8/8/8/8/4r3/4K2R w - - 0 1');
  const msgCheck = explainInvalidMove(checkChess, 'h1', 'h2');
  assert.match(msgCheck, /šachu/i);

  // Pinned rook on e2 blocking black rook on e8 from white king on e1
  const pinChess = new Chess('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1');
  const msgPin = explainInvalidMove(pinChess, 'e2', 'd2');
  assert.match(msgPin, /šachu/i);

  // Normal illegal geometry
  const startChess = new Chess();
  const msgGeom = explainInvalidMove(startChess, 'e2', 'e5');
  assert.match(msgGeom, /nemůže/i);
});

test('Kid-friendly AI picks legal moves with randomness and mild capture preference', () => {
  // Position where Black has a capture (d5xe4) and many quiet moves
  const chess = new Chess('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
  let captures = 0;
  let quiet = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const move = chooseComputerMove(chess, () => (i + 0.5) / N);
    assert.ok(move);
    if (move.captured) captures += 1;
    else quiet += 1;
  }
  assert.ok(captures > 0, 'AI should sometimes capture');
  assert.ok(quiet > 0, 'AI should also play non-captures (high randomness)');
  assert.ok(captures / N < 0.5, 'AI should not deterministically always capture');
});

test('Animation duration stays within 420-650 ms (normal) and 130-160 ms (reduced)', () => {
  const shortMove = { from: 'e2', to: 'e3', piece: 'p' };
  const knightMove = { from: 'g1', to: 'f3', piece: 'n' };
  const longMove = { from: 'a1', to: 'h8', piece: 'q' };

  for (const m of [shortMove, knightMove, longMove]) {
    const dNormal = computeAnimationDuration(m, false);
    const dReduced = computeAnimationDuration(m, true);
    assert.ok(dNormal >= 420 && dNormal <= 650, `Normal duration ${dNormal} out of range`);
    assert.ok(dReduced >= 130 && dReduced <= 160, `Reduced duration ${dReduced} out of range`);
  }
});

test('All 12 chess pieces have valid SVG data URIs and Czech names', () => {
  const expectedCodes = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
  for (const code of expectedCodes) {
    assert.ok(PIECE_SVGS[code]?.startsWith('data:image/svg+xml;charset=utf-8,'), `Missing SVG for ${code}`);
  }
  for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
    assert.ok(typeof PIECE_NAMES_CS[t] === 'string' && PIECE_NAMES_CS[t].length > 0);
  }
});

console.log(`\nAll ${passed} tests passed!`);
