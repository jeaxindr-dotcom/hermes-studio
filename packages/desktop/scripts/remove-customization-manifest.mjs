#!/usr/bin/env node
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const manifestPath = resolve('packages/desktop/build/customization-manifest.json')
if (existsSync(manifestPath)) unlinkSync(manifestPath)
