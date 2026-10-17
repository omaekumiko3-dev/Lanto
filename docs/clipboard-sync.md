# Shared Clipboard and Files

Enable **Shared clipboard** at the top of the device page to synchronize newly copied text and images between this computer and all paired, online Hosts signed in to their desktops. The adjacent arrow opens the separate **Share files** switch, online count, transfer progress, cancellation, and received-files directory. The main page no longer has a permanent bottom status bar. File sharing also requires clipboard sharing. Copied files and folders transfer automatically; when the popover says **Ready to paste**, they can be pasted in another device's file manager. No remote display connection is needed.

The controller is the synchronization hub and must remain running. Remote-to-remote files pass through it, so both the controller and receiver need sufficient free disk space. Manually added streaming devices that are not paired through Lanto Host do not participate. Both switches default to off. Initial enablement samples current state but synchronizes only subsequent copies. Disabling sharing stops sampling, revokes leases, and cancels transfers. Disabling only file sharing leaves text and image synchronization available.

## File behavior

- No application-level file-byte limit is imposed. Streaming reads/writes, backpressure, and SHA-256 verification avoid loading whole files into memory. Sizes use decimal strings and BigInt. Disk, operating-system, and filesystem limits still apply.
- Multiple regular files, folders, Chinese filenames, empty files, and empty folders are supported. One copy allows up to 100,000 file/directory entries and a 36 MiB JSON manifest. These are manifest limits, not a per-file byte limit.
- The target clipboard updates only after complete transfer and verification. Source changes, a newer target copy, connection loss, or cancellation abort commit and clean incomplete copies; partial files cannot be pasted. Copy again after a disconnection to retry. Resumable transfer is not implemented.
- Each reception uses a separate directory without overwriting existing files. Windows-invalid filename characters become underscores; collisions after case folding or normalization fail explicitly. Symbolic links and special device files are excluded. Filesystem metadata such as permissions, ACLs, and extended attributes is not preserved across endpoints.
- Completed files remain cached so clipboard file paths do not immediately become invalid. **Received files** opens the local receiving directory. Delete completed files manually once they are no longer needed; quitting or disabling sharing does not delete them.

Images transfer as PNG, with an approximately 18 MiB compressed-image limit. Text allows up to 16 Mi UTF-16 units and is also constrained by JSON request size. Rich text becomes plain text; application-private formats are not transferred. Simultaneous copies follow the last update observed by the controller. Clipboard history is not provided.

## Desktop components and installation

Host interfaces retain certificate pinning and pairing tokens without adding public services or anonymous file endpoints. Clipboard content does not enter logs. The controller renews leases every three seconds, with a twelve-second lifetime. After an abnormal exit, Host stops sampling and cleans unfinished transfers automatically.

**Windows:** A LOCAL SERVICE Host cannot directly access the signed-in desktop clipboard, so the runtime includes `install-windows-clipboard.ps1`. On the machine with the target desktop user already signed in, run as administrator:

```powershell
& 'C:\Program Files\Lanto Host\<runtime-directory>\install-windows-host.ps1' -Name MyWindows -Address <LAN-IP>
& 'C:\Program Files\Lanto Host\<runtime-directory>\install-windows-clipboard.ps1'
```

The second command creates the `Lanto Clipboard` login task running as the desktop user with ordinary privileges. The main Host remains LOCAL SERVICE and forwards only authenticated clipboard operations to a loopback desktop bridge protected by a random token. The desktop user receives runtime read access and modify access to `ProgramData\Lanto\Host\clipboard\desktop`; existing permissions on Host identity and pairing secrets remain unchanged. Rerun the clipboard installer after rerunning the Host installer. Clipboard access stops at logout and resumes automatically at login.

**macOS:** Host should run in the signed-in user's LaunchAgent session. Initial use requires `xcrun swiftc` from Xcode Command Line Tools to compile the bundled AppKit helper into a private cache; later runs reuse it.

**Linux:** Host should run as a graphical user's systemd user service. It requires Python 3, GTK 3, X11/Xwayland, and correct `DISPLAY`/`XAUTHORITY` variables. Verification used GNOME Wayland's existing Xwayland clipboard bridge. Other compositors are not comprehensively covered, and a standalone pure-Wayland data-control backend is not implemented.

Receiving directories:

| Endpoint | Default location |
| --- | --- |
| Controller | `clipboard/received` under the Electron user directory; Settings shows its actual location |
| Windows Host | `%ProgramData%\Lanto\Host\clipboard\desktop\received` |
| macOS/Linux Host | `~/.lanto/host/clipboard/received` |

## Physical verification on 2026-10-17

With the Windows controller running, Mac, Linux, and Windows Hosts each served as copy sources. Unicode/newline/emoji text and small files with Chinese filenames reached every endpoint and passed content SHA-256 comparison. A 2×2 PNG sent from Mac also had identical byte hashes on Linux, Windows Host, and the controller.

A controller copy included a folder containing a **4,294,967,312-byte file (4 GiB + 16 bytes)**, a file with a Chinese filename, a zero-byte file, and an empty directory. All three Hosts fully read the same SHA-256: `1065e981d5a908a1b87d00e87a2d55d3c08ae6ffd91d1cceffb91bdd2f645770`; the empty file and directory also existed. The controller main-process working set was approximately 156 MiB during transfer, without allocating memory proportional to the whole file. The first Windows transfer encountered one TLS record verification failure and did not commit partial files. Copying again succeeded without weakening TLS verification. The network failure's root cause remains unknown, so this does not establish long-term transfer stability.

After file sharing was disabled on real machines, text still reached all three endpoints while file copies triggered no transfer. After all sharing was disabled, newly copied local text left remote contents unchanged. Cancelling large-file transfers after approximately 85–252 MiB preserved the prior image clipboard on all three Hosts and cleaned unfinished files. Automation also covers pairing authentication, file switches, source changes, incomplete transfers, newer target-copy protection, queued request invalidation after disablement, three-endpoint forwarding, and duplicate-event suppression.
