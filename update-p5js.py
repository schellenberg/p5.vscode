import argparse
from pathlib import Path

import requests


def latest_release(repo: str):
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    response = requests.get(
        url,
        timeout=20,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "cs30-p5-updater"},
    )
    response.raise_for_status()
    return response.json()


def download_asset(asset_url: str, destination: Path):
    response = requests.get(asset_url, stream=True, timeout=60)
    response.raise_for_status()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as file_handle:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                file_handle.write(chunk)


def asset_map(release_json):
    return {asset["name"]: asset["browser_download_url"] for asset in release_json.get("assets", [])}


def main():
    parser = argparse.ArgumentParser(description="Update bundled p5.js and p5.sound assets")
    parser.add_argument("--dry-run", action="store_true", help="Print planned downloads without writing files")
    args = parser.parse_args()

    target_dir = Path("template/libraries")
    p5_release = latest_release("processing/p5.js")
    sound_release = latest_release("processing/p5.sound.js")

    p5_assets = asset_map(p5_release)
    sound_assets = asset_map(sound_release)

    required = [
        ("p5.js", p5_assets),
        ("p5.min.js", p5_assets),
        ("p5.sound.min.js", sound_assets),
    ]

    print(f"p5.js release: {p5_release.get('tag_name', 'unknown')}")
    print(f"p5.sound.js release: {sound_release.get('tag_name', 'unknown')}")

    for name, source_map in required:
        if name not in source_map:
            raise RuntimeError(f"Missing asset '{name}' in source release")

        destination = target_dir / name
        source_url = source_map[name]
        print(f"{name} <- {source_url}")
        if not args.dry_run:
            download_asset(source_url, destination)

    if args.dry_run:
        print("Dry run complete. No files were written.")
    else:
        print("Update complete.")


if __name__ == "__main__":
    main()