"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QUICK_TOPICS, TOPIC_GROUPS } from "./constants";

const KNOWN = new Set([...QUICK_TOPICS, ...Object.values(TOPIC_GROUPS).flat()]);

/** Searchable topic list with a free-text fallback, for topics beyond the quick chips. */
export function TopicPicker({ value, onChange }: { value: string; onChange: (topic: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const typed = search.trim().toLowerCase().replace(/\s+/g, "-");

  const pick = (topic: string) => {
    onChange(topic);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="rounded-full" aria-label="More topics" />}>
        More topics
        <ChevronsUpDown className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a topic" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No matching topic.</CommandEmpty>
            {Object.entries(TOPIC_GROUPS).map(([group, topics]) => (
              <CommandGroup key={group} heading={group}>
                {topics.map((t) => (
                  <CommandItem key={t} value={t} data-checked={t === value} onSelect={() => pick(t)}>
                    {t}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {typed && !KNOWN.has(typed) && /^[\w.+#-]{1,40}$/.test(typed) && (
              <CommandGroup heading="Custom">
                <CommandItem value={`custom-${typed}`} onSelect={() => pick(typed)}>
                  Use topic “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
