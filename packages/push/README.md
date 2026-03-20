# @whisperopencode/push

Push notification plugin for [opencode](https://github.com/nicholasgrass/opencode). Sends mobile alerts when long-running sessions complete.

## Install

```sh
npm install @whisperopencode/push
```

## CLI usage

```
opencode-push <install|status|test|unpair|devices|remove-device> [--pair <token>] [--relay <url>] [--server <label>] [--plugin <spec>] [--device <id>] [--json]
```

Pair with a mobile device:

```sh
npx --yes --prefix . --package=@whisperopencode/push opencode-push install --pair <token>
```

By default, `opencode-push install` writes an unpinned `@whisperopencode/push` entry to your OpenCode config so the host can track the latest plugin release. Pass `--plugin <spec>` if you want to pin a version instead.

## Plugin usage

Add to your opencode config:

```jsonc
{
  "plugin": ["@whisperopencode/push"]
}
```

The plugin checks in with the relay on startup and publishes events when sessions complete.

## License

MIT
