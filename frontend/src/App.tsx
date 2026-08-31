import './App.css'
import CssBaseline from '@mui/material/CssBaseline';
import Viewer from './pages/viewer';
import { ThemeProvider } from '@mui/material/styles';
import darkTheme from './theme';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
    <CssBaseline />
      <Viewer/>
      <ToastContainer 
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />
    </ThemeProvider>
  )
}

export default App
