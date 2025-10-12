import { Router } from 'express';
import authRoutes from './auth.routes';
import roomRoutes from './room.routes';
import aiRoutes from './ai.routes';
import exportRoutes from './export.routes';
import billingRoutes from './billing.routes';
import whiteboardRoutes from './whiteboard.routes';
import messagesRoutes from './messages.routes';
import userRoutes from './user.routes';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CollabSpace server is running',
    timestamp: new Date().toISOString(),
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/rooms', roomRoutes);
router.use('/ai', aiRoutes);
router.use('/export', exportRoutes);
router.use('/billing', billingRoutes);
router.use('/whiteboard', whiteboardRoutes);
router.use('/messages', messagesRoutes);
router.use('/user', userRoutes);

export default router;
