const enableWindowsExecutableEditing = process.env.MOVION_ENABLE_WIN_EXECUTABLE_EDITING === 'true'

module.exports = {
  appId: 'com.ads123121.movion',
  productName: 'Movion',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  toolsets: {
    winCodeSign: '1.1.0',
  },
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: ['dist/**/*', 'electron/**/*', 'src/shared/**/*.js', 'package.json'],
  asar: true,
  asarUnpack: ['electron/*.ps1'],
  extraMetadata: {
    main: 'electron/main.mjs',
  },
  win: {
    icon: 'build/icon.ico',
    signAndEditExecutable: enableWindowsExecutableEditing,
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'Movion',
    installerHeaderIcon: 'build/icon.ico',
  },
  portable: {
    artifactName: '${productName}-${version}-portable-${arch}.${ext}',
  },
}
