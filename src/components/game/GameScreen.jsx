import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ref, onValue, update, remove, get, serverTimestamp, set, onDisconnect } from 'firebase/database';
import { db } from '../../services/firebase';
import { MAX_NUMBER, numpadMap, regularKeyMap, hintNumbers } from '../../constants/gameConstants';

export default function GameScreen({ 
  nickname, gameConfig, onBack, playSound, updateBgmState, setIsFlashOut 
}) {
  const { mode, isHost, roomCode, myPlayerNum } = gameConfig;

  const [isGameStarted, setIsGameStarted] = useState(false);
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

  const [gameState, setGameState] = useState('READY'); 
  const [globalGameState, setGlobalGameState] = useState('READY'); 

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

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    const offsetRef = ref(db, ".info/serverTimeOffset");
    const unsubscribe = onValue(offsetRef, (snapshot) => {
      serverTimeOffsetRef.current = snapshot.val() || 0;
    });
    return () => unsubscribe();
  }, []);

  const getServerTime = () => Date.now() + serverTimeOffsetRef.current;

  useEffect(() => {
    updateBgmState(gameState, 'GAME');
  }, [gameState, updateBgmState]);

  // Init Game on Mount
  useEffect(() => {
    initGame(mode);
    return () => clearInterval(mainIntervalRef.current);
  }, []);

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

  const initGame = (currentMode) => {
    if (nextNumbersPoolRef.current.length > 0 && currentMode === 'SINGLE') return; 

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

    if (currentMode === 'SINGLE') {
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

    if (mode === 'MULTI') {
      update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        board: JSON.stringify(firstSet)
      });
    }
  };

  const broadcastStartSignal = () => {
    if (gameState !== 'READY') return;
    setIsGameStarted(true); 

    const now = getServerTime();
    const countdownStart = now + 100;
    const gameStart = countdownStart + 3000;
    const matchSeed = Math.floor(Math.random() * 1000000) + 1;

    if (mode === 'MULTI') {
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
      const now = getServerTime();

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

          if (mode === 'MULTI' && now - lastDbUpdateTime > 500) {
            update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), { timer: formatted });
            lastDbUpdateTime = now; 
          }
        }
      }
    }, 40); 
  };

  const saveMyBestRecord = async (finalTime) => {
    const recordRef = ref(db, `singleRankings/${nickname}`);
    const snapshot = await get(recordRef);
    const currentBest = snapshot.val();
    if (!currentBest || parseFloat(finalTime) < currentBest.time) {
      await set(recordRef, { name: nickname, time: parseFloat(finalTime), timestamp: serverTimestamp() });
    }
  };

  const handleTileClick = (index, value) => {
    if (showCountdown || !isGameStarted || myFinalTimeRef.current !== null) return;
    if (gameState !== 'RUNNING') {
      if (gameState === 'READY') setGameState('RUNNING');
      else return;
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
        if (mode === 'MULTI') {
          update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
            target: nextTarget, board: JSON.stringify(newBoard)
          });
        }
        return newBoard;
      });

      if (nextTarget > MAX_NUMBER) {
        const now = getServerTime();
        const final = (((now - globalStartTimeRef.current) / 1000) + elapsedSecondsRef.current).toFixed(2);
        myFinalTimeRef.current = final;
        setDisplayTime(final);

        if (mode === 'MULTI') {
          update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
            timer: final, serverVerifiedFinishTime: serverTimestamp() 
          });
          onValue(ref(db, `rooms/${roomCode}/finishDeadline`), (snapshot) => {
            if (!snapshot.exists()) {
              set(ref(db, `rooms/${roomCode}/finishDeadline`), now + 5000);
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

      if (mode === 'MULTI') {
        const now = getServerTime();
        const exactElapsed = ((now - globalStartTimeRef.current) / 1000) + elapsedSecondsRef.current;
        update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), { timer: exactElapsed.toFixed(2) });
      }
      setIsFlashOut(true); setTimeout(() => setIsFlashOut(false), 300);
      setWrongTileIdx(index); setTimeout(() => setWrongTileIdx(null), 150);
    }
  };

  useEffect(() => {
    if (mode !== 'MULTI' || !roomCode) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      if (data.gameState === 'STARTING' || data.gameState === 'RUNNING') setIsGameStarted(true); 
      if (data.gameState) setGlobalGameState(data.gameState);
      
      finishDeadlineRef.current = data.finishDeadline || null;

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
            list.push({ pNum, name: p.name, target: p.target || 1, timer: p.timer || '0.00' });
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
  }, [mode, roomCode, gameState, showCountdown]); 

  const handleGameEnd = () => {
    clearInterval(mainIntervalRef.current);
    setGameState('FINISHED'); 
    setShowResult(true);
  };

  const handleExecuteReplay = async () => {
    setIsGameStarted(false);
    if (mode === 'SINGLE') {
      initGame('SINGLE');
      return;
    }

    clearInterval(mainIntervalRef.current);
    setCurrentTarget(1); currentTargetRef.current = 1;
    elapsedSecondsRef.current = 0; myFinalTimeRef.current = null;
    setDisplayTime('0.00'); setTimerLabel('시간:');
    setShowCountdown(false); setShowResult(false);
    setBoard(Array(9).fill(null)); setLeaderboard([]); setGameState('READY');
    finishDeadlineRef.current = null;

    if (isHost) {
      await update(ref(db, `rooms/${roomCode}`), { gameState: 'READY', finishDeadline: null });
      await update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        target: 1, timer: '0.00', board: JSON.stringify(Array(9).fill(null)), serverVerifiedFinishTime: null
      });
    } else {
      await update(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`), {
        target: 1, timer: '0.00', board: JSON.stringify(Array(9).fill(null)), serverVerifiedFinishTime: null
      });
    }
  };

  const handleSingleReset = () => {
    clearInterval(mainIntervalRef.current);
    setIsGameStarted(false); setGameState('READY');
    setShowCountdown(false); setShowResult(false);
    setCurrentTarget(1); currentTargetRef.current = 1;
    elapsedSecondsRef.current = 0; myFinalTimeRef.current = null;
    setDisplayTime('0.00'); setTimerLabel('시간:');
    nextNumbersPoolRef.current = []; 
    setBoard(Array(9).fill(null));
  };

  const handleBackToLobby = async () => {
    clearInterval(mainIntervalRef.current);
    if (mode === 'MULTI' && roomCode) {
      const myPlayerRef = ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`);
      onDisconnect(myPlayerRef).cancel(); 
      if (isHost) await remove(ref(db, `rooms/${roomCode}`)); 
      else await remove(ref(db, `rooms/${roomCode}/players/p${myPlayerNum}`)); 
    }
    onBack();
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showCountdown || !isGameStarted || myFinalTimeRef.current !== null) return;
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
  }, [showCountdown, currentTarget, gameState, isGameStarted]);

  const formatFinalScoreDisplay = (player) => {
    let rawTimer = parseFloat(player.timer);
    const countBroken = player.target > MAX_NUMBER ? MAX_NUMBER : player.target - 1;
    if (isNaN(rawTimer) || rawTimer > 1000000 || rawTimer === 0) return `${countBroken}개 제거 (탈락)`;
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
    <div id="game-screen">
      {showCountdown && <div className="countdown-overlay">{countdownText}</div>}
      {showResult && (
        <div className="result-modal">
          <div className="result-box">
            <div className="result-title">{mode === 'SINGLE' ? '⏱️ 싱글 도전 완료!' : '🏆 최종 배틀 결과'}</div>
            <div className="final-rank-list">
              {mode === 'SINGLE' ? (
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
              {mode === 'SINGLE' ? (
                <button className="lobby-btn btn-single" style={{ width: '100%' }} onClick={handleExecuteReplay}>다시하기</button>
              ) : isHost ? (
                <button className="lobby-btn btn-create" style={{ width: '100%' }} onClick={handleExecuteReplay}>다시하기</button>
              ) : (
                <button className={`lobby-btn ${globalGameState === 'READY' ? 'btn-create' : ''}`} 
                  style={{ width: '100%', backgroundColor: globalGameState === 'READY' ? '' : '#cbd5e1', color: globalGameState === 'READY' ? '' : '#94a3b8', cursor: globalGameState === 'READY' ? 'pointer' : 'not-allowed' }} 
                  disabled={globalGameState !== 'READY'} onClick={handleExecuteReplay}
                >
                  {globalGameState === 'READY' ? '다시하기' : '방장 대기중...'}
                </button>
              )}
              <button className="lobby-btn btn-join" style={{ width: '100%', backgroundColor: '#dc3545' }} onClick={handleBackToLobby}>나가기</button>
            </div>
          </div>
        </div>
      )}

      <div className="room-header">
        <div className="header-row">
          <div className="room-tag">{mode === 'SINGLE' ? 'MODE: SINGLE' : `ROOM: ${roomCode}`}</div>
          <div className="room-tag" style={{backgroundColor: mode === 'SINGLE' ? '#ff9f43' : isHost ? '#007bff' : '#e83e8c'}}>
            {mode === 'SINGLE' ? `${nickname} (싱글)` : `${nickname} (PLAYER ${myPlayerNum}${isHost ? '/방장' : ''})`}
          </div>
        </div>
        {isHost && gameState === 'READY' && !showCountdown && !showResult && (
          <div style={{ marginTop: '10px' }}><button id="start-btn" onClick={broadcastStartSignal}>GAME START</button></div>
        )}
        {mode === 'SINGLE' && (gameState === 'RUNNING' || showCountdown) && !showResult && (
          <div style={{ marginTop: '10px' }}>
            <button onClick={handleSingleReset} style={{ padding: '6px 20px', fontSize: '1rem', fontWeight: 'bold', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
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
          <div className="grid-container">{renderedGrid}</div>
        </div>

        {mode === 'MULTI' && (
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
                {leaderboard.filter(player => player.pNum !== myPlayerNum).map((player, idx) => {
                  const oppBoard = allPlayerBoards[player.pNum] || Array(9).fill(null);
                  const isCleared = player.target > MAX_NUMBER;
                  return (
                    <div key={idx} className="minimap-card">
                      <div className="minimap-name">{player.name} ({isCleared ? 'FINISH' : `${player.target - 1}개`})</div>
                      <div className="mini-grid">
                        {oppBoard.map((val, sIdx) => (
                          <div key={sIdx} className={`mini-tile ${val === null ? 'empty' : ''}`}>{val}</div>
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
  );
}