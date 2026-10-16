# Shared Clipboard and Files

Enable Shared Clipboard in Settings to sync newly copied text and images between this machine and all paired Hosts that are online and logged in to the desktop. Share Files is a separate toggle and requires Shared Clipboard to be enabled as well. Copied files and folders are transferred automatically. When the interface shows Ready to paste, you can paste them in the file manager on another device. The remote screen does not need to be open.

The controller acts as the sync hub and must remain running; files sent from one remote device to another pass through the controller, so both the controller and the receiving device need sufficient free disk space. Manually added streaming devices that have not been paired through Lanto Host do not participate in sharing. Both toggles are off by default; when first enabled, only the current state is sampled, and syncing starts with subsequent new copies. Turning sharing off stops sampling, revokes sessions, and cancels transfers; after Shared Files is turned off, text and images can still sync.

## File Behavior

- There is no application-level limit on file bytes. Files use streaming reads and writes, backpressure, and SHA-256 verification, and are not loaded into memory all at once; sizes are calculated using decimal strings and BigInt. Disk capacity, the operating system, and the file system still impose practical limits.
- Supports multiple regular files, folders, Chinese names, empty files, and empty folders. Each copy can contain up to 100,000 file/directory entries, and the manifest is also limited to 36 MiB of JSON; this is a manifest limit, not a per-file byte limit.
- The destination clipboard is updated only after files are transferred and verified. If a source file changes, the destination receives new copied content, the connection is interrupted, or the transfer is canceled, submission is aborted and incomplete copies are cleaned up; partial files are not pasted. Copy again after a disconnection to retry; resumable transfers are not currently supported.
- Each receive uses a separate directory and does not overwrite existing files. Characters disallowed in Windows names are converted to underscores; conflicts after case folding or normalization fail explicitly. Symbolic links and special device files are not shared, and file system metadata such as permissions, ACLs, and extended attributes is not preserved across devices.
- Completed file caches are retained so that file paths in the clipboard do not immediately become invalid. Use the controller’s “Received Files” button to open the local receive directory; delete files yourself when they are no longer needed. Exiting or turning off the toggle does not delete completed files.

Images are transferred as PNG, with a limit of about 18 MiB for the compressed image; text is limited to 16 Mi UTF-16 code units and is also subject to the JSON request size limit. Rich text is extracted as plain text, and application-private formats are not transferred. When copying happens on multiple devices at once, the latest update observed by the controller takes precedence; clipboard history is not provided.

## Desktop Components and Installation

The Host interface continues to use the existing TLS certificate pinning and pairing token; no public-facing service or anonymous file entry point has been added. Clipboard contents are not logged. The controller renews its lease every three seconds, with a twelve-second lease; after an abnormal exit, the Host automatically stops sampling and cleans up unfinished transfers.

**Windows**: A LOCAL SERVICE Host cannot directly access the clipboard of the logged-in desktop, so the runtime package adds `install-windows-clipboard.ps1`. On a machine where the target desktop user is already logged in, run as administrator:

```powershell
& 'C:\Program Files\Lanto Host\<runtime directory>\install-windows-host.ps1' -Name MyWindows -Address <intranet IP>
& 'C:\Program Files\Lanto Host\<runtime directory>\install-windows-clipboard.ps1'
```

Step 2 creates a standard-privilege, desktop-user `Lanto Clipboard` Log in to the task. The main Host remains LOCAL SERVICE; only authenticated clipboard operations are forwarded to the local loopback proxy using a random token. The desktop user is granted read access to the runtime directory and `ProgramData\Lanto\Host\clipboard\desktop` Change the permissions; the Host identity and pairing secret retain their existing permissions. After rerunning the Host installer, run the clipboard installer again. The clipboard is unavailable when logging out of the desktop; the task automatically resumes after logging in.

**macOS**: The Host should run in the logged-in user’s LaunchAgent session. First use requires Xcode Command Line Tools’ `xcrun swiftc`, which compiles the AppKit component provided with the Host into a private cache directory; subsequent uses reuse it directly.

**Linux**: The Host should run as a systemd user service for the graphical user. It requires Python 3, GTK 3, X11/Xwayland, and the correct `DISPLAY`／`XAUTHORITY` environment. This was verified using the existing Xwayland clipboard bridge on GNOME Wayland; not all compositors were covered, and a standalone pure Wayland data-control backend has not been implemented.

Receive directory:

| Endpoint | Default location |
| --- | --- |
| Controller | Under the Electron user directory `clipboard/received`, view Settings to find the actual user directory |
| Windows Host | `%ProgramData%\Lanto\Host\clipboard\desktop\received` |
| macOS／Linux Host | `~/.lanto/host/clipboard/received` |

## 2026-10-17 Hardware Validation

With the Windows controller left running, the Mac, Linux, and Windows Hosts each served as a copy source: small files with Unicode/newline/emoji text and Chinese filenames were transferred to all endpoints and verified by comparing content SHA-256 hashes. Also verified that a 2×2 PNG sent from Mac to the Linux and Windows Hosts and the controller had identical byte digests.

Copied a folder from the controller containing a **4,294,967,312-byte (4 GiB + 16 bytes)** file, along with a file with a Chinese name, a zero-byte file, and an empty directory. All three Hosts read the entire contents and produced the same SHA-256:`1065e981d5a908a1b87d00e87a2d55d3c08ae6ffd91d1cceffb91bdd2f645770`, and the empty file and empty directory were also present. The controller main process working set was about 156 MiB during the transfer and did not allocate memory proportional to the total file size. The first Windows transfer encountered one TLS record verification failure and did not submit partial files; copying again completed successfully without lowering TLS verification requirements. The root cause of that network error has not been identified, so this does not support a claim that long-running transfer stability has been verified.

After Shared Files was actually turned off, text still reached all three endpoints, while copying files did not trigger a transfer; after all sharing was turned off, newly copied local text did not change remote contents. A large-file transfer was canceled after about 85–252 MiB; all three retained their original image clipboard and cleaned up unfinished files. Automation also covers pairing authentication, the file toggle, source file changes, incomplete transfers, protection against new destination copies, invalidation of queued requests after sharing is turned off, forwarding across three endpoints, and duplicate event suppression.
