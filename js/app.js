import {
  PIECE_NAMES_CS,
  COLOR_NAMES_CS,
  getPieceCode,
  getPieceSvg,
} from './pieces.js';
import {
  Chess,
  FILES,
  RANKS,
  getCapturedSquare,
  getCastlingRookMove,
  evaluateGameState,
  formatMoveCs,
  formatHistoryMoveCs,
  explainInvalidMove,
} from './engine.js';
import { chooseComputerMove } from './ai.js';
import { MoveAnimator } from './animator.js';

const DOM = {
  brandIcon: document.getElementById('brand-icon'),
  btnNewGame: document.getElementById('btn-new-game'),

  panelBlack: document.getElementById('panel-black'),
  blackAvatar: document.getElementById('black-avatar'),
  blackName: document.getElementById('black-name'),
  blackTurnBadge: document.getElementById('black-turn-badge'),
  blackSelected: document.getElementById('black-selected'),
  blackActions: document.getElementById('black-actions'),
  btnHintBlack: document.getElementById('btn-hint-black'),
  btnConfirmBlack: document.getElementById('btn-confirm-black'),

  panelWhite: document.getElementById('panel-white'),
  whiteAvatar: document.getElementById('white-avatar'),
  whiteName: document.getElementById('white-name'),
  whiteTurnBadge: document.getElementById('white-turn-badge'),
  whiteSelected: document.getElementById('white-selected'),
  whiteActions: document.getElementById('white-actions'),
  btnHintWhite: document.getElementById('btn-hint-white'),
  btnConfirmWhite: document.getElementById('btn-confirm-white'),

  boardFrame: document.getElementById('board-frame'),
  coordsTop: document.getElementById('coords-top'),
  coordsRight: document.getElementById('coords-right'),
  boardGrid: document.getElementById('board-grid'),
  trailLayer: document.getElementById('trail-layer'),
  animationLayer: document.getElementById('animation-layer'),

  statusCard: document.getElementById('status-card'),
  statusTitle: document.getElementById('status-title'),
  statusMessage: document.getElementById('status-message'),
  previewBar: document.getElementById('preview-bar'),
  previewText: document.getElementById('preview-text'),
  btnCancelPreview: document.getElementById('btn-cancel-preview'),

  btnModeComputer: document.getElementById('btn-mode-computer'),
  btnModePvp: document.getElementById('btn-mode-pvp'),

  historyCount: document.getElementById('history-count'),
  historyEmpty: document.getElementById('history-empty'),
  historyList: document.getElementById('history-list'),

  promotionModal: document.getElementById('promotion-modal'),
  promotionDialog: document.getElementById('promotion-dialog'),
  promotionButtons: Array.from(document.querySelectorAll('#promotion-options .promo-choice')),
  btnPromoCancel: document.getElementById('btn-promo-cancel'),

  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
};

const state = {
  chess: new Chess(),
  mode: 'computer', // 'computer' | 'pvp'
  sessionId: 1,
  gameState: null,

  selectedSquare: null,
  pendingMove: null, // Verbose chess.js move object staged for confirmation
  hintVisible: false,
  hintMoves: [], // Verbose legal moves for selectedSquare when hintVisible

  lastMove: null,
  moveHistory: [],
  renderedHistoryCount: -1,

  invalidSquare: null,
  invalidTimer: null,

  isAnimating: false,
  animHiddenSquares: new Set(),

  isComputerThinking: false,
  computerTimer: null,

  promotionPending: null, // { moves: verboseMove[], color: 'w'|'b' }
  confirmCallback: null,

  customNotice: null, // { title?: string, message: string, tone?: 'normal'|'warning'|'danger'|'success' }
};

/** @type {Record<string, { el: HTMLButtonElement, pieceImg: HTMLImageElement, previewImg: HTMLImageElement, captureImg: HTMLImageElement }>} */
const squareRefs = Object.create(null);

const animator = new MoveAnimator(DOM.trailLayer, DOM.animationLayer);

function setTextIfChanged(el, text) {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setImgPieceIfChanged(img, pieceCode) {
  const target = pieceCode || '';
  if (img.dataset.piece !== target) {
    img.dataset.piece = target;
    if (target) {
      img.src = getPieceSvg(target);
    } else {
      img.removeAttribute('src');
    }
  }
}

function isHumanTurn(color = state.chess.turn()) {
  if (state.mode === 'pvp') return true;
  return color === 'w';
}

function isInteractionBlocked() {
  return (
    state.isAnimating ||
    state.isComputerThinking ||
    state.gameState.over ||
    state.promotionPending !== null
  );
}

function hasActiveProgress() {
  return state.moveHistory.length > 0 || state.pendingMove !== null;
}

function clearInvalidFlash() {
  if (state.invalidTimer !== null) {
    clearTimeout(state.invalidTimer);
    state.invalidTimer = null;
  }
  state.invalidSquare = null;
}

function flashInvalidSquare(sq, message) {
  clearInvalidFlash();
  state.invalidSquare = sq;
  state.customNotice = {
    message,
    tone: 'warning',
  };
  render();

  const sessionAtFlash = state.sessionId;
  state.invalidTimer = setTimeout(() => {
    if (sessionAtFlash !== state.sessionId) return;
    state.invalidSquare = null;
    state.invalidTimer = null;
    syncBoardSquares();
  }, 680);
}

function getPlayerDisplayName(color) {
  if (state.mode === 'computer') {
    return color === 'w' ? 'Ty' : 'Počítač';
  }
  return color === 'w' ? 'Hráč 1' : 'Hráč 2';
}

/**
 * Builds the 64 square DOM elements ONCE and stores direct references.
 * Never called again during gameplay to prevent flicker or reflow.
 */
function buildBoardOnce() {
  const frag = document.createDocumentFragment();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = `${FILES[c]}${RANKS[r]}`;
      const isDark = (r + c) % 2 === 1;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `square ${isDark ? 'square--dark' : 'square--light'}`;
      btn.dataset.square = sq;
      btn.setAttribute('aria-label', `Pole ${sq}`);

      const hintDot = document.createElement('span');
      hintDot.className = 'sq-hint-dot';
      hintDot.setAttribute('aria-hidden', 'true');

      const hintRing = document.createElement('span');
      hintRing.className = 'sq-hint-ring';
      hintRing.setAttribute('aria-hidden', 'true');

      const pieceImg = document.createElement('img');
      pieceImg.className = 'sq-piece';
      pieceImg.alt = '';
      pieceImg.draggable = false;
      pieceImg.dataset.piece = '';

      const previewImg = document.createElement('img');
      previewImg.className = 'sq-preview-piece';
      previewImg.alt = '';
      previewImg.draggable = false;
      previewImg.dataset.piece = '';

      const captureBadge = document.createElement('span');
      captureBadge.className = 'sq-capture-badge';
      captureBadge.setAttribute('aria-hidden', 'true');

      const captureImg = document.createElement('img');
      captureImg.className = 'sq-capture-img';
      captureImg.alt = '';
      captureImg.draggable = false;
      captureImg.dataset.piece = '';

      const captureCross = document.createElement('span');
      captureCross.className = 'sq-capture-cross';
      captureCross.setAttribute('aria-hidden', 'true');

      captureBadge.appendChild(captureImg);
      captureBadge.appendChild(captureCross);

      btn.appendChild(hintDot);
      btn.appendChild(hintRing);
      btn.appendChild(pieceImg);
      btn.appendChild(previewImg);
      btn.appendChild(captureBadge);

      squareRefs[sq] = {
        el: btn,
        pieceImg,
        previewImg,
        captureImg,
      };

      frag.appendChild(btn);
    }
  }

  DOM.boardGrid.appendChild(frag);
}

/**
 * Incrementally updates all 64 squares without recreating DOM nodes
 * or resetting unchanged image sources.
 */
function syncBoardSquares() {
  const board = state.chess.board();
  const isPvp = state.mode === 'pvp';
  const pending = state.pendingMove;
  const capturedPreviewSq = pending ? getCapturedSquare(pending) : null;
  const isBlackPreview = Boolean(pending && isPvp && pending.color === 'b');

  // Build fast lookup sets for hint destinations
  const hintQuietSet = new Set();
  const hintCaptureSet = new Set();
  if (state.hintVisible && state.selectedSquare && !state.isAnimating) {
    for (const move of state.hintMoves) {
      if (move.captured) {
        hintCaptureSet.add(move.to);
      } else {
        hintQuietSet.add(move.to);
      }
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = `${FILES[c]}${RANKS[r]}`;
      const ref = squareRefs[sq];
      const cell = board[r][c];
      const pieceCode = getPieceCode(cell);

      // Base piece image (only updates src when pieceCode actually changes)
      setImgPieceIfChanged(ref.pieceImg, pieceCode);
      ref.pieceImg.classList.toggle('piece-rotated', Boolean(isPvp && cell && cell.color === 'b'));

      // Highlight classes
      ref.el.classList.toggle('has-piece', Boolean(pieceCode));
      ref.el.classList.toggle('is-selected', state.selectedSquare === sq);
      ref.el.classList.toggle('is-last-from', Boolean(state.lastMove && state.lastMove.from === sq));
      ref.el.classList.toggle('is-last-to', Boolean(state.lastMove && state.lastMove.to === sq));
      ref.el.classList.toggle('is-check', state.gameState.checkedKingSquare === sq);
      ref.el.classList.toggle('is-invalid', state.invalidSquare === sq);
      ref.el.classList.toggle('is-anim-hidden', state.animHiddenSquares.has(sq));

      // Hints
      ref.el.classList.toggle('has-hint-move', hintQuietSet.has(sq));
      ref.el.classList.toggle('has-hint-capture', hintCaptureSet.has(sq));

      // Preview: origin dimmed, target shows translucent attacking (or promoted) piece
      const isPreviewOrigin = Boolean(pending && pending.from === sq);
      const isPreviewTarget = Boolean(pending && pending.to === sq);
      ref.el.classList.toggle('is-preview-origin', isPreviewOrigin);
      ref.el.classList.toggle('is-preview-target', isPreviewTarget);
      ref.el.classList.toggle('has-preview', isPreviewTarget);

      if (isPreviewTarget) {
        const previewType = pending.promotion || pending.piece;
        const previewCode = `${pending.color}${previewType.toUpperCase()}`;
        setImgPieceIfChanged(ref.previewImg, previewCode);
        ref.previewImg.classList.toggle('piece-rotated', isBlackPreview);
      } else {
        setImgPieceIfChanged(ref.previewImg, '');
        ref.previewImg.classList.remove('piece-rotated');
      }

      // Capture preview: hide original captured piece & show crossed-out corner badge
      const isCapturedSq = Boolean(pending && capturedPreviewSq === sq && pending.captured);
      ref.el.classList.toggle('is-capture-hidden', isCapturedSq);
      ref.el.classList.toggle('has-capture-badge', isCapturedSq);
      ref.el.classList.toggle('is-preview-for-black', isCapturedSq && isBlackPreview);

      if (isCapturedSq) {
        const capColor = pending.color === 'w' ? 'b' : 'w';
        const capCode = `${capColor}${pending.captured.toUpperCase()}`;
        setImgPieceIfChanged(ref.captureImg, capCode);
        ref.captureImg.classList.toggle('piece-rotated', Boolean(isPvp && capColor === 'b'));
      } else {
        setImgPieceIfChanged(ref.captureImg, '');
        ref.captureImg.classList.remove('piece-rotated');
      }
    }
  }
}

function syncOrientationChrome() {
  const isPvp = state.mode === 'pvp';
  DOM.boardFrame.classList.toggle('is-pvp', isPvp);
  DOM.coordsTop.hidden = !isPvp;
  DOM.coordsRight.hidden = !isPvp;
  DOM.panelBlack.classList.toggle('is-rotated', isPvp);
  DOM.blackActions.hidden = !isPvp;

  DOM.btnModeComputer.classList.toggle('is-selected', !isPvp);
  DOM.btnModeComputer.setAttribute('aria-pressed', String(!isPvp));
  DOM.btnModePvp.classList.toggle('is-selected', isPvp);
  DOM.btnModePvp.setAttribute('aria-pressed', String(isPvp));
}

function syncPlayerPanels() {
  const gs = state.gameState;
  const turn = gs.turn;
  const isPvp = state.mode === 'pvp';
  const busy = state.isAnimating || state.isComputerThinking;

  // Names
  setTextIfChanged(DOM.whiteName, getPlayerDisplayName('w'));
  setTextIfChanged(DOM.blackName, getPlayerDisplayName('b'));

  // Active border
  DOM.panelWhite.classList.toggle('is-active', !gs.over && turn === 'w');
  DOM.panelBlack.classList.toggle('is-active', !gs.over && turn === 'b');

  // Turn badges
  const whiteStatus = gs.over
    ? 'Konec hry'
    : turn === 'w'
      ? 'Na tahu'
      : 'Čeká na tah';
  const blackStatus = gs.over
    ? 'Konec hry'
    : turn === 'b'
      ? (state.isComputerThinking ? 'Přemýšlí…' : 'Na tahu')
      : 'Čeká na tah';

  setTextIfChanged(DOM.whiteTurnBadge, whiteStatus);
  DOM.whiteTurnBadge.classList.toggle('is-turn', !gs.over && turn === 'w');
  DOM.whiteTurnBadge.classList.toggle('is-over', gs.over);

  setTextIfChanged(DOM.blackTurnBadge, blackStatus);
  DOM.blackTurnBadge.classList.toggle('is-turn', !gs.over && turn === 'b');
  DOM.blackTurnBadge.classList.toggle('is-over', gs.over);

  // Selected piece Czech name on active player's panel
  const selectedPiece = state.selectedSquare ? state.chess.get(state.selectedSquare) : null;
  const selectedLabel = selectedPiece
    ? `${PIECE_NAMES_CS[selectedPiece.type]} (${state.selectedSquare})`
    : '';

  const showWhiteSelected = Boolean(selectedLabel && turn === 'w' && !gs.over);
  DOM.whiteSelected.hidden = !showWhiteSelected;
  if (showWhiteSelected) {
    setTextIfChanged(DOM.whiteSelected, selectedLabel);
  }

  const showBlackSelected = Boolean(selectedLabel && turn === 'b' && isPvp && !gs.over);
  DOM.blackSelected.hidden = !showBlackSelected;
  if (showBlackSelected) {
    setTextIfChanged(DOM.blackSelected, selectedLabel);
  }

  // White controls: enabled only when it's White's turn and not busy/over
  const whiteTurnActive = !gs.over && !busy && turn === 'w';
  DOM.btnHintWhite.disabled = !whiteTurnActive;
  DOM.btnHintWhite.classList.toggle('is-active', whiteTurnActive && state.hintVisible);
  DOM.btnConfirmWhite.disabled = !(whiteTurnActive && state.pendingMove !== null);

  // Black controls (PvP only): enabled only when it's Black's turn and not busy/over
  const blackTurnActive = isPvp && !gs.over && !busy && turn === 'b';
  DOM.btnHintBlack.disabled = !blackTurnActive;
  DOM.btnHintBlack.classList.toggle('is-active', blackTurnActive && state.hintVisible);
  DOM.btnConfirmBlack.disabled = !(blackTurnActive && state.pendingMove !== null);
}

function syncStatusCard() {
  const gs = state.gameState;
  const turnName = getPlayerDisplayName(gs.turn);
  const turnColorName = COLOR_NAMES_CS[gs.turn].toLowerCase();

  let title = '';
  let message = '';
  let tone = 'normal';

  if (gs.status === 'checkmate') {
    const winnerName = getPlayerDisplayName(gs.winner);
    const winnerColor = COLOR_NAMES_CS[gs.winner].toLowerCase();
    title =
      state.mode === 'computer' && gs.winner === 'w'
        ? `Šachmat! Vyhrál jsi (${winnerColor})`
        : `Šachmat! Vyhrává ${winnerName} (${winnerColor})`;
    message = 'Král je v šachu a nemá žádný únik. Můžeš začít novou hru.';
    tone = 'success';
  } else if (gs.status === 'stalemate') {
    title = 'Remíza – pat!';
    message = gs.drawReason;
    tone = 'warning';
  } else if (gs.status === 'draw') {
    title = 'Remíza';
    message = gs.drawReason;
    tone = 'warning';
  } else if (state.isComputerThinking) {
    title = 'Počítač přemýšlí…';
    message = 'Chvilku počkej, počítač vybírá svůj tah.';
    tone = 'normal';
  } else if (state.isAnimating) {
    title = 'Tah se provádí…';
    message = 'Sleduj přesun figurky po šachovnici.';
    tone = 'normal';
  } else {
    const turnPhrase =
      state.mode === 'computer' && gs.turn === 'w'
        ? `Jsi na tahu (${turnColorName})`
        : `Na tahu je ${turnName} (${turnColorName})`;
    title = gs.inCheck ? `Šach! ${turnPhrase}` : turnPhrase;
    tone = gs.inCheck ? 'danger' : 'normal';

    if (state.customNotice) {
      if (state.customNotice.title) title = state.customNotice.title;
      message = state.customNotice.message;
      if (state.customNotice.tone) tone = state.customNotice.tone;
    } else if (state.pendingMove) {
      message = 'Náhled tahu je připravený. Stiskni „Potvrdit tah“ nebo vyber jiné pole.';
      if (!gs.inCheck) tone = 'success';
    } else if (state.selectedSquare) {
      const piece = state.chess.get(state.selectedSquare);
      const pName = piece ? PIECE_NAMES_CS[piece.type] : 'Figurka';
      message = `Vybraná figurka: ${pName} na ${state.selectedSquare}. Klepni na cílové políčko.`;
    } else if (gs.inCheck) {
      message = 'Král je v šachu! Vyber tah, který krále ochrání.';
    } else {
      message = 'Klepni na svou figurku a pak na cílové políčko.';
    }
  }

  setTextIfChanged(DOM.statusTitle, title);
  setTextIfChanged(DOM.statusMessage, message);

  DOM.statusCard.classList.toggle('is-warning', tone === 'warning');
  DOM.statusCard.classList.toggle('is-danger', tone === 'danger');
  DOM.statusCard.classList.toggle('is-success', tone === 'success');

  // Compact preview strip: hidden (takes zero space) unless a move is staged
  const showPreviewBar = Boolean(state.pendingMove && !state.isAnimating && !gs.over);
  DOM.previewBar.hidden = !showPreviewBar;
  if (showPreviewBar) {
    setTextIfChanged(DOM.previewText, `Náhled: ${formatMoveCs(state.pendingMove)}`);
  }
}

function syncHistory() {
  const count = state.moveHistory.length;
  if (state.renderedHistoryCount === count) return;
  state.renderedHistoryCount = count;

  setTextIfChanged(DOM.historyCount, String(count));
  DOM.historyEmpty.hidden = count > 0;
  DOM.historyList.hidden = count === 0;

  DOM.historyList.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 2) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const num = document.createElement('span');
    num.className = 'history-num';
    num.textContent = `${Math.floor(i / 2) + 1}.`;

    const whiteCell = document.createElement('span');
    whiteCell.className = 'history-cell';
    whiteCell.textContent = formatHistoryMoveCs(state.moveHistory[i]);

    const blackCell = document.createElement('span');
    blackCell.className = 'history-cell';
    blackCell.textContent = state.moveHistory[i + 1]
      ? formatHistoryMoveCs(state.moveHistory[i + 1])
      : '';

    li.appendChild(num);
    li.appendChild(whiteCell);
    li.appendChild(blackCell);
    frag.appendChild(li);
  }
  DOM.historyList.appendChild(frag);
}

function render() {
  state.gameState = evaluateGameState(state.chess);
  syncOrientationChrome();
  syncBoardSquares();
  syncPlayerPanels();
  syncStatusCard();
  syncHistory();
}

/* ==================== Interaction Handlers ==================== */

function handleSquareClick(sq) {
  if (isInteractionBlocked()) return;
  if (!isHumanTurn()) return;

  clearInvalidFlash();
  state.customNotice = null;

  const turn = state.chess.turn();
  const tappedPiece = state.chess.get(sq);

  // Case 1: Tapped an own piece
  if (tappedPiece && tappedPiece.color === turn) {
    if (state.selectedSquare === sq) {
      // Deselect piece & clear preview/hint
      state.selectedSquare = null;
      state.pendingMove = null;
      state.hintVisible = false;
      state.hintMoves = [];
    } else {
      state.selectedSquare = sq;
      state.pendingMove = null;
      state.hintVisible = false;
      state.hintMoves = [];
    }
    render();
    return;
  }

  // Case 2: No piece selected yet
  if (!state.selectedSquare) {
    state.customNotice = {
      message: tappedPiece
        ? 'To je figurka soupeře. Vyber prosím svou figurku.'
        : 'Nejprve klepni na svou figurku.',
      tone: 'warning',
    };
    render();
    return;
  }

  // Case 3: Own piece is selected, tapped target square
  const legalFromSelected = state.chess.moves({
    square: state.selectedSquare,
    verbose: true,
  });
  const matchingMoves = legalFromSelected.filter((m) => m.to === sq);

  if (matchingMoves.length === 0) {
    const explanation = explainInvalidMove(state.chess, state.selectedSquare, sq);
    flashInvalidSquare(sq, explanation);
    return;
  }

  if (matchingMoves.length > 1) {
    // Pawn promotion: ask player to pick Queen / Rook / Bishop / Knight before staging preview
    openPromotionModal(matchingMoves, turn);
    return;
  }

  // Legal single move -> stage preview (do NOT mutate chess state yet!)
  state.pendingMove = matchingMoves[0];
  state.hintVisible = false;
  state.hintMoves = [];
  render();
}

function handleToggleHint(playerColor) {
  if (isInteractionBlocked()) return;
  if (state.chess.turn() !== playerColor || !isHumanTurn(playerColor)) return;

  clearInvalidFlash();
  state.customNotice = null;

  if (!state.selectedSquare) {
    state.customNotice = {
      message: 'Nejprve klepni na svou figurku, pro kterou chceš ukázat nápovědu.',
      tone: 'warning',
    };
    render();
    return;
  }

  if (state.hintVisible) {
    state.hintVisible = false;
    state.hintMoves = [];
    render();
    return;
  }

  const moves = state.chess.moves({ square: state.selectedSquare, verbose: true });
  if (moves.length === 0) {
    const piece = state.chess.get(state.selectedSquare);
    const pName = piece ? PIECE_NAMES_CS[piece.type] : 'Figurka';
    state.hintVisible = false;
    state.hintMoves = [];
    state.customNotice = {
      message: state.chess.inCheck()
        ? `${pName} na ${state.selectedSquare} teď nemůže zachránit krále ze šachu. Vyber jinou figurku.`
        : `${pName} na ${state.selectedSquare} teď nemá žádný povolený tah. Vyber jinou figurku.`,
      tone: 'warning',
    };
    render();
    return;
  }

  state.hintVisible = true;
  state.hintMoves = moves;
  render();
}

function handleCancelPreview() {
  if (isInteractionBlocked()) return;
  state.pendingMove = null;
  state.customNotice = {
    message: 'Tah byl zrušen. Můžeš vybrat jiné políčko nebo jinou figurku.',
    tone: 'normal',
  };
  render();
}

async function handleConfirmMove(playerColor) {
  if (isInteractionBlocked()) return;
  if (state.chess.turn() !== playerColor || !isHumanTurn(playerColor)) return;
  if (!state.pendingMove) return;

  const moveToExecute = state.pendingMove;
  await executeMoveWithAnimation(moveToExecute);
}

/**
 * Executes a validated verbose move with smooth animation, golden trail,
 * castling/en-passant/capture/promotion effects, and safe cancellation.
 */
async function executeMoveWithAnimation(move) {
  const mySession = state.sessionId;

  clearInvalidFlash();
  state.customNotice = null;
  state.selectedSquare = null;
  state.pendingMove = null;
  state.hintVisible = false;
  state.hintMoves = [];
  state.isAnimating = true;

  // Hide stationary base pieces that are being animated in the overlay
  state.animHiddenSquares.clear();
  state.animHiddenSquares.add(move.from);
  const rookMove = getCastlingRookMove(move);
  if (rookMove) {
    state.animHiddenSquares.add(rookMove.from);
  }
  const capSq = getCapturedSquare(move);
  if (capSq) {
    state.animHiddenSquares.add(capSq);
  }

  render();

  const completed = await animator.animateMove(move, { mode: state.mode });
  if (!completed || mySession !== state.sessionId) {
    return;
  }

  // Apply the move to chess.js ONLY after confirmation & animation completion
  const applied = state.chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });

  state.animHiddenSquares.clear();
  state.isAnimating = false;

  if (applied) {
    state.lastMove = applied;
    state.moveHistory.push(applied);
  }

  render();

  // Trigger computer turn if applicable
  if (!state.gameState.over && state.mode === 'computer' && state.chess.turn() === 'b') {
    scheduleComputerTurn();
  }
}

function scheduleComputerTurn() {
  if (state.computerTimer !== null) {
    clearTimeout(state.computerTimer);
    state.computerTimer = null;
  }

  const mySession = state.sessionId;
  state.isComputerThinking = true;
  render();

  // Brief natural pause so kids can see their own move before computer responds
  const delayMs = 480 + Math.floor(Math.random() * 240);
  state.computerTimer = setTimeout(async () => {
    state.computerTimer = null;
    if (mySession !== state.sessionId) return;

    const chosen = chooseComputerMove(state.chess);
    state.isComputerThinking = false;

    if (!chosen || mySession !== state.sessionId) {
      render();
      return;
    }

    await executeMoveWithAnimation(chosen);
  }, delayMs);
}

/* ==================== Modals ==================== */

function openPromotionModal(moves, color) {
  state.promotionPending = { moves, color };
  DOM.promotionDialog.classList.toggle('is-rotated', state.mode === 'pvp' && color === 'b');

  for (const btn of DOM.promotionButtons) {
    const promoType = btn.dataset.promo;
    const img = btn.querySelector('img');
    if (img) {
      img.src = getPieceSvg(`${color}${promoType.toUpperCase()}`);
    }
  }

  DOM.promotionModal.hidden = false;
}

function closePromotionModal() {
  state.promotionPending = null;
  DOM.promotionModal.hidden = true;
  DOM.promotionDialog.classList.remove('is-rotated');
}

function handlePromotionChoice(promoType) {
  if (!state.promotionPending) return;
  const chosen = state.promotionPending.moves.find((m) => m.promotion === promoType);
  closePromotionModal();
  if (!chosen) return;

  state.pendingMove = chosen;
  state.hintVisible = false;
  state.hintMoves = [];
  state.customNotice = null;
  render();
}

function openConfirmModal({ title, message, okLabel, onConfirm }) {
  setTextIfChanged(DOM.confirmTitle, title);
  setTextIfChanged(DOM.confirmMessage, message);
  setTextIfChanged(DOM.btnConfirmOk, okLabel);
  state.confirmCallback = onConfirm;
  DOM.confirmModal.hidden = false;
}

function closeConfirmModal() {
  state.confirmCallback = null;
  DOM.confirmModal.hidden = true;
}

/* ==================== Reset & Mode Switching ==================== */

function resetGame(nextMode = state.mode) {
  // Bump session token first so any pending timers/animations abort cleanly
  state.sessionId += 1;

  if (state.computerTimer !== null) {
    clearTimeout(state.computerTimer);
    state.computerTimer = null;
  }
  clearInvalidFlash();
  animator.cancel();
  closePromotionModal();
  closeConfirmModal();

  state.mode = nextMode;
  state.chess = new Chess();
  state.selectedSquare = null;
  state.pendingMove = null;
  state.hintVisible = false;
  state.hintMoves = [];
  state.lastMove = null;
  state.moveHistory = [];
  state.renderedHistoryCount = -1;
  state.isAnimating = false;
  state.animHiddenSquares.clear();
  state.isComputerThinking = false;
  state.customNotice = null;

  render();
}

function requestNewGame() {
  if (!hasActiveProgress() && !state.isComputerThinking && !state.isAnimating) {
    resetGame(state.mode);
    return;
  }
  openConfirmModal({
    title: 'Začít novou hru?',
    message: 'Rozehraná partie nebo připravený tah se zahodí a figurky se vrátí na začátek.',
    okLabel: 'Ano, nová hra',
    onConfirm: () => resetGame(state.mode),
  });
}

function requestModeChange(targetMode) {
  if (targetMode === state.mode) return;

  if (!hasActiveProgress() && !state.isComputerThinking && !state.isAnimating) {
    resetGame(targetMode);
    return;
  }

  const label = targetMode === 'pvp' ? 'Ve dvou' : 'S počítačem';
  openConfirmModal({
    title: `Přepnout na režim „${label}“?`,
    message: 'Aktuální rozehraná partie se zahodí a začne nová hra.',
    okLabel: 'Přepnout',
    onConfirm: () => resetGame(targetMode),
  });
}

/* ==================== Bootstrap ==================== */

function init() {
  // Set static SVG icons (no emoji/text symbols)
  DOM.brandIcon.src = getPieceSvg('wN');
  DOM.whiteAvatar.src = getPieceSvg('wK');
  DOM.blackAvatar.src = getPieceSvg('bK');

  buildBoardOnce();

  // Delegated click listener on the persistent board grid
  DOM.boardGrid.addEventListener('click', (event) => {
    const sqBtn = event.target.closest('.square');
    if (!sqBtn || !sqBtn.dataset.square) return;
    handleSquareClick(sqBtn.dataset.square);
  });

  // White panel buttons
  DOM.btnHintWhite.addEventListener('click', () => handleToggleHint('w'));
  DOM.btnConfirmWhite.addEventListener('click', () => handleConfirmMove('w'));

  // Black panel buttons (PvP)
  DOM.btnHintBlack.addEventListener('click', () => handleToggleHint('b'));
  DOM.btnConfirmBlack.addEventListener('click', () => handleConfirmMove('b'));

  // Preview cancel
  DOM.btnCancelPreview.addEventListener('click', handleCancelPreview);

  // Header & Mode buttons
  DOM.btnNewGame.addEventListener('click', requestNewGame);
  DOM.btnModeComputer.addEventListener('click', () => requestModeChange('computer'));
  DOM.btnModePvp.addEventListener('click', () => requestModeChange('pvp'));

  // Promotion modal
  for (const btn of DOM.promotionButtons) {
    btn.addEventListener('click', () => handlePromotionChoice(btn.dataset.promo));
  }
  DOM.btnPromoCancel.addEventListener('click', closePromotionModal);

  // Confirm modal
  DOM.btnConfirmCancel.addEventListener('click', closeConfirmModal);
  DOM.btnConfirmOk.addEventListener('click', () => {
    const cb = state.confirmCallback;
    closeConfirmModal();
    if (cb) cb();
  });

  // Close modals on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!DOM.promotionModal.hidden) closePromotionModal();
      if (!DOM.confirmModal.hidden) closeConfirmModal();
    }
  });

  render();
}

init();
