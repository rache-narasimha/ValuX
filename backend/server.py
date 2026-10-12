"""Application entry point.

Run with: python -m backend.server
"""

import os
from http.server import ThreadingHTTPServer

from backend.app.web import Handler


def main():
    address = (os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "4173")))
    print(f"Valuation form running at http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, Handler).serve_forever()


if __name__ == "__main__":
    main()

