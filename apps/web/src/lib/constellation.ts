// Pure layout for the lineage constellation. No DOM or Vue so it can be unit tested in Node.
//
// Rows are cohorts, columns are "slots". Every subtree is packed against its left neighbours
// row by row (a contour, Reingold-Tilford style pass), so a family only consumes width in the
// rows it actually occupies. A mentor sits centred above its students.

export type LayoutInput = {
  id: string;
  mentorId: string | null;
  /** Index of the cohort row, 0 = top. */
  row: number;
  /** Stable tie-breaker for sibling order. */
  order: string;
};

export type LayoutResult = {
  /** Slot (column) per visible id, normalised so the left-most star sits at 0. */
  slots: Map<string, number>;
  span: number;
  /** Generation depth per id (0 for roots) within the laid out forest. */
  depth: Map<string, number>;
  /** Total descendants per id in the unfiltered input (used for "+N" fold badges). */
  descendants: Map<string, number>;
  children: Map<string, string[]>;
};

type Contour = Map<number, [number, number]>;

export const SIBLING_GAP = 1;
const COUSIN_GAP = 1.2;
const ROOT_GAP = 1.6;

function shiftContour(contour: Contour, by: number): Contour {
  const next: Contour = new Map();
  contour.forEach(([min, max], row) => next.set(row, [min + by, max + by]));
  return next;
}

function mergeInto(target: Contour, source: Contour) {
  source.forEach(([min, max], row) => {
    const current = target.get(row);
    target.set(row, current ? [Math.min(current[0], min), Math.max(current[1], max)] : [min, max]);
  });
}

/** Smallest shift that keeps `next` clear of `placed` in every shared row. */
function requiredShift(placed: Contour, next: Contour, siblingRow: number) {
  let shift = Number.NEGATIVE_INFINITY;
  next.forEach(([min], row) => {
    const other = placed.get(row);
    if (!other) return;
    shift = Math.max(shift, other[1] - min + (row === siblingRow ? SIBLING_GAP : COUSIN_GAP));
  });
  return shift;
}

export function layoutConstellation(input: readonly LayoutInput[], options: { rootId?: string | null; hidden?: ReadonlySet<string> } = {}): LayoutResult {
  const byId = new Map(input.map((node) => [node.id, node]));
  const allChildren = new Map<string, string[]>();
  input.forEach((node) => {
    if (!node.mentorId || node.mentorId === node.id || !byId.has(node.mentorId)) return;
    allChildren.set(node.mentorId, [...(allChildren.get(node.mentorId) ?? []), node.id]);
  });
  allChildren.forEach((ids) => ids.sort((a, b) => byId.get(a)!.row - byId.get(b)!.row || byId.get(a)!.order.localeCompare(byId.get(b)!.order, "zh-CN") || a.localeCompare(b)));

  // Descendant totals ignore filtering so a folded star can say how many it hides.
  const descendants = new Map<string, number>();
  const counting = new Set<string>();
  const count = (id: string): number => {
    if (descendants.has(id)) return descendants.get(id)!;
    if (counting.has(id)) return 0;
    counting.add(id);
    const total = (allChildren.get(id) ?? []).reduce((sum, kid) => sum + 1 + count(kid), 0);
    counting.delete(id);
    descendants.set(id, total);
    return total;
  };
  input.forEach((node) => count(node.id));

  const hidden = options.hidden ?? new Set<string>();
  const visible = input.filter((node) => !hidden.has(node.id));
  const visibleIds = new Set(visible.map((node) => node.id));
  const children = new Map<string, string[]>();
  allChildren.forEach((kids, mentor) => {
    if (!visibleIds.has(mentor)) return;
    const shown = kids.filter((kid) => visibleIds.has(kid));
    if (shown.length) children.set(mentor, shown);
  });

  const offsets = new Map<string, number>();
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  /** Lays out a subtree with its root at x = 0 and returns its contour. */
  const place = (id: string, level: number): Contour => {
    visiting.add(id);
    depth.set(id, level);
    const row = byId.get(id)!.row;
    const kids = (children.get(id) ?? []).filter((kid) => !visiting.has(kid) && !depth.has(kid));
    const contour: Contour = new Map([[row, [0, 0]]]);
    if (kids.length) {
      const placed: Contour = new Map();
      const shifts: number[] = [];
      kids.forEach((kid, index) => {
        const kidContour = place(kid, level + 1);
        let shift = index === 0 ? 0 : requiredShift(placed, kidContour, byId.get(kid)!.row);
        if (index > 0) shift = Math.max(Number.isFinite(shift) ? shift : 0, shifts[index - 1] + SIBLING_GAP);
        shifts.push(shift);
        offsets.set(kid, shift);
        mergeInto(placed, shiftContour(kidContour, shift));
      });
      const middle = (shifts[0] + shifts[shifts.length - 1]) / 2;
      kids.forEach((kid) => offsets.set(kid, offsets.get(kid)! - middle));
      let family = shiftContour(placed, -middle);
      // Students recorded in the mentor's own row are kept clear of the mentor.
      const sameRow = family.get(row);
      if (sameRow && sameRow[0] < SIBLING_GAP && sameRow[1] > -SIBLING_GAP) {
        const push = SIBLING_GAP - sameRow[0];
        kids.forEach((kid) => offsets.set(kid, offsets.get(kid)! + push));
        family = shiftContour(family, push);
      }
      mergeInto(contour, family);
    }
    visiting.delete(id);
    return contour;
  };

  const hasVisibleMentor = (node: LayoutInput) => Boolean(node.mentorId && node.mentorId !== node.id && visibleIds.has(node.mentorId));
  // The largest family anchors the left edge; lone stars and small families follow it.
  const rootOrder = (a: LayoutInput, b: LayoutInput) =>
    (descendants.get(b.id) ?? 0) - (descendants.get(a.id) ?? 0)
    || Number(b.id === options.rootId) - Number(a.id === options.rootId)
    || a.row - b.row || a.order.localeCompare(b.order, "zh-CN");
  const roots = visible.filter((node) => !hasVisibleMentor(node)).sort(rootOrder);

  const slots = new Map<string, number>();
  const forest: Contour = new Map();
  let previousRoot = Number.NEGATIVE_INFINITY;
  const placeRoot = (node: LayoutInput) => {
    const contour = place(node.id, 0);
    let shift = 0;
    if (forest.size) {
      const required = requiredShift(forest, contour, Number.NaN);
      // Separate families keep a wider gap; every new root starts right of the previous one.
      shift = Math.max(Number.isFinite(required) ? required + ROOT_GAP - COUSIN_GAP : 0, previousRoot + SIBLING_GAP);
    }
    previousRoot = shift;
    mergeInto(forest, shiftContour(contour, shift));
    const assign = (id: string, base: number) => {
      slots.set(id, base);
      (children.get(id) ?? []).forEach((kid) => { if (offsets.has(kid) && !slots.has(kid)) assign(kid, base + offsets.get(kid)!); });
    };
    assign(node.id, shift);
  };
  roots.forEach(placeRoot);
  // Members caught in a mentor cycle are unreachable from any root; keep them visible anyway.
  visible.filter((node) => !slots.has(node.id)).forEach((node) => { depth.delete(node.id); placeRoot(node); });

  const xs = [...slots.values()];
  const min = xs.length ? Math.min(...xs) : 0;
  const max = xs.length ? Math.max(...xs) : 0;
  slots.forEach((value, id) => slots.set(id, value - min));
  return { slots, span: max - min, depth, descendants, children: allChildren };
}

/** Ids below the given ones in the mentor tree (not including them). */
export function descendantsOf(ids: Iterable<string>, children: ReadonlyMap<string, readonly string[]>) {
  const result = new Set<string>();
  const queue = [...ids].flatMap((id) => [...(children.get(id) ?? [])]);
  while (queue.length) {
    const next = queue.shift()!;
    if (result.has(next)) continue;
    result.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return result;
}

/** The chain from a member up to its root, including the member. */
export function ancestorsOf(id: string, mentorOf: ReadonlyMap<string, string | null>) {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = mentorOf.get(cursor) ?? null;
  }
  return chain;
}

export type Viewport = { x: number; y: number; scale: number };

export function clampScale(scale: number, min: number, max: number) {
  return Math.min(max, Math.max(min, scale));
}

/** Scale and translation that fit a content box inside a viewport with padding. */
export function fitView(content: { width: number; height: number }, viewport: { width: number; height: number }, options: { min: number; max: number; padding?: number }): Viewport {
  const padding = options.padding ?? 32;
  const scale = clampScale(Math.min((viewport.width - padding * 2) / Math.max(content.width, 1), (viewport.height - padding * 2) / Math.max(content.height, 1)), options.min, options.max);
  return { scale, x: (viewport.width - content.width * scale) / 2, y: Math.max(padding, (viewport.height - content.height * scale) / 2) };
}

/** Zoom around a screen point so the content under the cursor stays put. */
export function zoomAt(view: Viewport, nextScale: number, point: { x: number; y: number }): Viewport {
  const ratio = nextScale / view.scale;
  return { scale: nextScale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}
