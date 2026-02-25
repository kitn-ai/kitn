import { Show, For, createSignal } from "solid-js";
import type { Exchange, ActivityEvent } from "./types";
import MarkdownText from "./MarkdownText";

interface ExchangeCardProps {
  exchange: Exchange;
  isPlaying: boolean;
  isPaused: boolean;
  isPlayingThis: boolean;
  hasAudioCache: boolean;
  onPlay: (id: number, text: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDownload: (id: number) => void;
  onCopy: (id: number, text: string) => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function activityIcon(type: ActivityEvent["type"]): string {
  switch (type) {
    case "delegate-start":
    case "delegate-end":
      return "\u21AA";
    case "tool-call":
      return "\u2692";
    case "tool-result":
      return "\u2713";
    case "agent-think":
      return "\u2026";
    case "agent-plan":
      return "\u25B6";
    case "agent-start":
      return "\u25CB";
    case "agent-end":
      return "\u25CF";
    default:
      return "\u2022";
  }
}

export default function ExchangeCard(props: ExchangeCardProps) {
  const [copiedId, setCopiedId] = createSignal(false);

  function handleCopy() {
    props.onCopy(props.exchange.id, props.exchange.agentText);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  const ex = () => props.exchange;

  return (
    <div class="vc-exchange">
      {/* User bubble */}
      <div class="vc-bubble vc-user">
        <div class="vc-bubble-header">
          <span class="vc-bubble-role">You</span>
          <span class="vc-bubble-time">{formatTime(ex().timestamp)}</span>
        </div>
        <p>{ex().userText}</p>
      </div>

      {/* Activity log */}
      <Show when={ex().activityLog.length > 0}>
        <div class="vc-activity-log">
          <For each={ex().activityLog}>
            {(activity) => (
              <div class={`vc-activity-item vc-activity-${activity.type}`}>
                <span class="vc-activity-icon">{activityIcon(activity.type)}</span>
                <span class="vc-activity-label">{activity.label}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Agent bubble */}
      <Show when={ex().agentText}>
        <div class="vc-bubble vc-agent">
          <div class="vc-bubble-header">
            <span class="vc-bubble-role">Agent</span>
            <span class="vc-bubble-time">{formatTime(ex().timestamp)}</span>
          </div>
          <MarkdownText content={ex().agentText} />
          <Show when={ex().isComplete}>
            <div class="vc-card-actions">
              {/* Playback controls */}
              <Show
                when={props.isPlayingThis}
                fallback={
                  <button
                    class="vc-play-btn"
                    onClick={() => props.onPlay(ex().id, ex().agentText)}
                    disabled={props.isPlaying && !props.isPlayingThis}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                    Play
                  </button>
                }
              >
                {/* Playing this card */}
                <Show
                  when={props.isPaused}
                  fallback={
                    <button class="vc-pause-btn" onClick={props.onPause}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="5" y="3" width="5" height="18" rx="1" />
                        <rect x="14" y="3" width="5" height="18" rx="1" />
                      </svg>
                      Pause
                    </button>
                  }
                >
                  <button class="vc-resume-btn" onClick={props.onResume}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                    Resume
                  </button>
                </Show>
                <button class="vc-stop-inline-btn" onClick={props.onStop}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop
                </button>
              </Show>

              {/* Separator + utility buttons */}
              <span class="vc-action-sep">|</span>

              <button
                class="vc-download-btn"
                onClick={() => props.onDownload(ex().id)}
                disabled={!props.hasAudioCache && !ex().audioId}
                title="Download audio"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>

              <button
                class="vc-copy-btn"
                onClick={handleCopy}
                title="Copy text"
              >
                <Show
                  when={copiedId()}
                  fallback={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Streaming indicator when no text yet */}
      <Show when={!ex().agentText && !ex().isComplete}>
        <div class="vc-bubble vc-agent vc-agent-streaming">
          <div class="vc-bubble-header">
            <span class="vc-bubble-role">Agent</span>
          </div>
          <span class="vc-typing-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      </Show>
    </div>
  );
}
