from __future__ import annotations

import atexit
import os
import signal
from pathlib import Path

from src.reliability.control_app import _stop_controller, create_app
from src.reliability.service import ReliabilityController
from src.reliability.subprocess_launcher import SubprocessLauncher


root = Path(os.environ["AO04_DATA_ROOT"])
controller = ReliabilityController(root=root, launcher=SubprocessLauncher())
stopped = False


def stop() -> None:
    global stopped
    if stopped:
        return
    stopped = True
    _stop_controller(controller)


def handle_signal(_signum: int, _frame: object) -> None:
    stop()
    raise SystemExit(0)


atexit.register(stop)
signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

app = create_app(root=root, token=os.environ["AO04_CONTROL_TOKEN"], controller=controller)
app.run(
    host="127.0.0.1",
    port=int(os.environ["AO04_CONTROL_PORT"]),
    use_reloader=False,
    threaded=True,
)
