import AppKit

final class PatternView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.12, alpha: 1).setFill()
        bounds.fill()
        let elapsed = ProcessInfo.processInfo.systemUptime
        let x = (sin(elapsed * 2) + 1) * 0.5 * (bounds.width - 160)
        NSColor.systemCyan.setFill()
        NSBezierPath(roundedRect: NSRect(x: x, y: 130, width: 160, height: 160), xRadius: 20, yRadius: 20).fill()
        let text = "Lanto performance test · Ends automatically\nFixed animation for comparing video pipelines\n\(Int(elapsed * 60))"
        text.draw(at: NSPoint(x: 35, y: bounds.height - 110), withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 22, weight: .medium),
            .foregroundColor: NSColor.white
        ])
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 500), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Lanto performance test — Ends automatically"
window.isReleasedWhenClosed = false
let view = PatternView(frame: window.contentView!.bounds)
window.contentView = view
window.center()
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in view.needsDisplay = true }
RunLoop.main.add(timer, forMode: .common)
DispatchQueue.main.asyncAfter(deadline: .now() + 240) { app.terminate(nil) }
app.run()
