import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { RoomProvider } from './context/RoomContext';
import { Home } from './pages/Home';
import { Board } from './pages/Board';
import { Whiteboard } from './pages/Whiteboard';
import { Integrations } from './pages/Integrations';

function App() {
  return (
    <RoomProvider>
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <Router>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/board" element={<Board />} />
            <Route path="/whiteboard" element={<Whiteboard />} />
            <Route path="/integrations" element={<Integrations />} />
          </Routes>
        </Router>
      </div>
    </RoomProvider>
  );
}

export default App;
