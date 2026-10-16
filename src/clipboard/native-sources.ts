// Small desktop-session helpers. JSON travels over anonymous pipes, never the command line.
export const windowsClipboard = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type 'using System.Runtime.InteropServices; public static class ClipboardSequence { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }'
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $command = $line | ConvertFrom-Json
    $revision = [string][ClipboardSequence]::GetClipboardSequenceNumber()
    if ($command.op -eq 'read') {
      $result = @{revision=$revision}
      if ($command.since -ne $revision) {
        $content = @{kind='empty'}
        if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
          $content = @{kind='files';paths=@([Windows.Forms.Clipboard]::GetFileDropList())}
        } elseif ([Windows.Forms.Clipboard]::ContainsImage()) {
          $image = [Windows.Forms.Clipboard]::GetImage()
          $memory = [IO.MemoryStream]::new()
          try { $image.Save($memory,[Drawing.Imaging.ImageFormat]::Png); $content=@{kind='image';png=[Convert]::ToBase64String($memory.ToArray())} }
          finally { $memory.Dispose(); $image.Dispose() }
        } elseif ([Windows.Forms.Clipboard]::ContainsText()) {
          $content = @{kind='text';text=[Windows.Forms.Clipboard]::GetText()}
        }
        if ([string][ClipboardSequence]::GetClipboardSequenceNumber() -ne $revision) { throw 'Clipboard changed while reading' }
        $result.content = $content
      }
    } elseif ($command.op -eq 'write') {
      if ($command.expected -ne $revision) { throw 'CLIPBOARD_CHANGED' }
      $content = $command.content
      switch ($content.kind) {
        'empty' { [Windows.Forms.Clipboard]::Clear() }
        'text' { if ($content.text.Length) { [Windows.Forms.Clipboard]::SetText($content.text) } else { [Windows.Forms.Clipboard]::Clear() } }
        'files' { $paths=[Collections.Specialized.StringCollection]::new(); foreach($path in $content.paths) { [void]$paths.Add($path) }; [Windows.Forms.Clipboard]::SetFileDropList($paths) }
        'image' { $memory=[IO.MemoryStream]::new([Convert]::FromBase64String($content.png)); $image=[Drawing.Image]::FromStream($memory); try { [Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose(); $memory.Dispose() } }
        default { throw 'Unsupported clipboard format' }
      }
      $result = @{revision=[string][ClipboardSequence]::GetClipboardSequenceNumber()}
    } else { throw 'Unsupported operation' }
    @{id=$command.id;result=$result} | ConvertTo-Json -Depth 8 -Compress | ForEach-Object { [Console]::WriteLine($_) }
  } catch { @{id=$command.id;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) } }
}
`

export const macClipboard = String.raw`
import AppKit
import Foundation
let pasteboard = NSPasteboard.general
func fail(_ message: String) throws -> Never { throw NSError(domain: message, code: 1) }
while let line = readLine() {
  var id: Any = 0
  do {
    guard let command = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { try fail("Invalid request") }
    id = command["id"] ?? 0
    let revision = String(pasteboard.changeCount)
    var result: [String: Any] = ["revision": revision]
    if command["op"] as? String == "read" {
      if command["since"] as? String != revision {
        var content: [String: Any] = ["kind": "empty"]
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
          content = ["kind": "files", "paths": urls.map { $0.path }]
        } else if let data = pasteboard.data(forType: .png) {
          content = ["kind": "image", "png": data.base64EncodedString()]
        } else if let data = pasteboard.data(forType: .tiff), let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
          content = ["kind": "image", "png": png.base64EncodedString()]
        } else if let text = pasteboard.string(forType: .string) { content = ["kind": "text", "text": text] }
        if String(pasteboard.changeCount) != revision { try fail("Clipboard changed while reading") }
        result["content"] = content
      }
    } else if command["op"] as? String == "write", let content = command["content"] as? [String: Any] {
      if command["expected"] as? String != revision { try fail("CLIPBOARD_CHANGED") }
      pasteboard.clearContents()
      var ok = true
      switch content["kind"] as? String {
      case "text": ok = pasteboard.setString(content["text"] as? String ?? "", forType: .string)
      case "files": ok = pasteboard.writeObjects((content["paths"] as? [String] ?? []).map { NSURL(fileURLWithPath: $0) })
      case "image": if let data = Data(base64Encoded: content["png"] as? String ?? "") { ok = pasteboard.setData(data, forType: .png) } else { ok = false }
      case "empty": break
      default: ok = false
      }
      if !ok { try fail("Could not write clipboard") }
      result = ["revision": String(pasteboard.changeCount)]
    } else { try fail("Unsupported operation") }
    let data = try JSONSerialization.data(withJSONObject: ["id": id, "result": result])
    print(String(decoding: data, as: UTF8.self))
  } catch {
    let data = try! JSONSerialization.data(withJSONObject: ["id": id, "error": (error as NSError).domain])
    print(String(decoding: data, as: UTF8.self))
  }
  fflush(stdout)
}
`

// GTK on Xwayland uses the compositor's existing clipboard bridge and needs no focus changes.
// ctypes keeps the helper independent of Python GI/development packages.
export const linuxClipboard = String.raw`
import ctypes as c, json, sys, threading, queue, base64, os
from urllib.parse import urlsplit, unquote
os.environ['GDK_BACKEND'] = 'x11'
gtk = c.CDLL('libgtk-3.so.0'); gdk = c.CDLL('libgdk-3.so.0'); glib = c.CDLL('libglib-2.0.so.0'); obj = c.CDLL('libgobject-2.0.so.0')
def bind(lib, name, restype, *args):
    f=getattr(lib,name); f.restype=restype; f.argtypes=list(args); return f
ptr=c.c_void_p; integer=c.c_int; string=c.c_char_p
if not bind(gtk,'gtk_init_check',integer,ptr,ptr)(None,None): raise RuntimeError('Desktop clipboard unavailable (DISPLAY/XAUTHORITY)')
atom=bind(gdk,'gdk_atom_intern',ptr,string,integer)
clipboard=bind(gtk,'gtk_clipboard_get',ptr,ptr)(atom(b'CLIPBOARD',0))
wait=bind(gtk,'gtk_clipboard_wait_for_contents',ptr,ptr,ptr)
data_get=bind(gtk,'gtk_selection_data_get_data_with_length',ptr,ptr,c.POINTER(integer))
data_free=bind(gtk,'gtk_selection_data_free',None,ptr)
selection_set=bind(gtk,'gtk_selection_data_set',None,ptr,ptr,integer,ptr,integer)
class Target(c.Structure): _fields_=[('target',string),('flags',c.c_uint),('info',c.c_uint)]
get_cb=c.CFUNCTYPE(None,ptr,ptr,c.c_uint,ptr); clear_cb=c.CFUNCTYPE(None,ptr,ptr)
set_data=bind(gtk,'gtk_clipboard_set_with_data',integer,ptr,c.POINTER(Target),c.c_uint,get_cb,clear_cb,ptr)
revision=0; owned={}; commands=queue.Queue()
@c.CFUNCTYPE(None,ptr,ptr,ptr)
def changed(a,b,d):
    global revision
    revision+=1
bind(obj,'g_signal_connect_data',c.c_ulong,ptr,string,ptr,ptr,ptr,integer)(clipboard,b'owner-change',changed,None,None,0)
def read_format(mime):
    data=wait(clipboard,atom(mime.encode(),0))
    if not data: return None
    try:
        length=integer(); value=data_get(data,c.byref(length))
        if length.value>24*1024*1024: raise RuntimeError('Clipboard text/image exceeds 24 MiB')
        return c.string_at(value,length.value) if value and length.value>=0 else None
    finally: data_free(data)
@get_cb
def provide(a,selection,info,d):
    mime=list(owned)[info]; value=owned[mime]; buffer=c.create_string_buffer(value)
    selection_set(selection,atom(mime.encode(),0),8,buffer,len(value))
@clear_cb
def clear(a,d): pass
def reader():
    for line in sys.stdin: commands.put(line)
    commands.put(None)
threading.Thread(target=reader,daemon=True).start()
@c.CFUNCTYPE(integer,ptr)
def tick(d):
    global revision, owned
    try: line=commands.get_nowait()
    except queue.Empty: return 1
    if line is None: gtk.gtk_main_quit(); return 0
    command={}
    try:
        command=json.loads(line); before=str(revision); result={'revision':before}
        if command['op']=='read':
            if command.get('since')!=before:
                content={'kind':'empty'}
                uris=read_format('text/uri-list')
                if uris:
                    paths=[]
                    for uri in uris.decode('utf8').splitlines():
                        url=urlsplit(uri)
                        if url.scheme=='file' and url.netloc in ('','localhost'): paths.append(unquote(url.path))
                    if paths: content={'kind':'files','paths':paths}
                if content['kind']=='empty':
                    png=read_format('image/png')
                    if png: content={'kind':'image','png':base64.b64encode(png).decode('ascii')}
                    else:
                        text=read_format('UTF8_STRING')
                        if text is None: text=read_format('text/plain;charset=utf-8')
                        if text is not None: content={'kind':'text','text':text.decode('utf8')}
                result={'revision':str(revision),'content':content}
        elif command['op']=='write':
            if command['expected']!=before: raise RuntimeError('CLIPBOARD_CHANGED')
            value=command['content']; kind=value['kind']
            if kind=='files':
                from pathlib import Path
                uris=[Path(p).as_uri() for p in value['paths']]
                owned={'text/uri-list':('\r\n'.join(uris)+'\r\n').encode(),'x-special/gnome-copied-files':('copy\n'+'\n'.join(uris)).encode()}
            elif kind=='image': owned={'image/png':base64.b64decode(value['png'])}
            elif kind in ('text','empty'):
                text=value.get('text','').encode(); owned={'UTF8_STRING':text,'text/plain;charset=utf-8':text,'text/plain':text}
            else: raise RuntimeError('Unsupported format')
            targets=(Target*len(owned))(*(Target(mime.encode(),0,i) for i,mime in enumerate(owned)))
            if not set_data(clipboard,targets,len(owned),provide,clear,None): raise RuntimeError('Could not own clipboard')
            # Drain owner-change before reporting the revision of our write.
            display=bind(gdk,'gdk_display_get_default',ptr)()
            bind(gdk,'gdk_display_sync',None,ptr)(display)
            while gtk.gtk_events_pending(): gtk.gtk_main_iteration_do(0)
            revision+=1; result={'revision':str(revision)}
        else: raise RuntimeError('Unsupported operation')
        print(json.dumps({'id':command['id'],'result':result},ensure_ascii=False),flush=True)
    except Exception as e: print(json.dumps({'id':command.get('id',0),'error':str(e)}),flush=True)
    return 1
bind(glib,'g_timeout_add',c.c_uint,c.c_uint,ptr,ptr)(20,tick,None)
gtk.gtk_main()
`
