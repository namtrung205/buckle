import React from 'react';
import { colors } from '../../../theme';
import { OUTLINE_VIEWBOX, Outline } from '../../../libraries/sectionDrawing';

interface SectionFigureProps {
  outline: Outline;
  /** Whether to draw the centroid crosshair dot. */
  showCentroid?: boolean;
  /** Pixels of the rendered square. */
  size?: number;
}

/**
 * A self-contained SVG renderer for a cross-section outline in the shared
 * `-90 -90 180 180` viewBox. One path, one source of truth: the picker
 * thumbnail, the live preview and the committed preview all render through it.
 */
const SectionFigure: React.FC<SectionFigureProps> = ({ outline, showCentroid = false, size = 120 }) => {
  const stroke = colors.accentSoft as string;
  const mish = outline.exact ? 0.2 : 0.45;
  return (
    <svg
      viewBox={OUTLINE_VIEWBOX}
      width={size}
      height={size}
      style={{ display: 'block' }}
    >
      {outline.d && (
        <>
          <path d={outline.d} fill={colors.accent} fillOpacity={mish} stroke={stroke} strokeWidth={2} fillRule="evenodd" />
          {showCentroid && <circle cx={0} cy={0} r={2} fill={colors.secondary} opacity={0.85} />}
        </>
      )}
    </svg>
  );
};

export default SectionFigure;