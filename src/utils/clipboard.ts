import { getElectronAPI } from './electron'

function copyWithSelection(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

export async function writeClipboardText(value: string): Promise<void> {
  const text = String(value || '')
  if (!text) throw new Error('复制内容为空')

  const desktop = getElectronAPI()
  if (desktop?.writeClipboardText) {
    const result = await desktop.writeClipboardText(text)
    if (result?.success) return
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (_) {}
  }

  if (!copyWithSelection(text)) throw new Error('系统剪贴板写入失败')
}
