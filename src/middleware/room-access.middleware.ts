import { Request, Response, NextFunction } from 'express';

import { IRoom, Room } from '../models/Room.model';
import { logger } from '../utils/logger.util';
import { AuthenticatedRequest } from './auth.middleware';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      room?: IRoom;
    }
  }
}

export const checkRoomOwnership = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: User not authenticated.',
      });
      return;
    }

    const room = await Room.findById(roomId);

    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    if (room.ownerId.toString() !== userId) {
      res.status(403).json({
        success: false,
        error: 'Access denied. Only room owner can perform this action.',
      });
      return;
    }

    req.room = room;
    next();
  } catch (error) {
    logger.error('Error checking room ownership:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

export const checkRoomParticipation = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: User not authenticated.',
      });
      return;
    }

    const room = await Room.findById(roomId);

    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    const isOwner = room.ownerId.toString() === userId;
    const isParticipant = room.participants.some(
      (p: any) => p.toString() === userId
    );

    if (!isOwner && !isParticipant) {
      res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant of this room.',
      });
      return;
    }

    req.room = room;
    next();
  } catch (error) {
    logger.error('Error checking room participation:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

export const checkRoomAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;
    const userId = (req as any).user?.id; // Optional auth

    const room = await Room.findById(roomId);

    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    // Check if user has access
    if (userId) {
      const isOwner = room.ownerId.toString() === userId;
      const isParticipant = room.participants.some(
        (p: any) => p.toString() === userId
      );

      if (isOwner || isParticipant || room.settings.isPublic) {
        req.room = room;
        next();
        return;
      }
    }

    // Allow access to public rooms even without authentication
    if (room.settings.isPublic) {
      req.room = room;
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error: 'Access denied.',
    });
  } catch (error) {
    logger.error('Error checking room access:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};
