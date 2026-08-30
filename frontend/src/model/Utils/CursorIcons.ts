/**
 * Custom canvas cursors for the pan / orbit navigation tools.
 *
 * The cursors are rasterised from the exact same SVG path data used by the
 * bottom-bar icons (`@mui/icons-material` PanTool / ThreeDRotation, viewBox
 * 0 0 24 24), so the mouse cursor always matches the active toolbar button.
 * Chrome does not support SVG cursors, so each icon is drawn once onto an
 * offscreen canvas and cached as a 32x32 PNG data URL (preloadToolCursors).
 * Until rasterisation completes, toolCursor() falls back to the given
 * standard cursor (grab).
 */

/** Toolbar icon path data, mirrored from @mui/icons-material PanTool / ThreeDRotation */
const ICON_PATHS = {
  pan: 'M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5',
  orbit: 'M7.52 21.48C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81zm.89-6.52c-.19 0-.37-.03-.52-.08-.16-.06-.29-.13-.4-.24-.11-.1-.2-.22-.26-.37-.06-.14-.09-.3-.09-.47h-1.3c0 .36.07.68.21.95.14.27.33.5.56.69.24.18.51.32.82.41.3.1.62.15.96.15.37 0 .72-.05 1.03-.15.32-.1.6-.25.83-.44s.42-.43.55-.72c.13-.29.2-.61.2-.97 0-.19-.02-.38-.07-.56-.05-.18-.12-.35-.23-.51-.1-.16-.24-.3-.4-.43-.17-.13-.37-.23-.61-.31.2-.09.37-.2.52-.33.15-.13.27-.27.37-.42.1-.15.17-.3.22-.46.05-.16.07-.32.07-.48 0-.36-.06-.68-.18-.96-.12-.28-.29-.51-.51-.69-.2-.19-.47-.33-.77-.43C9.1 8.05 8.76 8 8.39 8c-.36 0-.69.05-1 .16-.3.11-.57.26-.79.45-.21.19-.38.41-.51.67-.12.26-.18.54-.18.85h1.3c0-.17.03-.32.09-.45s.14-.25.25-.34c.11-.09.23-.17.38-.22.15-.05.3-.08.48-.08.4 0 .7.1.89.31.19.2.29.49.29.86 0 .18-.03.34-.08.49-.05.15-.14.27-.25.37-.11.1-.25.18-.41.24-.16.06-.36.09-.58.09H7.5v1.03h.77c.22 0 .42.02.6.07s.33.13.45.23c.12.11.22.24.29.4.07.16.1.35.1.57 0 .41-.12.72-.35.93-.23.23-.55.33-.95.33m8.55-5.92c-.32-.33-.7-.59-1.14-.77-.43-.18-.92-.27-1.46-.27H12v8h2.3c.55 0 1.06-.09 1.51-.27.45-.18.84-.43 1.16-.76.32-.33.57-.73.74-1.19.17-.47.26-.99.26-1.57v-.4c0-.58-.09-1.1-.26-1.57-.18-.47-.43-.87-.75-1.2m-.39 3.16c0 .42-.05.79-.14 1.13-.1.33-.24.62-.43.85-.19.23-.43.41-.71.53-.29.12-.62.18-.99.18h-.91V9.12h.97c.72 0 1.27.23 1.64.69.38.46.57 1.12.57 1.99zM12 0l-.66.03 3.81 3.81 1.33-1.33c3.27 1.55 5.61 4.72 5.96 8.48h1.5C23.44 4.84 18.29 0 12 0',
};

/** Cursor hotspots in rasterised pixels (pan: raised fingertip, orbit: centre) */
const HOTSPOTS: Record<ToolKey, readonly [number, number]> = {
  pan: [13, 6],
  orbit: [16, 16],
};

const CURSOR_SIZE = 32;
const ICON_SIZE = 26;
const ICON_COLOR = '#4a90e2'; // the toolbar's active colour

type ToolKey = keyof typeof ICON_PATHS;

type CursorEntry = { url: string; hotspot: readonly [number, number] };

const cache: Partial<Record<ToolKey, CursorEntry>> = {};
let preload: Promise<void> | null = null;

const buildSvg = (tool: ToolKey): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 24 24">` +
  `<path d="${ICON_PATHS[tool]}" fill="${ICON_COLOR}"/></svg>`;

const rasterise = (svg: string, tool: ToolKey): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to rasterise the "${tool}" cursor icon`));
    };
    image.src = url;
  });

const toPngDataUrl = (image: HTMLImageElement): string => {
  const canvas = document.createElement('canvas');
  canvas.width = CURSOR_SIZE;
  canvas.height = CURSOR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  const pad = (CURSOR_SIZE - ICON_SIZE) / 2;
  // Soft drop shadow keeps the icon readable over light model geometry
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0.5;
  ctx.shadowOffsetY = 0.5;
  ctx.drawImage(image, pad, pad, ICON_SIZE, ICON_SIZE);
  return canvas.toDataURL('image/png');
};

/**
 * Rasterise the pan / orbit toolbar icons into cached PNG cursors.
 * Safe to call repeatedly — the work is deduplicated, and failures simply
 * leave the standard 'grab' fallback cursor in place.
 */
export const preloadToolCursors = (): Promise<void> => {
  if (!preload) {
    preload = (async () => {
      for (const tool of Object.keys(ICON_PATHS) as ToolKey[]) {
        try {
          const image = await rasterise(buildSvg(tool), tool);
          cache[tool] = { url: toPngDataUrl(image), hotspot: HOTSPOTS[tool] };
        } catch (error) {
          console.warn(error);
        }
      }
    })();
  }
  return preload;
};

/**
 * CSS cursor for a navigation tool: the toolbar icon once rasterised,
 * otherwise the given fallback, e.g. 'grab'.
 */
export const toolCursor = (tool: ToolKey, fallback: string): string => {
  const entry = cache[tool];
  if (!entry) return fallback;
  const [x, y] = entry.hotspot;
  return `url(${entry.url}) ${x} ${y}, ${fallback}`;
};
