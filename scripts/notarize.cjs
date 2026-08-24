const path = require('path')
const { notarize } = require('@electron/notarize')

module.exports = async function notarizeMacApp(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Apple notarization skipped: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD or APPLE_TEAM_ID is missing.')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`Submitting ${appPath} for Apple notarization...`)
  await notarize({ appPath, appleId, appleIdPassword, teamId })
}
