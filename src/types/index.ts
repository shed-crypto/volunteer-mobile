// ─── Enums (matching backend) ──────────────────────────────────────────────

export enum SystemRole {
  ADMIN = 'admin',
  COORDINATOR = 'coordinator',
  VOLUNTEER = 'volunteer',
  REQUESTER = 'requester',
}

export enum ClearanceLevel {
  LOCAL = 'local',
  INTERNATIONAL = 'international',
  FRONTLINE = 'frontline',
}

export enum RequestCategory {
  MEDICAL = 'medical',
  EVACUATION = 'evacuation',
  LOGISTICS = 'logistics',
  MILITARY = 'military',
  HUMANITARIAN = 'humanitarian',
  SHELTER = 'shelter',
  PSYCHOLOGICAL = 'psychological',
  OTHER = 'other',
}

export enum RequestUrgency {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum RequestStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  PARTIALLY_DONE = 'partially_done',
  PENDING_REVIEW = 'pending_review',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  PENDING_REVIEW = 'pending_review',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum AssignmentStatus {
  ASSIGNED = 'assigned',
  EN_ROUTE = 'en_route',
  ON_SITE = 'on_site',
  COMPLETED = 'completed',
  WITHDRAWN = 'withdrawn',
}

export enum ChatType {
  TASK_CHAT = 'task_chat',
  ORG_CHAT = 'org_chat',
  DIRECT = 'direct',
}

export enum OrgRole {
  LEADER = 'leader',
  COORDINATOR = 'coordinator',
  MEMBER = 'member',
}

// ─── API Entities ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  systemRole: SystemRole;
  clearanceLevel: ClearanceLevel;
  trustScore: number;
  avatarUrl?: string;
  telegramChatId?: string;
  isBlocked: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    systemRole: SystemRole;
    clearanceLevel: ClearanceLevel;
  };
}

export interface Request {
  id: string;
  title: string;
  description?: string;
  category: RequestCategory;
  urgency: RequestUrgency;
  status: RequestStatus;
  requiredClearance: ClearanceLevel;
  latitude?: number;
  longitude?: number;
  isLocationHidden: boolean;
  deadline?: string;
  fundraisingUrl?: string;
  tags: string[];
  reportUrls: string[];
  additionalInfo: Array<{ id: string; text: string; createdAt: string; updatedAt?: string }>;
  creatorId: string;
  creator?: User;
  tasks?: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  requestId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  neededPeopleCount: number;
  requiredRoles: string[];
  priority: number;
  deadline?: string;
  chatId?: string;
  assignments?: TaskAssignment[];
  assignedCount?: number;
  isFull?: boolean;
  createdAt: string;
  // Додано для офлайн-архітектури
  isSynced?: boolean;
  lastSyncedAt?: number;
}

export interface TaskAssignment {
  id: string;
  taskId: string;
  userId: string;
  user?: User;
  fulfilledRole?: string;
  status: AssignmentStatus;
  assignedAt: string;
  completedAt?: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  name?: string;
  relatedRequestId?: string;
  participants: User[];
  updatedAt: string;
  lastMessage?: Message;
  unreadCount?: number;
}

  export interface Message {
    id: string;
    chatId: string;
    senderId?: string;
    sender?: User;
    content: string;
    sentAt: string;
    readBy: string[];
    messageType: 'text' | 'attachment' | 'system';
    attachmentUrl?: string;
    // Reply functionality
    replyToId?: string;
    replyTo?: Message;
    // Додано для офлайн-архітектури
    messageStatus?: string; // 'sent' | 'delivered' | 'read' | 'pending' | 'failed'
    deliveredTo?: string[];
  }

export interface Organization {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  parentOrgId?: string;
  parentOrg?: Organization;
  children?: Organization[];
  members?: OrganizationMember[];
  hubs?: Hub[];
  isPublic: boolean;
  bannerUrl?: string;
  settings?: OrganizationSettings;
  joinRequests?: OrganizationJoinRequest[];
}

export interface OrganizationSettings {
  id: string;
  organizationId: string;
  allowPublicJoin: boolean;
  requireJoinApproval: boolean;
  memberInviteAllowed: boolean;
  subgroupCreationAllowed: boolean;
  mediaUploadAllowed: boolean;
  allowedMemberRoles: OrgRole[];
}

export interface OrganizationJoinRequest {
  id: string;
  organizationId: string;
  userId: string;
  user?: User;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewComment?: string;
  reviewedAt?: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  user?: User;
  orgRole: OrgRole;
  joinedAt: string;
  isActive: boolean;
}

// ─── Vehicle (FR-01g, FR-07) ──────────────────────────────────────────────────

export enum VehicleType {
  PASSENGER = 'passenger',
  VAN       = 'van',
  PICKUP    = 'pickup',
  TRUCK     = 'truck',
  ARMORED   = 'armored',
}

export enum VehicleStatus {
  ACTIVE       = 'active',
  UNDER_REPAIR = 'under_repair',
}

export interface Vehicle {
  id: string;
  userId: string;
  type: VehicleType;
  capacityKg?: number;
  plateNumber?: string;
  status: VehicleStatus;
}

// ─── Hub / Warehouse (FR-03f) ─────────────────────────────────────────────────

export interface Hub {
  id: string;
  organizationId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  mediaUrl?: string;
  isPublic: boolean;
}

export interface TaskDelegation {
  id: string;
  taskId: string;
  organizationId: string;
  delegatedByUserId: string;
  message?: string;
  isAccepted?: boolean;
  createdAt: string;
}

export interface TaskReport {
  id: string;
  taskId: string;
  userId: string;
  user?: User;
  comment: string;
  attachments: { url: string; type: string; name: string }[];
  createdAt: string;
}

export interface TaskReportWithFiles extends TaskReport {
  attachments: Array<{
    url: string;
    type: string;
    name: string;
    localUri?: string; // Для локального шляху до файлу
  }>;
}

export interface TrustVouch {
  id: string;
  voucheeId: string;
  voucherId: string;
  voucher?: User;
  comment?: string;
  createdAt: string;
}

// ─── API Request/Response DTOs ────────────────────────────────────────────────

export interface CreateRequestDto {
  title: string;
  description?: string;
  category?: RequestCategory;
  urgency?: RequestUrgency;
  requiredClearanceLevel?: ClearanceLevel;
  latitude?: number;
  longitude?: number;
  isLocationHidden?: boolean;
  deadline?: string;
  fundraisingUrl?: string;
}

export interface FindRequestsDto {
  status?: RequestStatus;
  category?: RequestCategory;
  urgency?: RequestUrgency;
  search?: string;
  creatorId?: string;
  excludeCreatorId?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  limit?: number;
  offset?: number;
}

export interface CreateTaskDto {
  title: string;
  description?: string;
  neededPeopleCount?: number;
  requiredRoles?: string[];
  priority?: number;
  deadline?: string;
}
