import React from 'react';
import { Box } from '@mui/material';
import { Section } from '../../../types';
import { colors } from '../../../theme';

/**
 * A lightweight 2D SVG renderer for structural cross-sections.
 *
 * It draws a to-scale outline of the cross-section (I/H, rectangular, box/hollow,
 * pipe, angle, channel, tee, solid/filled shapes). The result is a faithful
 * "preview" of the section as declared, auto-scaled to fit a fixed viewBox.
 *
 * Each outline is expressed in millimetre coordinates with its local origin at
 * the bottom-left of its bounding box, so a single uniform scale + centre
 * transform places it correctly.
 */

interface SectionPreviewProps {
  section: Section;
  width?: number;
  height?: number;
}

const FILL = colors.accentSoft as string;
const STROKE = colors.text as string;
const GRID = colors.divider as string;

interface Outline {
  /** SVG path data in mm coordinates, origin = bottom-left of bbox. */
  d: string;
  /** bounding box width (mm) */
  w: number;
  /** bounding box height (mm) */
  h: number;
}

function outline(section: Section): Outline {
  switch (section.type) {
    case 'Rectangular': {
      const w = section.width, h = section.height;
      return { d: `M 0 ${h} L 0 0 L ${w} 0 L ${w} ${h} Z`, w, h };
    }
    case 'Circular': {
      const d = section.diameter, r = d / 2;
      return {
        d: `M ${d / 2} 0 A ${r} ${r} 0 1 0 ${d / 2} ${d} A ${r} ${r} 0 1 0 ${d / 2} 0 Z`,
        w: d, h: d,
      };
    }
    case 'HollowCircular': {
      const d = section.diameter, t = section.thickness;
      const ro = d / 2, ri = ro - t, c = d / 2;
      // outer (fill ring) + inner hole via two arcs with opposite sweep
      return {
        d:
          `M ${c} ${c - ro} A ${ro} ${ro} 0 1 1 ${c} ${c + ro} A ${ro} ${ro} 0 1 1 ${c} ${c - ro} Z ` +
          `M ${c} ${c - ri} A ${ri} ${ri} 0 1 0 ${c} ${c + ri} A ${ri} ${ri} 0 1 0 ${c} ${c - ri} Z`,
        w: d, h: d,
      };
    }
    case 'RectangularHollow': {
      const w = section.width, h = section.height, t = section.thickness;
      const bi = w - 2 * t, hi = h - 2 * t;
      return {
        d:
          `M 0 ${h} L 0 0 L ${w} 0 L ${w} ${h} Z ` +
          `M ${t} ${h - t} L ${t} ${t} L ${t + bi} ${t} L ${t + bi} ${h - t} Z`,
        w, h,
      };
    }
    case 'I': {
      const h = section.depth, b = section.width, tf = section.tf, tw = section.tw;
      const B = b / 2, TW = tw / 2;
      // y=0 is bottom; flange top and bottom
      return {
        d:
          `M 0 0 L ${b} 0 L ${b} ${tf} L ${B + TW} ${tf} L ${B + TW} ${h - tf} ` +
          `L ${b} ${h - tf} L ${b} ${h} L 0 ${h} L 0 ${h - tf} L ${B - TW} ${h - tf} ` +
          `L ${B - TW} ${tf} L 0 ${tf} Z`,
        w: b, h,
      };
    }
    case 'Channel': {
      const h = section.depth, b = section.width, tf = section.tf, tw = section.tw;
      return {
        d:
          `M 0 0 L ${b} 0 L ${b} ${tf} L ${tw} ${tf} L ${tw} ${h - tf} ` +
          `L ${b} ${h - tf} L ${b} ${h} L 0 ${h} Z`,
        w: b, h,
      };
    }
    case 'Angle': {
      const b = section.width, t = section.thickness;
      // heel at top-right; horizontal leg to the left, vertical leg down
      return {
        d: `M 0 0 L ${b} 0 L ${b} ${t} L ${t} ${t} L ${t} ${b} L 0 ${b} Z`,
        w: b, h: b,
      };
    }
    case 'Tee': {
      const h = section.depth, b = section.width, tf = section.tf, tw = section.tw;
      const B = b / 2, TW = tw / 2;
      // flange at top (y=0)
      return {
        d:
          `M 0 0 L ${b} 0 L ${b} ${tf} L ${B + TW} ${tf} L ${B + TW} ${h} ` +
          `L ${B - TW} ${h} L ${B - TW} ${tf} L 0 ${tf} Z`,
        w: b, h,
      };
    }
    default:
      return { d: `M 0 100 L 0 0 L 100 0 L 100 100 Z`, w: 100, h: 100 };
  }
}

const SectionPreview: React.FC<SectionPreviewProps> = ({ section, width = 230, height = 210 }) => {
  const { d, w, h } = outline(section);

  // Uniform scale that fits the outline into the viewBox.
  const maxDim = Math.max(w, h, 1);
  const S = 200; // target max extent in px within the viewBox
  const scale = S / maxDim;
  const vbW = S + 40;
  const vbH = S + 40;
  // centre the outline: its drawn width/height after scaling
  const dx = (vbW - w * scale) / 2;
  const dy = (vbH - h * scale) / 2;

  return (
    <Box
      sx={{
        width,
        height,
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <rect x={0} y={0} width={vbW} height={vbH} fill={colors.bg} />
        <line x1={vbW / 2} y1={8} x2={vbW / 2} y2={vbH - 8} stroke={GRID} strokeWidth={0.5} strokeDasharray="3 3" />
        <line x1={8} y1={vbH / 2} x2={vbW - 8} y2={vbH / 2} stroke={GRID} strokeWidth={0.5} strokeDasharray="3 3" />

        <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
          <path
            d={d}
            fill={FILL}
            fillOpacity={0.3}
            fillRule="evenodd"
            stroke={STROKE}
            strokeWidth={maxDim / 150}
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </Box>
  );
};

export default SectionPreview;