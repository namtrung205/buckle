import { observer } from 'mobx-react-lite';
import { Box, Button, Stack } from '@mui/material';
import { useRef, useState } from 'react';
import { useModel } from '../../model/Context';
import { UI } from '../Results/Components/ui';

/**
 * Goal-0 benchmark HUD. Fixture replacement only occurs after an explicit click.
 */
const FpsOverlay = observer(() => {
  const model = useModel();
  const reportRef = useRef<HTMLTextAreaElement | null>(null);
  const resultReportRef = useRef<HTMLTextAreaElement | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  if (!model || !model.showFps) return null;

  const benchmark = model.performanceBenchmark;
  const snapshot = benchmark.snapshot;
  const low = snapshot.fps > 0 && snapshot.fps < 30;
  const busy = benchmark.running || benchmark.fixtureLoading || benchmark.resultRunning;

  const copyReport = async () => {
    if (!benchmark.report) return;
    let copied = false;
    const textarea = reportRef.current;
    if (textarea) {
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      textarea.setSelectionRange(0, 0);
    }
    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(benchmark.report);
        copied = true;
      } catch {
        // Permission-hardened browsers still leave the JSON selected below.
      }
    }
    setCopyStatus(copied ? 'Copied' : 'Select JSON below');
  };

  const copyResultReport = async () => {
    if (!benchmark.resultReport) return;
    const textarea = resultReportRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.setSelectionRange(0, 0);
    setCopyStatus(copied ? 'Result copied' : 'Select result JSON below');
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 45,
        px: 1,
        py: 0.4,
        borderRadius: 1,
        backgroundColor: 'rgba(33, 40, 48, 0.78)',
        border: '1px solid rgba(90, 100, 114, 0.45)',
        color: low ? UI.red : UI.text,
        fontFamily: UI.mono,
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: '0.04em',
        pointerEvents: 'auto',
        userSelect: 'none',
        width: 330,
      }}
    >
      <Box>FPS {snapshot.fps || model.fps || '–'} · AVG {snapshot.frameMsAvg || '–'} ms · P95 {snapshot.frameMsP95 || '–'}</Box>
      <Box>DRAW {snapshot.drawCalls} · TRI {snapshot.triangles.toLocaleString()} · OBJ {snapshot.sceneObjects.toLocaleString()}</Box>
      <Box>GEO {snapshot.geometries} · TEX {snapshot.textures} · PROGRAM {snapshot.programs}</Box>
      <Box>CPU update {snapshot.cpuUpdateMsAvg} · submit {snapshot.renderSubmitMsAvg} · labels {snapshot.labelRenderMsAvg} ms</Box>
      <Box>RAY P95 {snapshot.raycastMsP95} ms · PICK {snapshot.pickables.toLocaleString()}</Box>
      <Box>SELECTED {model.selectedNodeIds.length + model.selectedMemberIds.length + model.selectedShellIds.length}</Box>
      <Box>MODE {model.renderMode} · QUALITY {model.qualityProfile} · WebGL2</Box>
      {benchmark.fixture && (
        <Box>FIXTURE {benchmark.fixture.requestedBeamCount.toLocaleString()} beams · load {benchmark.fixture.loadMs} ms</Box>
      )}
      {model.structuralSceneDB.memberCount > 0 && (
        <Box>
          DB {(model.structuralSceneDB.byteLength / 1048576).toFixed(2)} MB · build {model.structuralSceneDBBuildMs.toFixed(2)} ms
        </Box>
      )}
      {(benchmark.running || benchmark.fixtureLoading || benchmark.resultRunning) && (
        <Box sx={{ color: '#fbbf24', mt: 0.5 }}>
          {benchmark.fixtureLoading ? 'Loading fixture…' : benchmark.resultRunning ? 'Testing result textures…' : `${benchmark.phase} ${benchmark.progress}%`}
        </Box>
      )}
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void model.loadBenchmarkFixture(1_000)}>Load 1k</Button>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void model.loadBenchmarkFixture(10_000)}>Load 10k</Button>
        <Button size="small" variant="contained" disabled={busy} onClick={() => void benchmark.run()}>Run</Button>
        <Button size="small" variant="outlined" disabled={busy || model.structuralSceneDB.memberCount === 0} onClick={() => void model.runResultBenchmark()}>Result test</Button>
        <Button size="small" variant="text" disabled={!benchmark.report} onClick={() => void copyReport()}>
          {copyStatus || 'Copy'}
        </Button>
      </Stack>
      {benchmark.report && (
        <Box
          component="textarea"
          ref={reportRef}
          readOnly
          value={benchmark.report}
          aria-label="Viewer benchmark JSON"
          sx={{
            mt: 0.75,
            width: '100%',
            height: 92,
            boxSizing: 'border-box',
            resize: 'vertical',
            backgroundColor: 'rgba(12,16,20,.9)',
            color: UI.text,
            border: '1px solid rgba(130,140,155,.4)',
            fontFamily: UI.mono,
            fontSize: '10px',
            userSelect: 'text',
          }}
        />
      )}
      {benchmark.resultReport && (
        <Box
          component="textarea"
          ref={resultReportRef}
          readOnly
          value={benchmark.resultReport}
          aria-label="Result benchmark JSON"
          onClick={() => void copyResultReport()}
          sx={{
            mt: 0.75, width: '100%', height: 92, boxSizing: 'border-box', resize: 'vertical',
            backgroundColor: 'rgba(12,16,20,.9)', color: UI.text,
            border: '1px solid rgba(130,140,155,.4)', fontFamily: UI.mono,
            fontSize: '10px', userSelect: 'text',
          }}
        />
      )}
    </Box>
  );
});

export default FpsOverlay;
