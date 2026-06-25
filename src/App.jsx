import { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';

// 💡 파이어베이스 라이브러리
import { initializeApp } from "firebase/app";
import { 
  getDatabase, ref, set, onValue, remove, update, 
  onDisconnect, serverTimestamp, push, query, 
  orderByChild, limitToFirst, get 
} from "firebase/database";

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
  const [isGameStarted, setIsGameStarted] = useState(false); 
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

  const serverTimeOffsetRef = useRef(0);
  
  const boardRef = useRef(Array(9).fill(null));
  const [allPlayerBoards, setAllPlayerBoards] = useState({});
  const [topRankings, setTopRankings] = useState([]);
  const [myRanking, setMyRanking] = useState(null);
  const [showRankingModal, setShowRankingModal] = useState(false);

  useEffect(() => {
    const offsetRef = ref(db, ".info/serverTimeOffset");
    const unsubscribe = onValue(offsetRef, (snapshot) => {
      serverTimeOffsetRef.current = snapshot.val() || 0;
    });
    return () => unsubscribe();
  }, []);

  const getServerTime = () => Date.now() + serverTimeOffsetRef.current;

  useEffect(() => {
    const rankQuery = query(ref(db, 'singleRankings'), orderByChild('time'));
    
    const unsubscribe = onValue(rankQuery, (snapshot) => {
      const list = [];
      snapshot.forEach((childSnap) => {
        list.push(childSnap.val());
      });
      
      setTopRankings(list.slice(0, 10));

      const myBestIndex = list.findIndex(r => r.name === nickname);
      
      if (myBestIndex !== -1) {
        setMyRanking({
          rank: myBestIndex + 1,
          time: list[myBestIndex].time
        });
      } else {
        setMyRanking(null);
      }
    });

    return () => unsubscribe();
  }, [nickname]);

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
    if (nextNumbersPoolRef.current.length > 0 && mode === 'SINGLE') {
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
    setIsGameStarted(true); 

    const now = getServerTime(); // 👈 수정: Date.now() 대신 getServerTime() 사용
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
        const now = getServerTime(); // 👈 수정: Date.now() 대신 getServerTime() 사용

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

  // 💡 싱글 모드 최고 기록 저장 함수 (컴포넌트 밖으로 빼서 성능 최적화 및 중첩 문제 해결)
  const saveMyBestRecord = async (finalTime) => {
    const recordRef = ref(db, `singleRankings/${nickname}`);
    const snapshot = await get(recordRef);
    const currentBest = snapshot.val();

    if (!currentBest || parseFloat(finalTime) < currentBest.time) {
      await set(recordRef, {
        name: nickname,
        time: parseFloat(finalTime),
        timestamp: serverTimestamp()
      });
    }
  };

  const handleTileClick = (index, value) => {
    if (showCountdown || !isGameStarted) return;
    if (myFinalTimeRef.current !== null) return;

    if (gameState !== 'RUNNING') {
      if (gameState === 'READY') {
        setGameState('RUNNING'); 
      } else {
        return;
      }
    }

    if (value < currentTargetRef.current) return;

    if (value === currentTargetRef.current) {
      playSound('success');
      
      const nextTarget = currentTargetRef.current + 1;
      currentTargetRef.current = nextTarget; 
      setCurrentTarget(nextTarget);

      let pulledNumber = null;
      if (nextNumbersPoolRef.current.length > 0) {
        pulledNumber = nextNumbersPoolRef.current.shift();
      }

      setBoard(prevBoard => {
        if (prevBoard[index] !== value) return prevBoard; 

        const newBoard = [...prevBoard];
        newBoard[index] = pulledNumber; 

        if (gameMode === 'MULTI') {
          update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
            target: nextTarget,
            board: JSON.stringify(newBoard)
          });
        }
        return newBoard;
      });

      // 💡 종료 처리 로직 (중복 조건문 제거)
      if (nextTarget > MAX_NUMBER) {
        const now = getServerTime(); // 👈 수정: Date.now() 대신 getServerTime() 사용
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
              set(ref(db, `rooms/${roomCode}/finishDeadline`), now + 5000); // 👈 수정: now 사용
            }
          }, { onlyOnce: true });
        } else {
          saveMyBestRecord(final);
        }
        
        handleGameEnd();
      }
    } else {
      playSound('wrong'); 
      elapsedSecondsRef.current += 3; 

      if (gameMode === 'MULTI') {
        const now = getServerTime(); // 👈 수정: Date.now() 대신 getServerTime() 사용
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

      if (data.gameState === 'STARTING' || data.gameState === 'RUNNING') {
        setIsGameStarted(true); 
      }

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
    setIsGameStarted(false);

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

  // 💡 싱글 모드 중간 리셋 함수
  const handleSingleReset = () => {
    clearInterval(mainIntervalRef.current);
    setIsGameStarted(false);
    setGameState('READY');
    setShowCountdown(false);
    setShowResult(false);
    setCurrentTarget(1);
    currentTargetRef.current = 1;
    elapsedSecondsRef.current = 0;
    myFinalTimeRef.current = null;
    setDisplayTime('0.00');
    setTimerLabel('시간:');
    
    // GAME START 클릭 시 새로운 보드가 정상 생성되도록 풀 비우기
    nextNumbersPoolRef.current = []; 
    setBoard(Array(9).fill(null));
  };

  const handleBackToLobby = async () => {
    clearInterval(mainIntervalRef.current);

    if (gameMode === 'MULTI' && roomCode) {
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
      if (showCountdown || !isGameStarted || myFinalTimeRef.current !== null || screen !== 'GAME') return;
      
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

      {showRankingModal && (
        <div className="result-modal" style={{ zIndex: 30 }} onClick={() => setShowRankingModal(false)}>
          <div className="result-box" style={{ width: '90%', maxWidth: '380px', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="result-title" style={{ fontSize: '1.5rem', marginBottom: '15px' }}>🏆 싱글 명예의 전당</div>
            
            <div className="final-rank-list" style={{ width: '100%', marginBottom: '0' }}>
              {topRankings.slice(0, 10).map((rank, idx) => (
                <div key={idx} className={`rank-item ${rank.name === nickname ? 'is-me' : ''}`} style={{ padding: '10px 15px', marginBottom: '6px' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{marginRight: '5px'}}>{idx + 1}위.</strong> {rank.name}
                  </span>
                  <span style={{ flexShrink: 0 }}>{rank.time.toFixed(2)}초</span>
                </div>
              ))}

              {myRanking && myRanking.rank > 10 && (
                <>
                  <div style={{ textAlign: 'center', color: '#adb5bd', margin: '5px 0', fontSize: '1.2rem', lineHeight: '0.5' }}>⋮</div>
                  <div className="rank-item is-me" style={{ padding: '10px 15px' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{marginRight: '5px'}}>{myRanking.rank}위.</strong> {nickname} (나)
                    </span>
                    <span style={{ flexShrink: 0 }}>{myRanking.time.toFixed(2)}초</span>
                  </div>
                </>
              )}
            </div>

            <button className="lobby-btn btn-single" style={{ marginTop: '20px', width: '100%', background: '#6c757d' }} onClick={() => setShowRankingModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
      
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

              <div 
                className="single-ranking-box" 
                onClick={() => setShowRankingModal(true)}
                style={{ cursor: 'pointer', marginTop: '20px', background: '#f8f9fa', padding: '15px', borderRadius: '10px', textAlign: 'left', fontSize: '0.9rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)', transition: 'all 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '10px', color: '#333', textAlign: 'center', whiteSpace: 'nowrap', letterSpacing: '-0.5px' }}>
                  🏆 싱글 명예의 전당 (Top 3)
                </div>
                
                {topRankings.length === 0 ? (
                  <div style={{ color: '#888', textAlign: 'center', padding: '10px 0' }}>아직 등록된 기록이 없습니다.</div>
                ) : (
                  <>
                    {topRankings.slice(0, 3).map((rank, idx) => (
                      <div key={idx} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '6px 5px', 
                        borderBottom: idx === Math.min(topRankings.length, 3) - 1 ? 'none' : '1px solid #e2e8f0',
                        backgroundColor: rank.name === nickname ? '#e6f2ff' : 'transparent',
                        fontWeight: rank.name === nickname ? 'bold' : 'normal',
                        borderRadius: '5px'
                      }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '10px' }}>
                          <strong style={{color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#64748b', marginRight: '5px'}}>
                            {idx + 1}위.
                          </strong> 
                          {rank.name}
                        </span>
                        <span style={{ color: '#007bff', flexShrink: 0 }}>{rank.time.toFixed(2)}초</span>
                      </div>
                    ))}
                    
                    <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '0.8rem', color: '#6c757d', fontWeight: 'bold' }}>
                      터치하여 전체 순위 보기 👆
                    </div>
                  </>
                )}
              </div>
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
            <div className="header-row">
              <div className="room-tag">{gameMode === 'SINGLE' ? 'MODE: SINGLE' : `ROOM: ${roomCode}`}</div>
              <div className="room-tag" style={{backgroundColor: gameMode === 'SINGLE' ? '#ff9f43' : isHost ? '#007bff' : '#e83e8c'}}>
                {gameMode === 'SINGLE' ? `${nickname} (싱글)` : `${nickname} (PLAYER ${myPlayerNum}${isHost ? '/방장' : ''})`}
              </div>
            </div>
            
            {isHost && gameState === 'READY' && !showCountdown && !showResult && (
              <div style={{ marginTop: '10px' }}>
                <button id="start-btn" onClick={broadcastStartSignal}>GAME START</button>
              </div>
            )}

            {/* 💡 새로 추가된 싱글 모드 리셋 버튼 */}
              {gameMode === 'SINGLE' && (gameState === 'RUNNING' || showCountdown) && !showResult && (
                <div style={{ marginTop: '10px' }}>
                  <button 
                    onClick={handleSingleReset} 
                    style={{
                      padding: '6px 20px', 
                      fontSize: '1rem', 
                      fontWeight: 'bold', 
                      backgroundColor: '#6c757d', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '5px', 
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    🔄 리셋 (다시하기)
                  </button>
                </div>
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