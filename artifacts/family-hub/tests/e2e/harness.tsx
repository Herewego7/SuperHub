import { createRoot } from "react-dom/client";
import "@/index.css";
import * as familyHub from "./scenarios/familyHub";
import * as outlookAssignTo from "./scenarios/outlookAssignTo";
import * as privacyFallback from "./scenarios/privacyFallback";
import * as accountSwitch from "./scenarios/accountSwitch";
import * as announcements from "./scenarios/announcements";
import * as personTodoList from "./scenarios/personTodoList";
import * as personTodoListEmpty from "./scenarios/personTodoListEmpty";
import * as perPersonSettings from "./scenarios/perPersonSettings";
import * as settingsSections from "./scenarios/settingsSections";
import * as createTaskModal from "./scenarios/createTaskModal";
import * as eventModal from "./scenarios/eventModal";
import * as eventModalLongDesc from "./scenarios/eventModalLongDesc";
import * as celebrationsDialog from "./scenarios/celebrationsDialog";
import * as celebrationSnooze from "./scenarios/celebrationSnooze";
import * as personCardSections from "./scenarios/personCardSections";
import * as mealIngredientAnchor from "./scenarios/mealIngredientAnchor";
import * as todoCompleteStale from "./scenarios/todoCompleteStale";
import * as announcementsSlowAssignments from "./scenarios/announcementsSlowAssignments";
import * as celebrationDetail from "./scenarios/celebrationDetail";
import * as notificationsNative from "./scenarios/notificationsNative";
import * as sentryTestButton from "./scenarios/sentryTestButton";
import * as choreSwipeRemove from "./scenarios/choreSwipeRemove";
import * as choresInspirationConfetti from "./scenarios/choresInspirationConfetti";
import * as todosAllDoneConfetti from "./scenarios/todosAllDoneConfetti";
import * as todosParentHeadingConfetti from "./scenarios/todosParentHeadingConfetti";
import * as bonusChoreCompletedLine from "./scenarios/bonusChoreCompletedLine";
import * as calendarDragAndChips from "./scenarios/calendarDragAndChips";
import * as monthDots from "./scenarios/monthDots";
import * as screensaver from "./scenarios/screensaver";
import * as todosPartialConfetti from "./scenarios/todosPartialConfetti";
import * as todosSubCreateJump from "./scenarios/todosSubCreateJump";
import * as todosSubFieldKeyboard from "./scenarios/todosSubFieldKeyboard";
import * as choresLongSubtitle from "./scenarios/choresLongSubtitle";
import * as healthPushOtherProfile from "./scenarios/healthPushOtherProfile";
import * as rewardsCashoutOnly from "./scenarios/rewardsCashoutOnly";
import * as todosDragReorder from "./scenarios/todosDragReorder";
import * as todosChildReorder from "./scenarios/todosChildReorder";
import * as todosChildReorderPersist from "./scenarios/todosChildReorderPersist";
import * as todosTabChildReorder from "./scenarios/todosTabChildReorder";
import * as todosHandlesWithDone from "./scenarios/todosHandlesWithDone";
import * as todosAddMulti from "./scenarios/todosAddMulti";
import * as todosAlphaSort from "./scenarios/todosAlphaSort";
import * as createTaskSubTodos from "./scenarios/createTaskSubTodos";
import * as historyEntrySpotlight from "./scenarios/historyEntrySpotlight";
import * as eventAllDayFlow from "./scenarios/eventAllDayFlow";
import * as upgradeDialog from "./scenarios/upgradeDialog";
import * as onboardingRenameProfile from "./scenarios/onboardingRenameProfile";
import * as onboardingYouStepPersist from "./scenarios/onboardingYouStepPersist";
import * as parentPinChecklist from "./scenarios/parentPinChecklist";
import * as parentPinSet from "./scenarios/parentPinSet";
import * as parentGateNoPin from "./scenarios/parentGateNoPin";
import * as onboardingTour from "./scenarios/onboardingTour";
import * as onboardingDone from "./scenarios/onboardingDone";
import * as toastSwipe from "./scenarios/toastSwipe";
import * as trophyStripOverflow from "./scenarios/trophyStripOverflow";
import * as createTaskAssignees from "./scenarios/createTaskAssignees";
import * as todosHistoryDrawer from "./scenarios/todosHistoryDrawer";
import * as settingsGroupsPin from "./scenarios/settingsGroupsPin";
import * as kbPanel from "./scenarios/kbPanel";
import * as mealModal from "./scenarios/mealModal";
import * as groceryEdit from "./scenarios/groceryEdit";
import * as announcementsFinishSetupRace from "./scenarios/announcementsFinishSetupRace";
import * as announcementsRewardSuggestion from "./scenarios/announcementsRewardSuggestion";
import * as healthPushSpotlight from "./scenarios/healthPushSpotlight";
import * as spotlightHeaderClamp from "./scenarios/spotlightHeaderClamp";
import * as homeCalendarSyncError from "./scenarios/homeCalendarSyncError";
import * as screenshotInventory from "./scenarios/screenshotInventory";
import * as marketingShots from "./scenarios/marketingShots";
import * as activityBonusFilter from "./scenarios/activityBonusFilter";
import * as notificationsWeb from "./scenarios/notificationsWeb";
import * as eventModalRecurrenceIso from "./scenarios/eventModalRecurrenceIso";
import * as eventModalSeriesNote from "./scenarios/eventModalSeriesNote";
import * as eventMultiDriver from "./scenarios/eventMultiDriver";
import * as calendarReturn from "./scenarios/calendarReturn";
import * as calendarSyncErrorNamed from "./scenarios/calendarSyncErrorNamed";
import * as homeCheckOff from "./scenarios/homeCheckOff";
import * as liveRefresh from "./scenarios/liveRefresh";

// One persistent, multi-scenario harness page instead of a disposable
// dev-harness.tsx per session — add a new module to ./scenarios and
// register it here to cover a new component/flow permanently.
const SCENARIOS: Record<string, { setup: () => void; Component: React.ComponentType }> = {
  familyHub,
  outlookAssignTo,
  privacyFallback,
  accountSwitch,
  announcements,
  personTodoList,
  personTodoListEmpty,
  perPersonSettings,
  settingsSections,
  createTaskModal,
  eventModal,
  eventModalLongDesc,
  celebrationsDialog,
  celebrationSnooze,
  personCardSections,
  mealIngredientAnchor,
  todoCompleteStale,
  announcementsSlowAssignments,
  celebrationDetail,
  notificationsNative,
  sentryTestButton,
  choreSwipeRemove,
  choresInspirationConfetti,
  todosAllDoneConfetti,
  todosParentHeadingConfetti,
  todosPartialConfetti,
  todosSubCreateJump,
  todosSubFieldKeyboard,
  bonusChoreCompletedLine,
  calendarDragAndChips,
  monthDots,
  screensaver,
  choresLongSubtitle,
  rewardsCashoutOnly,
  todosDragReorder,
  todosChildReorder,
  todosChildReorderPersist,
  todosTabChildReorder,
  todosHandlesWithDone,
  todosAddMulti,
  todosAlphaSort,
  createTaskSubTodos,
  historyEntrySpotlight,
  eventAllDayFlow,
  upgradeDialog,
  onboardingRenameProfile,
  onboardingYouStepPersist,
  parentPinChecklist,
  parentPinSet,
  parentGateNoPin,
  onboardingTour,
  onboardingDone,
  toastSwipe,
  trophyStripOverflow,
  createTaskAssignees,
  todosHistoryDrawer,
  settingsGroupsPin,
  kbPanel,
  mealModal,
  groceryEdit,
  announcementsFinishSetupRace,
  announcementsRewardSuggestion,
  healthPushSpotlight,
  healthPushOtherProfile,
  spotlightHeaderClamp,
  homeCalendarSyncError,
  screenshotInventory,
  marketingShots,
  activityBonusFilter,
  notificationsWeb,
  eventModalRecurrenceIso,
  eventModalSeriesNote,
  eventMultiDriver,
  calendarReturn,
  calendarSyncErrorNamed,
  homeCheckOff,
  liveRefresh,
};

const params = new URLSearchParams(window.location.search);
const name = params.get("scenario") ?? "";
const scenario = SCENARIOS[name];

const root = document.getElementById("root")!;
if (!scenario) {
  root.textContent = `Unknown e2e scenario: "${name}". Available: ${Object.keys(SCENARIOS).join(", ")}`;
} else {
  scenario.setup();
  createRoot(root).render(<scenario.Component />);
}
