import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const rootDir = process.cwd()
const buildDir = path.join(rootDir, 'build')
const iconSvgPath = path.join(buildDir, 'icon.svg')

const iconPngSizes = [16, 24, 32, 48, 64, 128, 256, 512]
const iconIcoSizes = [16, 32, 48, 256]

const iconSvg = await sharp(iconSvgPath).toBuffer()

await mkdir(buildDir, { recursive: true })

const generatedPngPaths = []

for (const size of iconPngSizes) {
  const outputPath = path.join(buildDir, `icon-${size}.png`)
  await sharp(iconSvg).resize(size, size).png().toFile(outputPath)
  generatedPngPaths.push(outputPath)
}

await sharp(iconSvg).resize(512, 512).png().toFile(path.join(buildDir, 'icon.png'))

const iconIcoBuffer = await pngToIco(
  iconIcoSizes.map((size) => path.join(buildDir, `icon-${size}.png`)),
)
await writeFile(path.join(buildDir, 'icon.ico'), iconIcoBuffer)

const bannerSvg = `
<svg width="492" height="312" viewBox="0 0 492 312" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="32" y1="24" x2="430" y2="286" gradientUnits="userSpaceOnUse">
      <stop stop-color="#101826"/>
      <stop offset="1" stop-color="#070B12"/>
    </linearGradient>
    <linearGradient id="accent" x1="138" y1="82" x2="372" y2="258" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFD66B"/>
      <stop offset="0.5" stop-color="#FF8A5B"/>
      <stop offset="1" stop-color="#FF4D6D"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="492" height="312" rx="28" fill="url(#bg)"/>
  <path d="M104 191V104C104 89.6406 115.641 78 130 78C139.391 78 148.072 83.0744 152.774 91.2614L210.5 191.607L268.226 91.2614C272.928 83.0744 281.609 78 291 78C305.359 78 317 89.6406 317 104V191C317 205.359 305.359 217 291 217C281.609 217 272.928 211.926 268.226 203.739L210.5 103.393L152.774 203.739C148.072 211.926 139.391 217 130 217C115.641 217 104 205.359 104 191Z" fill="white"/>
  <path d="M160 209L210.5 121L261 209" stroke="url(#accent)" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="334" cy="102" r="34" fill="url(#accent)"/>
  <path d="M80 250C80 160.544 152.544 88 242 88H290" stroke="url(#accent)" stroke-width="22" stroke-linecap="round" opacity="0.85"/>
</svg>
`

await sharp(Buffer.from(bannerSvg)).png().toFile(path.join(buildDir, 'installer-banner.png'))

console.log(`Generated release assets in ${buildDir}`)
