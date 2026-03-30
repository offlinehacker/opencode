// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to host the fork's iOS/Android push
// permission, pairing, relay, and host-plugin setup UI inside the shared app package.

import { Card } from "@opencode-ai/ui/card"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, Show, createMemo, createResource, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type PushState } from "@/context/platform"
import { canClearPair, usePushPair } from "@/context/push-pair"
import { usePushRelay } from "@/context/push-relay"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { PushFail, pushIssue } from "@/utils/push-pair"
import { DEFAULT_PUSH_RELAY_URL } from "@/utils/push-relay-url"
import { sendPushTest } from "@/utils/push-test"
import { diagRows } from "./settings-mobile-notifications-data"

type PushAction = {
  label: string
  disabled: boolean
  run?: () => Promise<void>
}

type Summary = {
  variant: "info" | "warning" | "error" | "success"
  title: string
  body: string
  detail?: string
  command?: string
  action?: PushAction
}

export function shouldToastPairErr(err: unknown) {
  return !(err instanceof PushFail)
}

export const SettingsMobileNotifications: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const pairing = usePushPair()
  const relay = usePushRelay()
  const server = useServer()

  const [store, setStore] = createStore({
    asking: false,
    testing: false,
    diag: false,
  })

  const mobile = createMemo(() => platform.platform === "ios" || platform.platform === "android")
  const push = createMemo(() => platform.pushState?.())
  const diag = createMemo(() => push()?.diag)
  const issue = createMemo(() => pairing.issue() ?? pushIssue(push()))
  const paired = createMemo(() => push()?.paired || pairing.pair.status === "active")
  const clearable = createMemo(() =>
    canClearPair({
      paired: paired(),
      id: diag()?.pairID ?? pairing.pair.id,
      status: pairing.pair.status ?? diag()?.pairStatus,
    }),
  )
  const ready = createMemo(() => mobile() && !!platform.requestPushPermission)

  const phaseDesc = (value?: ReturnType<typeof pairing.phase>) => {
    if (value === "permission") return language.t("settings.general.notifications.push.pairing.step.permission")
    if (value === "register") return language.t("settings.general.notifications.push.pairing.step.register")
    if (value === "claim") return language.t("settings.general.notifications.push.pairing.step.claim")
    if (value === "finish") return language.t("settings.general.notifications.push.pairing.step.finish")
    return language.t("settings.general.notifications.push.pairing.step.begin")
  }

  const pushDesc = (value?: PushState) => {
    if (!value) return language.t("settings.general.notifications.push.permission.pending")
    if (value.allowed && !value.registered) {
      return language.t("settings.general.notifications.push.permission.registering")
    }
    switch (value.permission) {
      case "authorized":
        return language.t("settings.general.notifications.push.permission.authorized")
      case "provisional":
        return language.t("settings.general.notifications.push.permission.provisional")
      case "ephemeral":
        return language.t("settings.general.notifications.push.permission.ephemeral")
      case "denied":
        return language.t("settings.general.notifications.push.permission.denied")
      case "unsupported":
        return language.t("settings.general.notifications.push.permission.unsupported")
      default:
        return language.t("settings.general.notifications.push.permission.notDetermined")
    }
  }

  const note = createMemo(() => {
    if (platform.platform !== "ios") return
    if (!server.current || pairing.running() || paired() || issue()) return
    return language.t("settings.general.notifications.push.permission.ios")
  })
  const [speechLocales] = createResource(async () => {
    if (platform.platform !== "ios" || !platform.getSpeechLocales) return [] as string[]
    const locales = await platform.getSpeechLocales().catch(() => [] as string[])
    return locales.slice().sort((a, b) => localeLabel(a).localeCompare(localeLabel(b), language.intl()))
  })
  const speechAvailable = createMemo(() => platform.platform === "ios" && !!platform.getSpeechLocales)
  const speechOptions = createMemo(() =>
    (speechLocales() ?? []).map((value) => ({
      value,
      label: localeLabel(value),
    })),
  )
  const currentSpeech = createMemo(() => speechOptions().find((option) => option.value === settings.speech.locale()))

  const askPush = async () => {
    if (!platform.requestPushPermission) return
    setStore("asking", true)
    await platform
      .requestPushPermission()
      .catch((err: unknown) => {
        if (!shouldToastPairErr(err)) return
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("asking", false))
  }

  const openPush = async () => {
    if (!platform.openSystemSettings) return
    setStore("asking", true)
    await platform
      .openSystemSettings()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("asking", false))
  }

  const testPush = async () => {
    setStore("testing", true)
    await sendPushTest({
      platform,
      href: window.location.pathname + window.location.search + window.location.hash,
    })
      .then((ok) => {
        if (!ok) {
          showToast({
            title: language.t("settings.general.notifications.push.toast.failed.title"),
            description: language.t("settings.general.notifications.push.toast.failed.description"),
            variant: "error",
          })
          return
        }
        showToast({
          title: language.t("settings.general.notifications.push.toast.sent.title"),
          description: language.t("settings.general.notifications.push.toast.sent.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("testing", false))
  }

  const setupPush = async () => {
    await pairing
      .setup({ ask: true, source: "settings" })
      .then((ok) => {
        if (!ok) return
        showToast({
          title: language.t("settings.general.notifications.push.pairing.toast.paired.title"),
          description: language.t("settings.general.notifications.push.pairing.toast.paired.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        if (!shouldToastPairErr(err)) return
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const refreshDiag = async () => {
    if (!platform.getPushState || store.diag) return
    setStore("diag", true)
    await platform
      .getPushState()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("diag", false))
  }

  const clearPair = async () => {
    if (pairing.clearing()) return
    await pairing
      .clear()
      .then(() => {
        showToast({
          title: language.t("settings.general.notifications.push.pairing.toast.cleared.title"),
          description: language.t("settings.general.notifications.push.pairing.toast.cleared.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const rows = createMemo(() =>
    diagRows({
      push: push(),
      info: diag(),
      pair: pairing.pair,
      paired: paired(),
      run: pairing.running(),
      phase: pairing.phase(),
      relay: relay.current(),
      fallback: DEFAULT_PUSH_RELAY_URL,
    }),
  )

  const permissionAction = createMemo<PushAction>(() => {
    const value = push()
    if (pairing.running()) {
      return {
        label: language.t("settings.general.notifications.push.pairing.action.pairing"),
        disabled: true,
      }
    }
    if (!value) {
      return {
        label: language.t("settings.general.notifications.push.action.checking"),
        disabled: true,
      }
    }
    if (value.permission === "authorized" || value.permission === "provisional" || value.permission === "ephemeral") {
      return {
        label: language.t("settings.general.notifications.push.action.enabled"),
        disabled: true,
      }
    }
    if (value.permission === "denied") {
      return {
        label: language.t("settings.general.notifications.push.action.openSettings"),
        disabled: !platform.openSystemSettings,
        run: openPush,
      }
    }
    if (value.permission === "unsupported") {
      return {
        label: language.t("settings.general.notifications.push.action.unavailable"),
        disabled: true,
      }
    }
    return {
      label: language.t("settings.general.notifications.push.action.enable"),
      disabled: !platform.requestPushPermission,
      run: askPush,
    }
  })

  const pairAction = createMemo<PushAction>(() => {
    const value = push()
    const next = issue()
    if (pairing.running()) {
      return {
        label: language.t("settings.general.notifications.push.pairing.action.pairing"),
        disabled: true,
      }
    }
    if (next?.action === "settings" || value?.permission === "denied") {
      return {
        label: language.t("settings.general.notifications.push.action.openSettings"),
        disabled: !platform.openSystemSettings,
        run: openPush,
      }
    }
    if (paired()) {
      return {
        label: language.t("settings.general.notifications.push.pairing.action.repair"),
        disabled: !server.current,
        run: setupPush,
      }
    }
    if (pairing.pair.status === "pending" || pairing.pair.status === "claimed") {
      return {
        label: language.t("settings.general.notifications.push.pairing.action.finish"),
        disabled: !server.current,
        run: setupPush,
      }
    }
    return {
      label: language.t("settings.general.notifications.push.pairing.action.setup"),
      disabled: !server.current || value?.permission === "unsupported",
      run: setupPush,
    }
  })

  const pairDesc = createMemo(() => {
    const value = push()
    const next = issue()
    if (!server.current) return language.t("settings.general.notifications.push.pairing.server")
    if (pairing.running()) return phaseDesc(pairing.phase())
    if (!pairing.ready()) return language.t("settings.general.notifications.push.pairing.pending")
    if (!value) return language.t("settings.general.notifications.push.pairing.pending")
    if (paired()) return language.t("settings.general.notifications.push.pairing.paired")
    if (next) return next.message
    if (pairing.pair.status === "pending" || pairing.pair.status === "claimed") {
      return language.t("settings.general.notifications.push.pairing.retry")
    }
    return language.t("settings.general.notifications.push.pairing.unpaired")
  })

  const pairDisabled = createMemo(() => {
    const value = push()
    if (pairing.running() || pairing.clearing()) return true
    if (value?.permission === "unsupported") return true
    return pairAction().disabled
  })

  const pairTitle = createMemo(() => {
    if (paired() && language.locale() === "en") return "Phone paired"
    return language.t("settings.general.notifications.push.pairing.title")
  })

  const summary = createMemo<Summary>(() => {
    const value = push()
    const next = issue()
    const pair = pairAction()

    if (pairing.running()) {
      return {
        variant: "info",
        title: language.t("settings.general.notifications.push.pairing.action.pairing"),
        body: phaseDesc(pairing.phase()),
      }
    }

    if (paired()) {
      return {
        variant: "success",
        title: pairTitle(),
        body: language.t("settings.general.notifications.push.pairing.paired"),
      }
    }

    if (next) {
      return {
        variant: next.action === "settings" ? "warning" : "error",
        title:
          next.action === "settings"
            ? language.t("settings.general.notifications.push.permission.title")
            : language.t("settings.general.notifications.push.pairing.title"),
        body: next.message,
        detail: next.detail,
        command: next.code === "host_install_failed" ? pairing.pair.command : undefined,
        action: pair,
      }
    }

    if (!server.current) {
      return {
        variant: "warning",
        title: language.t("settings.general.notifications.push.pairing.title"),
        body: language.t("settings.general.notifications.push.pairing.server"),
      }
    }

    if (!value) {
      return {
        variant: "info",
        title: language.t("settings.general.notifications.push.permission.title"),
        body: language.t("settings.general.notifications.push.permission.pending"),
      }
    }

    if (!value.allowed) {
      return {
        variant: "info",
        title: language.t("settings.general.notifications.push.permission.title"),
        body: pushDesc(value),
        action: permissionAction(),
      }
    }

    if (!value.registered) {
      return {
        variant: "info",
        title: language.t("settings.general.notifications.push.pairing.title"),
        body: language.t("settings.general.notifications.push.permission.registering"),
      }
    }

    if (pairing.pair.status === "pending" || pairing.pair.status === "claimed") {
      return {
        variant: "warning",
        title: language.t("settings.general.notifications.push.pairing.title"),
        body: language.t("settings.general.notifications.push.pairing.retry"),
        action: pair,
      }
    }

    return {
      variant: "info",
      title: language.t("settings.general.notifications.push.pairing.title"),
      body: language.t("settings.general.notifications.push.pairing.unpaired"),
      action: pair,
    }
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.phone")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Voice input</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title="Speech language"
              description={
                speechAvailable()
                  ? "Choose the language used for iPhone speech-to-text. Availability and offline support can vary by locale."
                  : "Speech language settings are currently available on iPhone builds."
              }
            >
              <Show
                when={speechAvailable()}
                fallback={<span class="text-12-medium text-text-dimmed">Unavailable</span>}
              >
                <Select
                  data-action="settings-speech-language"
                  options={speechOptions()}
                  current={currentSpeech()}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  valueClass="whitespace-normal break-words text-left leading-tight"
                  class="max-w-[320px]"
                  children={(option) => (
                    <span class="whitespace-normal break-words text-left leading-tight">
                      {option?.label}
                    </span>
                  )}
                  onSelect={(option) => option && settings.speech.setLocale(option.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                  triggerStyle={{ "min-width": "220px", height: "auto" }}
                />
              </Show>
            </SettingsRow>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Notifications</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={ready()}
              fallback={
                <SettingsRow
                  title={language.t("settings.general.notifications.push.permission.title")}
                  description={
                    mobile()
                      ? language.t("settings.general.notifications.push.permission.unsupported")
                      : language.t("settings.whispercode.mobile.unavailable")
                  }
                >
                  <span class="text-12-medium text-text-dimmed">
                    {language.t("settings.general.notifications.push.action.unavailable")}
                  </span>
                </SettingsRow>
              }
            >
              <>
                <div class="py-4 border-b border-border-weak-base">
                  <StatusCard
                    variant={summary().variant}
                    title={summary().title}
                    body={summary().body}
                    detail={summary().detail}
                    command={summary().command}
                    action={summary().action}
                    busy={store.asking}
                  />
                </div>

                <SettingsRow
                  title={language.t("settings.general.notifications.push.permission.title")}
                  description={
                    <>
                      {pushDesc(push())}
                      <Show when={note()}>
                        {(text) => (
                          <>
                            <br />
                            {text()}
                          </>
                        )}
                      </Show>
                    </>
                  }
                >
                  <div data-action="settings-push-permission">
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={store.asking || permissionAction().disabled}
                      onClick={() => void permissionAction().run?.()}
                    >
                      {store.asking
                        ? language.t("settings.general.notifications.push.action.checking")
                        : permissionAction().label}
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.general.notifications.push.test.title")}
                  description={language.t("settings.general.notifications.push.test.description")}
                >
                  <div data-action="settings-push-test">
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={store.testing || !push()?.allowed || !paired()}
                      onClick={() => void testPush()}
                    >
                      {store.testing
                        ? language.t("settings.general.notifications.push.action.sending")
                        : language.t("settings.general.notifications.push.action.test")}
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow title={pairTitle()} description={pairDesc()}>
                  <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-push-pairing">
                    <Button size="small" disabled={pairDisabled()} onClick={() => void pairAction().run?.()}>
                      {pairAction().label}
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={pairing.running() || pairing.clearing() || !platform.clearPushPairing || !clearable()}
                      onClick={() => void clearPair()}
                    >
                      {pairing.clearing()
                        ? language.t("settings.general.notifications.push.pairing.action.clearing")
                        : language.t("settings.general.notifications.push.pairing.action.clear")}
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow
                  title="Diagnostics"
                  description="Inspect current mobile notification registration and relay pairing state."
                >
                  <div
                    class="flex w-full min-w-0 max-w-[460px] flex-col items-stretch gap-2"
                    data-action="settings-push-diagnostics"
                  >
                    <div class="min-w-0 max-w-full rounded-lg bg-surface-base px-3 py-2 text-12-mono text-text-dimmed whitespace-pre-wrap [overflow-wrap:anywhere]">
                      <For each={rows()}>{(item) => <div class="leading-relaxed">{item}</div>}</For>
                    </div>
                    <div class="flex justify-end">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={store.diag || !platform.getPushState}
                        onClick={() => void refreshDiag()}
                      >
                        {store.diag ? "Refreshing..." : "Refresh"}
                      </Button>
                    </div>
                  </div>
                </SettingsRow>
              </>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusCard(props: Summary & { busy: boolean }) {
  return (
    <Card variant={props.variant} class="rounded-lg px-4 py-3">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-medium text-text-strong">{props.title}</span>
          <span class="text-12-regular text-text-weak">{props.body}</span>
        </div>

        <Show when={props.detail}>
          {(text) => <div class="text-12-regular text-text-dimmed break-words">{text()}</div>}
        </Show>

        <Show when={props.command}>
          {(cmd) => (
            <div class="flex flex-col gap-1">
              <span class="text-12-medium text-text-secondary">Exact host command</span>
              <div class="overflow-x-auto rounded-lg bg-surface-base px-3 py-2 text-12-mono text-text-dimmed break-all">
                {cmd()}
              </div>
            </div>
          )}
        </Show>

        <Show when={props.action?.run}>
          <div class="flex justify-start">
            <Button
              size="small"
              disabled={props.busy || props.action?.disabled}
              onClick={() => void props.action?.run?.()}
            >
              {props.busy ? "Working..." : props.action?.label}
            </Button>
          </div>
        </Show>
      </div>
    </Card>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="min-w-0 max-w-full flex-shrink-0">{props.children}</div>
    </div>
  )
}

function localeLabel(identifier: string) {
  try {
    const locale = new Intl.Locale(identifier)
    const languageNames = new Intl.DisplayNames(undefined, { type: "language" })
    const regionNames = new Intl.DisplayNames(undefined, { type: "region" })
    const language = locale.language ? languageNames.of(locale.language) : undefined
    const region = locale.region ? regionNames.of(locale.region) : undefined
    if (language && region) return `${language} (${region})`
    if (language) return language
  } catch {}
  return identifier
}
