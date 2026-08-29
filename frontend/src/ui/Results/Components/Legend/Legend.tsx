import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import { lerpStops, colorToCss } from '../../../../model/PostProcessing/Colormap';
import { DEFLECTION_TYPE } from '../../../../model/PostProcessing/PostProcessing';

const TYPE_TITLES: Record<string, string> = {
  N: 'Axial force N',
  Vy: 'Shear force Vy',
  Vz: 'Shear force Vz',
  T: 'Torsion T',
  My: 'Bending moment My',
  Mz: 'Bending moment Mz',
  defl: 'Deflection |Δ|',
};

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.001) return v.toFixed(3);
  return v.toFixed(4);
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
    <Box sx={{ mt: 1.5, p: 1, border: '1px solid #d0d0d0', borderRadius: 1, backgroundColor: '#fafafa' }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {TYPE_TITLES[activeType] ?? activeType} {unit ? `[${unit}]` : ''}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography variant="caption">{fmt(minValue)}</Typography>
        <canvas
          ref={canvasRef}
          width={220}
          height={12}
          style={{ borderRadius: 3, border: '1px solid #bbbbbb', flex: 1 }}
        />
        <Typography variant="caption">{fmt(maxValue)}</Typography>
      </Box>
      {!isDefl && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Typography variant="caption" sx={{ color: '#666' }}>0</Typography>
        </Box>
      )}
    </Box>
  );
});

export default Legend;
