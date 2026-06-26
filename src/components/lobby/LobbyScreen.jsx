import React, { useState, useEffect } from 'react';
import { ref, onValue, set, onDisconnect, query, orderByChild } from 'firebase/database';
import { db } from '../../services/firebase';

export default function LobbyScreen({ nickname, setNickname, onJoinGame }) {
  const [joinInput, setJoinInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [topRankings, setTopRankings] = useState([]);
  const [myRanking, setMyRanking] = useState(null);
  const [showRankingModal, setShowRankingModal] = useState(false);

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
        setMyRanking({ rank: myBestIndex + 1, time: list[myBestIndex].time });
      } else {
        setMyRanking(null);
      }
    });
    return () => unsubscribe();
  }, [nickname]);

  const handleNicknameChange = (e) => {
    const val = e.target.value.slice(0, 10); 
    setNickname(val);
    sessionStorage.setItem('countup_nickname', val);
  };

  const startSingleMode = () => {
    onJoinGame({ mode: 'SINGLE', isHost: true, roomCode: '', myPlayerNum: 1 });
  };

  const createRoom = async () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    
    const roomRef = ref(db, `rooms/${code}`);
    onDisconnect(roomRef).remove();
    await set(roomRef, {
      exists: true,
      gameState: 'READY',
      players: {
        p1: { active: true, name: nickname, target: 1, timer: '0.00', board: JSON.stringify(Array(9).fill(null)) }
      }
    });
    onJoinGame({ mode: 'MULTI', isHost: true, roomCode: code, myPlayerNum: 1 });
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

      const mySlotRef = ref(db, `rooms/${code}/players/p${targetPNum}`);
      onDisconnect(mySlotRef).remove();
      await set(mySlotRef, {
        active: true, name: nickname, target: 1, timer: '0.00', board: JSON.stringify(Array(9).fill(null))
      });

      onJoinGame({ mode: 'MULTI', isHost: false, roomCode: code, myPlayerNum: targetPNum });
      setIsJoining(false); 
    }, { onlyOnce: true });
  };

  return (
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
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 5px', borderBottom: idx === Math.min(topRankings.length, 3) - 1 ? 'none' : '1px solid #e2e8f0',
                    backgroundColor: rank.name === nickname ? '#e6f2ff' : 'transparent',
                    fontWeight: rank.name === nickname ? 'bold' : 'normal', borderRadius: '5px'
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
              onClick={joinRoom} disabled={isJoining}
            >
              {isJoining ? '입장중...' : '입장'}
            </button>
          </div>
        </div>
      </div>

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
    </div>
  );
}