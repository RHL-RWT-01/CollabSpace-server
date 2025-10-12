import { Server, Socket } from 'socket.io';
import { StickyNote } from '../types';
import WhiteboardModel from '../models/Whiteboard.model';
import { logger } from '../utils/logger.util';
import { createSocketRateLimiter } from '../middleware/socketRateLimit.middleware';

// Create rate limiters for sticky note events
const rateLimiters = {
  create: createSocketRateLimiter({ maxRequests: 30, windowMs: 60000 }),
  update: createSocketRateLimiter({ maxRequests: 60, windowMs: 60000 }),
  delete: createSocketRateLimiter({ maxRequests: 30, windowMs: 60000 }),
};

export class StickyNoteHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  handleConnection(socket: Socket) {
    logger.info(`User ${socket.data.user?.id} connected for sticky notes`);

    // Handle creating a sticky note with rate limiting
    socket.on(
      'sticky-note:create',
      rateLimiters.create(
        'sticky-note:create',
        async (
          socket: Socket,
          data: { roomId: string; stickyNote: Omit<StickyNote, 'id'> }
        ) => {
          try {
            const { roomId, stickyNote } = data;
            const user = socket.data.user;

            if (!user) {
              socket.emit('error', {
                code: 'UNAUTHORIZED',
                message: 'User not authenticated',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Find the whiteboard for this room
            let whiteboard = await WhiteboardModel.findOne({ roomId });

            if (!whiteboard) {
              // Create a new whiteboard if it doesn't exist
              whiteboard = new WhiteboardModel({
                roomId,
                elements: [],
                appState: {},
                files: {},
              });
            }

            // Generate a unique ID for the sticky note
            const stickyNoteId = `sticky-note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create the sticky note element for Excalidraw
            const stickyNoteElement = {
              id: stickyNoteId,
              type: 'sticky-note',
              x: stickyNote.position.x,
              y: stickyNote.position.y,
              width: 200,
              height: 150,
              angle: 0,
              strokeColor: stickyNote.color,
              backgroundColor: stickyNote.color,
              fillStyle: 'solid',
              strokeWidth: 2,
              strokeStyle: 'solid',
              roughness: 1,
              opacity: 100,
              groupIds: [],
              frameId: null,
              roundness: { type: 'round' },
              seed: Math.floor(Math.random() * 1000000),
              versionNonce: Math.floor(Math.random() * 1000000),
              isDeleted: false,
              boundElements: null,
              updated: Date.now(),
              link: null,
              locked: false,
              customData: {
                content: stickyNote.content,
                userId: user.id,
                userName: user.name,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            };

            // Add the element to the whiteboard
            whiteboard.elements.push(stickyNoteElement);
            await whiteboard.save();

            // Create the sticky note response
            const newStickyNote: StickyNote = {
              id: stickyNoteId,
              content: stickyNote.content,
              position: stickyNote.position,
              color: stickyNote.color,
              userId: user.id,
              userName: user.name,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            // Broadcast to all users in the room
            this.io.to(roomId).emit('sticky-note:created', newStickyNote);

            logger.info(
              `Sticky note created in room ${roomId} by user ${user.id}`
            );
          } catch (error) {
            logger.error('Error creating sticky note:', error);
            socket.emit('error', {
              code: 'STICKY_NOTE_CREATE_FAILED',
              message: 'Failed to create sticky note',
              timestamp: new Date().toISOString(),
            });
          }
        }
      )
    );

    // Handle updating a sticky note with rate limiting
    socket.on(
      'sticky-note:update',
      rateLimiters.update(
        'sticky-note:update',
        async (
          socket: Socket,
          data: { roomId: string; stickyNote: StickyNote }
        ) => {
          try {
            const { roomId, stickyNote } = data;
            const user = socket.data.user;

            if (!user) {
              socket.emit('error', {
                code: 'UNAUTHORIZED',
                message: 'User not authenticated',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Find the whiteboard
            const whiteboard = await WhiteboardModel.findOne({ roomId });

            if (!whiteboard) {
              socket.emit('error', {
                code: 'WHITEBOARD_NOT_FOUND',
                message: 'Whiteboard not found',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Find and update the sticky note element
            const elementIndex = whiteboard.elements.findIndex(
              (el: any) => el.id === stickyNote.id && el.type === 'sticky-note'
            );

            if (elementIndex === -1) {
              socket.emit('error', {
                code: 'STICKY_NOTE_NOT_FOUND',
                message: 'Sticky note not found',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Update the element
            const element = whiteboard.elements[elementIndex];
            element.x = stickyNote.position.x;
            element.y = stickyNote.position.y;
            element.strokeColor = stickyNote.color;
            element.backgroundColor = stickyNote.color;
            element.updated = Date.now();

            if (element.customData) {
              element.customData.content = stickyNote.content;
              element.customData.updatedAt = new Date().toISOString();
            }

            await whiteboard.save();

            // Update the sticky note response
            const updatedStickyNote: StickyNote = {
              ...stickyNote,
              updatedAt: new Date().toISOString(),
            };

            // Broadcast to all users in the room except sender
            socket.to(roomId).emit('sticky-note:updated', updatedStickyNote);

            logger.info(
              `Sticky note updated in room ${roomId} by user ${user.id}`
            );
          } catch (error) {
            logger.error('Error updating sticky note:', error);
            socket.emit('error', {
              code: 'STICKY_NOTE_UPDATE_FAILED',
              message: 'Failed to update sticky note',
              timestamp: new Date().toISOString(),
            });
          }
        }
      )
    );

    // Handle deleting a sticky note with rate limiting
    socket.on(
      'sticky-note:delete',
      rateLimiters.delete(
        'sticky-note:delete',
        async (
          socket: Socket,
          data: { roomId: string; stickyNoteId: string }
        ) => {
          try {
            const { roomId, stickyNoteId } = data;
            const user = socket.data.user;

            if (!user) {
              socket.emit('error', {
                code: 'UNAUTHORIZED',
                message: 'User not authenticated',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Find the whiteboard
            const whiteboard = await WhiteboardModel.findOne({ roomId });

            if (!whiteboard) {
              socket.emit('error', {
                code: 'WHITEBOARD_NOT_FOUND',
                message: 'Whiteboard not found',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Find and remove the sticky note element
            const elementIndex = whiteboard.elements.findIndex(
              (el: any) => el.id === stickyNoteId && el.type === 'sticky-note'
            );

            if (elementIndex === -1) {
              socket.emit('error', {
                code: 'STICKY_NOTE_NOT_FOUND',
                message: 'Sticky note not found',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Check if user owns the sticky note or is admin
            const element = whiteboard.elements[elementIndex];
            if (element.customData?.userId !== user.id) {
              socket.emit('error', {
                code: 'UNAUTHORIZED',
                message: 'Not authorized to delete this sticky note',
                timestamp: new Date().toISOString(),
              });
              return;
            }

            // Remove the element
            whiteboard.elements.splice(elementIndex, 1);
            await whiteboard.save();

            // Broadcast deletion to all users in the room
            this.io
              .to(roomId)
              .emit('sticky-note:deleted', { id: stickyNoteId });

            logger.info(
              `Sticky note deleted in room ${roomId} by user ${user.id}`
            );
          } catch (error) {
            logger.error('Error deleting sticky note:', error);
            socket.emit('error', {
              code: 'STICKY_NOTE_DELETE_FAILED',
              message: 'Failed to delete sticky note',
              timestamp: new Date().toISOString(),
            });
          }
        }
      )
    );

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(
        `User ${socket.data.user?.id} disconnected from sticky notes`
      );
    });
  }
}
