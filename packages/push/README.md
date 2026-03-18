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

## Plugin usage

Add to your opencode config:

```jsonc
{
  "plugins": {
    "@whisperopencode/push": true,
  },
}
```

The plugin checks in with the relay on startup and publishes events when sessions complete.

## License

MIT
