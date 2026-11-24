import { getPieceSvg } from './pieces.js';
import { getCapturedSquare, getCastlingRookMove } from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function squareToGrid(sq) {
  return {
    col: sq.charCodeAt(0) - 97,
    row: 8 - parseInt(sq[1], 10),
  };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Computes waypoints (in grid col/row units) for a moving piece.
 * Knights use a 2-segment "L"-shaped path (2 squares along longer axis, then 1 perpendicular).
 */
function buildWaypoints(fromSq, toSq, pieceType) {
  const start = squareToGrid(fromSq);
  const end = squareToGrid(toSq);

  if (pieceType === 'n') {
    const dc = end.col - start.col;
    const dr = end.row - start.row;
    const corner = Math.abs(dr) > Math.abs(dc)
      ? { col: start.col, row: end.row }
      : { col: end.col, row: start.row };
    return [start, corner, end];
  }

  return [start, end];
}

/**
 * Computes total path length in square units.
 */
function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].col - points[i - 1].col, points[i].row - points[i - 1].row);
  }
  return len;
}

/**
 * Samples a polyline at progress u in [0, 1].
 */
function samplePath(points, u) {
  if (points.length === 2) {
    return {
      col: points[0].col + (points[1].col - points[0].col) * u,
      row: points[0].row + (points[1].row - points[0].row) * u,
    };
  }
  const segLengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].col - points[i - 1].col, points[i].row - points[i - 1].row);
    segLengths.push(d);
    total += d;
  }
  let target = u * total;
  for (let i = 0; i < segLengths.length; i++) {
    if (target <= segLengths[i] || i === segLengths.length - 1) {
      const localU = segLengths[i] > 0 ? Math.min(1, Math.max(0, target / segLengths[i])) : 1;
      return {
        col: points[i].col + (points[i + 1].col - points[i].col) * localU,
        row: points[i].row + (points[i + 1].row - points[i].row) * localU,
      };
    }
    target -= segLengths[i];
  }
  return points[points.length - 1];
}

/**
 * Computes duration in ms: 420–650 ms based on move distance, or 130–160 ms if reduced motion.
 */
export function computeAnimationDuration(move, reduced = prefersReducedMotion()) {
  const pts = buildWaypoints(move.from, move.to, move.piece);
  const dist = pathLength(pts);
  if (reduced) {
    return Math.round(130 + Math.min(dist / 7, 1) * 30);
  }
  // 1 square -> ~435 ms, 3 squares (knight) -> ~505 ms, 7+ squares -> ~645 ms
  const normalized = Math.min(Math.max((dist - 1) / 6.5, 0), 1);
  return Math.round(420 + normalized * 230);
}

/**
 * Creates a golden SVG trail polyline/path inside the 800x800 trail overlay.
 */
function createTrailElements(trailSvg, points) {
  const coords = points.map((p) => `${(p.col + 0.5) * 100},${(p.row + 0.5) * 100}`).join(' ');

  const glow = document.createElementNS(SVG_NS, 'polyline');
  glow.setAttribute('points', coords);
  glow.setAttribute('class', 'move-trail-glow');

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', coords);
  line.setAttribute('class', 'move-trail-line');

  const startDot = document.createElementNS(SVG_NS, 'circle');
  startDot.setAttribute('cx', String((points[0].col + 0.5) * 100));
  startDot.setAttribute('cy', String((points[0].row + 0.5) * 100));
  startDot.setAttribute('r', '10');
  startDot.setAttribute('class', 'move-trail-dot');

  trailSvg.appendChild(glow);
  trailSvg.appendChild(line);
  trailSvg.appendChild(startDot);

  // Measure path length for progressive stroke-dashoffset reveal
  let totalSvgLen = 0;
  for (let i = 1; i < points.length; i++) {
    totalSvgLen += Math.hypot(
      (points[i].col - points[i - 1].col) * 100,
      (points[i].row - points[i - 1].row) * 100
    );
  }
  glow.style.strokeDasharray = `${totalSvgLen}`;
  glow.style.strokeDashoffset = `${totalSvgLen}`;
  line.style.strokeDasharray = `${totalSvgLen}`;
  line.style.strokeDashoffset = `${totalSvgLen}`;

  return { glow, line, startDot, totalSvgLen };
}

function createFloatingPiece(pieceCode, isRotated, extraClass = '') {
  const wrap = document.createElement('div');
  wrap.className = `anim-piece${extraClass ? ' ' + extraClass : ''}`;
  const img = document.createElement('img');
  img.src = getPieceSvg(pieceCode);
  img.alt = '';
  img.draggable = false;
  if (isRotated) {
    img.classList.add('piece-rotated');
  }
  wrap.appendChild(img);
  return { wrap, img };
}

export class MoveAnimator {
  constructor(trailSvg, animLayer) {
    this.trailSvg = trailSvg;
    this.animLayer = animLayer;
    this._rafId = null;
    this._activeResolve = null;
    this._cancelled = false;
  }

  /**
   * Immediately stops any running animation and clears overlay layers.
   */
  cancel() {
    this._cancelled = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._clearLayers();
    if (this._activeResolve) {
      const resolve = this._activeResolve;
      this._activeResolve = null;
      resolve(false);
    }
  }

  _clearLayers() {
    if (this.trailSvg) {
      this.trailSvg.replaceChildren();
    }
    if (this.animLayer) {
      this.animLayer.replaceChildren();
    }
  }

  /**
   * Animates a chess.js verbose move.
   * @param {object} move Verbose chess.js move object
   * @param {{ mode: 'computer' | 'pvp' }} options
   * @returns {Promise<boolean>} Resolves true if completed, false if cancelled
   */
  animateMove(move, { mode }) {
    this.cancel();
    this._cancelled = false;

    const reduced = prefersReducedMotion();
    const duration = computeAnimationDuration(move, reduced);
    const isMovingRotated = mode === 'pvp' && move.color === 'b';

    const mainPoints = buildWaypoints(move.from, move.to, move.piece);
    const mainCode = `${move.color}${move.piece.toUpperCase()}`;
    const mainTrail = createTrailElements(this.trailSvg, mainPoints);
    const mainPiece = createFloatingPiece(mainCode, isMovingRotated);
    this.animLayer.appendChild(mainPiece.wrap);

    // Optional castling rook animation
    const rookMove = getCastlingRookMove(move);
    let rookData = null;
    if (rookMove) {
      const rookPoints = buildWaypoints(rookMove.from, rookMove.to, 'r');
      const rookCode = `${move.color}R`;
      const rookTrail = createTrailElements(this.trailSvg, rookPoints);
      const rookPiece = createFloatingPiece(rookCode, isMovingRotated);
      this.animLayer.appendChild(rookPiece.wrap);
      rookData = { points: rookPoints, trail: rookTrail, piece: rookPiece };
    }

    // Optional captured piece shrink-and-fade at the end of the move (including en passant)
    const capturedSq = getCapturedSquare(move);
    let capturedData = null;
    if (capturedSq && move.captured) {
      const capColor = move.color === 'w' ? 'b' : 'w';
      const capCode = `${capColor}${move.captured.toUpperCase()}`;
      const capRotated = mode === 'pvp' && capColor === 'b';
      const capPos = squareToGrid(capturedSq);
      const capPiece = createFloatingPiece(capCode, capRotated, 'anim-captured');
      capPiece.wrap.style.transform = `translate3d(${capPos.col * 100}%, ${capPos.row * 100}%, 0)`;
      // Insert captured piece below the moving piece
      this.animLayer.insertBefore(capPiece.wrap, mainPiece.wrap);
      capturedData = { piece: capPiece };
    }

    const setPos = (wrap, pos, scale = 1) => {
      wrap.style.transform =
        scale === 1
          ? `translate3d(${pos.col * 100}%, ${pos.row * 100}%, 0)`
          : `translate3d(${pos.col * 100}%, ${pos.row * 100}%, 0) scale(${scale})`;
    };

    // Set initial positions before first frame
    setPos(mainPiece.wrap, mainPoints[0]);
    if (rookData) {
      setPos(rookData.piece.wrap, rookData.points[0]);
    }

    const promoCode = move.promotion ? `${move.color}${move.promotion.toUpperCase()}` : null;
    let promotedSwapped = false;

    return new Promise((resolve) => {
      this._activeResolve = resolve;
      const startTime = performance.now();

      const step = (now) => {
        if (this._cancelled) return;

        const rawT = Math.min(1, (now - startTime) / duration);
        const eased = easeInOutCubic(rawT);

        // Move primary piece
        const pos = samplePath(mainPoints, eased);
        // Subtle lift in middle of movement (unless reduced motion)
        const lift = reduced ? 1 : 1 + Math.sin(rawT * Math.PI) * 0.08;
        setPos(mainPiece.wrap, pos, lift);

        // Reveal golden trail along path
        const mainOffset = mainTrail.totalSvgLen * (1 - eased);
        mainTrail.glow.style.strokeDashoffset = `${mainOffset}`;
        mainTrail.line.style.strokeDashoffset = `${mainOffset}`;

        // Fade trail gently at the very end
        if (rawT > 0.78) {
          const fade = Math.max(0, 1 - (rawT - 0.78) / 0.22);
          mainTrail.glow.style.opacity = String(fade * 0.55);
          mainTrail.line.style.opacity = String(fade);
          mainTrail.startDot.style.opacity = String(fade);
        }

        // Castling rook simultaneous motion
        if (rookData) {
          const rPos = samplePath(rookData.points, eased);
          setPos(rookData.piece.wrap, rPos, 1);
          const rOffset = rookData.trail.totalSvgLen * (1 - eased);
          rookData.trail.glow.style.strokeDashoffset = `${rOffset}`;
          rookData.trail.line.style.strokeDashoffset = `${rOffset}`;
          if (rawT > 0.78) {
            const fade = Math.max(0, 1 - (rawT - 0.78) / 0.22);
            rookData.trail.glow.style.opacity = String(fade * 0.55);
            rookData.trail.line.style.opacity = String(fade);
            rookData.trail.startDot.style.opacity = String(fade);
          }
        }

        // Captured piece shrinks and fades in the final 35% of the move
        if (capturedData && rawT >= 0.62) {
          const capT = Math.min(1, (rawT - 0.62) / 0.38);
          capturedData.piece.img.style.opacity = String(1 - capT);
          const scale = 1 - capT * 0.6;
          capturedData.piece.img.style.transform =
            `${capturedData.piece.img.classList.contains('piece-rotated') ? 'rotate(180deg) ' : ''}scale(${scale})`;
        }

        // Pawn promotion visual swap right at arrival
        if (promoCode && !promotedSwapped && rawT >= 0.88) {
          promotedSwapped = true;
          mainPiece.img.src = getPieceSvg(promoCode);
        }

        if (rawT < 1) {
          this._rafId = requestAnimationFrame(step);
        } else {
          this._rafId = null;
          this._clearLayers();
          this._activeResolve = null;
          resolve(true);
        }
      };

      this._rafId = requestAnimationFrame(step);
    });
  }
}
