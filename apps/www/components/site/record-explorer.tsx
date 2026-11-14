"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@foliage/ui/toggle-group";
const prompts = {
  day: [
    "What decision mattered today?",
    "What did you discover, change or prevent?",
    "What evidence would help you remember why?",
  ],
  week: [
    "What changed in your understanding this week?",
    "What took persistence, judgment or a different direction?",
    "What matters enough to carry into next week?",
  ],
};
export function ReflectionPrompts() {
  const [period, setPeriod] = useState<"day" | "week">("week");
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompts[period].join("\n\n"));
      setStatus("Prompts copied.");
    } catch {
      setStatus("Copy unavailable. Select the questions below to copy them.");
    }
  }
  return (
    <div className="reflection-prompts">
      <div className="reflection-controls">
        <ToggleGroup type="single" value={period} aria-label="Reflection period" onValueChange={(value) => {
          if (value !== "day" && value !== "week") return;
          setPeriod(value);
          setStatus("");
        }}>
          {(["day", "week"] as const).map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
            >
              {value === "day" ? "Today" : "This week"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="ghost" onClick={copy}>
          Copy prompts
        </Button>
      </div>
      <ul>
        {prompts[period].map((prompt) => (
          <li key={prompt}>{prompt}</li>
        ))}
      </ul>
      <span role="status" aria-atomic="true" className="sr-only">{status}</span>
      {status && <p aria-hidden="true" className="record-caption">{status}</p>}
    </div>
  );
}
