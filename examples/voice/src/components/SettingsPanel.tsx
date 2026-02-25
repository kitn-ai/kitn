import { Show, For } from "solid-js";
import type { Speaker, SttProvider } from "../lib/api";

interface SettingsPanelProps {
  speaker: string;
  onSpeakerChange: (value: string) => void;
  speakers: Speaker[];
  sttProvider: string;
  onSttProviderChange: (value: string) => void;
  sttProviders: SttProvider[];
}

export default function SettingsPanel(props: SettingsPanelProps) {
  return (
    <div class="vc-settings">
      <div class="vc-setting-row">
        <label class="vc-label">Voice</label>
        <select
          class="vc-select"
          value={props.speaker}
          onChange={(e) => props.onSpeakerChange(e.target.value)}
        >
          <For each={props.speakers}>
            {(s) => <option value={s.voiceId}>{s.name}</option>}
          </For>
          <Show when={props.speakers.length === 0}>
            <option value="alloy">Alloy (default)</option>
          </Show>
        </select>
      </div>
      <Show when={props.sttProviders.length > 1}>
        <div class="vc-setting-row">
          <label class="vc-label">STT</label>
          <select
            class="vc-select"
            value={props.sttProvider}
            onChange={(e) => props.onSttProviderChange(e.target.value)}
          >
            <For each={props.sttProviders}>
              {(p) => <option value={p.name}>{p.label}</option>}
            </For>
          </select>
        </div>
      </Show>
    </div>
  );
}
