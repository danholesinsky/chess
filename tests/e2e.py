import http.server
import os
import socketserver
import threading
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS_DIR = os.path.join(ROOT, "tests", "screenshots")
os.makedirs(SHOTS_DIR, exist_ok=True)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, format, *args):
        pass


def start_server():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), QuietHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port


def run_suite(page, url, label):
    errors = []
    page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
    page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" else None)

    page.goto(url, wait_until="networkidle")

    # 1. Verify header & forbidden copy
    header_text = page.locator("header").inner_text().strip()
    assert "šachy" in header_text and "Nová hra" in header_text, f"Unexpected header: {header_text}"
    body_text = page.locator("body").inner_text()
    for forbidden in ["malé šachy", "Hrajeme si", "Každý tah se počítá"]:
        assert forbidden not in body_text, f"Forbidden text found: {forbidden}"

    # 2. Verify mobile vertical order: status card MUST be above mode card
    status_box = page.locator("#status-card").bounding_box()
    mode_box = page.locator("#mode-card").bounding_box()
    assert status_box["y"] < mode_box["y"], f"Status ({status_box['y']}) must precede Mode ({mode_box['y']})"

    # 3. Verify 64 squares exist and capture references for DOM identity stability check
    sq_count = page.locator("#board-grid .square").count()
    assert sq_count == 64, f"Expected 64 squares, got {sq_count}"
    page.evaluate("""() => {
      window.__sqRefs = Array.from(document.querySelectorAll('#board-grid .square'));
      window.__imgRefs = window.__sqRefs.map(s => s.querySelector('.sq-piece'));
    }""")

    # Measure initial board geometry
    initial_board_box = page.locator("#board-grid").bounding_box()
    initial_d5_box = page.locator('.square[data-square="d5"]').bounding_box()

    # 4. Select e2 -> verify Czech name, hint dots, preview, no premature move
    page.locator('.square[data-square="e2"]').click()
    assert "Pěšec (e2)" in page.locator("#white-selected").inner_text()
    assert page.locator("#btn-confirm-white").is_disabled()

    page.locator("#btn-hint-white").click()
    assert "has-hint-move" in page.locator('.square[data-square="e3"]').get_attribute("class")
    assert "has-hint-move" in page.locator('.square[data-square="e4"]').get_attribute("class")

    # Preview e2 -> e4
    page.locator('.square[data-square="e4"]').click()
    assert "has-preview" in page.locator('.square[data-square="e4"]').get_attribute("class")
    assert "is-preview-origin" in page.locator('.square[data-square="e2"]').get_attribute("class")
    assert page.locator("#preview-bar").is_visible()
    assert not page.locator("#btn-confirm-white").is_disabled()

    # Verify zero DOM node recreation after selection, hint, and preview
    same_nodes = page.evaluate("""() => {
      const curSq = Array.from(document.querySelectorAll('#board-grid .square'));
      const curImg = curSq.map(s => s.querySelector('.sq-piece'));
      return curSq.every((s, i) => s === window.__sqRefs[i]) &&
             curImg.every((img, i) => img === window.__imgRefs[i]);
    }""")
    assert same_nodes, "Board square or piece DOM nodes were recreated on click!"

    if label == "modular-iphone":
        page.screenshot(path=os.path.join(SHOTS_DIR, "iphone_computer_preview.png"), full_page=False)

    # Cancel preview via "Rozmyslet si tah"
    page.locator("#btn-cancel-preview").click()
    assert not page.locator("#preview-bar").is_visible()
    assert page.locator("#btn-confirm-white").is_disabled()

    # Re-stage e2 -> e4 and confirm
    page.locator('.square[data-square="e4"]').click()
    page.locator("#btn-confirm-white").click()

    # Wait for white animation + computer response animation
    page.wait_for_function("() => Number(document.getElementById('history-count').textContent) === 2", timeout=5000)

    # 5. Switch to PvP mode (should ask confirmation since moves were played)
    page.locator("#btn-mode-pvp").click()
    assert page.locator("#confirm-modal").is_visible()
    page.locator("#btn-confirm-ok").click()
    assert not page.locator("#confirm-modal").is_visible()

    # Verify PvP orientation
    assert "is-rotated" in page.locator("#panel-black").get_attribute("class")
    assert page.locator("#coords-top").is_visible()
    assert page.locator("#coords-right").is_visible()
    assert "piece-rotated" in page.locator('.square[data-square="d7"] .sq-piece').get_attribute("class")
    assert "piece-rotated" not in page.locator('.square[data-square="e2"] .sq-piece').get_attribute("class")

    # Play 1. e2-e4 (White)
    page.locator('.square[data-square="e2"]').click()
    page.locator('.square[data-square="e4"]').click()
    page.locator("#btn-confirm-white").click()
    page.wait_for_function("() => Number(document.getElementById('history-count').textContent) === 1", timeout=4000)

    # Verify it's Black's turn: White disabled, Black enabled
    assert page.locator("#btn-hint-white").is_disabled()
    assert not page.locator("#btn-hint-black").is_disabled()

    # Play 1... d7-d5 (Black)
    page.locator('.square[data-square="d7"]').click()
    assert "Pěšec (d7)" in page.locator("#black-selected").inner_text()
    page.locator('.square[data-square="d5"]').click()
    page.locator("#btn-confirm-black").click()
    page.wait_for_function("() => Number(document.getElementById('history-count').textContent) === 2", timeout=4000)

    # Stage capture preview 2. e4xd5 and check geometry stability!
    page.locator('.square[data-square="e4"]').click()
    page.locator('.square[data-square="d5"]').click()

    d5_classes = page.locator('.square[data-square="d5"]').get_attribute("class")
    assert "has-preview" in d5_classes, f"d5 missing has-preview: {d5_classes}"
    assert "is-capture-hidden" in d5_classes, f"d5 missing is-capture-hidden: {d5_classes}"
    assert "has-capture-badge" in d5_classes, f"d5 missing has-capture-badge: {d5_classes}"

    capture_board_box = page.locator("#board-grid").bounding_box()
    capture_d5_box = page.locator('.square[data-square="d5"]').bounding_box()

    # Note: in PvP right coords add 18px so compare PvP board vs PvP d5 ratios & squareness
    assert abs(capture_d5_box["width"] - capture_d5_box["height"]) < 0.5, (
        f"Capture square d5 distorted: {capture_d5_box}"
    )
    assert abs(capture_board_box["width"] - capture_board_box["height"]) < 0.5, (
        f"Board distorted during capture preview: {capture_board_box}"
    )

    if label == "modular-iphone":
        page.screenshot(path=os.path.join(SHOTS_DIR, "iphone_pvp_capture_preview.png"), full_page=False)

    # Switch back to Computer mode and verify orientation restored
    page.locator("#btn-mode-computer").click()
    page.locator("#btn-confirm-ok").click()
    assert "is-rotated" not in page.locator("#panel-black").get_attribute("class")
    assert not page.locator("#coords-top").is_visible()
    assert not page.locator("#coords-right").is_visible()
    assert "piece-rotated" not in page.locator('.square[data-square="d7"] .sq-piece').get_attribute("class")

    assert not errors, f"Console/Page errors in {label}: {errors}"
    print(f"✓ E2E passed: {label}")


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # 1. Modular app on iPhone 15 Pro Max viewport (430x932)
            ctx_iphone = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx_iphone.new_page()
            run_suite(page, f"http://127.0.0.1:{port}/index.html", "modular-iphone")
            ctx_iphone.close()

            # 2. Standalone single-file HTML on iPad viewport (768x1024)
            ctx_ipad = browser.new_context(viewport={"width": 768, "height": 1024}, device_scale_factor=2)
            page_ipad = ctx_ipad.new_page()
            run_suite(page_ipad, f"http://127.0.0.1:{port}/dist/sachy.html", "standalone-ipad")
            page_ipad.screenshot(path=os.path.join(SHOTS_DIR, "ipad_computer.png"), full_page=False)
            ctx_ipad.close()

            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
