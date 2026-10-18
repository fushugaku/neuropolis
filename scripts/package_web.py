from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / "web/catalog.json").read_text())
(root / "web/dist/catalog.json").write_text(json.dumps(catalog, separators=(",", ":")))
