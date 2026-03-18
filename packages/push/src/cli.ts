#!/usr/bin/env node
import { parse, run } from "./cmd.js"

const opts = parse(process.argv.slice(2))

void run(process.argv[2], opts)
