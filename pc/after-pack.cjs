// Puts the droid's icon and Astromech's name into Astromech.exe. electron-builder would
// need Wine for that when building on a Mac; resedit does it in plain JavaScript.
const fs = require('node:fs')
const path = require('node:path')

exports.default = async context => {
  if (context.electronPlatformName !== 'win32') return
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit')
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const version = context.packager.appInfo.version

  const executable = NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true })
  const res = NtExecutableResource.from(executable)

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'build', 'icon.ico')))
  const group = res.entries.find(e => e.type === 14) // RT_GROUP_ICON: Electron's own icon
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group ? group.id : 1,
    group ? group.lang : 1033,
    iconFile.icons.map(i => i.data),
  )

  const [info] = Resource.VersionInfo.fromEntries(res.entries)
  if (info) {
    const [major, minor, patch] = version.split('.').map(Number)
    info.setFileVersion(major, minor, patch, 0, 1033)
    info.setProductVersion(major, minor, patch, 0, 1033)
    for (const lang of info.getAllLanguagesForStringValues()) {
      info.setStringValues(lang, {
        ProductName: 'Astromech',
        FileDescription: 'Astromech',
        CompanyName: 'Astromech',
        InternalName: 'Astromech',
        OriginalFilename: 'Astromech.exe',
        LegalCopyright: 'MIT',
        FileVersion: version,
        ProductVersion: version,
      })
    }
    info.outputToResourceEntries(res.entries)
  }

  res.outputResource(executable)
  fs.writeFileSync(exe, Buffer.from(executable.generate()))
}
