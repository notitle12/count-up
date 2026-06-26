import React from 'react';

export default function AudioControl({ isBgmOn, isSfxOn, toggleBgm, toggleSfx }) {
  return (
    <div className="audio-control-header">
      <h1>Count-Up</h1>
      <div className="audio-btn-row">
        <button onClick={toggleBgm} className={`audio-toggle-btn ${isBgmOn ? 'on' : 'off'}`}>
          {isBgmOn ? '🔊 BGM ON' : '🔇 BGM OFF'}
        </button>
        <button onClick={toggleSfx} className={`audio-toggle-btn ${isSfxOn ? 'on' : 'off'}`}>
          {isSfxOn ? '🔊 SFX ON' : '🔇 SFX OFF'}
        </button>
      </div>
    </div>
  );
}