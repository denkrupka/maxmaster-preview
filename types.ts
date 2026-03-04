
export interface AppNotification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  link?: string;
}

export interface NotificationSetting {
    id?: string; // UUID z bazy danych
    setting_type: string; // Logiczny kod (np. 'cand_reg')
    label: string;
    category: 'rekrutacja' | 'trial' | 'skills' | 'quality' | 'referrals' | 'system';
    target_role: Role | 'work_manager'; 
    system: boolean;
    email: boolean;
    sms: boolean;
}

export interface NotificationSettingUpdate extends Partial<NotificationSetting> {
    setting_type: string;
    target_role: Role | 'work_manager';
}

export enum Role {
  // Global roles (is_global_user = true)
  SUPERADMIN = 'superadmin',
  SALES = 'sales',
  DORADCA = 'doradca',

  // Company roles (is_global_user = false)
  COMPANY_ADMIN = 'company_admin',
  HR = 'hr',
  COORDINATOR = 'coordinator',
  BRIGADIR = 'brigadir',
  EMPLOYEE = 'employee',
  CANDIDATE = 'candidate',
  TRIAL = 'trial',

  // Legacy (for backward compatibility during migration)
  ADMIN = 'admin'
}

export enum UserStatus {
  INVITED = 'invited',
  STARTED = 'started',
  TESTS_IN_PROGRESS = 'tests_in_progress',
  TESTS_COMPLETED = 'tests_completed',
  INTERESTED = 'interested',
  NOT_INTERESTED = 'not_interested',
  REJECTED = 'rejected',
  OFFER_SENT = 'offer_sent',
  DATA_REQUESTED = 'data_requested',
  DATA_SUBMITTED = 'data_submitted',
  PORTAL_BLOCKED = 'portal_blocked',
  PENDING = 'pending',
  TRIAL = 'trial',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum ContractType {
  UOP = 'uop',
  UZ = 'uz',
  B2B = 'b2b'
}

export enum SkillCategory {
  MONTAZ = 'PRACE MONTAŻOWE',
  ELEKTRYKA = 'INSTALACJE ELEKTRYCZNE',
  TELETECHNIKA = 'TELETECHNICZNE',
  AUTOMATYKA = 'AUTOMATYKA',
  PPOZ = 'PPOŻ',
  POMIARY = 'POMIARY I PROTOKOŁY',
  UPRAWNIENIA = 'UPRAWNIENIA',
  BRYGADZISTA = 'BRYGADZISTA',
  TECZKA = 'TECZKA STANOWISKOWA',
  TECZKA_PRACOWNICZA = 'TECZKA PRACOWNICZA',
  INNE = 'INNE'
}

export enum VerificationType {
  THEORY_ONLY = 'theory_only',
  THEORY_PRACTICE = 'theory_practice',
  DOCUMENT = 'document'
}

export enum SkillStatus {
  LOCKED = 'locked',
  PENDING = 'pending',
  VERIFIED = 'verified',
  THEORY_PASSED = 'theory_passed',
  PRACTICE_PENDING = 'practice_pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  SUSPENDED = 'suspended'
}

/**
 * Added GradingStrategy enum to support test evaluation logic and fix imports in HR and Candidate pages.
 */
export enum GradingStrategy {
  ALL_CORRECT = 'all_correct',
  ANY_CORRECT = 'any_correct',
  MIN_2_CORRECT = 'min_2_correct'
}

/**
 * Added Question interface to define the structure of test questions.
 */
export interface Question {
  id: string;
  text: string;
  options: string[];
  correctOptionIndices: number[];
  gradingStrategy: GradingStrategy;
  timeLimit?: number;
  imageUrl?: string;
}

export interface Skill {
  id: string;
  name: string;
  name_pl: string;
  title_pl?: string;
  category: string; // Changed from enum to string for dynamic support
  description_pl: string;
  verification_type: VerificationType;
  hourly_bonus: number;
  required_pass_rate: number;
  criteria?: string[];
  is_active?: boolean;
  is_archived?: boolean;
}

export interface Position {
  id: string;
  name: string;
  responsibilities: string[];
  required_skill_ids: string[];
  required_document_ids?: string[];
  min_monthly_rate?: number;
  max_monthly_rate?: number;
  salary_type: 'hourly' | 'monthly';
  order: number;
  referral_bonus?: number;
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  status: UserStatus;
  base_rate?: number;
  contract_type?: ContractType;
  is_student?: boolean;
  phone?: string;
  hired_date: string;
  contract_end_date?: string;
  trial_end_date?: string;
  assigned_brigadir_id?: string;
  referred_by_id?: string;
  referral_bonus_paid?: boolean;
  referral_bonus_paid_date?: string;
  source?: string;
  notes?: string;
  resume_url?: string;
  target_position?: string;
  pesel?: string;
  birth_date?: string;
  citizenship?: string;
  document_type?: string;
  document_number?: string;
  zip_code?: string;
  city?: string;
  street?: string;
  house_number?: string;
  apartment_number?: string;
  bank_account?: string;
  nip?: string;
  termination_date?: string;
  termination_reason?: string;
  termination_initiator?: 'employee' | 'company';
  qualifications?: string[];
  is_blocked?: boolean;
  blocked_at?: string;
  blocked_reason?: string;
  plain_password?: string;

  // Multi-company fields
  company_id?: string;
  is_global_user?: boolean;
  invitation_token?: string;
  invitation_expires_at?: string;
  invited_by?: string;
  available_modules?: string[];
  created_at?: string;
  updated_at?: string;
}

// =====================================================
// MULTI-COMPANY TYPES
// =====================================================

export type CompanyStatus = 'active' | 'suspended' | 'cancelled' | 'trial';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'none';

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;

  // Legal data (for invoices)
  legal_name?: string;
  tax_id?: string; // NIP
  regon?: string;
  address_street?: string;
  address_city?: string;
  address_postal_code?: string;
  address_country?: string;
  street?: string;
  building_number?: string;
  apartment_number?: string;
  city?: string;
  postal_code?: string;

  // Contact data
  email?: string;
  phone?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_email?: string;

  // Additional info
  industry?: string;

  // Status
  status: CompanyStatus;
  is_blocked: boolean;
  blocked_at?: string;
  blocked_reason?: string;

  // Subscription
  trial_ends_at?: string;
  subscription_status: SubscriptionStatus;
  subscription_tier?: string;
  subscription_start?: string;
  subscription_end?: string;

  // Stripe
  stripe_customer_id?: string;
  stripe_subscription_id?: string;

  // Bonus balance
  bonus_balance: number;

  // Referral program
  referred_by_company_id?: string;
  referral_bonus_paid?: boolean;
  referral_bonus_paid_at?: string;

  // Settings
  settings?: Record<string, any>;

  // Working time settings (Раздел A)
  timezone?: string;
  currency?: string;
  allow_weekend_access?: boolean;
  night_time_from?: string;
  night_time_to?: string;
  max_working_time_minutes?: number;
  delay_tolerance_minutes?: number | null;
  working_hours?: WorkingHours;
  start_round_time?: RoundTime;
  finish_round_time?: RoundTime;

  // Metadata
  created_at: string;
  updated_at?: string;
  created_by?: string;
  sales_owner_id?: string;
  doradca_id?: string;
}

export interface Module {
  code: string;
  name_pl: string;
  name_en?: string;
  description_pl?: string;
  description_en?: string;
  available_roles: string[];
  base_price_per_user: number;
  is_active: boolean;
  display_order: number;
  icon?: string;
  created_at: string;
}

export interface CompanyModule {
  id: string;
  company_id: string;
  module_code: string;
  max_users: number;
  current_users: number;
  price_per_user: number;
  billing_cycle: 'monthly' | 'yearly';
  is_active: boolean;
  activated_at: string;
  deactivated_at?: string;
  demo_end_date?: string | null;
  stripe_subscription_id?: string;
  stripe_subscription_item_id?: string;
  next_billing_cycle_price?: number | null;
  price_scheduled_at?: string | null;
  scheduled_max_users?: number | null;
  scheduled_change_at?: string | null;
  subscription_period_end?: string | null;
  subscription_period_start?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ModuleUserAccess {
  id: string;
  company_id: string;
  user_id: string;
  module_code: string;
  is_enabled: boolean;
  enabled_at: string;
  disabled_at?: string;
  days_used: number;
  created_at: string;
}

export interface PaymentHistory {
  id: string;
  company_id: string;
  stripe_invoice_id?: string;
  stripe_payment_intent_id?: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'pending' | 'refunded';
  invoice_number?: string;
  invoice_pdf_url?: string;
  description?: string;
  paid_at?: string;
  created_at: string;
  payment_method?: 'stripe' | 'bonus' | 'mixed' | 'portal';
  payment_type?: 'subscription' | 'balance_topup' | 'seats_purchase' | 'bonus_credit' | 'bonus_debit';
  comment?: string;
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_id: string;
  status: SkillStatus;
  theory_score?: number;
  practice_checked_by?: string;
  practice_date?: string;
  confirmed_at?: string;
  rejection_reason?: string;
  checklist_progress?: Record<number, any>;
  document_url?: string;
  document_urls?: string[];
  expiry_date?: string;
  custom_name?: string;
  custom_type?: string;
  is_indefinite?: boolean;
  issue_date?: string;
  expires_at?: string;
  bonus_value?: number;
  is_archived?: boolean;
  effective_from?: string;
}

/**
 * Updated Test interface to use the Question interface for stronger typing.
 */
export interface Test {
  id: string;
  skill_ids: string[];
  title: string;
  questions: Question[];
  time_limit_minutes: number;
  is_active: boolean;
  is_archived?: boolean;
  questions_to_display?: number; // Optional: number of questions to show from total pool. If not set, shows all questions.
}

/**
 * Added TestAttempt interface to track user performance on qualification tests.
 */
export interface TestAttempt {
  id: string;
  user_id: string;
  test_id: string;
  score: number;
  passed: boolean;
  completed_at: string;
  duration_seconds?: number;
}

/**
 * Added BonusDocumentType for HR system configuration.
 */
export interface BonusDocumentType {
  id: string;
  label: string;
  bonus: number;
}

export interface SystemConfig {
    baseRate: number;
    overtimeBonus: number;
    holidayBonus: number;
    seniorityBonus: number;
    delegationBonus: number;
    contractBonuses: Record<string, number>;
    studentBonus: number;
    bonusDocumentTypes: BonusDocumentType[];
    bonusPermissionTypes: BonusDocumentType[];
    terminationReasons: string[];
    positions: string[];
    noteCategories: string[];
    badgeTypes: string[];
    skillCategories: string[]; // Added

    // Sales limits (set by SuperAdmin)
    salesMaxDiscountPercent: number;      // Max discount % a salesperson can give
    salesMaxFreeExtensionDays: number;    // Max free extension days a salesperson can give

    // Referral program settings (set by SuperAdmin)
    referralMinPaymentAmount: number;     // Min payment by referral to trigger bonus (default: 100 PLN)
    referralBonusAmount: number;          // Bonus for inviter (default: 50 PLN)
}

export interface CandidateHistoryEntry {
    id: string;
    candidate_id: string;
    created_at: string;
    action: string;
    performed_by: string;
}

export interface QualityIncident {
    id: string;
    user_id: string;
    skill_id: string;
    date: string;
    incident_number: number;
    description: string;
    reported_by: string;
    image_url?: string;
    image_urls?: string[];
}

export enum NoteCategory {
    GENERAL = 'Ogólna',
    ATTITUDE = 'Postawa',
    QUALITY = 'Jakość',
    PUNCTUALITY = 'Punktualność',
    SAFETY = 'BHP'
}

/**
 * Added NoteSeverity enum for employee evaluation notes.
 */
export enum NoteSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export interface EmployeeNote {
    id: string;
    employee_id: string;
    author_id: string;
    category: string;
    text: string;
    created_at: string;
}

export enum BadgeType {
    SPEED = 'Szybkość',
    QUALITY = 'Jakość',
    HELP = 'Pomocność',
    RELIABILITY = 'Rzetelność',
    SAFETY = 'BHP'
}

export interface EmployeeBadge {
    id: string;
    employee_id: string;
    author_id: string;
    month: string;
    type: string;
    badge_name?: string;
    message?: string;
    description: string;
    visible_to_employee: boolean;
    created_at: string;
}

export interface MonthlyBonus {
    kontrola_pracownikow: boolean;
    realizacja_planu: boolean;
    brak_usterek: boolean;
    brak_naduzyc_materialowych: boolean;
    staz_pracy_years: number;
}

export interface LibraryResource {
  id: string;
  title: string;
  description?: string;
  type: 'pdf' | 'video' | 'link' | 'mixed';
  category?: string; // Changed from enum
  categories?: string[]; // Changed from enum
  skill_ids: string[];
  url: string;
  videoUrl?: string;
  imageUrl?: string;
  file_urls?: string[]; // Added for multiple files
  textContent?: string;
  is_archived: boolean;
}

/**
 * Added missing interfaces for practical verification and coordinator workflows.
 */

export interface PracticalCheckItem {
  id: number;
  text_pl: string;
  required: boolean;
  points: number;
}

export interface PracticalCheckTemplate {
  id: string;
  skill_id: string;
  title_pl: string;
  min_points_to_pass: number;
  items: PracticalCheckItem[];
}

export interface ChecklistItemState {
  checked: boolean;
  image_url?: string;
}

export interface VerificationAttachment {
  id: string;
  url: string;
  type: string;
  created_at: string;
}

export interface VerificationNote {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
}

export interface VerificationLog {
  id: string;
  action: string;
  performed_by: string;
  created_at: string;
}

/**
 * Added Notification related interfaces for HR settings.
 */

export enum NotificationChannel {
  SYSTEM = 'system',
  EMAIL = 'email',
  SMS = 'sms',
  BOTH = 'both'
}

export interface NotificationTemplate {
  id: string;
  code: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
}

/**
 * Added SalaryHistoryEntry for rate change tracking.
 */
export interface SalaryHistoryEntry {
  id: string;
  user_id: string;
  date: string;
  rate: number;
  change_reason: string;
}

// =============================================
// CRM Types for Sales Module
// =============================================

export enum DealStage {
  LEAD = 'lead',
  QUALIFIED = 'qualified',
  PROPOSAL = 'proposal',
  NEGOTIATION = 'negotiation',
  WON = 'won',
  LOST = 'lost'
}

export enum DealPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum ActivityType {
  CALL = 'call',
  EMAIL = 'email',
  MEETING = 'meeting',
  NOTE = 'note',
  TASK = 'task',
  STATUS_CHANGE = 'status_change'
}

export interface CRMCompany {
  id: string;
  name: string;
  legal_name?: string;
  tax_id?: string;
  regon?: string;
  industry?: string;
  website?: string;
  address_street?: string;
  address_city?: string;
  address_postal_code?: string;
  address_country?: string;
  employee_count?: number;
  annual_revenue?: number;
  notes?: string;
  status: string;
  source?: string;
  assigned_sales_id?: string;
  // Portal account linking
  linked_company_id?: string;
  // Subscription info (synced from linked company)
  subscription_status?: 'brak' | 'trialing' | 'active' | 'past_due' | 'cancelled';
  subscription_end_date?: string;
  created_at: string;
  updated_at: string;
}

export interface CRMContact {
  id: string;
  crm_company_id?: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  is_decision_maker: boolean;
  linkedin_url?: string;
  notes?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CRMDeal {
  id: string;
  title: string;
  crm_company_id?: string;
  contact_id?: string;
  stage: DealStage;
  priority: DealPriority;
  value?: number;
  probability: number;
  expected_close_date?: string;
  actual_close_date?: string;
  lost_reason?: string;
  modules_interested?: string[];
  employee_count_estimate?: number;
  module_user_counts?: Record<string, number>;
  notes?: string;
  assigned_sales_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CRMActivity {
  id: string;
  activity_type: ActivityType;
  subject: string;
  description?: string;
  location?: string;
  crm_company_id?: string;
  contact_id?: string;
  deal_id?: string;
  scheduled_at?: string;
  completed_at?: string;
  is_completed: boolean;
  duration_minutes?: number;
  outcome?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// MONITI INTEGRATION TYPES
// =====================================================

// === Раздел A: Настройки рабочего времени ===

export interface WorkingHoursDay {
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
}

export interface WorkingHours {
  monday: WorkingHoursDay;
  tuesday: WorkingHoursDay;
  wednesday: WorkingHoursDay;
  thursday: WorkingHoursDay;
  friday: WorkingHoursDay;
  saturday: WorkingHoursDay;
  sunday: WorkingHoursDay;
}

export interface RoundTime {
  precision: number;
  method: 'ceil' | 'floor' | 'none';
}

// === Раздел B: Объекты ===

export interface Department {
  id: string;
  company_id: string;
  name: string;
  label?: string;
  parent_id?: string | null;
  client_id?: string | null;
  rodzaj?: string | null;
  typ?: string | null;
  kod_obiektu?: string | null;
  address_street?: string;
  address_city?: string;
  address_postal_code?: string;
  address_country?: string;
  latitude?: number | null;
  longitude?: number | null;
  range_meters?: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  subdepartments?: Department[];
  members_count?: number;
}

export interface DepartmentMember {
  id: string;
  department_id: string;
  user_id: string;
  company_id: string;
  role: 'member' | 'manager';
  assigned_at: string;
  user?: User;
}

// === МОДУЛЬ 1: Учёт рабочего времени ===

export type WorkerDayStatus = 'absent' | 'present' | 'late' | 'incomplete' | 'day_off' | 'holiday' | 'time_off';
export type ActivityType_TA = 'work' | 'break' | 'exit_business' | 'exit_private';
export type TimeActionType = 'work_start' | 'work_finish' | 'break_start' | 'break_finish' | 'exit_business_start' | 'exit_business_finish' | 'exit_private_start' | 'exit_private_finish';
export type TimeActionSource = 'web' | 'mobile' | 'kiosk' | 'manual';
export type WorkerCurrentStatus = 'offline' | 'working' | 'on_break' | 'exit_business' | 'exit_private';
export type DayRequestStatus = 'pending' | 'approved' | 'rejected';

export interface WorkerDay {
  id: string;
  company_id: string;
  user_id: string;
  date: string;
  status: WorkerDayStatus;
  confirmed: boolean;
  finished: boolean;
  total_time_minutes: number;
  work_time_minutes: number;
  break_time_minutes: number;
  overtime_minutes: number;
  note?: string;
  manager_note?: string;
  is_business_day: boolean;
  is_holiday: boolean;
  is_weekend: boolean;
  created_at: string;
  updated_at: string;
  entries?: WorkerDayEntry[];
  user?: User;
}

export interface WorkerDayEntry {
  id: string;
  worker_day_id: string;
  company_id: string;
  user_id: string;
  start_time: string;
  finish_time?: string;
  finished: boolean;
  department_id?: string;
  position_id?: string;
  is_remote: boolean;
  note?: string;
  created_at: string;
  updated_at: string;
  activities?: WorkerDayActivity[];
  department?: Department;
}

export interface WorkerDayActivity {
  id: string;
  entry_id: string;
  company_id: string;
  user_id: string;
  type: ActivityType_TA;
  start_time: string;
  finish_time?: string;
  finished: boolean;
  approved: boolean;
  created_at: string;
}

export interface TimeAction {
  id: string;
  company_id: string;
  user_id: string;
  action_type: TimeActionType;
  timestamp: string;
  source: TimeActionSource;
  latitude?: number;
  longitude?: number;
  department_id?: string;
  created_by?: string;
  note?: string;
  created_at: string;
}

export interface WorkerState {
  id: string;
  company_id: string;
  user_id: string;
  current_status: WorkerCurrentStatus;
  activity_started_at?: string;
  work_started_at?: string;
  work_finished_at?: string;
  current_department_id?: string;
  is_remote: boolean;
  updated_at: string;
  user?: User;
  department?: Department;
}

export interface WorkerDayRequest {
  id: string;
  company_id: string;
  user_id: string;
  worker_day_id?: string;
  date: string;
  status: DayRequestStatus;
  requested_entries: RequestedEntry[];
  note?: string;
  reviewer_id?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
  user?: User;
  reviewer?: User;
}

export interface RequestedEntry {
  start_time: string;
  finish_time: string;
  department_id?: string;
  activities: { type: ActivityType_TA; start_time: string; finish_time: string }[];
}

// === МОДУЛЬ 2: Отпуска и отсутствия ===

export type TimeOffRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TimeOffType {
  id: string;
  company_id: string;
  name: string;
  shortcut?: string;
  color: string;
  icon: string;
  is_paid: boolean;
  pay_rate?: number;
  is_limited?: boolean;
  limit_days?: number;
  is_daily?: boolean;
  is_subtype?: boolean;
  parent_type_id?: string;
  count_weekends?: boolean;
  count_holidays?: boolean;
  carry_over?: boolean;
  auto_approve?: boolean;
  require_advance?: boolean;
  default_comment?: string;
  requires_approval: boolean;
  allows_half_day: boolean;
  allows_hourly: boolean;
  is_archived: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface TimeOffLimit {
  id: string;
  company_id: string;
  user_id: string;
  time_off_type_id: string;
  year: number;
  total_days: number;
  used_days: number;
  carried_over_days: number;
  is_enabled?: boolean;
  created_at: string;
  updated_at: string;
  time_off_type?: TimeOffType;
  user?: User;
}

export interface TimeOffRequest {
  id: string;
  company_id: string;
  user_id: string;
  time_off_type_id: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time?: string;
  end_time?: string;
  hourly: boolean;
  amount: number;
  status: TimeOffRequestStatus;
  note_worker?: string;
  note_reviewer?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
  time_off_type?: TimeOffType;
  user?: User;
  reviewer?: User;
}

// === МОДУЛЬ 3: Графики работ ===

export interface ScheduleTemplate {
  id: string;
  company_id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  color: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScheduleAssignment {
  id: string;
  company_id: string;
  user_id: string;
  template_id?: string;
  date: string;
  custom_start_time?: string;
  custom_end_time?: string;
  department_id?: string;
  note?: string;
  created_at: string;
  updated_at: string;
  template?: ScheduleTemplate;
  user?: User;
  department?: Department;
}

// === МОДУЛЬ 4: Проекты ===

export type ProjectStatus = 'active' | 'completed' | 'archived' | 'on_hold';
export type TaskStatus_Project = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectBillingType = 'ryczalt' | 'hourly';
export type ProjectNameMode = 'custom' | 'object';
export type ProjectMemberPaymentType = 'hourly' | 'akord';
export type ProjectMemberStatus = 'assigned' | 'unassigned' | 'temporarily_unassigned';
export type ProjectMemberType = 'employee' | 'subcontractor';
export type ProjectIssueStatus = 'new' | 'in_progress' | 'completed' | 'cancelled' | 'done';
export type ProjectTaskBillingType = 'ryczalt' | 'hourly';
export type ProjectTaskWorkerPayment = 'akord' | 'hourly';

export interface ProjectCustomer {
  id: string;
  company_id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  contact_persons?: ProjectCustomerContact[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectCustomerContact {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  position?: string;
  phone?: string;
  email?: string;
}

export interface Project {
  id: string;
  company_id: string;
  customer_id?: string;
  department_id?: string;
  name: string;
  name_mode: ProjectNameMode;
  description?: string;
  status: ProjectStatus;
  color: string;
  billing_type: ProjectBillingType;
  // Ryczalt fields
  budget_hours?: number;
  budget_amount?: number;
  // Hourly fields
  hourly_rate?: number;
  // Hourly - additional settings
  overtime_paid?: boolean;
  overtime_rate?: number;
  overtime_base_hours?: number;
  saturday_paid?: boolean;
  saturday_rate?: number;
  saturday_hours?: number;
  sunday_paid?: boolean;
  sunday_rate?: number;
  sunday_hours?: number;
  night_paid?: boolean;
  night_rate?: number;
  night_hours?: number;
  night_start_hour?: number;
  night_end_hour?: number;
  contractor_client_id?: string;
  travel_paid?: boolean;
  travel_rate?: number;
  travel_hours?: number;
  code?: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
  customer?: ProjectCustomer;
  department?: Department;
  members?: ProjectMember[];
  tasks_count?: number;
  logged_hours?: number;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id?: string | null;
  worker_id?: string | null;
  role: 'manager' | 'member';
  member_type: ProjectMemberType;
  payment_type: ProjectMemberPaymentType;
  hourly_rate?: number;
  member_status: ProjectMemberStatus;
  position?: string;
  added_at: string;
  user?: User;
}

export interface ProjectIssueCategory {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
}

export interface ProjectTask {
  id: string;
  company_id: string;
  project_id?: string;
  name?: string;
  title: string;
  description?: string;
  status: TaskStatus_Project;
  priority: TaskPriority;
  billing_type: ProjectTaskBillingType;
  // For hourly billing
  hourly_value?: number;
  // For ryczalt billing
  quantity?: number;
  unit?: string;
  price_per_unit?: number;
  total_value?: number;
  // Worker payment
  worker_payment_type: ProjectTaskWorkerPayment;
  worker_rate_per_unit?: number;
  assigned_users?: string[];
  assigned_to?: string;
  created_by?: string;
  category?: string;
  has_start_deadline?: boolean;
  start_date?: string;
  start_time?: string;
  has_end_deadline?: boolean;
  due_date?: string;
  end_time?: string;
  estimated_hours?: number;
  tags?: string[];
  is_archived: boolean;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  project?: Project;
  assignee?: User;
  creator?: User;
  time_logs?: TaskTimeLog[];
  attachments?: TaskAttachment[];
  total_logged_minutes?: number;
}

export interface TaskTimeLog {
  id: string;
  company_id: string;
  task_id: string;
  user_id: string;
  date: string;
  minutes: number;
  description?: string;
  created_at: string;
  user?: User;
}

export interface ProjectTaskCategory {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  file_url: string;
  file_name: string;
  file_size?: number;
  uploaded_by?: string;
  created_at: string;
}

export interface ProjectProtocol {
  id: string;
  project_id: string;
  company_id: string;
  protocol_number: string;
  protocol_type: 'standard' | 'additional';
  advancement_percent: number;
  period_from?: string;
  period_to?: string;
  total_value: number;
  invoice_number?: string;
  client_representative_id?: string;
  tasks_data: ProjectProtocolTask[];
  accepted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectProtocolTask {
  task_id: string;
  name: string;
  value: number;
  completion_percent: number;
}

export interface ProjectIncome {
  id: string;
  project_id: string;
  company_id: string;
  document_type: 'faktura' | 'paragon' | 'nota_odsetkowa' | 'nota_ksiegowa' | 'faktura_zaliczkowa';
  document_number: string;
  issue_date: string;
  payment_due_date: string;
  value: number;
  basis_id?: string;
  basis_type?: 'protocol' | 'timesheet';
  payment_status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCost {
  id: string;
  project_id: string;
  company_id: string;
  cost_type: 'direct' | 'labor';
  document_type?: string;
  document_number?: string;
  issue_date?: string;
  payment_due_date?: string;
  issuer?: string;
  issuer_nip?: string;
  issuer_street?: string;
  issuer_building_number?: string;
  issuer_apartment_number?: string;
  issuer_city?: string;
  issuer_postal_code?: string;
  vat_rate?: number;
  value_brutto?: number;
  value_netto: number;
  category?: string;
  payment_status?: string;
  payment_method?: string;
  comment?: string;
  file_url?: string;
  task_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectScheduleEntry {
  id: string;
  project_id: string;
  company_id: string;
  year: number;
  month: number;
  planned_amount: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectIssue {
  id: string;
  project_id: string;
  company_id: string;
  name: string;
  issue_number?: number;
  reporter_id: string;
  reporter_company?: string;
  task_id?: string;
  category?: string;
  status: ProjectIssueStatus;
  description?: string;
  accepted: boolean;
  file_urls?: string[];
  history?: ProjectIssueHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface ProjectIssueHistoryEntry {
  id: string;
  issue_id: string;
  user_id: string;
  action: string;
  description?: string;
  file_urls?: string[];
  created_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  company_id: string;
  name: string;
  file_type: string;
  file_url: string;
  file_size?: number;
  uploaded_by: string;
  created_at: string;
}

export interface ProjectAttendanceConfirmation {
  id: string;
  project_id: string;
  company_id: string;
  user_id: string;
  date: string;
  client_confirmed: boolean;
  confirmed_at?: string;
  confirmed_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectAttendanceRow {
  user_id: string;
  user_name: string;
  department_name: string;
  task_name: string;
  date: string;
  work_start?: string;
  work_end?: string;
  total_hours: number;
  overtime_hours: number;
  is_saturday: boolean;
  is_sunday: boolean;
  client_confirmed: boolean;
  confirmation_id?: string;
}

// === МОДУЛЬ 5: Отчёты и Payroll ===

export type TimesheetStatus = 'draft' | 'confirmed' | 'paid';

export interface Timesheet {
  id: string;
  company_id: string;
  user_id: string;
  year: number;
  month: number;
  total_work_days: number;
  total_work_minutes: number;
  total_break_minutes: number;
  total_overtime_minutes: number;
  total_night_minutes: number;
  total_weekend_minutes: number;
  total_holiday_minutes: number;
  total_time_off_days: number;
  base_salary: number;
  overtime_salary: number;
  night_salary: number;
  weekend_salary: number;
  holiday_salary: number;
  bonus_salary: number;
  total_salary: number;
  status: TimesheetStatus;
  confirmed_by?: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
  user?: User;
}

export interface SavedReport {
  id: string;
  company_id: string;
  name: string;
  type: 'attendance' | 'time_salary' | 'timesheet' | 'custom';
  parameters: Record<string, any>;
  created_by?: string;
  created_at: string;
}

// === Раздел I: Праздничный календарь ===

export interface HolidayDay {
  id: string;
  company_id: string;
  date: string;
  name: string;
  is_recurring: boolean;
  country_code: string;
  created_at: string;
}

// === Раздел J: Центр уведомлений ===

export type NotificationType_Hub =
  | 'attendance_reminder' | 'day_request_new' | 'day_request_approved' | 'day_request_rejected'
  | 'time_off_new' | 'time_off_approved' | 'time_off_rejected'
  | 'schedule_updated' | 'task_assigned' | 'task_status_changed' | 'task_comment'
  | 'timesheet_ready' | 'general';

export interface NotificationHub {
  id: string;
  company_id: string;
  user_id: string;
  type: NotificationType_Hub;
  title: string;
  message: string;
  link?: string;
  is_read: boolean;
  read_at?: string;
  entity_type?: string;
  entity_id?: string;
  created_at: string;
}

// ---------------------------------------------------------------
// Contractors
// ---------------------------------------------------------------

export interface ContractorClient {
  id: string;
  company_id: string;
  name: string;
  nip?: string;
  address_street?: string;
  address_city?: string;
  address_postal_code?: string;
  address_country?: string;
  email?: string;
  phone?: string;
  note?: string;
  contractor_type?: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContractorClientContact {
  id: string;
  client_id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  position?: string;
  is_main_contact?: boolean;
  created_at: string;
}

export interface ContractorSubcontractor {
  id: string;
  company_id: string;
  name: string;
  nip?: string;
  address_street?: string;
  address_city?: string;
  address_postal_code?: string;
  address_country?: string;
  workers_count?: number;
  skills?: string;
  note?: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubcontractorWorker {
  id: string;
  subcontractor_id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  position?: string;
  is_main_contact?: boolean;
  created_at: string;
}

// =====================================================
// МОДУЛЬ: СМЕТИРОВАНИЕ (KOSZTORYSOWANIE)
// =====================================================

export type ResourceType = 'labor' | 'material' | 'equipment' | 'overhead';
export type EstimateCalculateMode = 'manual' | 'by_resources';

export interface UnitMeasure {
  id: number;
  company_id?: string;
  code: string;
  name: string;
  is_system: boolean;
}

export interface ValuationGroup {
  id: string;
  company_id: string;
  parent_id?: string;
  name: string;
  code?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  children?: ValuationGroup[];
}

export interface Valuation {
  id: string;
  company_id: string;
  group_id: string;
  code?: string;
  name: string;
  description?: string;
  unit_measure_id?: number;
  price: number;
  resource_type: ResourceType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  unit_measure?: UnitMeasure;
  group?: ValuationGroup;
}

export interface EstimateStage {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  code?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tasks?: EstimateTask[];
  totals?: {
    cost: number;
    cost_with_markup: number;
  };
}

export interface EstimateTask {
  id: string;
  stage_id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  code?: string;
  volume: number;
  unit_measure_id?: number;
  is_group: boolean;
  calculate_mode: EstimateCalculateMode;
  sort_order: number;
  start_date?: string;
  end_date?: string;
  duration?: number;
  created_at: string;
  updated_at: string;
  unit_measure?: UnitMeasure;
  resources?: EstimateResource[];
  children?: EstimateTask[];
  totals?: {
    cost: number;
    cost_with_markup: number;
  };
}

export interface EstimateResource {
  id: string;
  task_id: string;
  project_id: string;
  valuation_id?: string;
  name: string;
  code?: string;
  resource_type: ResourceType;
  unit_measure_id?: number;
  volume: number;
  price: number;
  markup: number;
  cost: number;
  price_with_markup: number;
  cost_with_markup: number;
  contractor_id?: string;
  needed_at?: string;
  url?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  unit_measure?: UnitMeasure;
  valuation?: Valuation;
  contractor?: Contractor;
}

export interface EstimateMarkup {
  id: string;
  project_id: string;
  name?: string;
  value: number;
  type: 'percent' | 'fixed';
  is_nds: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EstimateTotals {
  subtotal: number;
  subtotal_with_markup: number;
  nds: number;
  total: number;
}

// =====================================================
// МОДУЛЬ: ГАРМОНОГРАМ (GANTT)
// =====================================================

export type GanttDependencyType = 'FS' | 'FF' | 'SS' | 'SF';
export type GanttTaskSource = 'estimate' | 'ticket' | 'manual' | 'milestone';

export interface GanttTask {
  id: string;
  project_id: string;
  estimate_task_id?: string | null;
  ticket_id?: string | null;
  title?: string;
  parent_id?: string | null;
  start_date?: string;
  end_date?: string;
  duration?: number;
  progress: number;
  has_custom_progress: boolean;
  is_auto: boolean;
  is_milestone: boolean;
  color?: string;
  sort_order: number;
  source: GanttTaskSource;
  source_id?: string | null;
  assigned_to_id?: string | null;
  supervisor_id?: string | null;
  approver_id?: string | null;
  notes?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  created_at: string;
  updated_at: string;
  // Relations
  estimate_task?: EstimateTask | null;
  ticket?: any;
  assigned_to?: any;
  supervisor?: any;
  approver?: any;
}

export interface GanttDependency {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  dependency_type: GanttDependencyType;
  lag: number;
  created_at: string;
}

// =====================================================
// МОДУЛЬ: ЭЛЕКТРОСМЕТА / KOSZTORYSOWANIE (ELEKTRYCZNE)
// Система расчёта электромонтажных работ
// =====================================================

// Статусы запроса на расчёт
export type KosztorysRequestStatus =
  | 'new'               // Новый
  | 'in_progress'       // В работе
  | 'form_filled'       // Формуляр заполнен
  | 'estimate_generated'// Смета сформирована
  | 'estimate_approved' // Смета утверждена
  | 'estimate_revision' // На доработке
  | 'kp_sent'           // КП отправлено
  | 'closed'            // Закрыт
  | 'cancelled';        // Отменён

// Тип объекта
export type KosztorysObjectType = 'industrial' | 'residential' | 'office';

// Тип установки
export type KosztorysInstallationType = 'IE' | 'IT' | 'IE,IT';

// Тип формуляра
export type KosztorysFormType = 'PREM-IE' | 'PREM-IT' | 'MIESZK-IE' | 'MIESZK-IT';

// Уровень детализации КП
export type KosztorysProposalDetailLevel = 'detailed' | 'aggregated' | 'minimal';

// Источник запроса
export type KosztorysRequestSource = 'email' | 'phone' | 'meeting' | 'tender' | 'other';

// Запрос на расчёт (Zapytanie)
export interface KosztorysRequest {
  id: string;
  company_id: string;
  request_number: string;              // ZAP-YYYY-NNNNN
  status: KosztorysRequestStatus;
  // Client data
  client_name: string;
  nip?: string;                        // Tax ID (NIP)
  company_street?: string;             // Client company address
  company_street_number?: string;
  company_city?: string;
  company_postal_code?: string;
  company_country?: string;
  // Legacy contact fields (migrated to contacts table)
  contact_person: string;
  phone: string;
  email?: string;
  // Object data
  investment_name: string;             // Object name
  object_code?: string;                // Auto-generated code (e.g., WC26)
  object_type: KosztorysObjectType;
  object_type_id?: string;             // FK to kosztorys_object_types
  object_category_id?: string;         // FK to kosztorys_object_categories
  installation_types: KosztorysInstallationType;
  // Object address
  address?: string;                    // Legacy single field
  object_street?: string;
  object_street_number?: string;
  object_city?: string;
  object_postal_code?: string;
  object_country?: string;
  // Other
  planned_response_date?: string;
  notes?: string;
  internal_notes?: string;             // Internal notes (not visible to client)
  request_source?: KosztorysRequestSource;
  assigned_user_id: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  // Relations
  assigned_user?: User;
  created_by?: User;
  forms?: KosztorysForm[];
  estimates?: KosztorysEstimate[];
  files?: KosztorysRequestFile[];
  contacts?: KosztorysRequestContact[];  // Multiple representatives
  object_type_record?: KosztorysObjectTypeRecord;
  object_category?: KosztorysObjectCategoryRecord;
  work_types?: KosztorysRequestWorkType[];  // Selected work types (Rodzaj prac)
}

// Представитель компании (контакт)
export interface KosztorysRequestContact {
  id: string;
  request_id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  position?: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

// Тип объекта (управляемый пользователем)
export interface KosztorysObjectTypeRecord {
  id: string;
  company_id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Категория объекта (управляемая пользователем)
export interface KosztorysObjectCategoryRecord {
  id: string;
  company_id: string;
  object_type_id?: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  object_type?: KosztorysObjectTypeRecord;
}

// Файлы запроса
export interface KosztorysRequestFile {
  id: string;
  request_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by_id: string;
  uploaded_at: string;
}

// Формуляр выполняемых работ
export interface KosztorysForm {
  id: string;
  request_id: string;
  form_type: KosztorysFormType;
  version: number;
  is_current: boolean;
  status: 'draft' | 'completed' | 'archived';
  created_by_id: string;
  created_at: string;
  updated_at: string;
  // Relations
  general_data?: KosztorysFormGeneralData;
  answers?: KosztorysFormAnswer[];
}

// Общие технические данные формуляра (шапка)
export interface KosztorysFormGeneralData {
  id: string;
  form_id: string;
  hall_area?: number;           // Для промышленных
  office_area?: number;         // Для промышленных
  apartments_count?: string;    // Для жилых "120 mieszkań, 8500 m²"
  ext_wall_type?: string;       // Тип наружных стен
  int_wall_type?: string;       // Тип внутренних стен
  hall_ceiling_height?: number; // Высота потолка цеха
  office_ceiling_height?: number;// Высота потолка офисов
  ceiling_height?: number;      // Общая высота потолка
  consumable_material?: string; // Материал эксплуатационный
}

// Отметка в матрице формуляра
export interface KosztorysFormAnswer {
  id: string;
  form_id: string;
  room_code: string;            // Код помещения/элемента
  room_group: string;           // Группа помещения
  work_type_code: string;       // Код вида работ
  work_category: string;        // Категория работ
  is_marked: boolean;
  created_at: string;
}

// Группа помещений для формуляра
export interface KosztorysRoomGroup {
  code: string;
  name: string;
  rooms: KosztorysRoom[];
}

// Помещение/элемент установки
export interface KosztorysRoom {
  code: string;
  name: string;
  description?: string;
}

// Категория работ
export interface KosztorysWorkCategory {
  code: string;
  name: string;
  work_types: Partial<KosztorysWorkType>[];
}

// Вид работ
export interface KosztorysWorkType {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  unit_id: number;
  unit?: string | UnitMeasure;
  task_description?: string;
  expected_result?: string;
  labor_hours?: number;
  labor_hours_per_unit?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Системный каталог робочизны (из Excel, read-only)
export interface KosztorysSystemLabour {
  id: string;
  source_id: number;
  code: string;
  name: string;
  unit: string;
  description?: string;
  comments?: string;
  pkwiu?: string;
  price_unit?: number;
  category_id?: number;
  category_name?: string;
  category_number?: string;
  category_path?: string;
  tags?: string;
  is_active: boolean;
}

export interface KosztorysSystemLabourCategory {
  id: string;
  name: string;
  number?: string;
  path?: string;
  parent_id?: string;
  sort_order: number;
  depth: number;
}

// Собственный каталог робочизны (per company)
export interface KosztorysOwnLabour {
  id: string;
  company_id: string;
  code: string;
  name: string;
  unit?: string;
  price?: number;
  time_hours: number;
  time_minutes: number;
  cost_type: 'rg' | 'ryczalt';
  cost_ryczalt?: number;
  is_active: boolean;
  description?: string;
  category?: string;
  created_at: string;
  updated_at: string;
  materials?: KosztorysOwnLabourMaterial[];
  equipment?: KosztorysOwnLabourEquipment[];
}

export interface KosztorysOwnLabourMaterial {
  id: string;
  labour_id: string;
  material_name: string;
  material_price?: number;
  material_quantity: number;
  source_material_id?: string;
  source_wholesaler?: string;
  source_sku?: string;
  source_url?: string;
}

export interface KosztorysOwnLabourEquipment {
  id: string;
  labour_id: string;
  equipment_name: string;
  equipment_price?: number;
  equipment_quantity: number;
  source_equipment_id?: string;
  source_wholesaler?: string;
  source_sku?: string;
  source_url?: string;
}

// Справочник материалов
export interface KosztorysMaterial {
  id: string;
  company_id: string;
  code: string;
  name: string;
  category?: string;
  manufacturer?: string;
  unit_id: number;
  material_type: 'main' | 'minor' | 'consumable';
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  unit?: UnitMeasure | string;
  default_price?: number;
  ean?: string;
  sku?: string;
  ref_num?: string;
  catalog_price?: number;
  purchase_price?: number;
  images?: string;
  source_wholesaler?: string;
  source_wholesaler_url?: string;
  price_sync_mode?: 'fixed' | 'synced';
}

// Справочник техники
export interface KosztorysEquipment {
  id: string;
  company_id: string;
  code: string;
  name: string;
  category?: string;
  unit_id: number;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  unit?: UnitMeasure | string;
  manufacturer?: string;
  default_price?: number;
  ean?: string;
  sku?: string;
  ref_num?: string;
  catalog_price?: number;
  purchase_price?: number;
  images?: string;
  source_wholesaler?: string;
  source_wholesaler_url?: string;
  price_sync_mode?: 'fixed' | 'synced';
  parameters?: string;
}

// Шаблонное задание
export interface KosztorysTemplateTask {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description?: string;
  work_type_id: string;
  unit_id: number;
  base_quantity?: number;
  labor_hours?: number;
  expected_result?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  work_type?: KosztorysWorkType;
  unit?: UnitMeasure;
  materials?: KosztorysTemplateTaskMaterial[];
  equipment?: KosztorysTemplateTaskEquipment[];
}

// Материал в шаблонном задании
export interface KosztorysTemplateTaskMaterial {
  id: string;
  template_task_id: string;
  material_id: string;
  quantity_coefficient: number;
  material?: KosztorysMaterial;
}

// Техника в шаблонном задании
export interface KosztorysTemplateTaskEquipment {
  id: string;
  template_task_id: string;
  equipment_id: string;
  quantity_coefficient: number;
  equipment?: KosztorysEquipment;
}

// Правило маппинга (формуляр → шаблонное задание)
export interface KosztorysMappingRule {
  id: string;
  company_id: string;
  form_type: KosztorysFormType;
  room_code: string;
  room_group: string;
  work_code?: string;
  work_type_code: string;
  work_category: string;
  template_task_id: string;
  coefficient: number;
  multiplier?: number;
  priority?: number;
  conditions?: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  template_task?: KosztorysTemplateTask;
}

// Прайс-лист
export interface KosztorysPriceList {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  valid_from: string;
  valid_to?: string;
  is_active: boolean;
  created_by_id: string;
  created_at: string;
  items?: KosztorysPriceListItem[];
}

// Позиция прайс-листа
export interface KosztorysPriceListItem {
  id: string;
  price_list_id: string;
  item_type: 'work' | 'material' | 'equipment' | 'labor';
  item_id: string;
  item_code?: string;
  item_name?: string;
  unit?: string;
  unit_price: number;
  price?: number;
  material_id?: string;
  equipment_id?: string;
}

// Смета (Kosztorys)
export interface KosztorysEstimate {
  id: string;
  request_id: string;
  form_id: string;
  company_id: string;
  estimate_number: string;          // KSZ-YYYY-NNNNN
  version: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  vat_rate: number;
  total_works: number;
  total_materials: number;
  total_equipment: number;
  subtotal_net: number;
  vat_amount: number;
  total_gross: number;
  approved_by_id?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  // Relations
  items?: KosztorysEstimateItem[];
  equipment_items?: KosztorysEstimateEquipment[];
  approved_by?: User;
  request?: KosztorysRequest;
}

// Позиция сметы
export interface KosztorysEstimateItem {
  id: string;
  estimate_id: string;
  position_number: number;
  room_group: string;
  installation_element: string;
  task_description: string;
  material_name?: string;
  unit_id: number;
  quantity: number;
  unit_price_work: number;
  total_work: number;
  unit_price_material: number;
  total_material: number;
  total_item: number;
  expected_result?: string;
  source: 'auto' | 'manual';
  template_task_id?: string;
  mapping_rule_id?: string;
  price_deviation_reason?: string;   // Обоснование отклонения цены
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  unit?: UnitMeasure;
}

// Техника в смете
export interface KosztorysEstimateEquipment {
  id: string;
  estimate_id: string;
  equipment_id: string;
  unit_id: number;
  quantity: number;
  unit_price: number;
  total: number;
  equipment?: KosztorysEquipment;
  unit?: UnitMeasure;
}

// Коммерческое предложение (KP)
export interface KosztorysProposal {
  id: string;
  request_id: string;
  estimate_id: string;
  company_id: string;
  kp_number: string;                // KP-YYYY-NNNNN-vN
  version: number;
  detail_level: KosztorysProposalDetailLevel;
  file_path_pdf?: string;
  file_path_xlsx?: string;
  file_path_docx?: string;
  validity_days: number;
  payment_terms?: string;
  execution_terms?: string;
  sent_at?: string;
  viewed_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  client_response?: string;
  created_by_id: string;
  created_at: string;
  // Relations
  request?: KosztorysRequest;
  estimate?: KosztorysEstimate;
}

// Шаблон матрицы формуляра
export interface KosztorysFormTemplate {
  form_type: KosztorysFormType;
  title: string;
  general_fields: KosztorysFormField[];
  room_groups: KosztorysRoomGroup[];
  work_categories: KosztorysWorkCategory[];
}

// Поле в шапке формуляра
export interface KosztorysFormField {
  code: string;
  label: string;
  type: 'text' | 'decimal' | 'integer' | 'select';
  required: boolean;
  placeholder?: string;
  options?: string[]; // для select типа
}

// =====================================================
// НОВЫЕ ТИПЫ ДЛЯ RODZAJ PRAC И РЕДАКТОРА ФОРМУЛЯРОВ
// =====================================================

// Тип работ (Rodzaj prac) - замена installation_types
export interface KosztorysWorkTypeRecord {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Связь запроса с типами работ (многие-ко-многим)
export interface KosztorysRequestWorkType {
  id: string;
  request_id: string;
  work_type_id: string;
  created_at: string;
  work_type?: KosztorysWorkTypeRecord;
}

// Шаблон формуляра из БД
export interface KosztorysFormTemplateDB {
  id: string;
  company_id: string;
  form_type: KosztorysFormType;
  title: string;
  object_type?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  room_groups?: KosztorysFormRoomGroupDB[];
  work_categories?: KosztorysFormWorkCategoryDB[];
  general_fields?: KosztorysFormGeneralFieldDB[];
}

// Группа помещений из БД
export interface KosztorysFormRoomGroupDB {
  id: string;
  template_id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  rooms?: KosztorysFormRoomDB[];
}

// Помещение из БД
export interface KosztorysFormRoomDB {
  id: string;
  group_id: string;
  code: string;
  name: string;
  sort_order: number;
  created_at: string;
}

// Категория работ из БД
export interface KosztorysFormWorkCategoryDB {
  id: string;
  template_id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  work_types?: KosztorysFormWorkTypeDB[];
}

// Тип работы в категории из БД
export interface KosztorysFormWorkTypeDB {
  id: string;
  category_id: string;
  code: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at: string;
}

// Общее поле формуляра из БД
export interface KosztorysFormGeneralFieldDB {
  id: string;
  template_id: string;
  code: string;
  label: string;
  field_type: 'text' | 'decimal' | 'integer' | 'select';
  required: boolean;
  placeholder?: string;
  options?: string[];
  sort_order: number;
  created_at: string;
}

// =====================================================
// МОДУЛЬ: КОНТРАГЕНТЫ (KONTRAHENCI)
// =====================================================

export type ContractorEntityType = 'individual' | 'legal_entity';
export type ContractorType = 'customer' | 'contractor' | 'supplier';

export interface ContractorGroup {
  id: string;
  company_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Contractor {
  id: string;
  company_id: string;
  group_id?: string;
  contractor_entity_type: ContractorEntityType;
  contractor_type: ContractorType;
  name: string;
  short_name?: string;
  contact_person?: string;
  position?: string;
  phone?: string;
  email?: string;
  website?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  nip?: string;
  regon?: string;
  legal_address?: string;
  actual_address?: string;
  bank_name?: string;
  bank_bik?: string;
  bank_account?: string;
  bank_corr_account?: string;
  notes?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  group?: ContractorGroup;
}

// =====================================================
// МОДУЛЬ: ОФФЕРЫ / КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ (OFERTOWANIE)
// =====================================================

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'negotiation';

export interface OfferTemplate {
  id: string;
  company_id?: string;
  name: string;
  description?: string;
  content: Record<string, any>;
  print_settings: Record<string, any>;
  is_system: boolean;
  is_active: boolean;
  preview_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Offer {
  id: string;
  company_id: string;
  project_id?: string;
  client_id?: string;
  template_id?: string;
  number?: string;
  name: string;
  status: OfferStatus;
  language: string;
  currency_id?: number;
  valid_until?: string;
  total_amount: number;
  discount_percent: number;
  discount_amount: number;
  final_amount: number;
  notes?: string;
  internal_notes?: string;
  print_settings: Record<string, any>;
  public_token?: string;
  public_url?: string;
  viewed_at?: string;
  viewed_count: number;
  sent_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  project?: Project;
  client?: Contractor;
  template?: OfferTemplate;
  sections?: OfferSection[];
  items?: OfferItem[];
}

export type OfferRequestType = 'robota' | 'materialy' | 'sprzet' | 'all';
export type OfferRequestStatus = 'draft' | 'sent' | 'viewed' | 'responded' | 'accepted' | 'rejected';

export interface OfferRequest {
  id: string;
  company_id: string;
  offer_id: string;
  subcontractor_id?: string;
  name: string;
  request_type: OfferRequestType;
  status: OfferRequestStatus;
  share_token?: string;
  notes?: string;
  print_settings: Record<string, any>;
  response_data?: Record<string, any>;
  sent_at?: string;
  viewed_at?: string;
  responded_at?: string;
  created_by_id?: string;
  created_at: string;
  updated_at: string;
  // Joined
  offer?: Offer;
  subcontractor?: Contractor;
}

export interface OfferSection {
  id: string;
  offer_id: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  items?: OfferItem[];
}

export interface OfferItem {
  id: string;
  offer_id: string;
  section_id?: string;
  source_resource_id?: string;
  name: string;
  description?: string;
  unit_measure_id?: number;
  unit?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  sort_order: number;
  is_optional: boolean;
  discount_percent?: number;
  vat_rate?: number;
  created_at: string;
  updated_at: string;
  unit_measure?: UnitMeasure;
}

// =====================================================
// МОДУЛЬ: РАСШИРЕННЫЕ ЗАДАЧИ / ТИКЕТЫ (ZADANIA)
// =====================================================

export type TicketStatusType = 'open' | 'in_progress' | 'review' | 'resolved' | 'closed' | 'rejected';
export type TicketPriorityType = 'low' | 'normal' | 'high' | 'critical';
export type TicketFieldType = 'text' | 'number' | 'date' | 'datetime' | 'select' | 'multiselect' | 'user' | 'file' | 'checkbox';

export interface TicketType {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  is_default: boolean;
  is_active: boolean;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
  fields?: TicketTypeField[];
}

export interface TicketTypeField {
  id: string;
  ticket_type_id: string;
  name: string;
  field_type: TicketFieldType;
  options?: { value: string; label: string }[];
  is_required: boolean;
  is_visible: boolean;
  default_value?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TicketStatus {
  id: number;
  company_id?: string;
  name: string;
  color: string;
  is_default: boolean;
  is_closed: boolean;
  sort_order: number;
}

export interface TicketPriority {
  id: number;
  company_id?: string;
  name: string;
  color: string;
  is_default: boolean;
  sort_order: number;
}

export interface Ticket {
  id: string;
  company_id: string;
  project_id: string;
  ticket_type_id: string;
  parent_id?: string;
  code?: string;
  title: string;
  description?: string;
  status_id: number;
  priority_id?: number;
  assigned_to_id?: string;
  author_id: string;
  due_date?: string;
  start_date?: string;
  end_date?: string;
  duration?: number;
  progress: number;
  component_id?: string;
  plan_id?: string;
  position_x?: number;
  position_y?: number;
  custom_fields: Record<string, any>;
  is_locked: boolean;
  locked_by_id?: string;
  locked_at?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  deleted_at?: string;
  project?: Project;
  ticket_type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_to?: User;
  author?: User;
  component?: PlanComponent;
  plan?: Plan;
  children?: Ticket[];
  comments?: TicketComment[];
  journals?: TicketJournal[];
  attachments?: TicketAttachment[];
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  author?: User;
}

export interface TicketJournal {
  id: string;
  ticket_id: string;
  user_id: string;
  action: 'created' | 'updated' | 'status_changed' | 'assigned' | 'commented';
  old_value?: Record<string, any>;
  new_value?: Record<string, any>;
  created_at: string;
  user?: User;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  uploaded_by_id: string;
  created_at: string;
  uploaded_by?: User;
}

// =====================================================
// МОДУЛЬ: PLANY I RZUTY
// =====================================================

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface Plan {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  description?: string;
  status: PlanStatus;
  version?: string;
  file_name?: string;
  file_url?: string;
  thumbnail_url?: string;
  storage_path?: string;
  file_type?: string;
  file_size?: number;
  preview_path?: string;
  scale?: string;
  sort_order: number;
  uploaded_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  children?: Plan[];
  components?: PlanComponent[];
}

export interface PlanComponent {
  id: string;
  plan_id: string;
  parent_id?: string;
  name: string;
  description?: string;
  component_type: string;
  geometry: Record<string, any>;
  properties: Record<string, any>;
  style: Record<string, any>;
  layer?: string;
  is_visible: boolean;
  is_locked: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  tickets?: Ticket[];
}

// =====================================================
// МОДУЛЬ: DMS (ДОКУМЕНТЫ)
// =====================================================

export type DMSDocumentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';

export interface DMSFolder {
  id: string;
  project_id?: string;
  company_id: string;
  parent_id?: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  is_system: boolean;
  permissions: Record<string, any>;
  sort_order: number;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  children?: DMSFolder[];
  documents?: DMSDocument[];
}

export type DMSFile = DMSDocument;

export interface DMSDocument {
  id: string;
  folder_id: string;
  project_id?: string;
  company_id: string;
  name: string;
  description?: string;
  file_name: string;
  file_url?: string;
  mime_type?: string;
  size?: number;
  thumbnail_url?: string;
  storage_path: string;
  file_type: string;
  file_size: number;
  preview_path?: string;
  status: DMSDocumentStatus;
  version: number;
  tags: string[];
  metadata: Record<string, any>;
  is_template: boolean;
  template_id?: string;
  uploaded_by_id: string;
  created_by_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  uploaded_by?: User;
  versions?: DMSDocumentVersion[];
  permissions?: DMSDocumentPermission[];
}

export interface DMSDocumentVersion {
  id: string;
  document_id: string;
  version: number;
  file_name: string;
  storage_path: string;
  file_size: number;
  change_notes?: string;
  created_by_id: string;
  created_at: string;
  created_by?: User;
}

export interface DMSDocumentPermission {
  id: string;
  document_id: string;
  user_id?: string;
  role_id?: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_share: boolean;
  created_at: string;
}

// =====================================================
// МОДУЛЬ: ФИНАНСЫ (FINANSE)
// =====================================================

export type TransactionType = 'income' | 'expense';
export type TransactionStatus = 'pending' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other';

export interface FinanceCategory {
  id: string;
  company_id: string;
  parent_id?: string;
  name: string;
  transaction_type: TransactionType;
  color: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  children?: FinanceCategory[];
}

export interface FinanceTransaction {
  id: string;
  company_id: string;
  project_id?: string;
  category_id?: string;
  contractor_id?: string;
  account_id?: string;
  transaction_type: TransactionType;
  operation_type?: string;
  amount: number;
  currency_id: number;
  exchange_rate: number;
  amount_base: number;
  description?: string;
  reference_number?: string;
  document_number?: string;
  transaction_date: string;
  operation_date?: string;
  due_date?: string;
  status: TransactionStatus;
  payment_method?: PaymentMethod;
  is_recurring: boolean;
  recurring_settings?: Record<string, any>;
  attachments: string[];
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  category?: FinanceCategory;
  project?: Project;
  contractor?: Contractor;
}

export interface FinanceBudget {
  id: string;
  project_id: string;
  category_id?: string;
  name: string;
  planned_amount: number;
  spent_amount: number;
  period_start?: string;
  period_end?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  category?: FinanceCategory;
}

export interface FinanceAccount {
  id: string;
  company_id: string;
  name: string;
  type: string;
  account_type?: string;
  account_number?: string;
  bank_name?: string;
  balance: number;
  current_balance?: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type FinanceOperation = FinanceTransaction;

export interface FinanceAct {
  id: string;
  company_id: string;
  project_id?: string;
  contractor_id?: string;
  name?: string;
  number: string;
  type: string;
  status: string;
  payment_status?: string;
  amount: number;
  total?: number;
  paid_amount?: number;
  nds_amount?: number;
  date: string;
  act_date?: string;
  period_start?: string;
  period_end?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// МОДУЛЬ: ЗАКУПКИ (ZAOPATRZENIE)
// =====================================================

export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered' | 'received' | 'cancelled';
export type PurchaseOrderStatus = 'draft' | 'sent' | 'confirmed' | 'in_delivery' | 'received' | 'cancelled';

export interface PurchaseRequest {
  id: string;
  company_id: string;
  project_id?: string;
  number?: string;
  title: string;
  description?: string;
  status: PurchaseRequestStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  needed_by?: string;
  total_estimated: number;
  approved_by_id?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  items?: PurchaseRequestItem[];
  project?: Project;
}

export interface PurchaseRequestItem {
  id: string;
  request_id: string;
  resource_id?: string;
  name: string;
  description?: string;
  unit_measure_id?: number;
  quantity: number;
  estimated_price?: number;
  url?: string;
  notes?: string;
  sort_order: number;
  created_at: string;
  unit_measure?: UnitMeasure;
}

export interface PurchaseOrder {
  id: string;
  company_id: string;
  project_id?: string;
  contractor_id?: string;
  request_id?: string;
  number?: string;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_delivery?: string;
  actual_delivery?: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  shipping_address?: string;
  notes?: string;
  internal_notes?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  items?: PurchaseOrderItem[];
  contractor?: Contractor;
  project?: Project;
}

export interface PurchaseOrderItem {
  id: string;
  order_id: string;
  request_item_id?: string;
  name: string;
  description?: string;
  unit_measure_id?: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  received_quantity: number;
  sort_order: number;
  created_at: string;
  unit_measure?: UnitMeasure;
}

// =====================================================
// МОДУЛЬ: СОГЛАСОВАНИЯ (UZGODNIENIA)
// =====================================================

export type ApprovalStatus = 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalEntityType = 'document' | 'estimate' | 'offer' | 'purchase_request' | 'purchase_order' | 'ticket' | 'other' | 'act' | 'change_request' | 'order';

export interface ApprovalWorkflow {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  entity_type: ApprovalEntityType;
  entity_types?: ApprovalEntityType[];
  is_active: boolean;
  is_default: boolean;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
  steps?: ApprovalWorkflowStep[];
}

export interface ApprovalWorkflowStep {
  id: string;
  workflow_id: string;
  name: string;
  step_order: number;
  approver_type: 'user' | 'role' | 'any_of_users';
  approver_ids: string[];
  is_required: boolean;
  can_reject: boolean;
  auto_approve_after_days?: number;
  created_at: string;
}

export interface Approval {
  id: string;
  company_id: string;
  workflow_id?: string;
  workflow_template_id?: string;
  entity_type: ApprovalEntityType;
  entity_id: string;
  entity_name: string;
  subject?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  status: ApprovalStatus;
  current_step: number;
  initiated_by_id: string;
  initiated_at: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  workflow?: ApprovalWorkflow;
  steps?: ApprovalStep[];
}

export interface ApprovalStep {
  id: string;
  approval_id: string;
  step_order: number;
  approver_id?: string;
  status: ApprovalStatus;
  comment?: string;
  decided_at?: string;
  created_at: string;
  approver?: User;
}

// Aliases for backward compatibility
export type ApprovalRequest = Approval;
export type ApprovalWorkflowTemplate = ApprovalWorkflow;
export type ApprovalAction = ApprovalStep;

// =====================================================
// РОЛИ СТРОИТЕЛЬСТВА
// =====================================================

export enum ConstructionRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  PROJECT_MANAGER = 'project_manager',
  ESTIMATOR = 'estimator',
  FOREMAN = 'foreman',
  SUBCONTRACTOR = 'subcontractor',
  OBSERVER = 'observer',
  ACCOUNTANT = 'accountant'
}

// =====================================================
// ПАПКИ ПРОЕКТОВ
// =====================================================

export interface ProjectFolder {
  id: string;
  company_id: string;
  parent_id?: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  children?: ProjectFolder[];
  projects_count?: number;
}

// =====================================================
// МОДУЛЬ: СМЕТИРОВАНИЕ (KOSZTORYSOWANIE)
// Полный модуль сметирования
// =====================================================

// Типы сметы
export type KosztorysType = 'investor' | 'contractor' | 'offer';

// Валюта
export type KosztorysCurrency = 'PLN' | 'EUR' | 'USD';

// Тип ресурса
export type KosztorysResourceType = 'labor' | 'material' | 'equipment' | 'waste';

// Тип накладных
export type KosztorysOverheadType = 'percentage' | 'fixed';

// Тип нормы
export type KosztorysNormType = 'absolute' | 'relative';

// Способ округления
export type KosztorysRoundingMethod = 'default' | 'PN-70/N-02120';

// Шаблон расчёта
export type KosztorysCalculationTemplate = 'overhead-on-top' | 'overhead-included' | 'overhead-cascade' | 'simple';

// Тип источника индекса
export type KosztorysOriginIndexType = 'ETO' | 'KNNR' | 'KNR' | 'KSNR' | 'custom' | 'knr' | 'knnr' | 'ksnr';

// =====================================================
// Настройки точности (Precision Settings)
// =====================================================
export interface KosztorysPrecisionSettings {
  norms: number;          // Точность норм (6-7 знаков)
  resources: number;      // Точность ресурсов (2 знака)
  measurements: number;   // Точность обмеров (2-3 знака)
  unitValues: number;     // Точность ед. значений (2 знака)
  positionBase: number;   // Точность позиции (1-2 знака)
  costEstimateBase: number;  // Точность сметы (2 знака)
  roundingMethod: KosztorysRoundingMethod;
}

// =====================================================
// Настройки печати (Print Settings)
// =====================================================
export type KosztorysPrintPageType =
  | 'title'
  | 'detailed-cost-calculations'
  | 'simplified-cost-estimate.offer'
  | 'assembled-elements'
  | 'measurements'
  | 'cost-estimate.offer'
  | 'cost-estimate.investor'
  | 'labor-list'
  | 'equipment-list'
  | 'material-list';

export interface KosztorysPrintPage {
  type: 'predefined';
  name: KosztorysPrintPageType;
  enabled: boolean;
}

export interface KosztorysTitlePageSettings {
  companyInfo: {
    name: string;
    address: string;
    contacts: string[];
  };
  documentTitle: string;
  showCostFields: boolean;
  showManHourRate: boolean;
  showOverheadsCosts: boolean;
  orderDetails: {
    orderName: string;
    constructionSiteAddress: string;
  };
  clientDetails: {
    clientName: string;
    clientAddress: string;
  };
  contractorDetails: {
    contractorName: string;
    contractorAddress: string;
    industry: string;
  };
  participants: {
    preparedBy: string;
    preparedAt: string;
    preparedByIndustry: string;
    checkedBy: string;
    checkedAt: string;
    checkedByIndustry: string;
  };
}

export interface KosztorysPrintSettings {
  pages: KosztorysPrintPage[];
  titlePage: KosztorysTitlePageSettings;
}

// =====================================================
// Коэффициенты (Factors)
// =====================================================
export interface KosztorysFactors {
  labor: number;       // Коэффициент на робочизну (r-g)
  material: number;    // Коэффициент на материалы
  equipment: number;   // Коэффициент на оборудование
  waste: number;       // Коэффициент на отходы (в %)
}

// =====================================================
// Накладные расходы (Overhead)
// =====================================================
export interface KosztorysOverhead {
  id: string;
  name: string;        // "Koszty pośrednie (Kp)", "Zysk (Z)", "Koszty zakupu (Kz)"
  type: KosztorysOverheadType;
  value: number;       // Процент или фиксированная сумма
  appliesTo: KosztorysResourceType[];  // На что начисляется
  order: number;       // Порядок применения
}

// =====================================================
// Единица измерения (Unit)
// =====================================================
export interface KosztorysUnit {
  label: string;      // "m3", "r-g", "szt."
  unitIndex: string;  // "060", "149", "020"
}

// =====================================================
// Денежное значение (Money)
// =====================================================
export interface KosztorysMoney {
  value: number;
  currency: KosztorysCurrency;
}

// =====================================================
// Обмеры (Measurements)
// =====================================================
export interface KosztorysMeasurementEntry {
  id: string;
  type: 'expression' | 'value';
  expression: string;        // Формула: "10*2.5" или "0"
  description: string | null;
}

export interface KosztorysMeasurements {
  rootIds: string[];
  entries: Record<string, KosztorysMeasurementEntry>;
}

// =====================================================
// Ресурс (Resource) - КЛЮЧЕВОЙ ОБЪЕКТ ДЛЯ РАСЧЁТОВ
// =====================================================
export interface KosztorysResource {
  id: string;
  name: string;              // "robotnicy", "kabel YKY 3x2.5"
  index: string | null;      // Индекс в каталоге
  originIndex: {
    type: KosztorysOriginIndexType;
    index: string;
  };

  type: KosztorysResourceType;
  factor: number;            // Коэффициент ресурса

  norm: {
    type: KosztorysNormType;
    value: number;           // Норма расхода (1.35 r-g на единицу)
  };

  unit: KosztorysUnit;
  unitPrice: KosztorysMoney;          // Цена за единицу (51.86 PLN/r-g)

  group: string | null;      // Группа ресурсов
  marker: string | null;
  investorTotal: boolean;    // Для инвесторской сметы

  // Вычисляемые поля
  calculatedQuantity?: number;
  calculatedValue?: number;
}

// =====================================================
// Позиция сметы (Position) - ГЛАВНЫЙ ОБЪЕКТ
// =====================================================
export interface KosztorysPosition {
  id: string;
  base: string;              // Норматив: "KNNR 5 0701-01"
  originBase: string;        // Исходный норматив
  name: string;              // "Kopanie rowów dla kabli..."
  marker: string | null;     // Маркер/тег

  unit: KosztorysUnit;                // Единица измерения
  measurements: KosztorysMeasurements; // Обмеры
  multiplicationFactor: number;  // Множитель позиции

  resources: KosztorysResource[];     // Ресурсы (труд, материалы, техника)
  factors: KosztorysFactors;          // Коэффициенты позиции
  overheads: KosztorysOverhead[];     // Накладные позиции

  unitPrice: KosztorysMoney;          // Цена за единицу (для упрощённых смет)

  // Вычисляемые поля
  quantity?: number;
  totalLabor?: number;
  totalMaterial?: number;
  totalEquipment?: number;
  totalDirect?: number;       // Koszty bezpośrednie
  totalWithOverheads?: number; // Razem z narzutami
  unitCost?: number;          // Cena jednostkowa
}

// =====================================================
// Раздел сметы (Section)
// =====================================================
export interface KosztorysSection {
  id: string;
  name: string;
  description: string;
  ordinalNumber: string;     // "1", "1.1", "1.1.1"
  positionIds: string[];      // Позиции в разделе
  subsectionIds: string[];    // Подразделы
  factors: KosztorysFactors;           // Коэффициенты раздела
  overheads: KosztorysOverhead[];      // Накладные раздела

  // Вычисляемые поля
  totalLabor?: number;
  totalMaterial?: number;
  totalEquipment?: number;
  totalValue?: number;
}

// =====================================================
// Корневые данные сметы (Root Data)
// =====================================================
export interface KosztorysRootData {
  sectionIds: string[];      // ID разделов верхнего уровня
  positionIds: string[];     // ID позиций вне разделов
  factors: KosztorysFactors;           // Глобальные коэффициенты
  overheads: KosztorysOverhead[];      // Накладные расходы
}

// =====================================================
// Данные сметы (Cost Estimate Data)
// =====================================================
export interface KosztorysCostEstimateData {
  root: KosztorysRootData;
  sections: Record<string, KosztorysSection>;
  positions: Record<string, KosztorysPosition>;
}

// =====================================================
// Настройки сметы (Cost Estimate Settings)
// =====================================================
export interface KosztorysCostEstimateSettings {
  type: KosztorysType;                 // Тип сметы
  name: string;                        // Название
  description: string;                 // Описание
  created: string;                     // ISO datetime
  modified: string;
  defaultCurrency: KosztorysCurrency;

  print: KosztorysPrintSettings;
  precision: KosztorysPrecisionSettings;
  calculationTemplate: KosztorysCalculationTemplate;
  vatRate?: number;                    // Stawka VAT (domyślnie 23%)
}

// =====================================================
// Смета (Cost Estimate) - ГЛАВНАЯ СУЩНОСТЬ
// =====================================================
export interface KosztorysCostEstimate {
  id: string;
  company_id: string;
  created_by_id: string;

  settings: KosztorysCostEstimateSettings;
  data: KosztorysCostEstimateData;

  // Итоги
  totalLabor: number;
  totalMaterial: number;
  totalEquipment: number;
  totalOverhead: number;
  totalValue: number;

  created_at: string;
  updated_at: string;
}

// =====================================================
// Каталог нормативов
// =====================================================
export interface KosztorysCatalog {
  id: string;
  code: string;              // KNNR, KNR, KSNR
  name: string;
  description?: string;
}

export interface KosztorysCatalogItem {
  id: string;
  catalog_id: string;
  code: string;              // "KNNR 5 0701-01"
  name: string;
  unit: KosztorysUnit;
  defaultResources: KosztorysResource[];
}

// =====================================================
// Шаблон накладных расходов
// =====================================================
export interface KosztorysOverheadTemplate {
  id: string;
  company_id: string;
  name: string;
  type: KosztorysOverheadType;
  value: number;
  appliesToLabor: boolean;
  appliesToMaterial: boolean;
  appliesToEquipment: boolean;
  isDefault: boolean;
}

// =====================================================
// Комментарий / Задача к смете
// =====================================================
export type KosztorysTaskCategory = 'none' | 'needs_verification' | 'price_check' | 'measurement_check';
export type KosztorysTaskStatus = 'todo' | 'in_progress' | 'done';

export interface KosztorysThread {
  id: string;
  costEstimateId: string;
  anchorId: string | null;   // ID позиции или раздела
  taskCategory: KosztorysTaskCategory;
  taskStatus: KosztorysTaskStatus;
  content: string;
  assigneeId: string | null;
  authorId: string;
  createdAt: string;
  updatedAt: string | null;
  comments?: KosztorysThreadComment[];
}

export interface KosztorysThreadComment {
  id: string;
  threadId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

// =====================================================
// Справочник единиц измерения (Units)
// =====================================================
export interface KosztorysUnitReference {
  id: number;
  index: string;   // "020", "033", "040"...
  unit: string;    // "szt.", "kg", "m"
  name: string;    // "sztuka", "kilogram", "metr"
  lang: string;    // "pl"
}

// =====================================================
// Результат расчёта позиции
// =====================================================
export interface KosztorysPositionCalculationResult {
  quantity: number;
  laborTotal: number;
  materialTotal: number;
  equipmentTotal: number;
  directCostsTotal: number;
  overheadsTotal: number;
  totalWithOverheads: number;
  unitCost: number;
  resources: {
    id: string;
    calculatedQuantity: number;
    calculatedValue: number;
  }[];
}

// =====================================================
// Результат расчёта сметы
// =====================================================
export interface KosztorysCostEstimateCalculationResult {
  totalLabor: number;
  totalMaterial: number;
  totalEquipment: number;
  totalDirect: number;
  totalOverheads: number;
  totalValue: number;
  sections: Record<string, {
    totalLabor: number;
    totalMaterial: number;
    totalEquipment: number;
    totalValue: number;
    laborTotal?: number;
    materialTotal?: number;
    equipmentTotal?: number;
  }>;
  positions: Record<string, KosztorysPositionCalculationResult>;
}

// =====================================================
// UI состояние редактора
// =====================================================
export interface KosztorysEditorState {
  selectedItemId: string | null;
  selectedItemType: 'section' | 'position' | 'resource' | null;
  expandedSections: Set<string>;
  expandedPositions: Set<string>;
  expandedSubsections: Set<string>;
  clipboard: {
    id: string;
    type: 'section' | 'position' | 'resource';
    action: 'copy' | 'cut';
    data?: any;
  } | null;
  isDirty: boolean;
  lastSaved: string | null;
  treeRootExpanded?: boolean;
}

// =====================================================
// WHOLESALER INTEGRATION TYPES
// =====================================================

export interface WholesalerIntegration {
  id: string;
  company_id: string;
  wholesaler_id: string;
  wholesaler_name: string;
  branza: string;
  credentials: {
    username?: string;
    password?: string;
    cookies?: Record<string, string>;
    gql_works?: boolean;
    last_refresh?: string;
    [key: string]: any;
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =====================================================
// MISSING TYPE DEFINITIONS (used by constants.ts)
// =====================================================

export type FinanceOperationType = 'income' | 'expense';
export type FinanceOperationStatus = 'pending' | 'completed' | 'cancelled';

export type ActStatus = 'draft' | 'sent' | 'accepted' | 'rejected';
export type ActPaymentStatus = 'unpaid' | 'partial' | 'paid';
export type ActType = 'customer' | 'contractor';
export type ActFormType = 'KS2' | 'KS6a' | 'free';

export type ResourceRequestStatus = 'new' | 'partial' | 'ordered' | 'received' | 'cancelled';
export type OrderStatus = 'draft' | 'sent' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type OrderDeliveryStatus = 'pending' | 'partial' | 'delivered';
export type OrderPaymentStatus = 'unpaid' | 'partial' | 'paid';

export type StockOperationType = 'receipt' | 'issue' | 'transfer' | 'inventory';

export type ApprovalRequestStatus = 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalActionType = 'approved' | 'rejected' | 'returned' | 'delegated';

export type DMSPermission = 'view' | 'download' | 'edit' | 'delete' | 'manage';
export type DMSActivityAction = 'created' | 'viewed' | 'downloaded' | 'updated' | 'renamed' | 'moved' | 'deleted' | 'restored' | 'permission_changed' | 'version_created';

export type MarkupType = 'line' | 'arrow' | 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'polyline' | 'freehand' | 'text' | 'measurement';

// =====================================================
// PROCUREMENT TYPES
// =====================================================

export interface ResourceRequest {
  id: string;
  company_id: string;
  project_id?: string;
  name?: string;
  title: string;
  description?: string;
  status: ResourceRequestStatus;
  priority: 'low' | 'normal' | 'medium' | 'high' | 'urgent';
  resource_type?: string;
  needed_at?: string;
  volume_required?: number;
  is_over_budget?: boolean;
  requested_by_id: string;
  approved_by_id?: string;
  items?: any[];
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  company_id: string;
  project_id?: string;
  request_id?: string;
  supplier_id?: string;
  contractor_id?: string;
  number?: string;
  order_number?: string;
  order_date?: string;
  expected_delivery?: string;
  status: OrderStatus;
  delivery_status?: OrderDeliveryStatus;
  payment_status?: OrderPaymentStatus;
  total?: number;
  total_amount?: number;
  nds_amount?: number;
  notes?: string;
  items?: any[];
  created_at: string;
  updated_at: string;
}

export interface Stock {
  id: string;
  company_id: string;
  project_id?: string;
  name: string;
  description?: string;
  address?: string;
  location?: string;
  type?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockBalance {
  id: string;
  stock_id: string;
  material_id?: string;
  equipment_id?: string;
  name?: string;
  item_name: string;
  item_code?: string;
  unit?: string;
  quantity: number;
  available_quantity?: number;
  min_quantity?: number;
  total_value?: number;
  last_operation_at?: string;
}
