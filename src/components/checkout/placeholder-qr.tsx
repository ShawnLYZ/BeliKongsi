const SIZE = 25;
const FINDER = 7;

/** A small deterministic bit pattern from the payment id, so each checkout looks a little different. */
function bits(seed: string): (x: number, y: number) => boolean {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (x, y) => {
    let v = (h ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
    return (v & 7) < 3;
  };
}

const inFinder = (x: number, y: number) =>
  (x < FINDER + 1 && y < FINDER + 1) ||
  (x >= SIZE - FINDER - 1 && y < FINDER + 1) ||
  (x < FINDER + 1 && y >= SIZE - FINDER - 1);

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={7} height={7} fill="currentColor" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="currentColor" />
    </g>
  );
}

/**
 * A generic placeholder in the shape of a QR code, drawn as SVG. It encodes nothing and cannot be
 * scanned: the DuitNow QR payment here is simulated.
 */
export function PlaceholderQr({ seed }: { seed: string }) {
  const on = bits(seed);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inFinder(x, y) && on(x, y)) cells.push({ x, y });
    }
  }
  return (
    <svg
      role="img"
      aria-label="Placeholder QR code (Simulated). It cannot be scanned."
      viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`}
      className="size-56 rounded-xl border bg-white p-2 text-[#10243f]"
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={SIZE + 4} height={SIZE + 4} fill="#fff" />
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
      <Finder x={0} y={0} />
      <Finder x={SIZE - FINDER} y={0} />
      <Finder x={0} y={SIZE - FINDER} />
    </svg>
  );
}
