import { cn } from "@/utils/cn";

const windowsKeyMap: Record<string, string> = {
  "⌘": "Ctrl",
  cmd: "Ctrl",
  "⇧": "Shift",
  shift: "Shift",
  "⌥": "Alt",
  option: "Alt",
  esc: "Esc",
  click: "Click",
};

const normalizeKeyLabel = (key: string) => {
  const mapped = windowsKeyMap[key.toLowerCase()];
  return mapped || key;
};

export function Kbd({ children, size = "small" }: Readonly<{ children: React.ReactNode; size?: "small" | "medium" }>) {
  const normalizedChildren = typeof children === "string" ? normalizeKeyLabel(children) : children;

  return (
    <kbd
      className={cn(
        `inline-flex items-center justify-center px-2 font-medium bg-gray-a4 tracking-[0.1px] font-sans w-auto text-gray-a10`,
        size === "small" && "h-[18px] px-1 text-[10px] rounded-[3px] min-w-[18px]",
        size === "medium" && "h-[28px] px-2 text-xs rounded-md min-w-[28px]",
      )}
    >
      {normalizedChildren}
    </kbd>
  );
}

export function Kbds({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="ml-auto inline-flex gap-1 pl-4">{children}</div>;
}

export function Shortcut({ children, keys }: Readonly<{ children: React.ReactNode; keys: string[] }>) {
  return (
    <div className="flex justify-between items-center">
      <div className="text-gray-11 text-[13px]">{children}</div>
      <div className="flex items-end gap-1">
        {keys.map((key) => (
          <Kbd key={key} size="medium">
            {key}
          </Kbd>
        ))}
      </div>
    </div>
  );
}
