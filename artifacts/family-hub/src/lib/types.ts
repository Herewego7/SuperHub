export type TabType = "home" | "calendar" | "chores" | "todos" | "people" | "meals" | "behaviour";
export type ChoresSubTabType = "chores" | "rewards" | "trophies" | "bonus";

export interface EventDisplay {
  id: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  assignedProfiles: Array<{
    id: string;
    name: string;
    color: string;
    initials: string;
    photoUrl?: string | null;
  }>;
  timeUntil: string;
  profileIds: string[] | null;
  isAllDay: boolean | null;
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
  profileId?: string | null;
  profileName?: string;
  profileColor?: string;
  recurrenceType?: "daily" | "weekly" | "monthly" | "annually" | null;
  recurrenceEndDate?: Date | null;
  isRecurringInstance?: boolean;
  seriesId?: string;
}

export interface ProfileCircleProps {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoUrl?: string | null;
  isSelected: boolean;
  onToggle: (id: string) => void;
  /** When true, the circle shrinks and hides its name label (sticky-scroll condensed mode). */
  condensed?: boolean;
}

export interface ChoreDisplay {
  id: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  taskType?: string;
  points: number;
  profileIds: string[];
  profileNames: string[];
  profileColors: string[];
  daysOfWeek: number[];
  isCompleted: boolean;
  completionDate?: Date;
  assignedProfileId?: string; // For tracking which specific profile this display is for
  // Target-count fields
  isTargetChore?: boolean;
  targetCount?: number | null;
  targetPeriod?: string | null;
  targetProgress?: number; // completions in current period
  lastCompletionDate?: Date; // most-recent completion timestamp (used for target-chore isRecent grace)
  // True for regular (non-target) chores with no assignees — shown locked
  // until a parent assigns them to someone.
  isUnassignedRegular?: boolean;
}

export interface AchievementDisplay {
  id: string;
  title: string;
  description: string;
  icon: string;
  profileId: string;
  profileName?: string;
  profileColor?: string;
  earnedAt: Date;
  type: string;
}

export interface ProgressData {
  profileId: string;
  profileName: string;
  profileColor: string;
  completed: number;
  total: number;
  percentage: number;
  choreCompleted: number;
  choreTotal: number;
  todoCompleted: number;
  todoTotal: number;
  dailyCompleted: number;
  dailyTotal: number;
}
