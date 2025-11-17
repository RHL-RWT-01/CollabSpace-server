import crypto from 'crypto';
import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { redisClient } from '../config/database';
import { User } from '../models/User.model';
import { verifyToken } from '../utils/jwt.util';
import { logger } from '../utils/logger.util';
import { getSession } from '../utils/redis.util';
import { registerChatHandlers } from './handlers/chat.handler';
import { registerConnectionHandlers } from './handlers/connection.handler';
import { registerRoomHandlers } from './handlers/room.handler';
import { registerStickyNoteHandlers } from './handlers/sticky-note.handler';
import { registerWebRTCHandlers } from './handlers/webrtc.handler';
import { registerWhiteboardHandlers } from './handlers/whiteboard.handler';

let io: SocketIOServer;

export const initializeSocket = (httpServer: HTTPServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Enhanced authentication middleware
  io.use(async (socket, next) => {
    try {
      // Connection rate limiting per IP
      const clientIP = socket.handshake.address;
      const connLimitKey = `connlimit:${clientIP}`;

      try {
        const current = await redisClient.incr(connLimitKey);
        if (current === 1) {
          await redisClient.expire(connLimitKey, 60);
        }
        if (current > 10) {
          return next(new Error('Too many connection attempts'));
        }
      } catch (redisError) {
        logger.warn('Redis connection limiting failed:', redisError);
      }

      // Token extraction with priority order
      const token =
        socket.handshake.auth.token ||
        (socket.handshake.query.token as string) ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        // Generate unique anonymous ID
        const anonymousId = crypto.randomUUID();
        socket.data.user = {
          id: anonymousId,
          name: `Anonymous-${anonymousId.slice(0, 8)}`,
          isAnonymous: true,
        };
        logger.info(`Anonymous connection: ${socket.id} (${clientIP})`);
        return next();
      }

      // Verify JWT token
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).select('-password');

      if (!user) {
        return next(new Error('User not found'));
      }

      // Optional session validation in Redis
      try {
        const session = await getSession(user.id, decoded.sessionId);
        if (!session) {
          logger.warn(
            `Session not found for user ${user.id}, allowing connection`
          );
        }
      } catch (sessionError) {
        logger.warn('Session validation failed:', sessionError);
      }

      socket.data.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        subscriptionPlan: user.subscriptionPlan,
        isAnonymous: false,
      };

      logger.info(
        `Authenticated connection: ${socket.id} for user ${user.id} (${clientIP})`,
        {
          transport: socket.conn.transport.name,
          userAgent: socket.handshake.headers['user-agent'],
        }
      );

      next();
    } catch (error: any) {
      logger.error('Socket authentication failed:', {
        socketId: socket.id,
        error: error.message,
        ip: socket.handshake.address,
      });

      if (error.name === 'JsonWebTokenError') {
        return next(new Error('Invalid token'));
      } else if (error.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      } else {
        return next(new Error('Authentication failed'));
      }
    }
  });

  // Enhanced connection handler
  io.on('connection', (socket) => {
    logger.info('New socket connection:', {
      socketId: socket.id,
      userId: socket.data.user?.id || 'anonymous',
      transport: socket.conn.transport.name,
    });

    // Emit connection confirmation
    socket.emit('connected', {
      socketId: socket.id,
      userId: socket.data.user?.id || 'anonymous',
      serverTime: new Date().toISOString(),
      isReconnection: false, // Will be enhanced with reconnection detection
    });

    // Register all event handlers
    registerConnectionHandlers(io, socket);
    registerRoomHandlers(io, socket);
    registerWhiteboardHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerWebRTCHandlers(io, socket);
    registerStickyNoteHandlers(io, socket);
  });

  // Note: For multi-instance deployments, configure Redis adapter:
  // io.adapter(createAdapter(pubClient, subClient))

  logger.info('Socket.IO server initialized');
  return io;
};

export const getSocketIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

export { io };
