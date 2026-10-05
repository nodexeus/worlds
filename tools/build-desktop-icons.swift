// Reuse the app's existing astronaut favicon for a macOS application icon.
import AppKit

let output = URL(fileURLWithPath: "desktop/assets", isDirectory: true)
let iconset = output.appendingPathComponent("BotCrossing.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

/// Rasterize the existing astronaut mark at the requested size.
func appIcon(_ size: Int) -> Data {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let s = CGFloat(size)
    let rect = NSRect(x: s * 0.035, y: s * 0.035, width: s * 0.93, height: s * 0.93)
    let shape = NSBezierPath(roundedRect: rect, xRadius: s * 0.21, yRadius: s * 0.21)
    NSGradient(starting: NSColor(calibratedRed: 0.16, green: 0.26, blue: 0.38, alpha: 1),
               ending: NSColor(calibratedRed: 0.04, green: 0.08, blue: 0.15, alpha: 1))!.draw(in: shape, angle: -90)
    let mark = NSAttributedString(string: "👨‍🚀", attributes: [.font: NSFont.systemFont(ofSize: s * 0.68)])
    let bounds = mark.size()
    mark.draw(at: NSPoint(x: (s - bounds.width) / 2, y: (s - bounds.height) / 2 + s * 0.04))
    image.unlockFocus()
    return NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try appIcon(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try appIcon(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try appIcon(512).write(to: output.appendingPathComponent("icon.png"))

/// Draw a monochrome helmet silhouette for macOS template-image rendering.
func trayIcon(_ size: Int) -> Data {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let s = CGFloat(size)
    NSColor.black.setFill()
    NSBezierPath(ovalIn: NSRect(x: s * 0.13, y: s * 0.18, width: s * 0.74, height: s * 0.74)).fill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.08, y: s * 0.11, width: s * 0.84, height: s * 0.26), xRadius: s * 0.08, yRadius: s * 0.08).fill()
    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.26, y: s * 0.43, width: s * 0.48, height: s * 0.22), xRadius: s * 0.08, yRadius: s * 0.08).fill()
    image.unlockFocus()
    return NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
}
try trayIcon(18).write(to: output.appendingPathComponent("trayTemplate.png"))
try trayIcon(36).write(to: output.appendingPathComponent("trayTemplate@2x.png"))
