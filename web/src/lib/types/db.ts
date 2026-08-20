/**
 * Database types.
 *
 * Hand-authored to match supabase/migrations. Once your project is linked you
 * can replace this file with generated output:
 *   npm run db:types
 */

export type WorkKind =
  | 'assignment' | 'quiz' | 'exam' | 'project'
  | 'reading' | 'lab' | 'discussion' | 'other';

export type WorkStatus = 'todo' | 'in_progress' | 'submitted' | 'graded' | 'dropped';
export type WorkSource = 'manual' | 'canvas' | 'gradescope' | 'ics';
export type NoteKind = 'page' | 'handwritten' | 'mixed';
export type AttachmentKind = 'image' | 'pdf' | 'ink' | 'audio' | 'file';
export type IntegrationProvider = 'canvas' | 'google' | 'notion' | 'gradescope' | 'ics';
export type IntegrationStatus = 'connected' | 'expired' | 'error' | 'disconnected';
export type ReminderChannel = 'push' | 'email';
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled';

/** Insert requires `R` keys; everything else is optional (DB defaults fill in). */
type Table<Row, R extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, R> & Partial<Omit<Row, R>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Profile = {
  id: string;
  display_name: string | null;
  timezone: string;
  default_reminder_offsets: number[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
};

export type Term = {
  id: string;
  user_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Course = {
  id: string;
  user_id: string;
  term_id: string | null;
  code: string | null;
  title: string;
  section: string | null;
  color: string;
  credits: number | null;
  location: string | null;
  notes: string | null;
  canvas_course_id: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Instructor = {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  office: string | null;
  pronouns: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OfficeHour = {
  id: string;
  user_id: string;
  instructor_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
  url: string | null;
  by_appointment: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseMeeting = {
  id: string;
  user_id: string;
  course_id: string;
  kind: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
  url: string | null;
  /** Bounds the weekly pattern to the weeks the class actually runs. */
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseLink = {
  id: string;
  user_id: string;
  course_id: string;
  kind: string;
  label: string;
  url: string;
  passcode: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Assignment = {
  id: string;
  user_id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  kind: WorkKind;
  status: WorkStatus;
  due_at: string | null;
  due_is_all_day: boolean;
  available_at: string | null;
  lock_at: string | null;
  points: number | null;
  score: number | null;
  priority: number;
  estimated_minutes: number | null;
  url: string | null;
  source: WorkSource;
  canvas_assignment_id: number | null;
  source_hash: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  user_id: string;
  course_id: string | null;
  parent_id: string | null;
  title: string;
  kind: NoteKind;
  body: string;
  tags: string[];
  session_date: string | null;
  is_pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteLink = {
  source_note_id: string;
  target_note_id: string;
};

export type Attachment = {
  id: string;
  user_id: string;
  note_id: string | null;
  course_id: string | null;
  kind: AttachmentKind;
  storage_path: string;
  filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  ink_metadata: Record<string, unknown> | null;
  page_index: number;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  kind: string;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
  updated_at: string;
};

export type Integration = {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  account_label: string | null;
  /** Stable per-account identifier (Google email, Canvas host). */
  external_account_id: string;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationSecret = {
  integration_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[] | null;
  created_at: string;
  updated_at: string;
};

export type CalendarEventLink = {
  id: string;
  user_id: string;
  assignment_id: string;
  provider: IntegrationProvider;
  integration_id: string | null;
  external_calendar_id: string | null;
  external_event_id: string;
  content_hash: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
  user_id: string;
  assignment_id: string;
  offset_minutes: number | null;
  remind_at: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  sent_at: string | null;
  error: string | null;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type ExternalCalendar = {
  id: string;
  user_id: string;
  integration_id: string;
  external_id: string;
  name: string;
  description: string | null;
  color: string | null;
  color_override: string | null;
  timezone: string | null;
  is_primary: boolean;
  is_visible: boolean;
  sync_enabled: boolean;
  is_app_managed: boolean;
  access_role: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  user_id: string;
  calendar_id: string;
  external_event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  status: string | null;
  recurring_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NotionPageLink = {
  id: string;
  user_id: string;
  assignment_id: string;
  integration_id: string;
  database_id: string;
  page_id: string;
  content_hash: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type SyncRun = {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  direction: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_created: number;
  items_updated: number;
  items_skipped: number;
  error: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, 'id'>;
      terms: Table<Term, 'user_id' | 'name'>;
      courses: Table<Course, 'user_id' | 'title'>;
      instructors: Table<Instructor, 'user_id' | 'course_id' | 'name'>;
      office_hours: Table<OfficeHour, 'user_id' | 'instructor_id' | 'weekday' | 'starts_at' | 'ends_at'>;
      course_meetings: Table<CourseMeeting, 'user_id' | 'course_id' | 'weekday' | 'starts_at' | 'ends_at'>;
      course_links: Table<CourseLink, 'user_id' | 'course_id' | 'label' | 'url'>;
      assignments: Table<Assignment, 'user_id' | 'title'>;
      notes: Table<Note, 'user_id'>;
      note_links: Table<NoteLink, 'source_note_id' | 'target_note_id'>;
      attachments: Table<Attachment, 'user_id' | 'kind' | 'storage_path'>;
      documents: Table<Document, 'user_id' | 'course_id' | 'title'>;
      integrations: Table<Integration, 'user_id' | 'provider'>;
      integration_secrets: Table<IntegrationSecret, 'integration_id'>;
      calendar_event_links: Table<CalendarEventLink, 'user_id' | 'assignment_id' | 'provider' | 'external_event_id'>;
      reminders: Table<Reminder, 'user_id' | 'assignment_id' | 'remind_at'>;
      push_subscriptions: Table<PushSubscriptionRow, 'user_id' | 'endpoint' | 'p256dh' | 'auth'>;
      sync_runs: Table<SyncRun, 'user_id' | 'provider'>;
      external_calendars: Table<ExternalCalendar, 'user_id' | 'integration_id' | 'external_id' | 'name'>;
      calendar_events: Table<CalendarEvent, 'user_id' | 'calendar_id' | 'external_event_id' | 'starts_at' | 'ends_at'>;
      notion_page_links: Table<NotionPageLink, 'user_id' | 'assignment_id' | 'integration_id' | 'database_id' | 'page_id'>;
    };
    Views: Record<never, never>;
    Functions: {
      sync_assignment_reminders: {
        Args: { p_assignment_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      work_kind: WorkKind;
      work_status: WorkStatus;
      work_source: WorkSource;
      note_kind: NoteKind;
      attachment_kind: AttachmentKind;
      integration_provider: IntegrationProvider;
      integration_status: IntegrationStatus;
      reminder_channel: ReminderChannel;
      reminder_status: ReminderStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
