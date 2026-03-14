#!/usr/bin/env bun
import { parse, run } from "./cmd"

const opts = parse(Bun.argv.slice(2))

void run(Bun.argv[2], opts)
