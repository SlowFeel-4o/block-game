import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve(process.cwd(), 'leaderboard-data.json');

// Default starter leaderboard if no saved data exists
const DEFAULT_LEADERBOARD = [
  { id: 'bot-1', name: 'Александр', username: 'alex_cube', bestScore: 3420, updatedAt: Date.now() - 86400000 * 2 },
  { id: 'bot-2', name: 'Екатерина', username: 'kate_star', bestScore: 2890, updatedAt: Date.now() - 86400000 },
  { id: 'bot-3', name: 'Максим', username: 'max_master', bestScore: 2410, updatedAt: Date.now() - 3600000 * 5 },
  { id: 'bot-4', name: 'София', username: 'sofia_p', bestScore: 1980, updatedAt: Date.now() - 3600000 * 2 },
  { id: 'bot-5', name: 'Артём', username: 'artem_88', bestScore: 1650, updatedAt: Date.now() - 1800000 },
  { id: 'bot-6', name: 'Даниил', username: 'daniil_top', bestScore: 1420, updatedAt: Date.now() - 600000 }
];

function loadLeaderboard() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Failed to load leaderboard file, using defaults:', e);
  }
  return [...DEFAULT_LEADERBOARD];
}

function saveLeaderboard(leaderboard) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(leaderboard, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to save leaderboard file:', e);
  }
}

export function setupRealtime(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Server state
  let leaderboard = loadLeaderboard();
  const clients = new Map(); // ws -> player object

  function getOnlineList() {
    return Array.from(clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      username: p.username || '',
      currentScore: p.currentScore || 0,
      bestScore: p.bestScore || 0,
      joinedAt: p.joinedAt || Date.now()
    }));
  }

  function broadcast(msg, excludeWs = null) {
    const data = JSON.stringify(msg);
    for (const [ws, _] of clients) {
      if (ws !== excludeWs && ws.readyState === ws.OPEN) {
        try {
          ws.send(data);
        } catch (e) {}
      }
    }
  }

  function updateLeaderboard(player) {
    if (!player || !player.id) return false;
    const score = Math.max(player.bestScore || 0, player.currentScore || 0);
    if (score <= 0) return false;

    let existing = leaderboard.find(e => e.id === player.id);
    let changed = false;

    if (existing) {
      if (score > existing.bestScore) {
        existing.bestScore = score;
        existing.name = player.name || existing.name;
        existing.username = player.username || existing.username;
        existing.updatedAt = Date.now();
        changed = true;
      }
    } else {
      leaderboard.push({
        id: player.id,
        name: player.name || 'Игрок',
        username: player.username || '',
        bestScore: score,
        updatedAt: Date.now()
      });
      changed = true;
    }

    if (changed) {
      leaderboard.sort((a, b) => b.bestScore - a.bestScore);
      if (leaderboard.length > 50) leaderboard = leaderboard.slice(0, 50);
      saveLeaderboard(leaderboard);
      broadcast({ type: 'leaderboard:updated', payload: leaderboard });
    }

    return changed;
  }

  wss.on('connection', (ws) => {
    let clientPlayer = null;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return;
      }

      if (!data || !data.type) return;

      switch (data.type) {
        case 'join': {
          const payload = data.payload || {};
          const id = payload.id || 'usr_' + Math.random().toString(36).substring(2, 9);
          const name = (payload.name && payload.name.trim()) || 'Игрок #' + id.slice(-4);
          const username = (payload.username && payload.username.trim()) || '';
          const currentScore = Number(payload.currentScore) || 0;
          const bestScore = Number(payload.bestScore) || 0;

          clientPlayer = {
            id,
            name,
            username,
            currentScore,
            bestScore,
            joinedAt: Date.now()
          };

          clients.set(ws, clientPlayer);

          // Check if this player updates the leaderboard with their best score
          updateLeaderboard(clientPlayer);

          // Send full current state to newly connected client
          ws.send(JSON.stringify({
            type: 'init',
            payload: {
              selfId: id,
              online: getOnlineList(),
              leaderboard: leaderboard
            }
          }));

          // Notify others of joined user
          broadcast({
            type: 'user:joined',
            payload: {
              id,
              name,
              username,
              currentScore,
              bestScore,
              joinedAt: clientPlayer.joinedAt
            }
          }, ws);
          break;
        }

        case 'score:update': {
          if (!clientPlayer) return;
          const payload = data.payload || {};
          if (typeof payload.currentScore === 'number') {
            clientPlayer.currentScore = payload.currentScore;
          }
          if (typeof payload.bestScore === 'number' && payload.bestScore > clientPlayer.bestScore) {
            clientPlayer.bestScore = payload.bestScore;
          }

          updateLeaderboard(clientPlayer);

          broadcast({
            type: 'player:updated',
            payload: {
              id: clientPlayer.id,
              currentScore: clientPlayer.currentScore,
              bestScore: clientPlayer.bestScore
            }
          });
          break;
        }

        case 'game:over': {
          if (!clientPlayer) return;
          const payload = data.payload || {};
          const finalScore = Number(payload.finalScore) || clientPlayer.currentScore;
          const bestScore = Number(payload.bestScore) || clientPlayer.bestScore;

          clientPlayer.currentScore = finalScore;
          if (bestScore > clientPlayer.bestScore) {
            clientPlayer.bestScore = bestScore;
          }

          updateLeaderboard(clientPlayer);

          broadcast({
            type: 'player:updated',
            payload: {
              id: clientPlayer.id,
              currentScore: clientPlayer.currentScore,
              bestScore: clientPlayer.bestScore,
              isGameOver: true
            }
          });
          break;
        }

        case 'name:update': {
          if (!clientPlayer) return;
          const newName = (data.payload && data.payload.name && data.payload.name.trim()) || clientPlayer.name;
          if (newName) {
            clientPlayer.name = newName;
            updateLeaderboard(clientPlayer);
            broadcast({
              type: 'player:name_changed',
              payload: {
                id: clientPlayer.id,
                name: clientPlayer.name
              }
            });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (clientPlayer) {
        clients.delete(ws);
        broadcast({
          type: 'user:left',
          payload: { id: clientPlayer.id }
        });
        clientPlayer = null;
      }
    });

    ws.on('error', () => {
      if (clientPlayer) {
        clients.delete(ws);
        broadcast({
          type: 'user:left',
          payload: { id: clientPlayer.id }
        });
        clientPlayer = null;
      }
    });
  });

  // Heartbeat ping interval
  const pingInterval = setInterval(() => {
    for (const [ws, _] of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {}
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}
