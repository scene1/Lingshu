import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function hashFile(filePath, algorithm, encoding) {
  return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest(encoding)
}

function safeAssetName(value, metadataName) {
  const name = String(value || '')
  invariant(name && path.basename(name) === name, `${metadataName} contains an unsafe asset path: ${name}`)
  return name
}

function readMetadata(directory, metadataName) {
  const metadataPath = path.join(directory, metadataName)
  invariant(fs.existsSync(metadataPath), `missing update metadata: ${metadataName}`)
  const metadata = parse(fs.readFileSync(metadataPath, 'utf8'))
  invariant(metadata && typeof metadata === 'object', `invalid update metadata: ${metadataName}`)
  return metadata
}

function validateMetadata(directory, metadataName, version) {
  const metadata = readMetadata(directory, metadataName)
  invariant(String(metadata.version || '') === version, `${metadataName} version must be ${version}`)
  invariant(Array.isArray(metadata.files) && metadata.files.length > 0, `${metadataName} has no files`)

  const referenced = new Set()
  for (const entry of metadata.files) {
    const assetName = safeAssetName(entry?.url, metadataName)
    const assetPath = path.join(directory, assetName)
    invariant(fs.existsSync(assetPath), `${metadataName} references missing asset: ${assetName}`)
    invariant(Number(entry.size) === fs.statSync(assetPath).size, `${metadataName} has the wrong size for ${assetName}`)
    invariant(String(entry.sha512 || '') === hashFile(assetPath, 'sha512', 'base64'), `${metadataName} has the wrong SHA512 for ${assetName}`)
    referenced.add(assetName)
  }

  const primary = safeAssetName(metadata.path, metadataName)
  invariant(referenced.has(primary), `${metadataName} primary path is not listed in files: ${primary}`)
  invariant(String(metadata.sha512 || '') === hashFile(path.join(directory, primary), 'sha512', 'base64'), `${metadataName} has the wrong primary SHA512`)
  return referenced
}

export function verifyReleaseAssets(directory, version, platform = 'all') {
  invariant(/^\d+\.\d+\.\d+$/.test(version), `invalid release version: ${version}`)
  invariant(['all', 'macos', 'windows'].includes(platform), `invalid release platform: ${platform}`)
  invariant(fs.existsSync(directory) && fs.statSync(directory).isDirectory(), `release directory not found: ${directory}`)

  const requiredAssets = []
  if (platform !== 'windows') {
    requiredAssets.push(
      `Lingshu-v${version}-mac-arm64.dmg`,
      `Lingshu-v${version}-mac-arm64.zip`,
      `Lingshu-v${version}-mac-x64.dmg`,
      `Lingshu-v${version}-mac-x64.zip`,
    )
  }
  if (platform !== 'macos') {
    requiredAssets.push(
      `Lingshu-v${version}-win-x64-setup.exe`,
      `Lingshu-v${version}-win-x64.zip`,
    )
  }
  for (const assetName of requiredAssets) {
    invariant(fs.existsSync(path.join(directory, assetName)), `missing release asset: ${assetName}`)
  }

  let macFiles = new Set()
  let windowsFiles = new Set()
  if (platform !== 'windows') {
    macFiles = validateMetadata(directory, 'latest-mac.yml', version)
    for (const arch of ['arm64', 'x64']) {
      const zipName = `Lingshu-v${version}-mac-${arch}.zip`
      invariant(macFiles.has(zipName), `latest-mac.yml does not contain ${arch} update metadata`)
      invariant(fs.existsSync(path.join(directory, `${zipName}.blockmap`)), `missing blockmap: ${zipName}.blockmap`)
    }
  }

  if (platform !== 'macos') {
    windowsFiles = validateMetadata(directory, 'latest.yml', version)
    const installerName = `Lingshu-v${version}-win-x64-setup.exe`
    invariant(windowsFiles.has(installerName), 'latest.yml does not contain the Windows installer')
    invariant(fs.existsSync(path.join(directory, `${installerName}.blockmap`)), `missing blockmap: ${installerName}.blockmap`)
  }

  return {
    version,
    platform,
    directory: path.resolve(directory),
    macUpdateFiles: [...macFiles],
    windowsUpdateFiles: [...windowsFiles],
  }
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const directory = path.resolve(argument('--dir', 'release-assets'))
  const version = argument('--version', String(process.env.GITHUB_REF_NAME || '').replace(/^v/, ''))
  const platform = argument('--platform', 'all')
  try {
    const result = verifyReleaseAssets(directory, version, platform)
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } catch (error) {
    console.error(`Release asset verification failed: ${error.message}`)
    process.exitCode = 1
  }
}
