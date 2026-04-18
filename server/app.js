/**
 * HTTP + Socket.io : session avant l’API, SPA planning React servie sur `/`.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { config } = require('../config');
const { mountDiscordOAuth } = require('../auth/discordOAuth');
const { isAuthenticated } = require('../auth/middleware');
const { createLogger } = require('../lib/logger');
const { setIo } = require('../lib/realtime');
const { wireRealtime } = require('./realtimeWire');
const { apiRouter } = require('./api');
const { renderLoginPage } = require('./loginPage');

const log = createLogger('web');
const rootDir = path.join(__dirname, '..');
const webIndex = path.join(rootDir, 'public', 'web', 'index.html');

/** @type {import('http').Server | null} */
let httpServer = null;
/** @type {import('socket.io').Server | null} */
let ioServer = null;

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    log.info('http_request', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(requestLogger);

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'absid',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use('/api', apiRouter);

  app.get('/login', (req, res) => {
    if (isAuthenticated(req)) return res.redirect('/');
    res.type('html').send(renderLoginPage());
  });

  mountDiscordOAuth(app);

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.use(express.static(path.join(rootDir, 'public'), { index: false }));

  app.use((req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    if (req.path === '/login') return next();
    if (req.path.startsWith('/socket.io')) return next();
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/assets/')) return next();
    if (!isAuthenticated(req)) {
      return res.redirect('/login');
    }
    return next();
  });

  app.use(express.static(path.join(rootDir, 'public', 'web'), { index: false }));

  function serveSpaIndex(req, res) {
    if (!fs.existsSync(webIndex)) {
      return res
        .status(503)
        .type('html')
        .send(
          '<p>Build frontend manquant. Exécutez <code>npm run build:web</code> puis relancez.</p>'
        );
    }
    return res.sendFile(webIndex);
  }

  app.get('/', serveSpaIndex);
  app.get('/admin', serveSpaIndex);

  return app;
}

function startWebServer() {
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: false },
  });
  setIo(io);
  wireRealtime();
  ioServer = io;
  httpServer = server;

  return new Promise((resolve, reject) => {
    server.listen(config.port, () => {
      log.info('http_listen', { port: config.port, sockets: true });
      resolve({ server, io });
    });
    server.on('error', (err) => {
      log.error('http_error', { message: err.message });
      reject(err);
    });
  });
}

function shutdownHttp() {
  return new Promise((resolve) => {
    try {
      ioServer?.close();
    } catch {
      /* ignore */
    }
    ioServer = null;
    if (httpServer) {
      httpServer.close(() => resolve());
      httpServer = null;
    } else {
      resolve();
    }
  });
}

module.exports = { createApp, startWebServer, shutdownHttp };
