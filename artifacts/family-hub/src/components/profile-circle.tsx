import { ProfileCircleProps } from "@/lib/types";
import { objectUrl } from "@/lib/apiBase";

export function ProfileCircle({
  id,
  name,
  initials,
  color,
  photoUrl,
  isSelected,
  onToggle,
  condensed = false,
}: ProfileCircleProps) {
  const handleClick = () => {
    onToggle(id);
  };

  const getProfileColorClass = (color: string) => {
    if (color.includes("300, 69%")) return "profile-mommy";
    if (color.includes("230, 89%")) return "profile-daddy";
    if (color.includes("330, 81%")) return "profile-paisley";
    if (color.includes("35, 91%")) return "profile-truitt";
    if (color.includes("160, 84%")) return "profile-jett";
    return "";
  };

  const profileClass = getProfileColorClass(color);

  return (
    <div
      className="flex flex-col items-center group cursor-pointer shrink-0"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Select ${name}`}
      aria-pressed={isSelected}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      data-testid={`profile-${name.toLowerCase()}`}
    >
      <div
        className={`rounded-full transition-all duration-200 group-hover:scale-105 aspect-square ${
          condensed ? 'w-11 h-11 border-[3px]' : 'w-20 h-20 border-[5px]'
        } ${
          isSelected
            ? `profile-selected ${profileClass}`
            : `border-transparent hover:border-border ${profileClass} opacity-60 saturate-50 hover:opacity-80 hover:saturate-100`
        }`}
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}90)`,
          borderColor: isSelected ? color : 'transparent'
        }}
      >
        <div className={`w-full h-full rounded-full flex items-center justify-center text-white font-semibold ${condensed ? 'text-sm' : 'text-xl'}`}>
          {photoUrl ? (
            <img
              src={objectUrl(photoUrl)}
              alt={name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
      </div>
      {!condensed && (
        // max-w + truncate: without them a long profile name sets this
        // flex item's width (the wrapper is shrink-0), which widens that
        // avatar's column, pushes the rest of the family out of the
        // horizontal strip, and at desktop width runs into the settings /
        // privacy / sign-out icon column beside it. The name is truncated
        // everywhere else it appears; the family bar was the one place
        // rendering it at full length. title= keeps the full name reachable.
        <span
          title={name}
          className={`text-sm font-medium mt-2 max-w-[5.5rem] truncate transition-all duration-200 ${isSelected ? 'text-foreground' : 'text-muted-foreground opacity-60 group-hover:opacity-80'}`}
        >
          {name}
        </span>
      )}
    </div>
  );
}
