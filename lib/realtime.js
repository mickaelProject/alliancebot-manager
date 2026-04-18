/**
 * Socket.io instance holder + emit helpers (wired from server bootstrap).
 */

/** @type {import('socket.io').Server | null} */
let io = null;

/**
 * @param {import('socket.io').Server} serverIo
 */
function setIo(serverIo) {
  io = serverIo;
}

function getIo() {
  return io;
}

/**
 * @param {string} type
 * @param {Record<string, unknown>} payload
 */
function emitDashboard(type, payload) {
  if (!io) return;
  io.emit('dashboard', { type, payload: payload || {}, ts: Date.now() });
}

module.exports = { setIo, getIo, emitDashboard };
