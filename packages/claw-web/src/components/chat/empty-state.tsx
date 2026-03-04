"use client"

import { PromptSuggestion } from "@/components/ui/prompt-suggestion"
import { Sparkles, FileText, Code, Wrench } from "lucide-react"

type Suggestion = {
  icon: React.ReactNode
  label: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: <Sparkles className="size-4 shrink-0" />,
    label: "Search the web for today's tech news",
  },
  {
    icon: <FileText className="size-4 shrink-0" />,
    label: "Read and summarize a file",
  },
  {
    icon: <Code className="size-4 shrink-0" />,
    label: "Help me write a script",
  },
  {
    icon: <Wrench className="size-4 shrink-0" />,
    label: "What tools do you have?",
  },
]

type EmptyStateProps = {
  onSuggestion: (text: string) => void
}

export function EmptyState({ onSuggestion }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      {/* Heading */}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          What can I help you with?
        </h1>
        <p className="text-sm text-muted-foreground">
          I&apos;m your personal AI assistant, powered by KitnClaw
        </p>
      </div>

      {/* Suggestion chips */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <PromptSuggestion
            key={s.label}
            onClick={() => onSuggestion(s.label)}
          >
            {s.icon}
            {s.label}
          </PromptSuggestion>
        ))}
      </div>
    </div>
  )
}
