#!/usr/bin/env python3
"""Render committed SVG brand artwork into checked-in PNG assets.
Runs in GitHub Actions after a brand source changes; not in Cloudflare."""
from pathlib import Path
import cairosvg

root = Path(__file__).resolve().parent.parent

def render(svg: str, dest: str, w: int, h: int):
    path = root / dest
    path.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(url=str(root / svg), write_to=str(path),
                     output_width=w, output_height=h)
    print(f"Rendered {dest}: {w}x{h}")

if __name__ == "__main__":
    render("assets/brand/mark.svg", "assets/app-192.png", 192, 192)
    render("assets/brand/mark.svg", "assets/app-512.png", 512, 512)
    render("assets/brand/mark.svg", "assets/brand/apple-touch-180.png", 180, 180)
    render("assets/brand/social-default.svg",
           "assets/brand/social-default.png", 1200, 630)
