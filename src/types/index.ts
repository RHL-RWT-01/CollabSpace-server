// Subscription plan enum
export enum SubscriptionPlan {
  FREE = 'FREE',
  PRO = 'PRO',
  TEAMS = 'TEAMS',
}

// Subscription status enum
export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  TRIALING = 'trialing',
}

// Socket-related interfaces for presence tracking
export interface UserPresenceData {
  id: string;
  name: string;
  avatar?: string;
  socketId: string;
  joinedAt: string; // ISO timestamp
  lastActivity: string; // ISO timestamp
  isAnonymous?: boolean;
}

export interface SocketAuthData {
  id: string;
  email?: string;
  name: string;
  avatar?: string;
  subscriptionPlan: SubscriptionPlan;
  isAnonymous: boolean;
}

export interface RoomState {
  roomId: string;
  users: UserPresenceData[];
  createdAt: string;
  lastActivity: string;
}

export interface SocketErrorData {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

export interface Message {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  roomId: string;
  content: string;
  type: 'text' | 'system';
  createdAt: string;
  tempId?: string;
}

export interface ConnectionInfo {
  socketId: string;
  userId: string;
  connectedAt: string;
  transport: 'websocket' | 'polling';
  ipAddress?: string;
  userAgent?: string;
}

// Chat message interface
export interface Message {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  createdAt: string;
  tempId?: string;
}

// Sticky note interface
export interface StickyNote {
  id: string;
  content: string;
  position: {
    x: number;
    y: number;
  };
  color: string;
  userId: string;
  userName: string;
  createdAt: string;
  updatedAt: string;
}

// User payload for JWT tokens
export interface UserPayload {
  userId: string;
  email: string;
  name: string;
  subscriptionPlan: SubscriptionPlan;
}

// Room settings interface
export interface RoomSettings {
  maxParticipants: number;
  isPublic: boolean;
  allowGuests: boolean;
  recordSessions: boolean;
}

// Whiteboard element interface with enhanced Excalidraw-specific fields
export interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  roughness: number;
  opacity: number;
  properties?: Record<string, any>;
  isDeleted: boolean;
  link?: string;
  locked?: boolean;
  points?: number[][];
  lastCommittedPoint?: number[] | null;
  startBinding?: any;
  endBinding?: any;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  version: number;
  versionNonce: number;
  groupIds: string[];
  boundElements: any[];
  updated: number;
  seed: number;
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: string;
  verticalAlign: string;
  containerId: string | null;
  originalText: string;
}

// Whiteboard app state interface
export interface WhiteboardAppState {
  viewBackgroundColor: string;
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemFillStyle: string;
  currentItemStrokeWidth: number;
  currentItemRoughness: number;
  currentItemOpacity: number;
  currentItemFontFamily: number;
  currentItemFontSize: number;
  currentItemTextAlign: string;
  currentItemStrokeStyle: string;
  currentItemRoundness: string;
  gridSize: number | null;
  colorPalette: Record<string, string[]>;
  zoom: { value: number };
  scrollX: number;
  scrollY: number;
  theme: 'light' | 'dark';
}

// Whiteboard snapshot interface
export interface WhiteboardSnapshot {
  id: string;
  elements: WhiteboardElement[];
  appState: WhiteboardAppState;
  files: Record<string, any>;
  timestamp: Date;
  userId: string;
  version: number;
}

// Socket event types
export interface SocketEventData {
  roomId: string;
  userId: string;
  timestamp: Date;
}

export interface JoinRoomData extends SocketEventData {
  userData: {
    name: string;
    avatar?: string;
  };
}

export interface WhiteboardUpdateData extends SocketEventData {
  elements: WhiteboardElement[];
}

export interface ChatMessageData extends SocketEventData {
  message: string;
  type: 'text' | 'system';
}

export interface CursorMoveData extends SocketEventData {
  cursor: {
    x: number;
    y: number;
  };
}

// API response types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedAPIResponse<T> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Error types
export interface APIError {
  statusCode: number;
  message: string;
  code?: string;
  details?: any;
}

// File upload types
export interface FileUploadData {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Subscription and billing types
export interface SubscriptionData {
  plan: SubscriptionPlan;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}

// Feature limits by plan
export interface PlanLimits {
  maxParticipants: number;
  maxRooms: number;
  aiRequestsPerMonth: number;
  storageGB: number;
}

// Analytics and metrics types
export interface RoomMetrics {
  roomId: string;
  participantCount: number;
  sessionDuration: number;
  messagesCount: number;
  whiteboardElementsCount: number;
  createdAt: Date;
}

export interface UserMetrics {
  userId: string;
  totalSessionTime: number;
  roomsCreated: number;
  roomsJoined: number;
  messagessent: number;
  lastActive: Date;
}
