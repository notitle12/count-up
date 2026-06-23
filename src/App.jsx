import { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';

// 💡 파이어베이스 라이브러리
import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, set, onValue, remove, update, onDisconnect, serverTimestamp } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 화면과 DB부터 먼저 켜두고, 애널리틱스 모듈은 나중에 따로 불러옵니다.
if (typeof window !== 'undefined') {
  import('firebase/analytics')
    .then(({ getAnalytics }) => {
      getAnalytics(app);
    })
    .catch((error) => {
      console.warn("애드가드 차단: 모듈을 다운로드하지 못했지만 게임은 정상 실행됩니다.");
    });
}


const MAX_NUMBER = 50;
const numpadMap = {'Numpad7': 0, 'Numpad8': 1, 'Numpad9': 2, 'Numpad4': 3, 'Numpad5': 4, 'Numpad6': 5, 'Numpad1': 6, 'Numpad2': 7, 'Numpad3': 8};
const regularKeyMap = {'Digit7': 0, 'Digit8': 1, 'Digit9': 2, 'Digit4': 3, 'Digit5': 4, 'Digit6': 5, 'Digit1': 6, 'Digit2': 7, 'Digit3': 8};
const hintNumbers = [7, 8, 9, 4, 5, 6, 1, 2, 3];

const clickAudioBase = typeof Audio !== "undefined" ? new Audio('./click.mp3') : null;
const wrongAudioBase = typeof Audio !== "undefined" ? new Audio('./wrong.mp3') : null;
if (clickAudioBase) clickAudioBase.preload = 'auto';
if (wrongAudioBase) wrongAudioBase.preload = 'auto';

export default function App() {
  const [isGameStarted, setIsGameStarted] = useState(false); // 게임 시작 여부 확인용
  const [screen, setScreen] = useState('LOBBY'); 
  const [gameMode, setGameMode] = useState('SINGLE'); 
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [myPlayerNum, setMyPlayerNum] = useState(1);
  const [isHost, setIsHost] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  
  const [nickname, setNickname] = useState(() => {
    return sessionStorage.getItem('countup_nickname') || `Player_${Math.floor(Math.random() * 900) + 100}`;
  });

  const [currentTarget, setCurrentTarget] = useState(1);
  const [board, setBoard] = useState(Array(9).fill(null));
  
  const [displayTime, setDisplayTime] = useState('0.00');
  const [timerLabel, setTimerLabel] = useState('시간:');
  
  const [countdownText, setCountdownText] = useState('');
  const [showCountdown, setShowCountdown] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [wrongTileIdx, setWrongTileIdx] = useState(null);
  const [activeTileIdx, setActiveTileIdx] = useState(null);
  const [isFlash, setIsFlash] = useState(false);

  const [gameState, setGameState] = useState('READY'); 
  const [globalGameState, setGlobalGameState] = useState('READY'); 

  const bgmRef = useRef(null);
  const [isBgmOn, setIsBgmOn] = useState(false);
  const [isSfxOn, setIsSfxOn] = useState(true); 

  const seedRef = useRef(1);
  const myFinalTimeRef = useRef(null);
  const globalStartTimeRef = useRef(0);
  const mainIntervalRef = useRef(null);
  const elapsedSecondsRef = useRef(0);
  const nextNumbersPoolRef = useRef([]); 
  
  const currentTargetRef = useRef(1);
  const finishDeadlineRef = useRef(null);
  
  const boardRef = useRef(Array(9).fill(null));
  const [allPlayerBoards, setAllPlayerBoards] = useState({});

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    if (!bgmRef.current) {
      bgmRef.current = new Audio('./bgm.mp3');
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.2;
    }

    if (gameState === 'RUNNING' && isBgmOn && screen === 'GAME') {
      bgmRef.current.play().catch((e) => console.log("BGM 재생 보류:", e));
    } else {
      if (bgmRef.current) {
        bgmRef.current.pause();
      }
    }
  }, [gameState, isBgmOn, screen]);

  const playSound = (type) => {
    if (!isSfxOn) return; 
    try {
      const baseSound = type === 'success' ? clickAudioBase : wrongAudioBase;
      if (!baseSound) return;
      
      const sound = baseSound.cloneNode();
      sound.volume = type === 'success' ? 0.4 : 0.6; 
      sound.play().catch((e) => console.log("효과음 보류:", e));
    } catch (e) {}
  };

  const toggleBgm = () => setIsBgmOn(!isBgmOn);

  const seededRandom = () => {
    const a = 1664525; const c = 1013904223; const m = Math.pow(2, 32);
    seedRef.current = (a * seedRef.current + c) % m;
    return seedRef.current / m;
  };

  const shuffleArray = (array) => {
    let arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const handleNicknameChange = (e) => {
    const val = e.target.value.slice(0, 10); 
    setNickname(val);
    sessionStorage.setItem('countup_nickname', val);
  };

  const startSingleMode = () => {
    setGameMode('SINGLE'); setIsHost(true); setRoomCode(''); setMyPlayerNum(1);
    setScreen('GAME');
    initGame('SINGLE');
  };

  const createRoom = async () => {
    setGameMode('MULTI'); setIsHost(true);
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    setRoomCode(code); setMyPlayerNum(1);
    
    const roomRef = ref(db, `rooms/${code}`);
    
    onDisconnect(roomRef).remove();

    await set(roomRef, {
      exists: true,
      gameState: 'READY',
      players: {
        p1: { active: true, name: nickname, target: 1, timer: '0.00', board: JSON.stringify(Array(9).fill(null)) }
      }
    });

    setScreen('GAME');
    initGame('MULTI', code, 1);
  };

  const joinRoom = () => {
    if (isJoining) return;
    const code = joinInput.toUpperCase().trim();
    if (code.length !== 5) { alert("올바른 코드를 입력하세요."); return; }

    setIsJoining(true);
    const roomPlayersRef = ref(db, `rooms/${code}`);
    
    onValue(roomPlayersRef, async (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.exists) { 
        alert("존재하지 않는 방입니다."); 
        setIsJoining(false); 
        return; 
      }
      if (data.gameState !== 'READY') { 
        alert("이미 게임이 시작된 방입니다."); 
        setIsJoining(false); 
        return; 
      }

      let assigned = false;
      let targetPNum = 2;

      for (let i = 2; i <= 10; i++) {
        if (!data.players || !data.players[`p${i}`] || data.players[`p${i}`].active !== true) {
          targetPNum = i;
          assigned = true;
          break;
        }
      }

      if (!assigned) { 
        alert("방이 가득 찼습니다."); 
        setIsJoining(false); 
        return; 
      }

      setGameMode('MULTI'); setIsHost(false); setRoomCode(code); setMyPlayerNum(targetPNum);

      const mySlotRef = ref(db, `rooms/${code}/players/p${targetPNum}`);
      
      onDisconnect(mySlotRef).remove();

      await set(mySlotRef, {
        active: true,
        name: nickname,
        target: 1,
        timer: '0.00',
        board: JSON.stringify(Array(9).fill(null))
      });

      setScreen('GAME');
      initGame('MULTI', code, targetPNum);
      setIsJoining(false); 
    }, { onlyOnce: true });
  };

  const initGame = (mode, code = roomCode, pNum = myPlayerNum) => {
    clearInterval(mainIntervalRef.current);
    setCurrentTarget(1);
    currentTargetRef.current = 1; 
    elapsedSecondsRef.current = 0;
    myFinalTimeRef.current = null;
    setDisplayTime('0.00');
    setTimerLabel('시간:');
    setShowCountdown(false);
    setShowResult(false);
    setAllPlayerBoards({});
    setGameState('READY'); 
    setGlobalGameState('READY');
    finishDeadlineRef.current = null;

    if (mode === 'SINGLE') {
      seedRef.current = Date.now();
      generateInitialGameData();
    }
  };

  const generateInitialGameData = (customSeed = null) => {
    if (customSeed) seedRef.current = customSeed;
    let firstSet = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    firstSet = shuffleArray(firstSet);
    setBoard(firstSet);

    let pool = [];
    for (let startNum = 10; startNum <= MAX_NUMBER; startNum += 9) {
      let chunk = [];
      for (let i = 0; i < 9; i++) {
        if (startNum + i <= MAX_NUMBER) chunk.push(startNum + i);
      }
      chunk = shuffleArray(chunk);
      pool = [...pool, ...chunk];
    }
    nextNumbersPoolRef.current = pool; 

    if (gameMode === 'MULTI') {
      update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        board: JSON.stringify(firstSet)
      });
    }
  };

  const broadcastStartSignal = () => {
    if (gameState !== 'READY') return;
    setIsGameStarted(true); // 👈 클릭 가능 상태로 전환

    const now = Date.now();
    const countdownStart = now + 100;
    const gameStart = countdownStart + 3000;
    const matchSeed = Math.floor(Math.random() * 1000000) + 1;

    if (gameMode === 'MULTI') {
      update(ref(db, `rooms/${roomCode}`), {
        sharedSeed: matchSeed,
        schedCountdown: countdownStart,
        schedStart: gameStart,
        gameState: 'STARTING',
        finishDeadline: null
      });
    } else {
      seedRef.current = Date.now();
      generateInitialGameData();
      startSyncLoop(countdownStart, gameStart);
    }
  };

  const startSyncLoop = (countdownTime, gameTime) => {
    globalStartTimeRef.current = gameTime;
    clearInterval(mainIntervalRef.current);

    let lastDbUpdateTime = 0; 

    mainIntervalRef.current = setInterval(() => {
      const now = Date.now();

      if (now < globalStartTimeRef.current) {
        setShowCountdown(true);
        setGameState('READY');
        const timeLeft = (globalStartTimeRef.current - now) / 1000;
        if (timeLeft > 2) setCountdownText('3');
        else if (timeLeft > 1) setCountdownText('2');
        else if (timeLeft > 0) setCountdownText('1');
      } else {
        setShowCountdown(false);
        setGameState('RUNNING'); 

        if (finishDeadlineRef.current) {
          const left = (finishDeadlineRef.current - now) / 1000;
          if (left > 0) {
            setTimerLabel(`⏱️ 마감까지: ${left.toFixed(1)}초 | 시간:`);
          } else {
            finishDeadlineRef.current = null;
            handleGameEnd();
          }
        } else {
          setTimerLabel('시간:');
        }

        if (myFinalTimeRef.current === null) {
          const exactElapsed = ((now - globalStartTimeRef.current) / 1000) + elapsedSecondsRef.current;
          const formatted = exactElapsed.toFixed(2);
          
          setDisplayTime(formatted);

          if (gameMode === 'MULTI' && now - lastDbUpdateTime > 500) {
            update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
              timer: formatted
            });
            lastDbUpdateTime = now; 
          }
        }
      }
    }, 40); 
  };

    const handleTileClick = (index, value) => {
      // 1. 카운트다운 중에는 절대 클릭 금지 (화면 레이어 때문)
      if (showCountdown || !isGameStarted) return;

      // 2. 게임 종료 후에는 클릭 금지
      if (myFinalTimeRef.current !== null) return;

      // 3. [수정] 게임이 RUNNING이 아니더라도 READY 상태라면 일단 클릭 허용
      // 만약 첫 클릭이라면 RUNNING으로 상태를 강제 동기화합니다.
      if (gameState !== 'RUNNING') {
        if (gameState === 'READY') {
          setGameState('RUNNING'); 
        } else {
          // 그 외(예: FINISHED) 상태라면 클릭 무시
          return;
        }
      }

      // 4. 숫자 확인 로직 (기존 유지)
      if (value < currentTargetRef.current) return;

      if (value === currentTargetRef.current) {
        playSound('success');
      
      const nextTarget = currentTargetRef.current + 1;
      currentTargetRef.current = nextTarget; 
      setCurrentTarget(nextTarget);

      setBoard(prevBoard => {
        if (prevBoard[index] !== value) return prevBoard; 

        const newBoard = [...prevBoard];
        if (nextNumbersPoolRef.current.length > 0) {
          newBoard[index] = nextNumbersPoolRef.current.shift(); 
        } else {
          newBoard[index] = null; 
        }

        if (gameMode === 'MULTI') {
          update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
            target: nextTarget,
            board: JSON.stringify(newBoard)
          });
        }
        return newBoard;
      });

      if (nextTarget > MAX_NUMBER) {
        const now = Date.now();
        const final = (((now - globalStartTimeRef.current) / 1000) + elapsedSecondsRef.current).toFixed(2);
        myFinalTimeRef.current = final;
        setDisplayTime(final);

        if (gameMode === 'MULTI') {
          update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
            timer: final,
            serverVerifiedFinishTime: serverTimestamp() 
          });
          
          onValue(ref(db, `rooms/${roomCode}/finishDeadline`), (snapshot) => {
            if (!snapshot.exists()) {
              set(ref(db, `rooms/${roomCode}/finishDeadline`), now + 5000);
            }
          }, { onlyOnce: true });
        } else {
          handleGameEnd();
        }
      }
    } else {
      playSound('wrong'); 
      elapsedSecondsRef.current += 3; 

      if (gameMode === 'MULTI') {
        const now = Date.now();
        const exactElapsed = ((now - globalStartTimeRef.current) / 1000) + elapsedSecondsRef.current;
        update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
          timer: exactElapsed.toFixed(2)
        });
      }
      setIsFlash(true); setTimeout(() => setIsFlash(false), 300);
      setWrongTileIdx(index); setTimeout(() => setWrongTileIdx(null), 150);
    }
  };

  useEffect(() => {
    if (gameMode !== 'MULTI' || !roomCode || screen !== 'GAME') return;

    const roomRef = ref(db, `rooms/${roomCode}`);
    
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      if (data.gameState) {
        setGlobalGameState(data.gameState);
      }

      if (data.finishDeadline) {
        finishDeadlineRef.current = data.finishDeadline;
      } else {
        finishDeadlineRef.current = null;
      }

      if (data.gameState === 'STARTING' && gameState === 'READY' && !showCountdown) {
        seedRef.current = data.sharedSeed; 
        generateInitialGameData(data.sharedSeed); 
        startSyncLoop(data.schedCountdown, data.schedStart); 
      }

      if (data.players) {
        let list = [];
        let boardsMap = {};

        Object.keys(data.players).forEach((pKey) => {
          const p = data.players[pKey];
          if (p.active) {
            const pNum = parseInt(pKey.replace('p', ''));
            list.push({
              pNum: pNum,
              name: p.name,
              target: p.target || 1,
              timer: p.timer || '0.00'
            });

            if (p.board) {
              try { boardsMap[pNum] = JSON.parse(p.board); } catch(e) {}
            }
          }
        });

        list.sort((a, b) => {
          if (b.target !== a.target) return b.target - a.target;
          return parseFloat(a.timer) - parseFloat(b.timer);
        });

        setLeaderboard(list);
        setAllPlayerBoards(boardsMap);

        if (list.length > 0 && list.every(p => p.target > MAX_NUMBER) && gameState === 'RUNNING') {
          handleGameEnd();
        }
      }
    });

    return () => unsubscribe(); 
  }, [gameMode, roomCode, screen, gameState, showCountdown]); 

  const handleGameEnd = () => {
    clearInterval(mainIntervalRef.current);
    setGameState('FINISHED'); 
    setShowResult(true);
  };

  const handleExecuteReplay = async () => {
    setIsGameStarted(true); // 👈 다시 시작할 때 true로 설정 (버튼 눌러서 다시 시작하는 셈)
    
    if (gameMode === 'SINGLE') {
      initGame('SINGLE');
      return;
    }

    clearInterval(mainIntervalRef.current);
    setCurrentTarget(1);
    currentTargetRef.current = 1;
    elapsedSecondsRef.current = 0;
    myFinalTimeRef.current = null;
    setDisplayTime('0.00');
    setTimerLabel('시간:');
    setShowCountdown(false);
    setShowResult(false);
    setBoard(Array(9).fill(null));
    setLeaderboard([]);
    setGameState('READY');
    finishDeadlineRef.current = null; 

    if (isHost) {
      await update(ref(db, `rooms/${roomCode}`), {
        gameState: 'READY',
        finishDeadline: null
      });
      
      await update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        target: 1,
        timer: '0.00',
        board: JSON.stringify(Array(9).fill(null)),
        serverVerifiedFinishTime: null
      });
    } else {
      await update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        target: 1,
        timer: '0.00',
        board: JSON.stringify(Array(9).fill(null)),
        serverVerifiedFinishTime: null
      });
    }
  };

  const handleBackToLobby = async () => {
    clearInterval(mainIntervalRef.current);

    if (gameMode === 'MULTI' && roomCode) {
      // 💡 [버그 픽스 완료] code -> roomCode, targetPNum -> myPlayerNum 으로 올바르게 변수명 매칭 완료
      const myPlayerRef = ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`);
      onDisconnect(myPlayerRef).cancel(); 

      if (isHost) {
        await remove(ref(db, `rooms/${roomCode}`)); 
      } else {
        await remove(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`)); 
      }
    }

    setIsGameStarted(false);
    setScreen('LOBBY');
    setGameMode('SINGLE');
    setRoomCode('');
    setJoinInput('');
    setMyPlayerNum(1);
    setIsHost(false);
    setCurrentTarget(1);
    currentTargetRef.current = 1;
    setBoard(Array(9).fill(null));
    setDisplayTime('0.00');
    setTimerLabel('시간:');
    setShowCountdown(false);
    setShowResult(false);
    setLeaderboard([]);
    setGameState('READY');
    setAllPlayerBoards({});
    setGlobalGameState('READY');
    finishDeadlineRef.current = null;
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showCountdown || myFinalTimeRef.current !== null || screen !== 'GAME') return;
      let idx = numpadMap[e.code] !== undefined ? numpadMap[e.code] : regularKeyMap[e.code];
      
      const currentBoard = boardRef.current;

      if (idx !== undefined && currentBoard[idx] !== null) {
        if (currentBoard[idx] === currentTargetRef.current) {
          setActiveTileIdx(idx); 
          setTimeout(() => setActiveTileIdx(null), 80);
          handleTileClick(idx, currentBoard[idx]);
        } else {
          handleTileClick(idx, currentBoard[idx]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCountdown, currentTarget, screen, gameState]);

  const formatFinalScoreDisplay = (player) => {
    let rawTimer = parseFloat(player.timer);
    const countBroken = player.target > MAX_NUMBER ? MAX_NUMBER : player.target - 1;

    if (isNaN(rawTimer) || rawTimer > 1000000 || rawTimer === 0) {
      return `${countBroken}개 제거 (탈락)`;
    }
    return player.target > MAX_NUMBER ? `${rawTimer.toFixed(2)}초 (완주)` : `${countBroken}개 제거 (${rawTimer.toFixed(2)}초) [탈락]`;
  };

  const renderedGrid = useMemo(() => {
    return board.map((val, idx) => (
      <div key={idx} 
        className={`tile ${val === null ? 'empty' : ''} ${wrongTileIdx === idx ? 'wrong' : ''} ${activeTileIdx === idx ? 'active' : ''}`}
        onClick={() => val !== null && handleTileClick(idx, val)}
      >
        {val}
        {val !== null && <span className="key-hint">N{hintNumbers[idx]}</span>}
      </div>
    ));
  }, [board, wrongTileIdx, activeTileIdx]);

  return (
    <div className={`app-container ${isFlash ? 'penalty-flash' : ''}`}>
      {showCountdown && <div className="countdown-overlay">{countdownText}</div>}
      
      {showResult && (
        <div className="result-modal">
          <div className="result-box">
            <div className="result-title">{gameMode === 'SINGLE' ? '⏱️ 싱글 도전 완료!' : '🏆 최종 배틀 결과'}</div>
            <div className="final-rank-list">
              {gameMode === 'SINGLE' ? (
                <div className="rank-item is-me" style={{fontSize: '1.3rem', padding: '15px 5px'}}>
                  <span>{nickname} 님 기록</span> <span>{displayTime}초</span>
                </div>
              ) : (
                leaderboard.map((player, idx) => (
                  <div key={idx} className={`rank-item ${player.pNum === myPlayerNum ? 'is-me' : ''}`}>
                    <span>{idx + 1}등. {player.name} {player.pNum === myPlayerNum ? '(나)' : ''}</span>
                    <span>{formatFinalScoreDisplay(player)}</span>
                  </div>
                ))
              )}
            </div>
            
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              {gameMode === 'SINGLE' ? (
                <button className="lobby-btn btn-single" style={{ width: '100%' }} onClick={handleExecuteReplay}>다시하기</button>
              ) : isHost ? (
                <button className="lobby-btn btn-create" style={{ width: '100%' }} onClick={handleExecuteReplay}>다시하기</button>
              ) : (
                <button 
                  className={`lobby-btn ${globalGameState === 'READY' ? 'btn-create' : ''}`} 
                  style={{ 
                    width: '100%', 
                    backgroundColor: globalGameState === 'READY' ? '' : '#cbd5e1', 
                    color: globalGameState === 'READY' ? '' : '#94a3b8',
                    cursor: globalGameState === 'READY' ? 'pointer' : 'not-allowed'
                  }} 
                  disabled={globalGameState !== 'READY'}
                  onClick={handleExecuteReplay}
                >
                  {globalGameState === 'READY' ? '다시하기' : '방장 대기중...'}
                </button>
              )}
              
              <button className="lobby-btn btn-join" style={{ width: '100%', backgroundColor: '#dc3545' }} onClick={handleBackToLobby}>나가기</button>
            </div>
          </div>
        </div>
      )}

      <div className="audio-control-header">
        <h1>Count-Up</h1>
        <div className="audio-btn-row">
          <button onClick={toggleBgm} className={`audio-toggle-btn ${isBgmOn ? 'on' : 'off'}`}>
            {isBgmOn ? '🔊 BGM ON' : '🔇 BGM OFF'}
          </button>
          <button onClick={() => setIsSfxOn(!isSfxOn)} className={`audio-toggle-btn ${isSfxOn ? 'on' : 'off'}`}>
            {isSfxOn ? '🔊 SFX ON' : '🔇 SFX OFF'}
          </button>
        </div>
      </div>

      {screen === 'LOBBY' ? (
        <div id="lobby-screen">
          <div className="nickname-container">
            <span className="nickname-label">👤 나의 닉네임:</span>
            <input type="text" className="nickname-input" value={nickname} onChange={handleNicknameChange} placeholder="닉네임 입력 (최대10자)" />
          </div>

          <div className="lobby-row">
            <div className="lobby-section">
              <div className="section-title">혼자 하기</div>
              <button className="lobby-btn btn-single" onClick={startSingleMode}>싱글 플레이 (기록)</button>
            </div>
            <div className="v-line"></div>
            <div className="lobby-section">
              <div className="section-title">같이 하기 (최대 10인)</div>
              <button className="lobby-btn btn-create" onClick={createRoom}>방 만들기 (방장)</button>
              <div className="join-box">
                <input type="text" className="join-input" placeholder="CODE" maxLength="5" value={joinInput} onChange={(e) => setJoinInput(e.target.value)} />
                <button 
                  className="lobby-btn btn-join" 
                  style={{width: 'auto', padding: '10px 20px', backgroundColor: isJoining ? '#6c757d' : '', cursor: isJoining ? 'not-allowed' : 'pointer'}} 
                  onClick={joinRoom}
                  disabled={isJoining}
                >
                  {isJoining ? '입장중...' : '입장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div id="game-screen">
          <div className="room-header">
            <div className="room-tag">{gameMode === 'SINGLE' ? 'MODE: SINGLE' : `ROOM: ${roomCode}`}</div>
            <div className="room-tag" style={{backgroundColor: gameMode === 'SINGLE' ? '#ff9f43' : isHost ? '#007bff' : '#e83e8c'}}>
              {gameMode === 'SINGLE' ? `${nickname} (싱글)` : `${nickname} (PLAYER ${myPlayerNum}${isHost ? '/방장' : ''})`}
            </div>
            {isHost && gameState === 'READY' && !showCountdown && !showResult && (
              <button id="start-btn" onClick={broadcastStartSignal}>GAME START</button>
            )}
          </div>

          <div className="game-layout">
            <div className="my-area">
              <div className="dashboard">
                <div id="info">나의 타겟: <span style={{color: '#007bff', fontSize: '1.4rem'}}>{currentTarget <= MAX_NUMBER ? currentTarget : 'Clear!'}</span></div>
                <div className="timer-container"><span>{timerLabel}</span> <span>{displayTime}</span>초</div>
              </div>
              
              <div className="grid-container">
                {renderedGrid}
              </div>
            </div>

            {gameMode === 'MULTI' && (
              <div className="side-multi-area">
                <div className="leaderboard-area">
                  <div className="board-title">실시간 순위상황</div>
                  {leaderboard.map((player, idx) => {
                    const isCleared = player.target > MAX_NUMBER;
                    const countBroken = isCleared ? MAX_NUMBER : player.target - 1; 
                    const progress = (countBroken / MAX_NUMBER) * 100;
                    
                    let displayTimeRaw = parseFloat(player.timer);
                    let safeTimerStr = isNaN(displayTimeRaw) || displayTimeRaw > 1000000 ? "0.00" : displayTimeRaw.toFixed(2);

                    return (
                      <div key={idx} className={`player-row ${player.pNum === myPlayerNum ? 'is-me' : ''}`}>
                        <div className="player-info-text">
                          <span>{idx + 1}등. {player.name} {player.pNum === myPlayerNum ? '(나)' : ''}</span>
                          <span className="progress-counter">{countBroken} / {MAX_NUMBER} 개 ({safeTimerStr}초)</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{width: `${progress}%`, backgroundColor: player.pNum === myPlayerNum ? '#007bff' : '#28a745'}}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="minimaps-area">
                  <div className="board-title" style={{marginTop: '10px'}}>실시간 미니 뷰어</div>
                  <div className="minimaps-grid">
                    {leaderboard
                      .filter(player => player.pNum !== myPlayerNum) 
                      .map((player, idx) => {
                        const oppBoard = allPlayerBoards[player.pNum] || Array(9).fill(null);
                        const isCleared = player.target > MAX_NUMBER;
                        return (
                          <div key={idx} className="minimap-card">
                            <div className="minimap-name">{player.name} ({isCleared ? 'FINISH' : `${player.target - 1}개`})</div>
                            <div className="mini-grid">
                              {oppBoard.map((val, sIdx) => (
                                <div key={sIdx} className={`mini-tile ${val === null ? 'empty' : ''}`}>
                                  {val}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    {leaderboard.length <= 1 && <div className="no-opponents">다른 플레이어가 입장하면<br/>여기에 실시간 화면이 보입니다.</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}