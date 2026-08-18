import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import Room from './Room'


function App() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<Room />} />
        </Routes>
    )
}

export default App