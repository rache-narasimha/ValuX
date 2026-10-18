"""Application entry point.

Run with: python -m backend.server
"""

import os
from http.server import ThreadingHTTPServer

from backend.app.auth.config import validate_secrets
from backend.app.auth.database import wait_for_database
from backend.app.web.handler import Handler


def main():
    validate_secrets()
    wait_for_database()
    address = (os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "4173")))
    print(f"ValuX running at http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, Handler).serve_forever()


if __name__ == "__main__":
    main()
