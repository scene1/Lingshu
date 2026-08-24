import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import { verifyReleaseAssets } from './verify-release-assets.mjs'

function sha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

function writeAsset(directory, name, content = name) {
  const filePath = path.join(directory, name)
  fs.writeFileSync(filePath, content)
  return {
    url: name,
    size: fs.statSync(filePath).size,
    sha512: sha512(filePath),
  }
}

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-release-'))
  const version = '2.0.1'
  const macAssets = ['arm64', 'x64'].flatMap(arch => [
    writeAsset(directory, `Lingshu-v${version}-mac-${arch}.zip`),
    writeAsset(directory, `Lingshu-v${version}-mac-${arch}.dmg`),
  ])
  for (const arch of ['arm64', 'x64']) writeAsset(directory, `Lingshu-v${version}-mac-${arch}.zip.blockmap`)

  const windowsInstaller = writeAsset(directory, `Lingshu-v${version}-win-x64-setup.exe`)
  writeAsset(directory, `Lingshu-v${version}-win-x64-setup.exe.blockmap`)
  writeAsset(directory, `Lingshu-v${version}-win-x64.zip`)

  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), stringify({
    version,
    files: macAssets,
    path: macAssets[0].url,
    sha512: macAssets[0].sha512,
  }))
  fs.writeFileSync(path.join(directory, 'latest.yml'), stringify({
    version,
    files: [windowsInstaller],
    path: windowsInstaller.url,
    sha512: windowsInstaller.sha512,
  }))
  return { directory, version }
}

test('accepts complete signed-release metadata assets', () => {
  const fixture = createFixture()
  try {
    const result = verifyReleaseAssets(fixture.directory, fixture.version)
    assert.equal(result.macUpdateFiles.length, 4)
    assert.deepEqual(result.windowsUpdateFiles, ['Lingshu-v2.0.1-win-x64-setup.exe'])
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('rejects metadata when an artifact was changed after packaging', () => {
  const fixture = createFixture()
  try {
    fs.appendFileSync(path.join(fixture.directory, 'Lingshu-v2.0.1-mac-arm64.zip'), 'tampered')
    assert.throws(
      () => verifyReleaseAssets(fixture.directory, fixture.version),
      /wrong size|wrong SHA512/,
    )
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('supports a macOS-only local packaging check', () => {
  const fixture = createFixture()
  try {
    fs.rmSync(path.join(fixture.directory, 'latest.yml'))
    fs.rmSync(path.join(fixture.directory, 'Lingshu-v2.0.1-win-x64-setup.exe'))
    fs.rmSync(path.join(fixture.directory, 'Lingshu-v2.0.1-win-x64-setup.exe.blockmap'))
    fs.rmSync(path.join(fixture.directory, 'Lingshu-v2.0.1-win-x64.zip'))
    const result = verifyReleaseAssets(fixture.directory, fixture.version, 'macos')
    assert.equal(result.platform, 'macos')
    assert.equal(result.macUpdateFiles.length, 4)
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})
