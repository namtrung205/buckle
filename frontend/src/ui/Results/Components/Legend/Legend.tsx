import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
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
};

const Legend = observer(() => {
  const model = useModel();
  const post = model.postProcessing;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeType = post.activeType;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeType) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    for (let x = 0; x < width; x++) {
      const t = x / (width - 1);
      ctx.fillStyle = colorToCss(lerpStops(t));
      ctx.fillRect(x, 0, 1, height);
    }
  }, [activeType]);

  if (!activeType) return null;

  const isDefl = activeType === DEFLECTION_TYPE;
  const unit = post.unit;
  const minValue = isDefl ? post.max * 1000 : post.min;
  const maxValue = isDefl ? post.max * 1000 : post.max;

  return (
    <Box sx={{ mt: 1.5, p: 1.25, border: `1px solid ${UI.border}`, borderRadius: 1.5, backgroundColor: UI.panel2 }}>
      <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: UI.text }}>
        {TYPE_TITLES[activeType] ?? activeType}
      </Typography>
      <canvas
        ref={canvasRef}
        width={220}
        height={14}
        style={{
          width: '100%',
          height: 14,
          borderRadius: 4,
          border: `1px solid ${UI.borderDark}`,
          display: 'block',
          marginTop: 6,
        }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontFamily: UI.mono, fontSize: '10.5px', color: UI.dim, mt: 0.5 }}>
        <span>{fmtValue(minValue)}</span>
        <span>{fmtValue(maxValue)}</span>
      </Box>
      {unit && (
        <Typography sx={{ textAlign: 'center', fontFamily: UI.mono, fontSize: '10px', color: UI.dim, mt: 0.25 }}>
          {unit}
        </Typography>
      )}
    </Box>
  );
});

export default Legend;
