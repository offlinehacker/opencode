import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"

type VoiceOverlayState = "hidden" | "recording" | "processing"

export function VoiceInputOverlay(props: { state: () => VoiceOverlayState; onStop: () => void }) {
  const active = () => props.state() !== "hidden"
  const processing = () => props.state() === "processing"

  return (
    <Show when={active()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div class="flex flex-col items-center gap-3 rounded-xl bg-background-base px-4 py-3 shadow-lg">
          <div class="text-12-medium text-foreground-base">{processing() ? "Processing..." : "Listening..."}</div>
          <Button type="button" variant="primary" class="h-8 px-3" onClick={() => props.onStop()} disabled={processing()}>
            <div class="flex items-center gap-2">
              <Icon name="stop" class="size-4.5" />
              <span>{processing() ? "Processing" : "Stop"}</span>
            </div>
          </Button>
        </div>
      </div>
    </Show>
  )
}
