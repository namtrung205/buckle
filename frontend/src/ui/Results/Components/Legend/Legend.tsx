import { observer } from 'mobx-react-lite';
import { Box, Typography } from '@mui/material';
import { useModel } from '../../../../model/Context';
import { lerpStops, colorToCss } from '../../../../model/PostProcessing/Colormap';
import { DEFLECTION_TYPE } from '../../../../model/PostProcessing/PostProcessing';
import { UI, fmtValue } from '../ui';

const TYPE_TITLES: Record<string, string> = {
  N: 'Axial force N',
  Vy: 'Shear force Vy',
  Vz: 'Shear force Vz',
  T: 'Torsion T',
  My: 'Bending moment My',
  Mz: 'Bending moment Mz',
  defl: 'Deflection |Δ|',
  Smax: 'Stress σ (max fibre)',
  Sabs: 'Stress |σ| (extreme)',
  SvonM: 'Von Mises σ',
};

const TYPE_UNITS: Record<string, string> = {
  N: 'kN', Vy: 'kN', Vz: 'kN', T: 'kN', My: 'kNm', Mz: 'kNm', defl: 'mm',
  Smax: 'MPa', Sabs: 'MPa', SvonM: 'MPa',
};

/** Vertical colour-bar gradient — the same diverging colormap as the contour:
 *  deep blue (most negative) at the top → green (zero) → deep red (most positive)
 *  at the bottom, with no white in the middle. */
const BAR_GRADIENT = `linear-gradient(to bottom, ${[0, 0.25, 0.5, 0.75, 1]
  .map((t) => `${colorToCss(lerpStops(t))} ${t * 100}%`)
  .join(', ')})`;

const BAR_MIN = colorToCss(lerpStops(0)); // deep blue — most negative
const BAR_MAX = colorToCss(lerpStops(1)); // deep red — most positive

/**
 * Contour legend floating directly over the 3D viewer (ETABS-style, left edge)
 * instead of living inside the Results dock: a vertical colour bar reading
 * deep blue → green (0) → deep red top-to-bottom with the min value at the top and the max value at
 * the bottom, each labelled with the member that carries it. Pure display —
 * pointer events pass through so orbit / pan / zoom keep working, it only
 * appears while a result type is active, and the Results tabs can hide it.
 */
const Legend = observer(() => {
  const model = useModel();
  // The Viewer provides the model asynchronously — it is still null during the
  // very first render(s) of the Layout, so bail out instead of crashing.
  if (!model) return null;
  const post = model.postProcessing;
  const activeType = post.activeType;
  if (!activeType || !post.showLegend) return null;

  const isDefl = activeType === DEFLECTION_TYPE;
  const display = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : fmtValue(isDefl ? v * 1000 : v);

  const rowSx = { fontFamily: UI.mono, fontSize: '10.5px', lineHeight: 1.25 } as const;

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 14,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 45,
        width: 138,
        p: 1.25,
        borderRadius: 2,
        backgroundColor: 'rgba(33, 40, 48, 0.88)',
        border: '1px solid rgba(90, 100, 114, 0.55)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Title + unit */}
      <Typography sx={{ fontFamily: UI.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', color: UI.text }}>
        {TYPE_TITLES[activeType] ?? activeType}
      </Typography>
      <Typography sx={{ fontFamily: UI.mono, fontSize: '9px', color: UI.dim, mb: 0.75 }}>
        {TYPE_UNITS[activeType] ?? ''}
      </Typography>

      {/* Colour bar (blue → red, top → bottom) + the members holding the extremes */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          sx={{
            width: 14,
            height: 148,
            borderRadius: 1,
            border: '1px solid rgba(90, 100, 114, 0.8)',
            background: BAR_GRADIENT,
            flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', py: 0.25 }}>
          <Box>
            <Typography sx={{ ...rowSx, fontWeight: 700, color: BAR_MIN }}>
              {display(post.extremeMin?.value)}
            </Typography>
            <Typography sx={{ ...rowSx, color: UI.dim }}>
              {post.extremeMin?.label ?? ''}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ ...rowSx, fontWeight: 700, color: BAR_MAX }}>
              {display(post.extremeMax?.value)}
            </Typography>
            <Typography sx={{ ...rowSx, color: UI.dim }}>
              {post.extremeMax?.label ?? ''}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

export default Legend;
