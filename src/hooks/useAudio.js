import { useState, useRef, useEffect } from 'react';

import clickSound from '../assets/click.mp3';
import wrongSound from '../assets/wrong.mp3';
import bgmSound from '../assets/bgm.mp3';

const clickAudioBase = typeof Audio !== "undefined" ? new Audio(clickSound) : null;
const wrongAudioBase = typeof Audio !== "undefined" ? new Audio(wrongSound) : null;

if (clickAudioBase) clickAudioBase.preload = 'auto';
if (wrongAudioBase) wrongAudioBase.preload = 'auto';

export function useAudio() {
  const [isBgmOn, setIsBgmOn] = useState(false);
  const [isSfxOn, setIsSfxOn] = useState(true);
  const bgmRef = useRef(null);

  useEffect(() => {
    if (!bgmRef.current) {
      bgmRef.current = new Audio(bgmSound);
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.1;
    }
  }, []);

  const toggleBgm = () => setIsBgmOn(prev => !prev);
  const toggleSfx = () => setIsSfxOn(prev => !prev);

  const playSound = (type) => {
    if (!isSfxOn) return; 
    try {
      const baseSound = type === 'success' ? clickAudioBase : wrongAudioBase;
      if (!baseSound) return;
      
      const sound = baseSound.cloneNode();
      sound.volume = type === 'success' ? 1.0 : 0.4; 
      sound.play().catch((e) => console.log("효과음 보류:", e));
    } catch (e) {}
  };

  const updateBgmState = (gameState, screen) => {
    if (gameState === 'RUNNING' && isBgmOn && screen === 'GAME') {
      bgmRef.current?.play().catch((e) => console.log("BGM 재생 보류:", e));
    } else {
      bgmRef.current?.pause();
    }
  };

  return { isBgmOn, isSfxOn, toggleBgm, toggleSfx, playSound, updateBgmState };
}