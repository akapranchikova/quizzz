import { Route, Routes, Navigate } from 'react-router-dom';
import ScreenPage from './pages/ScreenPage';
import ControllerPage from './pages/ControllerPage';
import AdminPage from './pages/AdminPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/screen" replace />} />
      <Route path="/screen" element={<ScreenPage />} />
      <Route path="/controller" element={<ControllerPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}

export default App;
