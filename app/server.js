const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// In production, restrict Socket.IO CORS to the app's own origin
const corsOrigin = process.env.NODE_ENV === 'production'
  ? (process.env.NEXTAUTH_URL || 'http://localhost:3000')
  : '*';

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  });

  global.io = io;

  io.on('connection', (socket) => {
    socket.on('join', (uploadId) => {
      socket.join(uploadId);
    });
  });

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });

  // Graceful shutdown — give in-flight requests up to 10s to finish
  const shutdown = () => {
    console.log('> Shutting down...');
    httpServer.close(() => {
      console.log('> HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
