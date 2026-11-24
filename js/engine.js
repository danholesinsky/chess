import { Chess } from '../vendor/chess.js';
import { PIECE_NAMES_CS, PIECE_NAMES_ACC_CS } from './pieces.js';

export { Chess };

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

/**
 * Returns the square of the captured piece (handles en passant correctly).
 * @param {object} move Verbose chess.js move
 * @returns {string|null}
 */
export function getCapturedSquare(move) {
  if (!move || !move.captured) return null;
  if (move.flags && move.flags.includes('e')) {
    // En passant: captured pawn sits on destination file and origin rank
    return `${move.to[0]}${move.from[1]}`;
  }
  return move.to;
}

/**
 * Returns rook movement info if the move is castling, otherwise null.
 * @param {object} move Verbose chess.js move
 * @returns {{ from: string, to: string, side: 'k' | 'q' } | null}
 */
export function getCastlingRookMove(move) {
  if (!move || !move.flags) return null;
  const rank = move.color === 'w' ? '1' : '8';
  if (move.flags.includes('k')) {
    return { from: `h${rank}`, to: `f${rank}`, side: 'k' };
  }
  if (move.flags.includes('q')) {
    return { from: `a${rank}`, to: `d${rank}`, side: 'q' };
  }
  return null;
}

/**
 * Finds the square of the king of the given color ('w' or 'b').
 * @param {Chess} chess
 * @param {'w'|'b'} color
 * @returns {string|null}
 */
export function findKingSquare(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (cell && cell.type === 'k' && cell.color === color) {
        return cell.square;
      }
    }
  }
  return null;
}

/**
 * Evaluates full game state with strict checkmate vs stalemate separation.
 * Checkmate is ONLY declared when the king is in check AND there are 0 legal moves.
 * @param {Chess} chess
 * @returns {{
 *   over: boolean,
 *   status: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw',
 *   winner: 'w' | 'b' | null,
 *   turn: 'w' | 'b',
 *   inCheck: boolean,
 *   checkedKingSquare: string | null,
 *   drawReason: string | null
 * }}
 */
export function evaluateGameState(chess) {
  const turn = chess.turn();
  const inCheck = chess.inCheck();
  const legalMoves = chess.moves();
  const checkedKingSquare = inCheck ? findKingSquare(chess, turn) : null;

  if (inCheck && legalMoves.length === 0 && chess.isCheckmate()) {
    return {
      over: true,
      status: 'checkmate',
      winner: turn === 'w' ? 'b' : 'w',
      turn,
      inCheck: true,
      checkedKingSquare,
      drawReason: null,
    };
  }

  if (!inCheck && legalMoves.length === 0 && chess.isStalemate()) {
    return {
      over: true,
      status: 'stalemate',
      winner: null,
      turn,
      inCheck: false,
      checkedKingSquare: null,
      drawReason: 'Pat – hráč na tahu nemá žádný legální tah a král není v šachu.',
    };
  }

  if (chess.isInsufficientMaterial()) {
    return {
      over: true,
      status: 'draw',
      winner: null,
      turn,
      inCheck: false,
      checkedKingSquare: null,
      drawReason: 'Remíza – na šachovnici už není dostatek figurek pro mat.',
    };
  }

  if (chess.isThreefoldRepetition()) {
    return {
      over: true,
      status: 'draw',
      winner: null,
      turn,
      inCheck: false,
      checkedKingSquare: null,
      drawReason: 'Remíza – stejná pozice se zopakovala třikrát.',
    };
  }

  if (chess.isDrawByFiftyMoves && chess.isDrawByFiftyMoves()) {
    return {
      over: true,
      status: 'draw',
      winner: null,
      turn,
      inCheck: false,
      checkedKingSquare: null,
      drawReason: 'Remíza – pravidlo 50 tahů bez braní a tahu pěšcem.',
    };
  }

  if (chess.isDraw()) {
    return {
      over: true,
      status: 'draw',
      winner: null,
      turn,
      inCheck: false,
      checkedKingSquare: null,
      drawReason: 'Remíza.',
    };
  }

  return {
    over: false,
    status: inCheck ? 'check' : 'playing',
    winner: null,
    turn,
    inCheck,
    checkedKingSquare,
    drawReason: null,
  };
}

/**
 * Formats a verbose move into kid-friendly Czech description.
 * @param {object} move
 * @returns {string}
 */
export function formatMoveCs(move) {
  if (!move) return '';
  const pieceName = PIECE_NAMES_CS[move.piece] || 'Figurka';

  if (move.flags && move.flags.includes('k')) {
    return `Malá rošáda (${move.from} → ${move.to})`;
  }
  if (move.flags && move.flags.includes('q')) {
    return `Velká rošáda (${move.from} → ${move.to})`;
  }

  let text = '';
  if (move.captured) {
    const capAcc = PIECE_NAMES_ACC_CS[move.captured] || 'figurku';
    if (move.flags && move.flags.includes('e')) {
      text = `${pieceName} ${move.from} × ${move.to} (bere ${capAcc} mimochodem)`;
    } else {
      text = `${pieceName} ${move.from} × ${move.to} (bere ${capAcc})`;
    }
  } else {
    text = `${pieceName} ${move.from} → ${move.to}`;
  }

  if (move.promotion) {
    const promoName = PIECE_NAMES_CS[move.promotion] || 'Dáma';
    text += ` → ${promoName}`;
  }

  return text;
}

/**
 * Formats a compact move label for move history list.
 * @param {object} move
 * @returns {string}
 */
export function formatHistoryMoveCs(move) {
  if (!move) return '';
  if (move.flags && move.flags.includes('k')) return '0-0 (malá rošáda)';
  if (move.flags && move.flags.includes('q')) return '0-0-0 (velká rošáda)';
  const pieceName = PIECE_NAMES_CS[move.piece] || '';
  const sep = move.captured ? ' × ' : ' → ';
  let suffix = '';
  if (move.promotion) {
    suffix += ` = ${PIECE_NAMES_CS[move.promotion]}`;
  }
  if (move.san && move.san.endsWith('#')) {
    suffix += ' #';
  } else if (move.san && move.san.endsWith('+')) {
    suffix += ' +';
  }
  return `${pieceName} ${move.from}${sep}${move.to}${suffix}`;
}

/**
 * Checks whether a piece on fromSquare could geometrically reach toSquare
 * (ignoring king-safety), used to give clearer Czech error feedback for pins / check.
 */
function isPseudoGeometricReach(chess, piece, from, to) {
  const fFile = from.charCodeAt(0) - 97;
  const fRank = parseInt(from[1], 10);
  const tFile = to.charCodeAt(0) - 97;
  const tRank = parseInt(to[1], 10);
  const df = tFile - fFile;
  const dr = tRank - fRank;
  const adf = Math.abs(df);
  const adr = Math.abs(dr);
  const targetPiece = chess.get(to);

  if (targetPiece && targetPiece.color === piece.color) return false;

  switch (piece.type) {
    case 'n':
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case 'k':
      return adf <= 1 && adr <= 1 && (adf > 0 || adr > 0);
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const startRank = piece.color === 'w' ? 2 : 7;
      if (df === 0 && !targetPiece) {
        if (dr === dir) return true;
        if (fRank === startRank && dr === 2 * dir) {
          const midSq = `${from[0]}${fRank + dir}`;
          return !chess.get(midSq);
        }
      }
      if (adf === 1 && dr === dir && targetPiece && targetPiece.color !== piece.color) {
        return true;
      }
      return false;
    }
    case 'r':
    case 'b':
    case 'q': {
      const straight = df === 0 || dr === 0;
      const diag = adf === adr;
      if (piece.type === 'r' && !straight) return false;
      if (piece.type === 'b' && !diag) return false;
      if (piece.type === 'q' && !straight && !diag) return false;
      const stepF = Math.sign(df);
      const stepR = Math.sign(dr);
      let cf = fFile + stepF;
      let cr = fRank + stepR;
      while (cf !== tFile || cr !== tRank) {
        const sq = `${String.fromCharCode(97 + cf)}${cr}`;
        if (chess.get(sq)) return false;
        cf += stepF;
        cr += stepR;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Returns a friendly Czech explanation for why a tapped move is invalid.
 * @param {Chess} chess
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function explainInvalidMove(chess, from, to) {
  const piece = chess.get(from);
  if (!piece) {
    return 'Nejprve vyber svou figurku.';
  }

  const pieceName = PIECE_NAMES_CS[piece.type] || 'Figurka';

  if (chess.inCheck()) {
    return `Král je v šachu! Tah ${pieceName.toLowerCase()} na ${to} šach neodstraní.`;
  }

  if (isPseudoGeometricReach(chess, piece, from, to)) {
    return `Na pole ${to} teď nemůžeš – tvůj král by zůstal v šachu.`;
  }

  return `${pieceName} z ${from} na ${to} nemůže. Zkus tlačítko Nápověda.`;
}
