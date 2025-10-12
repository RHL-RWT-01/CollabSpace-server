import { Socket, Server as SocketIOServer } from 'socket.io';
import { StickyNoteHandler } from '../../handlers/sticky-note.handler';

let stickyNoteHandler: StickyNoteHandler;

export const registerStickyNoteHandlers = (
  io: SocketIOServer,
  socket: Socket
): void => {
  // Initialize sticky note handler if not already done
  if (!stickyNoteHandler) {
    stickyNoteHandler = new StickyNoteHandler(io);
  }

  // Delegate to the StickyNoteHandler class
  stickyNoteHandler.handleConnection(socket);
};
