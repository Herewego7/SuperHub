import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { ChoreIcon } from "@/components/customChoreIcons";

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  placeholder?: string;
  /** Icon-only square button (no "Change icon" label) — for placing next to
   * another field (e.g. a Name input) where a full-width text button would
   * fight it for space. */
  compact?: boolean;
}

export function EmojiPicker({ value, onChange, placeholder = "Change icon", compact = false }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (emojiObj: { native: string }) => {
    onChange(emojiObj.native);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            aria-label={placeholder}
            title={placeholder}
          >
            {value ? <ChoreIcon icon={value} className="w-5 h-5 text-lg leading-none" /> : <span className="text-muted-foreground text-lg">🙂</span>}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full justify-start gap-2 text-sm font-normal"
          >
            <ChoreIcon icon={value} className="w-5 h-5 text-lg leading-none" />
            <span className="text-muted-foreground">{placeholder}</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-xl"
        side="bottom"
        align="start"
        style={{ zIndex: 9999 }}
      >
        <Picker
          data={data}
          onEmojiSelect={handleSelect}
          theme="light"
          previewPosition="none"
          skinTonePosition="search"
          maxFrequentRows={2}
          perLine={9}
        />
      </PopoverContent>
    </Popover>
  );
}
