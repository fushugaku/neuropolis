from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
import os
import webbrowser

root = Path(__file__).resolve().parents[1] / "web/dist"
port = int(os.environ.get("NEUROPOLIS_PORT", os.environ.get("METROPOLIX_PORT", "8765")))
class InstrumentHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

server = ThreadingHTTPServer(("127.0.0.1", port), partial(InstrumentHandler, directory=str(root)))
print(f"neuropolis · Local: http://127.0.0.1:{port}", flush=True)
if os.environ.get("NEUROPOLIS_OPEN_BROWSER", os.environ.get("METROPOLIX_OPEN_BROWSER")) == "1":
    webbrowser.open(f"http://127.0.0.1:{port}")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
