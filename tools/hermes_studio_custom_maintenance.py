#!/usr/bin/env python3
"""Hermes Studio Custom Maintenance.

Safe local fallback for official app updates. It only replaces the installed
resources/webui/dist directory and keeps a dated rollback archive. User data
under Hermes profiles, Web UI state, credentials, and workspaces is never
read, moved, or deleted by the deployment operations.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from pathlib import PurePosixPath
from typing import Callable

try:
    import psutil
except ImportError as exc:  # pragma: no cover - surfaced by the GUI/CLI
    raise SystemExit("psutil is required: python -m pip install psutil") from exc


APP_NAME = "Hermes Studio"
DEFAULT_SOURCE = Path(r"C:\Users\owner\AppData\Local\hermes\workspace\hermes-studio-src")
DEFAULT_WORKSPACE = Path(r"C:\Users\owner\AppData\Local\hermes\workspace")
DEFAULT_INSTALL_ROOT = Path(r"C:\Users\owner\AppData\Local\Programs\Hermes Studio")
HEALTH_URL = "http://127.0.0.1:8748/"


def env_path(name: str, fallback: Path) -> Path:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else fallback


SOURCE_ROOT = env_path("HERMES_STUDIO_SOURCE", DEFAULT_SOURCE)
WORKSPACE_ROOT = env_path("HERMES_STUDIO_WORKSPACE", DEFAULT_WORKSPACE)
INSTALL_ROOT = env_path("HERMES_STUDIO_INSTALL_ROOT", DEFAULT_INSTALL_ROOT)
INSTALL_DIST = INSTALL_ROOT / "resources" / "webui" / "dist"
EXE = INSTALL_ROOT / "Hermes Studio.exe"
BACKUP_PREFIX = "hermes-studio-dist-backup-"


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def node_executable() -> str:
    candidates = [
        os.environ.get("HERMES_NODE", "").strip(),
        str(SOURCE_ROOT / ".tools" / "node-v24.19.0-win-x64" / "node.exe"),
        shutil.which("node") or "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("Node.js 24 was not found. Set HERMES_NODE or install the portable Node used by the fork.")


def validate_dist(path: Path) -> None:
    required = [path / "client" / "index.html", path / "server" / "index.js"]
    missing = [str(item) for item in required if not item.is_file()]
    if missing:
        raise RuntimeError(f"Bundle incomplet, fichiers manquants : {missing}")
    if not list((path / "client" / "assets" / "js").glob("CodeWorkspaceView-*.js")):
        raise RuntimeError("Le build ne contient pas le workspace Code.")
    index = (path / "client" / "index.html").read_text(encoding="utf-8", errors="ignore")
    if "hermes-local-" in index:
        raise RuntimeError("Le build contient encore l'ancien prototype injecté.")


def studio_processes() -> list[psutil.Process]:
    expected = str(EXE).lower()
    found: list[psutil.Process] = []
    for process in psutil.process_iter(["name", "exe"]):
        try:
            name = str(process.info.get("name") or "").lower()
            executable = str(process.info.get("exe") or "").lower()
            if name == "hermes studio.exe" and (not executable or executable == expected):
                found.append(process)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return found


def stop_studio(log: Callable[[str], None] = print) -> list[int]:
    processes = studio_processes()
    pids = [process.pid for process in processes]
    for process in processes:
        try:
            process.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    _, alive = psutil.wait_procs(processes, timeout=12)
    for process in alive:
        try:
            process.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    if alive:
        psutil.wait_procs(alive, timeout=8)
    remaining = studio_processes()
    if remaining:
        raise RuntimeError(f"Hermes Studio ne se ferme pas : {[p.pid for p in remaining]}")
    if pids:
        log(f"Hermes Studio fermé ({', '.join(map(str, pids))}).")
    return pids


def launch_studio(log: Callable[[str], None] = print) -> int:
    if not EXE.is_file():
        raise RuntimeError(f"Executable introuvable : {EXE}")
    flags = 0
    flags |= getattr(subprocess, "DETACHED_PROCESS", 0)
    flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    process = subprocess.Popen(
        [str(EXE)],
        cwd=str(INSTALL_ROOT),
        creationflags=flags,
        close_fds=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log(f"Hermes Studio relancé (PID {process.pid}).")
    return process.pid


def wait_until_ready(timeout: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.75)
    return False


def backup_installed_dist(log: Callable[[str], None] = print) -> Path:
    validate_dist(INSTALL_DIST)
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    archive = WORKSPACE_ROOT / f"{BACKUP_PREFIX}{timestamp()}.zip"
    base = archive.with_suffix("")
    shutil.make_archive(str(base), "zip", root_dir=INSTALL_DIST.parent, base_dir=INSTALL_DIST.name)
    log(f"Backup créé : {archive}")
    return archive


def latest_backup() -> Path:
    backups = sorted(WORKSPACE_ROOT.glob(f"{BACKUP_PREFIX}*.zip"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not backups:
        raise RuntimeError(f"Aucun backup trouvé dans {WORKSPACE_ROOT}")
    return backups[0]


def extract_backup(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        destination = destination.resolve()
        for member in bundle.infolist():
            normalized = member.filename.replace("\\", "/")
            parts = PurePosixPath(normalized).parts
            if normalized.startswith("/") or (parts and ":" in parts[0]) or ".." in parts:
                raise RuntimeError(f"Backup ZIP path is unsafe: {member.filename}")
            target = (destination.joinpath(*parts)).resolve()
            if target != destination and destination not in target.parents:
                raise RuntimeError(f"Backup ZIP escapes its extraction directory: {member.filename}")
        bundle.extractall(destination)
    extracted = destination / "dist"
    validate_dist(extracted)
    return extracted


def install_dist(source_dist: Path, label: str, log: Callable[[str], None] = print) -> dict[str, object]:
    source_dist = source_dist.resolve()
    validate_dist(source_dist)
    if not INSTALL_DIST.is_dir():
        raise RuntimeError(f"Bundle installé introuvable : {INSTALL_DIST}")

    archive = backup_installed_dist(log)
    stopped = stop_studio(log)
    staging = INSTALL_DIST.with_name("dist.hermes-maintenance-staging")
    previous = INSTALL_DIST.with_name("dist.hermes-maintenance-previous")
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(previous, ignore_errors=True)
    shutil.copytree(source_dist, staging)
    validate_dist(staging)
    INSTALL_DIST.rename(previous)
    try:
        staging.rename(INSTALL_DIST)
        validate_dist(INSTALL_DIST)
        launch_studio(log)
        if not wait_until_ready():
            raise RuntimeError("Le serveur Hermes Studio ne répond pas après l'installation.")
    except Exception:
        log("Échec : restauration automatique du bundle précédent.")
        try:
            stop_studio(log)
        except Exception as stop_error:
            log(f"Fermeture du renderer après échec impossible : {stop_error}")
        shutil.rmtree(INSTALL_DIST, ignore_errors=True)
        if previous.exists():
            previous.rename(INSTALL_DIST)
        try:
            launch_studio(log)
            wait_until_ready(timeout=30)
        except Exception as relaunch_error:
            log(f"Relance après restauration impossible : {relaunch_error}")
        raise
    finally:
        shutil.rmtree(previous, ignore_errors=True)

    log(f"{label} appliqué avec succès. Les données utilisateur n'ont pas été touchées.")
    return {"ok": True, "backup": str(archive), "stopped_pids": stopped, "target": str(INSTALL_DIST)}


def reapply_local_build(log: Callable[[str], None] = print) -> dict[str, object]:
    source_dist = SOURCE_ROOT / "dist"
    return install_dist(source_dist, "Build custom local", log)


def rollback_latest(log: Callable[[str], None] = print) -> dict[str, object]:
    archive = latest_backup()
    log(f"Rollback depuis : {archive}")
    with tempfile.TemporaryDirectory(prefix="hermes-studio-rollback-") as temporary:
        source_dist = extract_backup(archive, Path(temporary))
        result = install_dist(source_dist, "Rollback", log)
    result["restored_backup"] = str(archive)
    return result


def report_upstream(log: Callable[[str], None] = print) -> dict[str, object]:
    script = SOURCE_ROOT / "scripts" / "custom-update-manager.mjs"
    if not script.is_file():
        raise RuntimeError(f"Comparateur introuvable : {script}")
    output = WORKSPACE_ROOT / f"hermes-studio-update-report-{timestamp()}.json"
    command = [
        node_executable(),
        str(script),
        "report",
        "--repo",
        str(SOURCE_ROOT),
        "--ours",
        "feat/agents-tasks-code-workspace",
        "--theirs",
        "upstream/main",
        "--output",
        str(output),
    ]
    completed = subprocess.run(command, cwd=SOURCE_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode not in (0, 2):
        raise RuntimeError(completed.stderr.strip() or "Le comparateur upstream a échoué.")
    if not output.is_file():
        raise RuntimeError("Le comparateur n'a pas produit de rapport.")
    report = json.loads(output.read_text(encoding="utf-8"))
    report["reportPath"] = str(output)
    return report


def run_cli(action: str) -> int:
    if action == "reapply":
        print(json.dumps(reapply_local_build(), ensure_ascii=False, indent=2))
    elif action == "rollback":
        print(json.dumps(rollback_latest(), ensure_ascii=False, indent=2))
    elif action == "report":
        print(json.dumps(report_upstream(), ensure_ascii=False, indent=2))
    else:
        raise ValueError(action)
    return 0


class MaintenanceWindow:
    BG = "#0d1117"
    CARD = "#161b22"
    BORDER = "#30363d"
    TEXT = "#e6edf3"
    MUTED = "#8b949e"
    BLUE = "#58a6ff"
    GREEN = "#238636"
    RED = "#f85149"

    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.root = tk.Tk()
        self.root.title("Hermes Studio Custom — Maintenance")
        self.root.geometry("760x680")
        self.root.minsize(680, 600)
        self.root.configure(bg=self.BG)
        self.jobs: queue.Queue[tuple[str, object]] = queue.Queue()
        self.busy = False

        title = tk.Label(self.root, text="Hermes Studio Custom", bg=self.BG, fg=self.TEXT, font=("Segoe UI", 20, "bold"))
        title.pack(anchor="w", padx=28, pady=(24, 2))
        subtitle = tk.Label(self.root, text="Réappliquer, analyser ou restaurer — sans toucher à vos données Hermes.", bg=self.BG, fg=self.MUTED, font=("Segoe UI", 10))
        subtitle.pack(anchor="w", padx=30, pady=(0, 18))

        card = tk.Frame(self.root, bg=self.CARD, highlightbackground=self.BORDER, highlightthickness=1)
        card.pack(fill="x", padx=24, pady=4)
        tk.Label(card, text="Actions sûres", bg=self.CARD, fg=self.TEXT, font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=20, pady=(16, 8))
        buttons = tk.Frame(card, bg=self.CARD)
        buttons.pack(fill="x", padx=20, pady=(0, 18))
        self._button(buttons, "Analyser upstream", self._report, self.BLUE).pack(side="left", fill="x", expand=True, padx=(0, 8))
        self._button(buttons, "Réappliquer le build custom", self._reapply, self.GREEN).pack(side="left", fill="x", expand=True, padx=8)
        self._button(buttons, "Rollback dernier backup", self._rollback, self.RED).pack(side="left", fill="x", expand=True, padx=(8, 0))

        info = tk.Frame(self.root, bg=self.CARD, highlightbackground=self.BORDER, highlightthickness=1)
        info.pack(fill="x", padx=24, pady=(14, 4))
        tk.Label(info, text="Périmètre protégé", bg=self.CARD, fg=self.TEXT, font=("Segoe UI", 11, "bold")).pack(anchor="w", padx=20, pady=(14, 4))
        tk.Label(info, text="Profils · sessions · credentials · skills · workspaces · bases Hermes", bg=self.CARD, fg="#3fb950", font=("Segoe UI", 10)).pack(anchor="w", padx=20, pady=(0, 14))

        self.status = tk.Label(self.root, text="Prêt.", bg=self.BG, fg=self.MUTED, font=("Segoe UI", 10), anchor="w")
        self.status.pack(fill="x", padx=28, pady=(18, 6))
        self.output = tk.Text(self.root, height=16, bg="#010409", fg=self.TEXT, insertbackground=self.TEXT, relief="flat", borderwidth=0, font=("Consolas", 9), wrap="word")
        self.output.pack(fill="both", expand=True, padx=24, pady=(0, 20))
        self.root.after(100, self._drain_jobs)
        self._write(f"Source : {SOURCE_ROOT}\nBundle installé : {INSTALL_DIST}\n")

    def _button(self, parent, text: str, command: Callable[[], None], color: str):
        import tkinter as tk
        return tk.Button(parent, text=text, command=command, bg=color, fg="white", activebackground=color, activeforeground="white", relief="flat", borderwidth=0, padx=12, pady=10, font=("Segoe UI", 10, "bold"), cursor="hand2")

    def _write(self, text: str) -> None:
        self.output.insert("end", text.rstrip() + "\n")
        self.output.see("end")

    def _start(self, label: str, action: Callable[[Callable[[str], None]], object]) -> None:
        if self.busy:
            return
        self.busy = True
        self.status.configure(text=f"{label}…", fg=self.BLUE)
        self._write(f"\n=== {label} ===")

        def worker() -> None:
            try:
                result = action(lambda line: self.jobs.put(("log", line)))
                self.jobs.put(("done", result))
            except Exception as exc:  # pragma: no cover - GUI failure path
                self.jobs.put(("error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def _report(self) -> None:
        self._start("Analyse upstream", report_upstream)

    def _reapply(self) -> None:
        self._start("Réapplication du build custom", reapply_local_build)

    def _rollback(self) -> None:
        self._start("Rollback", rollback_latest)

    def _drain_jobs(self) -> None:
        try:
            while True:
                kind, value = self.jobs.get_nowait()
                if kind == "log":
                    self._write(str(value))
                elif kind == "done":
                    self.busy = False
                    self.status.configure(text="Terminé avec succès.", fg="#3fb950")
                    self._write(json.dumps(value, ensure_ascii=False, indent=2))
                else:
                    self.busy = False
                    self.status.configure(text="Échec — consultez le rapport.", fg=self.RED)
                    self._write(f"ERREUR : {value}")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_jobs)

    def run(self) -> None:
        self.root.mainloop()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hermes Studio Custom maintenance tool")
    parser.add_argument("action", nargs="?", choices=["gui", "report", "reapply", "rollback"], default="gui")
    args = parser.parse_args(argv)
    if args.action == "gui":
        MaintenanceWindow().run()
        return 0
    return run_cli(args.action)


if __name__ == "__main__":
    raise SystemExit(main())
