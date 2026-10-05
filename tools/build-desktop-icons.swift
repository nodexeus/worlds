// Rasterize the supplied Nodexeus SVG assets; never redraw the brand glyph.
import AppKit

let output = URL(fileURLWithPath: "desktop/assets", isDirectory: true)
let iconset = output.appendingPathComponent("BotCrossing.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
guard let brand = NSImage(contentsOfFile: "public/brand/nodexeus-mark.svg"),
      let mono = NSImage(contentsOfFile: "public/brand/nodexeus-mark-mono.svg") else {
    fatalError("Download the official Nodexeus SVG assets before building icons")
}

/// Rasterize the official mark on a flat ink application tile.
func appIcon(_ size: Int) -> Data {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let s = CGFloat(size)
    let rect = NSRect(x: s * 0.035, y: s * 0.035, width: s * 0.93, height: s * 0.93)
    NSColor(calibratedRed: 5 / 255, green: 5 / 255, blue: 6 / 255, alpha: 1).setFill()
    NSBezierPath(roundedRect: rect, xRadius: s * 0.21, yRadius: s * 0.21).fill()
    brand.draw(in: NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8))
    image.unlockFocus()
    return NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try appIcon(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try appIcon(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try appIcon(512).write(to: output.appendingPathComponent("icon.png"))

/// Rasterize the supplied monochrome mark for the macOS menu bar.
func trayIcon(_ size: Int) -> Data {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    mono.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    image.unlockFocus()
    return NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
}
try trayIcon(18).write(to: output.appendingPathComponent("trayTemplate.png"))
try trayIcon(36).write(to: output.appendingPathComponent("trayTemplate@2x.png"))
