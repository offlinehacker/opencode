import { Component, Show, createEffect, createMemo, createResource, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { usePlatform, type DisplayBackend, type PairInfo, type PairState, type PushState } from "@/context/platform"
import { usePushRelay } from "@/context/push-relay"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useUpdaterAction } from "./updater-action"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { showToast } from "@/utils/toast"
import { addPush, dropPush, hasPush, installPush } from "@/utils/push-plugin"
import { Persist, persisted } from "@/utils/persist"
import { Link } from "./link"
import { SettingsList } from "./settings-list"

// UPSTREAM-DIVERGENCE-FILE: General settings stays focused on shared desktop/server options after
// upstream sync 6b9ce5e63 because the fork moved phone notification setup into its own tab.

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type PushAction = {
  label: string
  disabled: boolean
  run?: () => Promise<void>
}

type ThemeOption = {
  id: string
  name: string
}

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  label: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const permission = usePermission()
  const platform = usePlatform()
  const dialog = useDialog()
  const params = useParams()
  const settings = useSettings()

  const updater = useUpdaterAction()

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const dir = createMemo(() => decode64(params.dir))
  const accepting = createMemo(() => {
    const value = dir()
    if (!value) return false
    if (!params.id) return permission.isAutoAcceptingDirectory(value)
    return permission.isAutoAccepting(params.id, value)
  })

  const toggleAccept = (checked: boolean) => {
    const value = dir()
    if (!value) return

    if (!params.id) {
      if (permission.isAutoAcceptingDirectory(value) === checked) return
      permission.toggleAutoAcceptDirectory(value)
      return
    }

    if (checked) {
      permission.enableAutoAccept(params.id, value)
      return
    }

    permission.disableAutoAccept(params.id, value)
  }
  const desktop = createMemo(() => platform.platform === "desktop")

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const serverSync = useServerSync()
  const serverSdk = useServerSDK()
  const relay = usePushRelay()

  const [store, setStore] = createStore({
    asking: false,
    testing: false,
    clearing: false,
    pairing: false,
    installing: false,
    copying: false,
    removing: false,
  })

  const push = createMemo(() => platform.pushState?.())
  const installed = createMemo(() => hasPush(serverSync().data.config.plugin))
  const updating = createMemo(() => serverSync().data.reload === "pending")

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
    if (!platform.testPush) return
    setStore("testing", true)
    await platform
      .testPush(window.location.pathname + window.location.search + window.location.hash)
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

  const setPairInfo = (value?: PairInfo) => {
    setPair({
      id: value?.id,
      status: value?.status,
      command: value?.command,
      expires: value?.expires,
      channel: value?.channel,
      device: value?.device,
      message: value?.message,
      updated: value ? Date.now() : 0,
    })
  }

  const startPair = async () => {
    if (!platform.beginPushPairing || store.pairing) return
    setStore("pairing", true)
    await platform
      .beginPushPairing()
      .then((value) => {
        setPairInfo(value)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("pairing", false))
  }

  const clearPair = async () => {
    if (!platform.clearPushPairing) return
    setStore("clearing", true)
    await platform
      .clearPushPairing()
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
      .finally(() => setStore("clearing", false))
  }

  const installHost = async () => {
    setStore("installing", true)
    await serverSync()
      .updateConfig({ plugin: addPush(serverSync().data.config.plugin) })
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

  const copyHost = async () => {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clip?.writeText) {
      showToast({
        title: language.t("settings.general.notifications.push.host.toast.copyFailed.title"),
        description: language.t("settings.general.notifications.push.host.toast.copyFailed.description"),
        variant: "error",
      })
      return
    }
    setStore("copying", true)
    await clip
      .writeText(pair.command ?? installPush())
      .then(() => {
        showToast({
          title: language.t("settings.general.notifications.push.host.toast.copied.title"),
          description: language.t("settings.general.notifications.push.host.toast.copied.description"),
          variant: "success",
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("copying", false))
  }

  const removeHost = async () => {
    setStore("removing", true)
    await serverSync()
      .updateConfig({ plugin: dropPush(serverSync().data.config.plugin) })
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

  const relayDesc = createMemo(() => {
    if (relay.custom()) {
      return language.t("settings.general.notifications.push.relay.description.custom", {
        url: relay.current() ?? relay.custom() ?? "",
      })
    }
    if (relay.guess()) {
      return language.t("settings.general.notifications.push.relay.description.guess", {
        url: relay.guess() ?? "",
      })
    }
    return language.t("settings.general.notifications.push.relay.description.empty")
  })

  const pairDesc = createMemo(() => {
    const value = push()
    if (store.pairing || !pairReady()) return language.t("home.push.install.status.preparing")
    if (!value) return language.t("settings.general.notifications.push.pairing.pending")
    if (value.paired) return language.t("settings.general.notifications.push.pairing.paired")
    if (pair.status === "claimed") return language.t("home.push.install.status.claimed")
    if (pair.status === "expired") return language.t("home.push.install.status.expired")
    if (pair.status === "failed") return pair.message || language.t("home.push.install.status.failed")
    if (pair.command) return language.t("home.push.install.status.pending")
    return language.t("settings.general.notifications.push.pairing.unpaired")
  })

  createEffect(() => {
    if (push()?.paired) {
      setPairInfo({
        id: pair.id ?? "active",
        status: "active",
        channel: push()?.channel,
        device: pair.device,
      })
      return
    }
    if (pair.status !== "active") return
    setPairInfo()
  })

  createEffect(() => {
    if (!platform.getPushPairing || !pair.id || push()?.paired) return
    if (pair.status !== "pending" && pair.status !== "claimed") return

    let active = true
    const tick = async () => {
      if (!active) return
      await platform
        .getPushPairing?.()
        .then((value) => {
          if (!active || !value) return
          setPairInfo(value)
          if (value.status === "active") {
            void platform.getPushState?.()
          }
        })
        .catch(() => undefined)
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 3000)
    onCleanup(() => {
      active = false
      window.clearInterval(timer)
    })
  })

  const pushAction = createMemo<PushAction>(() => {
    const value = push()
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

  const [shells] = createResource(
    () =>
      serverSdk()
        .client.pty.shells()
        .then((res) => res.data ?? [])
        .catch(() => [] as ShellOption[]),
    { initialValue: [] as ShellOption[] },
  )

  const [displayBackend, { refetch: refetchDisplayBackend }] = createResource(
    () => (linux() && platform.getDisplayBackend ? true : false),
    () => Promise.resolve(platform.getDisplayBackend?.() ?? null).catch(() => null as DisplayBackend | null),
    { initialValue: null as DisplayBackend | null },
  )

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => (desktop() && platform.getPinchZoomEnabled ? true : false),
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  onMount(() => {
    void theme.loadThemes()
  })

  const autoOption = { id: "auto", value: "", label: language.t("settings.general.row.shell.autoDefault") }
  const currentShell = createMemo(() => serverSync().data.config.shell ?? "")

  const shellOptions = createMemo<ShellSelectOption[]>(() => {
    const list = shells.latest
    const current = serverSync().data.config.shell

    const nameCounts = new Map<string, number>()
    for (const s of list) {
      nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1)
    }

    const options = [
      autoOption,
      ...list.map((s) => {
        const ambiguousName = (nameCounts.get(s.name) || 0) > 1
        const text = ambiguousName ? s.path : s.name
        const label = s.acceptable ? text : `${text} (${language.t("settings.general.row.shell.terminalOnly")})`
        return {
          id: s.path,
          // Prefer name over path - "bash" is much cleaner than the explicit full route even when it may change due to PATH.
          value: ambiguousName ? s.path : s.name,
          label,
        }
      }),
    ]

    if (current && !options.some((o) => o.value === current)) {
      options.push({ id: current, value: current, label: current })
    }

    return options
  })

  const onDisplayBackendChange = (checked: boolean) => {
    const update = platform.setDisplayBackend?.(checked ? "wayland" : "auto")
    if (!update) return
    void update.finally(() => {
      void refetchDisplayBackend()
    })
  }

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const InterfaceSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={
            <span class="flex items-center gap-2">
              {language.t("settings.general.row.newInterface.title")}
              <Tag variant="accent">{language.t("settings.general.row.newInterface.badge")}</Tag>
            </span>
          }
          description={language.t("settings.general.row.newInterface.description")}
        >
          <div data-action="settings-new-layout-designs">
            <Switch
              checked={settings.general.newLayoutDesigns()}
              onChange={(checked) => {
                settings.general.setNewLayoutDesigns(checked)
                if (!checked) return
                void import("@/components/settings-v2").then((module) => {
                  void dialog.show(() => <module.DialogSettings />)
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const InterfaceNoticeSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.newInterfaceNotice.title")}
          description={language.t("settings.general.row.newInterfaceNotice.description")}
        >
          <Button size="small" variant="ghost" onClick={settings.general.dismissNewInterfaceNotice}>
            {language.t("settings.general.row.newInterfaceNotice.dismiss")}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const GeneralSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <Select
            data-action="settings-language"
            options={languageOptions()}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("command.permissions.autoaccept.enable")}
          description={language.t("toast.permissions.autoaccept.on.description")}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} disabled={!dir()} onChange={toggleAccept} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shell.title")}
          description={language.t("settings.general.row.shell.description")}
        >
          <Select
            data-action="settings-shell"
            options={shellOptions()}
            current={shellOptions().find((o) => o.value === currentShell()) ?? autoOption}
            value={(o) => o.id}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentShell()) return
              serverSync().updateConfig({ shell: option.value })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AdvancedSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.advanced")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showNavigation.title")}
          description={language.t("settings.general.row.showNavigation.description")}
        >
          <div data-action="settings-show-navigation">
            <Switch
              checked={settings.general.showNavigation()}
              onChange={(checked) => settings.general.setShowNavigation(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showCustomAgents.title")}
          description={language.t("settings.general.row.showCustomAgents.description")}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
        >
          <Select
            data-action="settings-color-scheme"
            options={colorSchemeOptions()}
            current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && theme.setColorScheme(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "220px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.theme.title")}
          description={
            <>
              {language.t("settings.general.row.theme.description")}{" "}
              <Link href="https://opencode.ai/docs/themes/">{language.t("common.learnMore")}</Link>
            </>
          }
        >
          <Select
            data-action="settings-theme"
            options={themeOptions()}
            current={themeOptions().find((o) => o.id === theme.themeId())}
            value={(o) => o.id}
            label={(o) => o.name}
            onSelect={(option) => {
              if (!option) return
              theme.setTheme(option.id)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={language.t("settings.general.row.uiFont.title")}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={language.t("settings.general.row.font.title")}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.terminalFont.title")}
          description={language.t("settings.general.row.terminalFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-terminal-font"
              label={language.t("settings.general.row.terminalFont.title")}
              hideLabel
              type="text"
              value={terminal()}
              onChange={(value) => settings.appearance.setTerminalFont(value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRow>

        <Show when={platform.platform === "ios" && platform.requestPushPermission}>
          <SettingsRow
            title={language.t("settings.general.notifications.push.permission.title")}
            description={pushDesc(push())}
          >
            <div data-action="settings-push-permission">
              <Button
                size="small"
                variant="secondary"
                disabled={store.asking || pushAction().disabled}
                onClick={() => void pushAction().run?.()}
              >
                {store.asking ? language.t("settings.general.notifications.push.action.checking") : pushAction().label}
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
                disabled={store.testing || !platform.testPush || !push()?.allowed}
                onClick={() => void testPush()}
              >
                {store.testing
                  ? language.t("settings.general.notifications.push.action.sending")
                  : language.t("settings.general.notifications.push.action.test")}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow title={language.t("settings.general.notifications.push.relay.title")} description={relayDesc()}>
            <div class="flex w-full max-w-[460px] items-center justify-end gap-2" data-action="settings-push-relay">
              <TextField
                type="text"
                value={relay.custom() ?? ""}
                placeholder={relay.guess() ?? "http://host:8787"}
                onChange={(value) => relay.set(value)}
                class="w-full min-w-0"
              />
              <Button size="small" variant="secondary" disabled={!relay.custom()} onClick={() => relay.clear()}>
                {language.t("settings.general.notifications.push.relay.action.auto")}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow title={language.t("settings.general.notifications.push.pairing.title")} description={pairDesc()}>
            <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-push-pairing">
              <Button
                size="small"
                variant="secondary"
                disabled={store.pairing || !platform.beginPushPairing || !push()?.allowed}
                onClick={() => void startPair()}
              >
                {store.pairing
                  ? language.t("home.push.install.action.preparing")
                  : language.t("settings.general.notifications.push.pairing.action.repair")}
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={store.clearing || !platform.clearPushPairing || !push()?.paired}
                onClick={() => void clearPair()}
              >
                {store.clearing
                  ? language.t("settings.general.notifications.push.pairing.action.clearing")
                  : language.t("settings.general.notifications.push.pairing.action.clear")}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow title={language.t("settings.general.notifications.push.host.title")} description={hostDesc()}>
            <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-push-host">
              <Button size="small" variant="secondary" disabled={store.copying} onClick={() => void copyHost()}>
                {store.copying
                  ? language.t("settings.general.notifications.push.host.action.copying")
                  : language.t("settings.general.notifications.push.host.action.copy")}
              </Button>
              <Show
                when={installed()}
                fallback={
                  <Button size="small" disabled={store.installing || updating()} onClick={() => void installHost()}>
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
                  {store.removing
                    ? language.t("settings.general.notifications.push.host.action.removing")
                    : language.t("settings.general.notifications.push.host.action.remove")}
                </Button>
              </Show>
            </div>
          </SettingsRow>
        </Show>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.updates")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <Button size="small" variant="secondary" disabled={!updater.action().run} onClick={updater.run}>
            {language.t(updater.action().label)}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.display")}</h3>

        <SettingsList>
          <SettingsRow
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRow>

          <Show when={linux()}>
            <SettingsRow
              title={
                <div class="flex items-center gap-2">
                  <span>{language.t("settings.general.row.wayland.title")}</span>
                  <Tooltip value={language.t("settings.general.row.wayland.tooltip")} placement="top">
                    <span class="text-text-weak">
                      <Icon name="help" size="small" />
                    </span>
                  </Tooltip>
                </div>
              }
              description={language.t("settings.general.row.wayland.description")}
            >
              <div data-action="settings-wayland">
                <Switch checked={displayBackend.latest === "wayland"} onChange={onDisplayBackendChange} />
              </div>
            </SettingsRow>
          </Show>
        </SettingsList>
      </div>
    </Show>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        <UpdatesSection />

        <DisplaySection />

        <Show when={desktop()}>
          <AdvancedSection />
        </Show>
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
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
