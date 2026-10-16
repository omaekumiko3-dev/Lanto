#!/usr/bin/env python3
"""Copy Homebrew runtime libraries into a staged app before code signing."""
import argparse
import pathlib
import shutil
import subprocess


def dependencies(binary):
    output = subprocess.check_output(["otool", "-L", str(binary)], text=True)
    return [line.strip().split(" (", 1)[0] for line in output.splitlines()[1:]]


def external_library(dependency, origin):
    if dependency.startswith("@loader_path/"):
        candidate = origin.parent / dependency[len("@loader_path/"):]
    elif dependency.startswith(("/opt/homebrew/", "/usr/local/")):
        candidate = pathlib.Path(dependency)
    else:
        return None
    source = candidate.resolve(strict=True)
    return source if str(source).startswith(("/opt/homebrew/", "/usr/local/")) else None


def verify_dependencies(binary, executable, app):
    for dependency in dependencies(binary):
        if dependency.startswith(("/System/Library/", "/usr/lib/")):
            continue
        # otool also prints a dylib's own LC_ID_DYLIB entry.
        if binary != executable and dependency == "@rpath/" + binary.name:
            continue
        if dependency.startswith("@loader_path/"):
            target = binary.parent / dependency[len("@loader_path/"):]
        elif dependency.startswith("@executable_path/"):
            target = executable.parent / dependency[len("@executable_path/"):]
        else:
            raise RuntimeError("Unresolved dependency: " + dependency)
        target = target.resolve(strict=True)
        if not target.is_relative_to(app):
            raise RuntimeError("Dependency escapes app: " + dependency)


def bundle(app):
    app = pathlib.Path(app).resolve(strict=True)
    executable = app / "Contents/MacOS/Sunshine"
    if app.suffix != ".app" or not executable.is_file():
        raise ValueError("Expected a staged Sunshine .app")
    frameworks = app / "Contents/Frameworks"
    frameworks.mkdir(exist_ok=True)
    sources = {}
    pending = [executable]
    scanned = set()
    while pending:
        binary = pending.pop()
        if binary in scanned:
            continue
        scanned.add(binary)
        for dependency in dependencies(binary):
            source = external_library(dependency, binary)
            if source is None:
                continue
            name = source.name
            if name in sources and sources[name] != source:
                raise ValueError("Conflicting library name: " + name)
            if name not in sources:
                sources[name] = source
                shutil.copy2(source, frameworks / name)
                pending.append(source)
                formula = source.parent.parent
                notices = app / "Contents/Resources/third-party" / (formula.parent.name + "-" + formula.name)
                for notice in formula.rglob("*"):
                    if notice.is_file() and notice.name.lower().startswith(("license", "copying", "copyright", "notice")):
                        destination = notices / notice.relative_to(formula)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(notice, destination)
    for binary in [executable] + [frameworks / name for name in sources]:
        origin = executable if binary == executable else sources[binary.name]
        for dependency in dependencies(origin):
            source = external_library(dependency, origin)
            if source is not None:
                name = source.name
                prefix = "@executable_path/../Frameworks/" if binary == executable else "@loader_path/"
                subprocess.run(["install_name_tool", "-change", dependency, prefix + name, str(binary)], check=True)
        if binary != executable:
            subprocess.run(["install_name_tool", "-id", "@rpath/" + binary.name, str(binary)], check=True)
    for binary in [executable] + [frameworks / name for name in sources]:
        verify_dependencies(binary, executable, app)
    print("Bundled {} runtime libraries; sign the app before deploying".format(len(sources)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", help="Staged app; never modify a running installation")
    bundle(parser.parse_args().app)
