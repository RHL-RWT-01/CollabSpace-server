import { body, param, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

// Helper function to handle validation errors
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
    return;
  }
  next();
};

// Common validation rules
export const validateEmail = body('email')
  .isEmail()
  .withMessage('Please provide a valid email')
  .normalizeEmail();

export const validatePassword = body('password')
  .isLength({ min: 6 })
  .withMessage('Password must be at least 6 characters long')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .withMessage(
    'Password must contain at least one lowercase letter, one uppercase letter, and one number'
  );

export const validateName = body('name')
  .isLength({ min: 2, max: 50 })
  .withMessage('Name must be between 2 and 50 characters')
  .trim();

export const validateRoomName = body('name')
  .isLength({ min: 1, max: 100 })
  .withMessage('Room name must be between 1 and 100 characters')
  .trim();

export const validateMessage = body('message')
  .isLength({ min: 1, max: 1000 })
  .withMessage('Message must be between 1 and 1000 characters')
  .trim();

// Validation chains for different endpoints (to be used in subsequent phases)
export const validateSignup = [
  validateEmail,
  validatePassword,
  validateName,
  handleValidationErrors,
];

export const validateSignin = [
  validateEmail,
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

export const validateCreateRoom = [
  validateRoomName,
  body('settings.maxParticipants')
    .optional()
    .isInt({ min: 2, max: 100 })
    .withMessage('Max participants must be between 2 and 100'),
  body('settings.isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
  handleValidationErrors,
];

export const validateUpdateRoom = [
  body('name')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Room name must be between 1 and 100 characters')
    .trim(),
  body('settings.maxParticipants')
    .optional()
    .isInt({ min: 2, max: 100 })
    .withMessage('Max participants must be between 2 and 100'),
  body('settings.isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
  body('settings.allowGuests')
    .optional()
    .isBoolean()
    .withMessage('allowGuests must be a boolean'),
  body('settings.recordSessions')
    .optional()
    .isBoolean()
    .withMessage('recordSessions must be a boolean'),
  handleValidationErrors,
];

export const validateSendMessage = [
  validateMessage,
  body('roomId').isMongoId().withMessage('Invalid room ID'),
  handleValidationErrors,
];

// Validate ObjectId parameters
export const validateObjectId = (paramName: string) => {
  return param(paramName).isMongoId().withMessage(`Invalid ${paramName}`);
};
