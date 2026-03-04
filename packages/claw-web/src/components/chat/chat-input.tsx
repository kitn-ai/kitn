"use client"

import { useRef, useState } from "react"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input"
import { Button } from "@/components/ui/button"
import { ArrowUp, Square, Paperclip, X } from "lucide-react"
import { cn } from "@/lib/utils"

type AttachedFile = {
  name: string
  file: File
}

type ChatInputProps = {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
}

export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSubmit = value.trim().length > 0 && !isStreaming

  const handleSubmit = () => {
    if (!canSubmit) return
    onSend(value.trim())
    setValue("")
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newFiles: AttachedFile[] = Array.from(files).map((f) => ({
      name: f.name,
      file: f,
    }))
    setAttachedFiles((prev) => [...prev, ...newFiles])
    // Reset the input so the same file can be re-selected if removed
    e.target.value = ""
  }

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* File chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachedFiles.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="max-w-[180px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="ml-0.5 rounded-full hover:text-foreground transition-colors"
                aria-label={`Remove ${f.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      <PromptInput
        value={value}
        onValueChange={setValue}
        onSubmit={handleSubmit}
        isLoading={isStreaming}
        className="w-full"
      >
        <PromptInputTextarea
          placeholder="Message KitnClaw..."
          className="px-2 py-2"
        />

        <PromptInputActions className="justify-between px-2 pb-1">
          {/* Left actions */}
          <PromptInputAction tooltip="Attach files">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
          </PromptInputAction>

          {/* Right actions */}
          <div className="ml-auto">
            {isStreaming ? (
              <PromptInputAction tooltip="Stop generating">
                <Button
                  type="button"
                  size="icon-sm"
                  className="rounded-full"
                  onClick={onStop}
                >
                  <Square className="size-4 fill-current" />
                </Button>
              </PromptInputAction>
            ) : (
              <PromptInputAction tooltip="Send message">
                <Button
                  type="button"
                  size="icon-sm"
                  className={cn(
                    "rounded-full transition-opacity",
                    !canSubmit && "opacity-40"
                  )}
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  <ArrowUp className="size-4" />
                </Button>
              </PromptInputAction>
            )}
          </div>
        </PromptInputActions>
      </PromptInput>
    </div>
  )
}
