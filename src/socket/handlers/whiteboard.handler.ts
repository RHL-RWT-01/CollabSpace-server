import { Socket, Server as SocketIOServer } from "socket.io";
import Whiteboard from "../../models/Whiteboard.model";
import { logger } from "../../utils/logger.util";

// Rate limiting for updates and cursor movements
const updateRateLimit = new Map<string, number>();
const cursorRateLimit = new Map<string, number>();

// Access control helper function
const checkWhiteboardAccess = async (
  socket: Socket,
  roomId: string,
  userId: string,
  operation: "read" | "write" = "write"
): Promise<boolean> => {
  try {
    // Check if user is in the room
    const userRooms = Array.from(socket.rooms);
    if (!userRooms.includes(roomId)) {
      socket.emit("error", {
        message: "Access denied: Not a member of this room",
        code: "ACCESS_DENIED",
      });
      return false;
    }

    // Check if whiteboard exists and user has access
    const whiteboard = await Whiteboard.findOne({ roomId });
    if (!whiteboard) {
      // Allow creating whiteboard for room members
      if (operation === "read") {
        return true; // Allow reading even if whiteboard doesn't exist yet
      }
      return true; // Allow write operations to create the whiteboard
    }

    // Additional access checks could be added here:
    // - Check if user is room owner/admin
    // - Check if room allows public editing
    // - Check if user has specific whiteboard permissions

    return true;
  } catch (error) {
    logger.error("Error checking whiteboard access:", error);
    socket.emit("error", {
      message: "Access validation failed",
      code: "ACCESS_CHECK_ERROR",
    });
    return false;
  }
};

export const registerWhiteboardHandlers = (
  io: SocketIOServer,
  socket: Socket
): void => {
  // Enhanced whiteboard-update handler with database persistence
  socket.on(
    "whiteboard-update",
    async (data: {
      roomId: string;
      elements: any[];
      appState: any;
      files?: any;
    }) => {
      try {
        const { roomId, elements, appState, files } = data;
        const userId = socket.data.user?.id;

        if (!userId) {
          socket.emit("error", {
            message: "User not authenticated",
            code: "AUTH_ERROR",
          });
          return;
        }

        // Check access control
        const hasAccess = await checkWhiteboardAccess(
          socket,
          roomId,
          userId,
          "write"
        );
        if (!hasAccess) {
          return;
        }

        // Rate limiting: max 10 updates per second per user
        const now = Date.now();
        const userRateKey = `${userId}-${roomId}`;
        const lastUpdate = updateRateLimit.get(userRateKey) || 0;

        if (now - lastUpdate < 100) {
          // 100ms minimum between updates
          socket.emit("error", {
            message: "Update rate limit exceeded",
            code: "RATE_LIMIT_ERROR",
          });
          return;
        }
        updateRateLimit.set(userRateKey, now);

        // Find or create whiteboard
        let whiteboard = await Whiteboard.findOne({ roomId });
        if (!whiteboard) {
          whiteboard = await Whiteboard.create({
            roomId,
            elements: [],
            appState: {},
            files: {},
            version: 1,
            lastModifiedBy: userId,
          });
        }

        // Update whiteboard with new data
        whiteboard.elements = elements;
        whiteboard.appState = appState;
        whiteboard.files = files || {};
        whiteboard.version += 1;
        whiteboard.lastModifiedBy = userId;
        whiteboard.lastModifiedAt = new Date();

        await whiteboard.save();

        // Broadcast to all users in the room except sender
        socket.to(roomId).emit("whiteboard-updated", {
          roomId,
          elements,
          appState,
          files: files || {},
          version: whiteboard.version,
          userId,
          socketId: socket.id,
          elementCount: elements.length,
        });
      } catch (error) {
        logger.error("Error updating whiteboard:", error);
        socket.emit("error", {
          message: "Failed to update whiteboard",
          code: "WHITEBOARD_UPDATE_ERROR",
        });
      }
    }
  );

  // Enhanced cursor-move handler with throttling
  socket.on(
    "cursor-move",
    (data: {
      roomId: string;
      cursor: { x: number; y: number; userId: string; timestamp: number };
    }) => {
      try {
        const { roomId, cursor } = data;
        const userId = socket.data.user?.id;
        const userName = socket.data.user?.name;

        if (!userId) {
          return; // Skip if user not authenticated, but don't emit error for cursor movements
        }

        // Throttling: only broadcast every 50ms per user
        const throttleKey = `cursor-${userId}-${roomId}`;
        const lastCursorUpdate = updateRateLimit.get(throttleKey) || 0;
        const now = Date.now();

        if (now - lastCursorUpdate < 50) {
          return; // Silently ignore if throttled
        }
        updateRateLimit.set(throttleKey, now);

        // Include user name and color in broadcast
        socket.to(roomId).emit("cursor-moved", {
          roomId,
          cursor: {
            ...cursor,
            userId,
            userName,
            timestamp: now,
          },
        });
      } catch (error) {
        logger.error("Error moving cursor:", error);
      }
    }
  );

  // Handle element creation
  socket.on(
    "element-create",
    async (data: { roomId: string; element: any }) => {
      try {
        const { roomId, element } = data;
        const userId = socket.data.user?.id;

        if (!userId) {
          socket.emit("error", {
            message: "User not authenticated",
            code: "AUTH_ERROR",
          });
          return;
        }

        // Check access control
        const hasAccess = await checkWhiteboardAccess(
          socket,
          roomId,
          userId,
          "write"
        );
        if (!hasAccess) {
          return;
        }

        // Find whiteboard and add element
        const whiteboard = await Whiteboard.findOne({ roomId });
        if (whiteboard) {
          const newElement = {
            ...element,
            userId,
            timestamp: Date.now(),
          };

          whiteboard.elements.push(newElement);
          whiteboard.version += 1;
          whiteboard.lastModifiedBy = userId;
          await whiteboard.save();

          // Broadcast element creation to other users
          socket.to(roomId).emit("element-created", {
            roomId,
            element: newElement,
            userId,
            version: whiteboard.version,
          });
        }
      } catch (error) {
        logger.error("Error creating element:", error);
        socket.emit("error", {
          message: "Failed to create element",
          code: "ELEMENT_CREATE_ERROR",
        });
      }
    }
  );

  // Handle element updates
  socket.on(
    "element-update",
    async (data: { roomId: string; element: any }) => {
      try {
        const { roomId, element } = data;
        const userId = socket.data.user?.id;

        if (!userId) {
          socket.emit("error", {
            message: "User not authenticated",
            code: "AUTH_ERROR",
          });
          return;
        }

        // Check access control
        const hasAccess = await checkWhiteboardAccess(
          socket,
          roomId,
          userId,
          "write"
        );
        if (!hasAccess) {
          return;
        }

        // Find element in database by ID and update
        const whiteboard = await Whiteboard.findOne({ roomId });
        if (whiteboard) {
          const elementIndex = whiteboard.elements.findIndex(
            (el: any) => el.id === element.id
          );

          if (elementIndex !== -1) {
            whiteboard.elements[elementIndex] = {
              ...element,
              userId,
              timestamp: Date.now(),
            };
            whiteboard.version += 1;
            whiteboard.lastModifiedBy = userId;
            await whiteboard.save();

            // Broadcast element update to other users
            socket.to(roomId).emit("element-updated", {
              roomId,
              element: whiteboard.elements[elementIndex],
              userId,
              version: whiteboard.version,
            });
          }
        }
      } catch (error) {
        logger.error("Error updating element:", error);
        socket.emit("error", {
          message: "Failed to update element",
          code: "ELEMENT_UPDATE_ERROR",
        });
      }
    }
  );

  // Handle element deletion
  socket.on(
    "element-delete",
    async (data: { roomId: string; elementId: string }) => {
      try {
        const { roomId, elementId } = data;
        const userId = socket.data.user?.id;

        if (!userId) {
          socket.emit("error", {
            message: "User not authenticated",
            code: "AUTH_ERROR",
          });
          return;
        }

        // Check access control
        const hasAccess = await checkWhiteboardAccess(
          socket,
          roomId,
          userId,
          "write"
        );
        if (!hasAccess) {
          return;
        }

        // Remove element from database
        const whiteboard = await Whiteboard.findOne({ roomId });
        if (whiteboard) {
          whiteboard.elements = whiteboard.elements.filter(
            (el: any) => el.id !== elementId
          );
          whiteboard.version += 1;
          whiteboard.lastModifiedBy = userId;
          await whiteboard.save();

          // Broadcast element deletion to other users
          socket.to(roomId).emit("element-deleted", {
            roomId,
            elementId,
            userId,
            version: whiteboard.version,
          });
        }
      } catch (error) {
        logger.error("Error deleting element:", error);
        socket.emit("error", {
          message: "Failed to delete element",
          code: "ELEMENT_DELETE_ERROR",
        });
      }
    }
  );

  // Handle whiteboard loading
  socket.on("whiteboard-load", async (data: { roomId: string }) => {
    try {
      // Validate input data
      if (!data) {
        socket.emit("error", {
          message: "Missing data for whiteboard-load request",
          code: "INVALID_DATA",
        });
        return;
      }

      const { roomId } = data;

      if (!roomId) {
        socket.emit("error", {
          message: "Room ID is required",
          code: "INVALID_ROOM_ID",
        });
        return;
      }

      const userId = socket.data.user?.id;

      if (!userId) {
        socket.emit("error", {
          message: "User not authenticated",
          code: "AUTH_ERROR",
        });
        return;
      }

      // Check access control for reading
      const hasAccess = await checkWhiteboardAccess(
        socket,
        roomId,
        userId,
        "read"
      );
      if (!hasAccess) {
        return;
      }

      // Load whiteboard from database
      const whiteboard = await Whiteboard.findOne({ roomId });

      if (whiteboard) {
        socket.emit("whiteboard-loaded", {
          roomId,
          elements: whiteboard.elements,
          appState: whiteboard.appState,
          files: whiteboard.files,
          version: whiteboard.version,
          lastUpdated: whiteboard.lastModifiedAt,
        });
      } else {
        // Send empty whiteboard if none exists
        socket.emit("whiteboard-loaded", {
          roomId,
          elements: [],
          appState: {},
          files: {},
          version: 0,
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      logger.error("Error loading whiteboard:", error);
      socket.emit("error", {
        message: "Failed to load whiteboard",
        code: "WHITEBOARD_LOAD_ERROR",
      });
    }
  });

  // Handle whiteboard snapshot creation
  socket.on("whiteboard-snapshot", async (data: { roomId: string }) => {
    try {
      // Validate input data
      if (!data) {
        socket.emit("error", {
          message: "Missing data for whiteboard-snapshot request",
          code: "INVALID_DATA",
        });
        return;
      }

      const { roomId } = data;

      if (!roomId) {
        socket.emit("error", {
          message: "Room ID is required",
          code: "INVALID_ROOM_ID",
        });
        return;
      }
      const userId = socket.data.user?.id;

      if (!userId) {
        socket.emit("error", {
          message: "User not authenticated",
          code: "AUTH_ERROR",
        });
        return;
      }

      // Check access control
      const hasAccess = await checkWhiteboardAccess(
        socket,
        roomId,
        userId,
        "write"
      );
      if (!hasAccess) {
        return;
      }

      // Create snapshot
      const whiteboard = await Whiteboard.findOne({ roomId });
      if (whiteboard) {
        // In a real app, you might save snapshots to a separate collection
        // For now, we'll just emit the current state as a snapshot
        socket.emit("whiteboard-snapshot-created", {
          roomId,
          timestamp: new Date(),
          version: whiteboard.version,
        });
      }
    } catch (error) {
      logger.error("Error creating whiteboard snapshot:", error);
      socket.emit("error", {
        message: "Failed to create snapshot",
        code: "SNAPSHOT_CREATE_ERROR",
      });
    }
  });
};

