import { Socket, Server as SocketIOServer } from 'socket.io';
import { logger } from '../../utils/logger.util';
import { cleanupUserPresence, getUsersInRoom, updateUserActivity } from '../../utils/presence.util';

interface SocketData {
  user?: {
    id: string;
    name: string;
    email?: string;
    avatar?: string;
    subscriptionPlan: string;
    isAnonymous?: boolean;
  };
  currentRoom?: string;
  disconnectingRooms?: string[];
}

export const registerConnectionHandlers = (io: SocketIOServer, socket: Socket): void => {
  // Handle disconnecting event to capture rooms before they're cleared
  socket.on('disconnecting', () => {
    try {
      const socketData = socket.data as SocketData;
      // Store rooms for use in disconnect handler
      socketData.disconnectingRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
      
      logger.debug(`Socket ${socket.id} disconnecting from rooms:`, socketData.disconnectingRooms);
    } catch (error) {
      logger.error('Error handling disconnecting:', error);
    }
  });

  // Enhanced disconnect handler with presence cleanup
  socket.on('disconnect', async (reason: string) => {
    try {
      const socketData = socket.data as SocketData;
      const userId = socketData.user?.id;
      
      if (!userId) {
        logger.info(`Anonymous socket ${socket.id} disconnected: ${reason}`);
        return;
      }

      // Get rooms from disconnecting event or current room
      const affectedRooms = socketData.disconnectingRooms || (socketData.currentRoom ? [socketData.currentRoom] : []);
      
      // Clean up user presence from all rooms
      const cleanedRooms = await cleanupUserPresence(userId, socket.id);
      
      // Notify rooms of user departure
      for (const roomId of [...new Set([...affectedRooms, ...cleanedRooms])]) {
        try {
          const updatedUsers = await getUsersInRoom(roomId);
          socket.to(roomId).emit('user-left', {
            roomId,
            userId,
            updatedUserList: updatedUsers,
          });
        } catch (error) {
          logger.error(`Error notifying room ${roomId} of user departure:`, error);
        }
      }
      
      logger.info(`User ${userId} (socket ${socket.id}) disconnected from ${cleanedRooms.length} rooms: ${reason}`);
    } catch (error) {
      logger.error('Error handling disconnect:', error);
    }
  });

  // Enhanced error handler with context logging and user notification
  socket.on('error', (error: Error) => {
    try {
      const socketData = socket.data as SocketData;
      const userId = socketData.user?.id;
      
      logger.error('Socket error:', {
        socketId: socket.id,
        userId,
        error: error.message,
        stack: error.stack,
      });
      
      // Emit user-friendly error notification
      socket.emit('notification', {
        type: 'error',
        message: 'Connection error occurred. Please try refreshing the page.',
        timestamp: new Date().toISOString(),
      });
    } catch (handlerError) {
      logger.error('Error in error handler:', handlerError);
    }
  });

  // Heartbeat mechanism for connection health tracking
  socket.on('heartbeat', async () => {
    try {
      const socketData = socket.data as SocketData;
      const userId = socketData.user?.id;
      const currentRoom = socketData.currentRoom;
      
      // Update user activity in Redis if in a room
      if (userId && currentRoom) {
        await updateUserActivity(userId, currentRoom);
      }
      
      // Respond with heartbeat acknowledgment
      socket.emit('heartbeat-ack', {
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error handling heartbeat:', error);
    }
  });

  // Handle ping-pong for connection health
  socket.on('ping', () => {
    socket.emit('pong');
  });
};