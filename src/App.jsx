import { useState } from 'react';
import './App.css';
import AudioControl from './components/common/AudioControl';
import LobbyScreen from './components/lobby/LobbyScreen';
import GameScreen from './components/game/GameScreen';
import { useAudio } from './hooks/useAudio';

export default function App() {
  const [screen, setScreen] = useState('LOBBY'); 
  const [gameConfig, setGameConfig] = useState(null);
  const [isFlashOut, setIsFlashOut] = useState(false);
  const [nickname, setNickname] = useState(() => {
    return sessionStorage.getItem('countup_nickname') || `Player_${Math.floor(Math.random() * 900) + 100}`;
  });

  const { isBgmOn, isSfxOn, toggleBgm, toggleSfx, playSound, updateBgmState } = useAudio();

  const handleJoinGame = (config) => {
    setGameConfig(config);
    setScreen('GAME');
  };

  const handleBackToLobby = () => {
    setGameConfig(null);
    setScreen('LOBBY');
  };

  return (
    <div className={`app-container ${isFlashOut ? 'penalty-flash' : ''}`}>
      <AudioControl 
        isBgmOn={isBgmOn} 
        isSfxOn={isSfxOn} 
        toggleBgm={toggleBgm} 
        toggleSfx={toggleSfx} 
      />

      {screen === 'LOBBY' ? (
        <LobbyScreen 
          nickname={nickname} 
          setNickname={setNickname} 
          onJoinGame={handleJoinGame} 
        />
      ) : (
        <GameScreen 
          nickname={nickname} 
          gameConfig={gameConfig} 
          onBack={handleBackToLobby}
          playSound={playSound}
          updateBgmState={updateBgmState}
          setIsFlashOut={setIsFlashOut}
        />
      )}
    </div>
  );
}