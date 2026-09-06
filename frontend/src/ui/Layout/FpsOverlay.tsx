import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Box, Button, LinearProgress } from '@mui/material';
import { useModel } from '../../model/Context';
import { UI } from '../Results/Components/ui';

/**
 * On-screen FPS readout over the 3D viewer. Reads Model.fps, which the render
 * loop refreshes ~2×/s (Settings → View → Show FPS). Pure display — pointer
 * events pass through so orbit / pan / zoom keep working.
 */
const FpsOverlay = observer(() => {
  const model = useModel();
  const [copied, setCopied] = useState(false);
  if (!model || !model.showFps) return null;

  const perf = model.performanceSnapshot;
  const low = perf.fps > 0 && perf.fps < 30;
  const formatCount = (value: number) => value.toLocaleString('en-US');

  const copyResult = async () => {
    if (!model.benchmarkReport) return;
    try {
      await navigator.clipboard.writeText(model.benchmarkReport);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = model.benchmarkReport;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 45,
        px: 1.1,
        py: 0.7,
        borderRadius: 1,
        backgroundColor: 'rgba(33, 40, 48, 0.78)',
        border: '1px solid rgba(90, 100, 114, 0.45)',
        color: low ? UI.red : UI.text,
        fontFamily: UI.mono,
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1.45,
        letterSpacing: '0.04em',
        pointerEvents: 'none',
        userSelect: 'none',
        minWidth: 265,
      }}
    >
      <div style={{ color: low ? UI.red : UI.text }}>
        FPS {perf.fps > 0 ? perf.fps : '–'} · AVG {perf.frameMsAvg} ms
      </div>
      <div>P95 {perf.frameMsP95} ms · P99 {perf.frameMsP99} ms</div>
      <div>DRAW {formatCount(perf.drawCalls)} · TRI {formatCount(perf.triangles)}</div>
      <div>OBJ {formatCount(perf.sceneObjects)} · GEO {formatCount(perf.geometries)} · TEX {formatCount(perf.textures)}</div>
      <div>PICK {formatCount(perf.pickables)} · RAY {perf.raycastMsLast}/{perf.raycastMsP95} ms</div>
      <div>LABEL {formatCount(perf.labels)}</div>
      <Box sx={{ mt: 0.7, pointerEvents: 'auto' }} onPointerDown={(event) => event.stopPropagation()}>
        <Button
          size="small"
          variant="outlined"
          disabled={model.benchmarkRunning}
          onClick={() => void model.runPerformanceBenchmark()}
          sx={{ fontSize: '10px', py: 0.25, minHeight: 24 }}
        >
          {model.benchmarkRunning ? `Running: ${model.benchmarkPhase}` : 'Run benchmark'}
        </Button>
        {model.benchmarkRunning && (
          <LinearProgress variant="determinate" value={model.benchmarkProgress} sx={{ mt: 0.6, height: 3 }} />
        )}
        {model.benchmarkReport && !model.benchmarkRunning && (
          <>
            <Button
              size="small"
              variant="contained"
              onClick={() => void copyResult()}
              sx={{ ml: 0.7, fontSize: '10px', py: 0.25, minHeight: 24 }}
            >
              {copied ? 'Copied' : 'Copy result'}
            </Button>
            <Box
              component="textarea"
              readOnly
              value={model.benchmarkReport}
              onFocus={(event: React.FocusEvent<HTMLTextAreaElement>) => event.currentTarget.select()}
              sx={{
                display: 'block', mt: 0.7, width: 410, height: 150, resize: 'both',
                bgcolor: 'rgba(10, 14, 18, 0.92)', color: UI.text, border: '1px solid rgba(90,100,114,.5)',
                borderRadius: 0.5, p: 0.7, fontFamily: UI.mono, fontSize: '10px', lineHeight: 1.25,
                pointerEvents: 'auto', userSelect: 'text',
              }}
            />
          </>
        )}
      </Box>
    </Box>
  );
});

export default FpsOverlay;
