import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
} from '@mui/material';

import { useModel } from '../../model/Context';
import { colors, fontFamily } from '../../theme';
import Select from '../../components/Select';
import { observer } from 'mobx-react-lite';
import { Line } from '../../model';
import PropertyRow from '../Model/PropertyRow';

/**
 * Member drawing tool, docked into the right panel (replaces the old floating
 * dialog). While this panel is mounted the user is in "draw mode": they pick a
 * section and press Start, then click on the viewport to chain members. Pressing
 * the panel's close button (handled by RightPanel) or Escape stops the Line tool.
 */
const DrawPanel = observer(() => {
  const model = useModel();
  const [sections, setSections] = useState(model?.sections);
  const [selectedSection, setSelectedSection] = useState<number>(0);

  const lineTool = Line.getInstance();

  // Stop the line tool when the draw panel is closed/unmounted, so a dangling
  // preview stroke is never left on the viewport.
  useEffect(() => {
    return () => {
      lineTool.stop();
      lineTool.delete();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync section list + default selection whenever the panel stays mounted
  // across section edits.
  useEffect(() => {
    if (!model) return;
    setSections(model.sections);
    if (model.sections.length > 0) {
      const current = model.sections.some((s) => s.id === selectedSection) ? selectedSection : model.sections[0].id;
      setSelectedSection(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.sections]);

  const startFreeMode = () => {
    if (!model) return;
    lineTool.start();
    lineTool.setType('elasticBeamColumn');
    const section = model.sections.find((sec: any) => sec.id === selectedSection);
    if (!section) return;
    lineTool.section = section;
  };

  const stopFreeMode = () => {
    lineTool.stop();
    lineTool.delete();
  };

  const handleSection = (value: number) => {
    setSelectedSection(value);
    lineTool.setSection(value);
  };

  const drawing = lineTool.state !== 0;

  const sectionOptions = (sections || []).map((sec: any) => ({
    id: sec.id,
    name: sec.name || `Section ${sec.id}`,
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <PropertyRow label="Section">
        <Select
          label={''}
          list={sectionOptions}
          value={selectedSection}
          onChange={(e: any) => handleSection(Number(e.target.value))}
          size="small"
        />
      </PropertyRow>

      <Typography
        variant="body2"
        sx={{
          fontWeight: 400,
          color: colors.textDim,
          fontSize: '0.72rem',
          fontFamily,
          lineHeight: 1.5,
          mt: 0.25,
        }}
      >
        {drawing
          ? 'Click the viewport to place members. Right-click or Esc to stop the current stroke.'
          : 'Pick a section and press Start, then click in the viewport to draw members.'}
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
        <Button
          onClick={drawing ? stopFreeMode : startFreeMode}
          variant="contained"
          size="small"
          disableElevation
          sx={{
            minWidth: '64px',
            height: '28px',
            fontSize: '0.75rem',
            px: 1.5,
            backgroundColor: drawing ? colors.success : colors.accent,
            '&:hover': {
              backgroundColor: drawing ? colors.success : colors.accentHover,
            },
          }}
        >
          {drawing ? 'Stop' : 'Start'}
        </Button>
      </Box>
    </Box>
  );
});

export default DrawPanel;