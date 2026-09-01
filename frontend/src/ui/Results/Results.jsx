import React, { useState } from 'react';
import {
  Box,
} from '@mui/material';
import Dialog from '../../components/Dialog/Dialog';
import Select from '../../components/Select/Select';
import Displacements from './Components/Displacements/Displacements';
import Diagrams from './Components/Diagrams/Diagrams';

const Results = ({open, onClose}) => {
  const [selectedType, setSelectedType] = useState('Diagrams');

  const handleTypeChange = (event) => {
    setSelectedType(event.target.value);
  };

  const viewOptions = [
    { id: 'Diagrams', name: 'Diagrams' },
    { id: 'Displacements', name: 'Displacements' }
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth={false}
      draggable
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableRestoreFocus
      title="Results"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', width: 'auto', maxWidth: 'calc(100vw - 40px)' }}>
        <Box sx={{ mb: 2, width: '300px' , ml:2}}>
          <Select
            list={viewOptions}
            value={selectedType}
            onChange={handleTypeChange}
            label="View Type"
            size="small"
          />
        </Box>
        {selectedType === 'Displacements' && (
          <Box sx={{ width: '100%', overflow: 'auto' }}>
            <Displacements />
          </Box>
        )}
        {selectedType === 'Diagrams' && (
          <Box sx={{ width: '100%', px: 2, pb: 2, overflowY: 'auto', maxHeight: '500px' }}>
            <Diagrams />
          </Box>
        )}
      </Box>
    </Dialog>
  )
}

export default Results