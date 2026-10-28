import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import readXlsxFile, { readSheetNames } from 'read-excel-file'

// Export TikTok kadang menulis <dimension> yang salah (mis. A1:X19 padahal data sampai BY79),
// dan read-excel-file memotong data sesuai <dimension>. Tag itu dibuang agar ukuran dihitung ulang.
async function sanitize(file: File): Promise<Blob> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  let changed = false
  for (const name of Object.keys(files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
    const xml = strFromU8(files[name])
    const fixed = xml.replace(/<dimension\b[^>]*?(\/>|>\s*<\/dimension>)/, '')
    if (fixed !== xml) {
      files[name] = strToU8(fixed)
      changed = true
    }
  }
  return changed ? new Blob([zipSync(files)]) : file
}

export async function readXlsx(file: File, sheet?: string) {
  return readXlsxFile(await sanitize(file), sheet ? { sheet } : undefined)
}

export async function readXlsxSheetNames(file: File) {
  return readSheetNames(file)
}
