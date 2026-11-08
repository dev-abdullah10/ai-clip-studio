import os
import tempfile
from pathlib import Path

import pytest

# Isolate storage for every test run.
_STORAGE = Path(tempfile.mkdtemp(prefix="aics-test-"))
os.environ["AICS_STORAGE_DIR"] = str(_STORAGE)
os.environ["PYTHONIOENCODING"] = "utf-8"


@pytest.fixture(scope="session")
def storage_dir() -> Path:
    return _STORAGE


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from backend.main import app

    with TestClient(app) as c:
        yield c
