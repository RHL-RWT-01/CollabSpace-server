import { Socket, Server as SocketIOServer } from 'socket.io';
import { ChatHandler } from '../../handlers/chat.handler';

let chatHandler: ChatHandler;

export const registerChatHandlers = (
  io: SocketIOServer,
  socket: Socket
): void => {
  // Initialize chat handler if not already done
  if (!chatHandler) {
    chatHandler = new ChatHandler(io);
  }

  // Delegate to the ChatHandler class
  chatHandler.handleConnection(socket);
};
