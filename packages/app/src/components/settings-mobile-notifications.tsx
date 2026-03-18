import { Component, For, Show, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform, type PushState } from "@/context/platform"
import { canClearPair, usePushPair } from "@/context/push-pair"
import { usePushRelay } from "@/context/push-relay"
import { useServer } from "@/context/server"
import { addPush, dropPush, hasPush } from "@/utils/push-plugin"
import { DEFAULT_PUSH_RELAY_URL } from "@/utils/push-relay-url"
import { sendPushTest } from "@/utils/push-test"
import { diagRows } from "./settings-mobile-notifications-data"

type PushAction = {
  label: string
  disabled: boolean
  run?: () => Promise<void>
}

export const SettingsMobileNotifications: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const pairing = usePushPair()
  const relay = usePushRelay()
  const server = useServer()
  const sync = useGlobalSync()

  const [store, setStore] = createStore({
    asking: false,
    testing: false,
    diag: false,
    installing: false,
    removing: false,
  })

  const mobile = createMemo(() => platform.platform === "ios" || platform.platform === "android")
  const push = createMemo(() => platform.pushState?.())
  const diag = createMemo(() => push()?.diag)
  const paired = createMemo(() => push()?.paired || pairing.pair.status === "active")
  const clearable = createMemo(() =>
    canClearPair({
      paired: paired(),
      id: diag()?.pairID ?? pairing.pair.id,
      status: pairing.pair.status ?? diag()?.pairStatus,
    }),
  )
  const installed = createMemo(() => hasPush(sync.data.config.plugin))
  const updating = createMemo(() => sync.data.reload === "pending")
  const ready = createMemo(() => mobile() && !!platform.requestPushPermission)

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
    if (!server.current || pairing.running() || paired()) return
    return language.t("settings.general.notifications.push.permission.ios")
  })

  const askPush = async () => {
    if (!platform.requestPushPermission) return
    setStore("asking", true)
    await platform
      .requestPushPermission()
      .catch((err: unknown) => {
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
      .setup({ ask: true })
      .then((ok) => {
        if (!ok) return
        showToast({
          title: language.t("settings.general.notifications.push.pairing.toast.paired.title"),
          description: language.t("settings.general.notifications.push.pairing.toast.paired.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
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

  const installHost = async () => {
    setStore("installing", true)
    await sync
      .updateConfig({ plugin: addPush(sync.data.config.plugin) })
      .then(() => {
        showToast({
          title: language.t("settings.general.notifications.push.host.toast.installed.title"),
          description: language.t("settings.general.notifications.push.host.toast.installed.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("installing", false))
  }

  const removeHost = async () => {
    setStore("removing", true)
    await sync
      .updateConfig({ plugin: dropPush(sync.data.config.plugin) })
      .then(() => {
        showToast({
          title: language.t("settings.general.notifications.push.host.toast.removed.title"),
          description: language.t("settings.general.notifications.push.host.toast.removed.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("removing", false))
  }

  const hostDesc = createMemo(() => {
    if (updating()) return language.t("settings.general.notifications.push.host.description.updating")
    if (installed()) return language.t("settings.general.notifications.push.host.description.installed")
    return language.t("settings.general.notifications.push.host.description.missing")
  })

  const pairDesc = createMemo(() => {
    const value = push()
    if (!server.current) return language.t("settings.general.notifications.push.pairing.server")
    if (pairing.running()) {
      const step = pairing.step()
      if (step === "permission") return language.t("settings.general.notifications.push.pairing.step.permission")
      if (step === "register") return language.t("settings.general.notifications.push.pairing.step.register")
      if (step === "claim") return language.t("settings.general.notifications.push.pairing.step.claim")
      if (step === "finish") return language.t("settings.general.notifications.push.pairing.step.finish")
      return language.t("settings.general.notifications.push.pairing.step.begin")
    }
    if (!pairing.ready()) return language.t("settings.general.notifications.push.pairing.pending")
    if (!value) return language.t("settings.general.notifications.push.pairing.pending")
    if (paired()) return language.t("settings.general.notifications.push.pairing.paired")
    if (pairing.pair.message) return pairing.pair.message
    if (pairing.pair.status === "pending" || pairing.pair.status === "claimed") {
      return language.t("settings.general.notifications.push.pairing.retry")
    }
    return language.t("settings.general.notifications.push.pairing.unpaired")
  })

  const pairLabel = createMemo(() => {
    const value = push()
    if (pairing.running()) return language.t("settings.general.notifications.push.pairing.action.pairing")
    if (value?.permission === "denied") return language.t("settings.general.notifications.push.action.openSettings")
    if (!value?.allowed) return language.t("settings.general.notifications.push.pairing.action.setup")
    if (paired()) return language.t("settings.general.notifications.push.pairing.action.repair")
    if (pairing.pair.status === "pending" || pairing.pair.status === "claimed") {
      return language.t("settings.general.notifications.push.pairing.action.finish")
    }
    return language.t("settings.general.notifications.push.pairing.action.setup")
  })

  const pairDisabled = createMemo(() => {
    const value = push()
    if (pairing.running() || pairing.clearing()) return true
    if (!server.current) return true
    if (value?.permission === "unsupported") return true
    return false
  })

  const rows = createMemo(() =>
    diagRows({
      push: push(),
      info: diag(),
      pair: pairing.pair,
      paired: paired(),
      relay: relay.current(),
      fallback: DEFAULT_PUSH_RELAY_URL,
    }),
  )

  const action = createMemo<PushAction>(() => {
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
      label: server.current
        ? language.t("settings.general.notifications.push.pairing.action.setup")
        : language.t("settings.general.notifications.push.action.enable"),
      disabled: server.current ? pairDisabled() : !platform.requestPushPermission,
      run: server.current ? setupPush : askPush,
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
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.section.whispercode")}</h3>

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
                      disabled={store.asking || action().disabled}
                      onClick={() => void action().run?.()}
                    >
                      {store.asking
                        ? language.t("settings.general.notifications.push.action.checking")
                        : action().label}
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.general.notifications.push.generic.title")}
                  description={language.t("settings.general.notifications.push.generic.description")}
                >
                  <span class="text-12-medium text-text-dimmed">
                    {language.t("settings.general.notifications.push.generic.value")}
                  </span>
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

                <SettingsRow
                  title={language.t("settings.general.notifications.push.pairing.title")}
                  description={pairDesc()}
                >
                  <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-push-pairing">
                    <Button size="small" disabled={pairDisabled()} onClick={() => void setupPush()}>
                      {pairLabel()}
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
                  title={language.t("settings.general.notifications.push.host.title")}
                  description={hostDesc()}
                >
                  <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-push-host">
                    <Show
                      when={installed()}
                      fallback={
                        <Button
                          size="small"
                          disabled={store.installing || updating()}
                          onClick={() => void installHost()}
                        >
                          {store.installing || updating()
                            ? language.t("settings.general.notifications.push.host.action.installing")
                            : language.t("settings.general.notifications.push.host.action.install")}
                        </Button>
                      }
                    >
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={store.removing || updating()}
                        onClick={() => void removeHost()}
                      >
                        {store.removing || updating()
                          ? language.t("settings.general.notifications.push.host.action.removing")
                          : language.t("settings.general.notifications.push.host.action.remove")}
                      </Button>
                    </Show>
                  </div>
                </SettingsRow>

                <SettingsRow
                  title="Diagnostics"
                  description="Inspect current mobile notification registration and relay pairing state."
                >
                  <div
                    class="flex w-full max-w-[460px] flex-col items-stretch gap-2"
                    data-action="settings-push-diagnostics"
                  >
                    <div class="overflow-x-auto rounded-lg bg-surface-base px-3 py-2 text-12-mono text-text-dimmed">
                      <For each={rows()}>{(item) => <div class="break-all leading-relaxed">{item}</div>}</For>
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
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
