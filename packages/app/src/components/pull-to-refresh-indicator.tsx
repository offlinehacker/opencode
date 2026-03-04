import { Show } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"

export function PullToRefreshIndicator(props: {
  pulling: boolean
  progress: number
  refreshing: boolean
  pullDistance: number
}) {
  return (
    <Show when={props.pulling || props.refreshing}>
      <div
        class="flex items-center justify-center w-full overflow-hidden pointer-events-none"
        style={{ height: `${props.pullDistance}px` }}
      >
        <div
          class="flex items-center justify-center text-text-dimmed"
          classList={{
            "animate-spin": props.refreshing,
          }}
          style={{
            opacity: props.refreshing ? 1 : props.progress,
            transform: props.refreshing ? undefined : `rotate(${props.progress * 180}deg)`,
          }}
        >
          <Show when={props.refreshing} fallback={<Icon name="arrow-down-to-line" />}>
            <Spinner class="size-5" />
          </Show>
        </div>
      </div>
    </Show>
  )
}
