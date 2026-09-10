"""Start the current AO-04 demo controller from its saved local configuration."""

from __future__ import annotations

import json
import os
import runpy
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
CONFIG = HERE.parent / "m3-fastlane" / "web-e2e-current.json"


def main() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    output = Path(config["output"])
    private = json.loads((output / "private-control.json").read_text(encoding="utf-8"))
    os.environ.update(
        {
            "AO04_CONTROL_TOKEN": private["token"],
            "AO04_DATA_ROOT": str(output / "controller-data"),
            "AO04_BIND_DIR": str(output / "bindings"),
            "AO04_CONTROL_PORT": str(config["ports"]["controller"]),
            "AO04_SERVICE_DEMO": "1",
            "AO04_DEP_TIMEOUT_S": "4",
            "PYTHONPATH": config["controller"],
        }
    )
    sys.path.insert(0, config["controller"])
    runpy.run_path(
        str(HERE.parent / "m3-fastlane" / "run-control-service.py"),
        run_name="__main__",
    )


if __name__ == "__main__":
    main()
