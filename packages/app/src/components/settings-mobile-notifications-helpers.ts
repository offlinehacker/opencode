import { PushFail } from "@/utils/push-pair"

export function shouldToastPairErr(err: unknown) {
  return !(err instanceof PushFail)
}
