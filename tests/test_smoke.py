import subprocess


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("database_ok") is True
    assert payload.get("ffmpeg_available") is True


def test_system_info(client):
    response = client.get("/api/system/info")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ffmpeg"]["available"] is True
    assert payload["ffmpeg"]["ass"] is True


def test_settings_round_trip(client):
    response = client.get("/api/settings")
    assert response.status_code == 200
    original = response.json()["settings"]

    patch = {"visual_analysis_default": not original.get("visual_analysis_default", False)}
    response = client.patch("/api/settings", json=patch)
    assert response.status_code == 200
    assert response.json()["settings"]["visual_analysis_default"] == patch["visual_analysis_default"]

    # restore
    client.patch("/api/settings", json={"visual_analysis_default": original.get("visual_analysis_default", False)})


def test_upload_and_delete(client, tmp_path):
    from backend.core.config import get_settings

    source = tmp_path / "sample.mp4"
    subprocess.run(
        [
            get_settings().ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=10:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    with source.open("rb") as handle:
        response = client.post(
            "/api/projects/upload",
            files={"file": ("sample.mp4", handle, "video/mp4")},
            data={"name": "Smoke Test Project"},
        )
    assert response.status_code in (200, 201)
    project = response.json()
    assert project["id"]
    assert project["duration"] and project["duration"] > 0

    delete = client.delete(f"/api/projects/{project['id']}")
    assert delete.status_code == 204 or delete.status_code == 200
